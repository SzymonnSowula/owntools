//! Device sync through a folder somebody else already syncs (Dropbox,
//! OneDrive, iCloud Drive, Syncthing, a NAS share). No server, no account.
//!
//! The chosen folder is outside AppData, so every byte that goes there passes
//! through this module. Layout inside it:
//!
//! ```text
//! <folder>/owntools-sync/<deviceId>/manifest.json      { deviceId, deviceName, platform, appVersion, updatedAt }
//! <folder>/owntools-sync/<deviceId>/<collection>.json  { version: 1, updatedAt, items | value, tombstones }
//! <folder>/owntools-sync/<deviceId>/boards/<id>/…      folder collections, copied whole
//! ```
//!
//! A device writes **only its own subtree**; reading merges every other
//! device's (the merge itself is TypeScript, `packages/feature-sync/src/merge.ts`
//! — this side knows nothing about what a collection means). Writes are
//! temp-file + rename, so a cloud client never picks up a half-written JSON,
//! and a folder copy lands in a sibling temp dir that is swapped into place.
//!
//! The watcher (`notify`) debounces 2 s and ignores our own subtree, so our
//! writes never trigger our own re-read. Every command is `async` — none of
//! this may run on the main thread (see the disk ground rule).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

/// Name of the layout directory inside the chosen folder.
pub const LAYOUT_DIR: &str = "owntools-sync";
/// Where the chosen folder and the device identity are remembered (AppData).
const STATE_FILE: &str = "sync/state.json";
/// Event emitted after the folder changed and settled.
pub const CHANGED_EVENT: &str = "sync-changed";
const DEBOUNCE: Duration = Duration::from_secs(2);
/// Default size cap for a copied folder (a board with images, a meeting).
pub const DEFAULT_COPY_CAP: u64 = 20 * 1024 * 1024;
/// A collection file larger than this is not even parsed.
const MAX_JSON_BYTES: u64 = 64 * 1024 * 1024;

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Persisted {
    folder: Option<String>,
    device_id: Option<String>,
    device_name: Option<String>,
}

struct Watch {
    // Dropping the watcher closes its channel; the debounce thread then exits.
    _watcher: notify::RecommendedWatcher,
}

#[derive(Default)]
struct Runtime {
    persisted: Persisted,
    loaded: bool,
    watch: Option<Watch>,
    last_read: Option<i64>,
    last_write: Option<i64>,
}

static STATE: Mutex<Option<Runtime>> = Mutex::new(None);

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn app_data(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn load_persisted(app: &AppHandle) -> Persisted {
    let Ok(dir) = app_data(app) else {
        return Persisted::default();
    };
    match fs::read_to_string(dir.join(STATE_FILE)) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
            log::warn!("sync: state.json unreadable ({e}); starting clean");
            Persisted::default()
        }),
        Err(_) => Persisted::default(),
    }
}

fn save_persisted(app: &AppHandle, persisted: &Persisted) -> Result<(), String> {
    let path = app_data(app)?.join(STATE_FILE);
    let text = serde_json::to_string_pretty(persisted).map_err(|e| e.to_string())?;
    write_atomic(&path, text.as_bytes())
}

/// Runs `f` with the (lazily loaded) runtime state under the lock.
fn with_state<T>(app: &AppHandle, f: impl FnOnce(&mut Runtime) -> T) -> T {
    let mut guard = STATE.lock().unwrap_or_else(|p| p.into_inner());
    let runtime = guard.get_or_insert_with(Runtime::default);
    if !runtime.loaded {
        runtime.persisted = load_persisted(app);
        runtime.loaded = true;
    }
    f(runtime)
}

fn device_of(p: &Persisted) -> Result<Device, String> {
    match (&p.device_id, &p.device_name) {
        (Some(id), name) if !id.is_empty() => Ok(Device {
            device_id: id.clone(),
            device_name: name.clone().unwrap_or_else(|| "This PC".into()),
        }),
        _ => Err("sync: device identity not set yet".into()),
    }
}

fn folder_of(p: &Persisted) -> Result<PathBuf, String> {
    p.folder
        .as_deref()
        .filter(|f| !f.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| "sync: no folder chosen".to_string())
}

/* ------------------------------------------------------------------ */
/* Paths & files                                                       */
/* ------------------------------------------------------------------ */

/// A relative path from the frontend, checked so it can only name something
/// *inside* the directory it is joined onto: no absolute paths, no drive
/// letters, no `..`, no empty components.
pub fn safe_rel(rel: &str) -> Result<PathBuf, String> {
    let trimmed = rel.trim();
    if trimmed.is_empty() {
        return Err("empty path".into());
    }
    if trimmed.starts_with(['/', '\\']) {
        return Err(format!("refusing absolute path {rel:?}"));
    }
    let mut out = PathBuf::new();
    for raw in trimmed.split(['/', '\\']) {
        if raw.is_empty() || raw == "." {
            continue;
        }
        if raw == ".." || raw.contains(':') || raw.contains('\0') {
            return Err(format!("refusing path component {raw:?} in {rel:?}"));
        }
        out.push(raw);
    }
    if out.components().next().is_none() {
        return Err(format!("path {rel:?} names nothing"));
    }
    if out.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(format!("path {rel:?} is not a plain relative path"));
    }
    Ok(out)
}

/// `[a-z0-9][a-z0-9-]*`, at most 64 characters — the file stem of a collection.
pub fn valid_collection(name: &str) -> bool {
    let bytes = name.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 64
        && (bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit())
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
}

/// Write next to the target, then rename over it: a reader (or a cloud
/// client) sees the old file or the new one, never a torso.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("{} has no parent", path.display()))?;
    fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into());
    let tmp = parent.join(format!(".{name}.tmp-{}", std::process::id()));
    fs::write(&tmp, bytes).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("rename {} -> {}: {e}", tmp.display(), path.display()));
    }
    Ok(())
}

fn layout_root(folder: &Path) -> PathBuf {
    folder.join(LAYOUT_DIR)
}

fn device_dir(folder: &Path, device_id: &str) -> PathBuf {
    layout_root(folder).join(device_id)
}

fn mtime_ms(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn is_scratch(name: &str) -> bool {
    name.starts_with('.') || name.contains(".sync-tmp-") || name.contains(".sync-old-")
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub device_id: String,
    pub device_name: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub device_id: String,
    pub device_name: String,
    pub platform: String,
    pub app_version: String,
    pub updated_at: i64,
}

fn write_manifest(dir: &Path, device: &Device, app_version: &str, updated_at: i64) -> Result<(), String> {
    let manifest = Manifest {
        device_id: device.device_id.clone(),
        device_name: device.device_name.clone(),
        platform: std::env::consts::OS.to_string(),
        app_version: app_version.to_string(),
        updated_at,
    };
    let text = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    write_atomic(&dir.join("manifest.json"), text.as_bytes())
}

/// Lists the device directories under the layout root (names only).
fn list_device_dirs(folder: &Path) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(layout_root(folder)) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if is_scratch(&name) {
                continue;
            }
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                out.push(name);
            }
        }
    }
    out.sort();
    out
}

/// Checks the folder is a writable directory and creates this device's
/// subtree with a manifest. Returns every device directory found.
pub fn init_layout(folder: &Path, device: &Device, app_version: &str) -> Result<Vec<String>, String> {
    if !folder.is_dir() {
        return Err(format!("{} is not a folder", folder.display()));
    }
    let dir = device_dir(folder, &device.device_id);
    fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    // Prove we can write there before promising anything.
    let probe = dir.join(format!(".write-probe-{}", std::process::id()));
    fs::write(&probe, b"ok").map_err(|e| format!("{} is not writable: {e}", folder.display()))?;
    let _ = fs::remove_file(&probe);
    let existing = fs::read_to_string(dir.join("manifest.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<Manifest>(&t).ok());
    let updated_at = existing.map(|m| m.updated_at).unwrap_or_else(now_ms);
    write_manifest(&dir, device, app_version, updated_at)?;
    Ok(list_device_dirs(folder))
}

/// Writes one collection file into a device directory and bumps its manifest.
pub fn write_collection(
    dir: &Path,
    device: &Device,
    app_version: &str,
    collection: &str,
    json: &str,
) -> Result<i64, String> {
    if !valid_collection(collection) {
        return Err(format!("bad collection name {collection:?}"));
    }
    // Refuse to write something a reader would have to skip.
    serde_json::from_str::<Value>(json).map_err(|e| format!("{collection}: not JSON: {e}"))?;
    write_atomic(&dir.join(format!("{collection}.json")), json.as_bytes())?;
    let at = now_ms();
    write_manifest(dir, device, app_version, at)?;
    Ok(at)
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceRead {
    pub device_id: String,
    pub manifest: Value,
    pub collections: BTreeMap<String, Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadAll {
    pub devices: Vec<DeviceRead>,
    /// Files that were skipped, one line each — shown in the card.
    pub warnings: Vec<String>,
    pub read_at: i64,
}

fn read_json(path: &Path) -> Result<Value, String> {
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_JSON_BYTES {
        return Err(format!("{} bytes, over the limit", meta.len()));
    }
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str::<Value>(&text).map_err(|e| e.to_string())
}

/// Reads every device's manifest and collection files. A corrupt or
/// half-synced file is skipped and named in `warnings`; nothing is fatal short
/// of the layout directory being unreadable.
pub fn read_all(folder: &Path) -> Result<ReadAll, String> {
    let root = layout_root(folder);
    let mut devices = Vec::new();
    let mut warnings = Vec::new();
    let entries = match fs::read_dir(&root) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ReadAll { devices, warnings, read_at: now_ms() })
        }
        Err(e) => return Err(format!("read {}: {e}", root.display())),
    };
    let mut dirs: Vec<PathBuf> = entries
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .map(|e| e.path())
        .filter(|p| !p.file_name().map(|n| is_scratch(&n.to_string_lossy())).unwrap_or(true))
        .collect();
    dirs.sort();
    for dir in dirs {
        let dir_name = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let manifest = match read_json(&dir.join("manifest.json")) {
            Ok(v) => v,
            Err(e) => {
                warnings.push(format!("{dir_name}/manifest.json: {e}"));
                continue;
            }
        };
        let device_id = manifest
            .get("deviceId")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| dir_name.clone());
        let mut collections = BTreeMap::new();
        let files = match fs::read_dir(&dir) {
            Ok(files) => files,
            Err(e) => {
                warnings.push(format!("{dir_name}: {e}"));
                continue;
            }
        };
        for file in files.flatten() {
            let name = file.file_name().to_string_lossy().to_string();
            if !file.file_type().map(|t| t.is_file()).unwrap_or(false) {
                continue;
            }
            if is_scratch(&name) || name == "manifest.json" || !name.ends_with(".json") {
                continue;
            }
            let stem = name.trim_end_matches(".json").to_string();
            if !valid_collection(&stem) {
                continue;
            }
            match read_json(&file.path()) {
                Ok(v) => {
                    collections.insert(stem, v);
                }
                Err(e) => warnings.push(format!("{dir_name}/{name}: {e}")),
            }
        }
        devices.push(DeviceRead { device_id, manifest, collections });
    }
    Ok(ReadAll { devices, warnings, read_at: now_ms() })
}

/* ------------------------------------------------------------------ */
/* Folder copies                                                       */
/* ------------------------------------------------------------------ */

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CopyOutcome {
    pub ok: bool,
    /// True when the source was over the size cap — nothing was written.
    pub skipped: bool,
    pub reason: Option<String>,
    pub bytes: u64,
    pub files: u64,
}

fn excluded(name: &std::ffi::OsStr, exclude: &[String]) -> bool {
    let n = name.to_string_lossy();
    exclude.iter().any(|x| x == n.as_ref())
}

/// Bytes and files under `dir`, skipping symlinks and the excluded top-level names.
pub fn dir_size(dir: &Path, exclude: &[String]) -> Result<(u64, u64), String> {
    fn walk(dir: &Path, exclude: &[String], top: bool, acc: &mut (u64, u64)) -> Result<(), String> {
        for entry in fs::read_dir(dir).map_err(|e| format!("read {}: {e}", dir.display()))?.flatten() {
            if top && excluded(&entry.file_name(), exclude) {
                continue;
            }
            let ft = entry.file_type().map_err(|e| e.to_string())?;
            if ft.is_symlink() {
                continue;
            }
            if ft.is_dir() {
                walk(&entry.path(), exclude, false, acc)?;
            } else if ft.is_file() {
                acc.0 += entry.metadata().map(|m| m.len()).unwrap_or(0);
                acc.1 += 1;
            }
        }
        Ok(())
    }
    let mut acc = (0, 0);
    walk(dir, exclude, true, &mut acc)?;
    Ok(acc)
}

fn copy_dir_recursive(src: &Path, dst: &Path, exclude: &[String], top: bool) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("create {}: {e}", dst.display()))?;
    for entry in fs::read_dir(src).map_err(|e| format!("read {}: {e}", src.display()))?.flatten() {
        if top && excluded(&entry.file_name(), exclude) {
            continue;
        }
        let ft = entry.file_type().map_err(|e| e.to_string())?;
        if ft.is_symlink() {
            continue;
        }
        let target = dst.join(entry.file_name());
        if ft.is_dir() {
            copy_dir_recursive(&entry.path(), &target, exclude, false)?;
        } else if ft.is_file() {
            fs::copy(entry.path(), &target).map_err(|e| format!("copy {}: {e}", entry.path().display()))?;
        }
    }
    Ok(())
}

/// Copies a folder whole: into a sibling temp dir first, then swapped into
/// place, so `dst` is always a complete copy. Over `cap` bytes → skipped.
pub fn copy_tree(src: &Path, dst: &Path, cap: u64, exclude: &[String]) -> Result<CopyOutcome, String> {
    if !src.is_dir() {
        return Err(format!("{} is not a folder", src.display()));
    }
    let (bytes, files) = dir_size(src, exclude)?;
    if bytes > cap {
        return Ok(CopyOutcome {
            ok: false,
            skipped: true,
            reason: Some(format!(
                "{} is {:.1} MB, over the {:.0} MB limit",
                src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                bytes as f64 / 1_048_576.0,
                cap as f64 / 1_048_576.0
            )),
            bytes,
            files,
        });
    }
    let parent = dst
        .parent()
        .ok_or_else(|| format!("{} has no parent", dst.display()))?;
    fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
    let name = dst
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| format!("{} has no name", dst.display()))?;
    let pid = std::process::id();
    let tmp = parent.join(format!(".{name}.sync-tmp-{pid}"));
    if tmp.exists() {
        let _ = fs::remove_dir_all(&tmp);
    }
    copy_dir_recursive(src, &tmp, exclude, true)?;
    if dst.exists() {
        let old = parent.join(format!(".{name}.sync-old-{pid}"));
        if old.exists() {
            let _ = fs::remove_dir_all(&old);
        }
        fs::rename(dst, &old).map_err(|e| format!("move aside {}: {e}", dst.display()))?;
        if let Err(e) = fs::rename(&tmp, dst) {
            let _ = fs::rename(&old, dst);
            let _ = fs::remove_dir_all(&tmp);
            return Err(format!("swap in {}: {e}", dst.display()));
        }
        let _ = fs::remove_dir_all(&old);
    } else {
        fs::rename(&tmp, dst).map_err(|e| format!("move {} into place: {e}", dst.display()))?;
    }
    Ok(CopyOutcome { ok: true, skipped: false, reason: None, bytes, files })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub is_dir: bool,
    pub mtime_ms: i64,
    /// Recursive for a folder.
    pub bytes: u64,
}

/// One level of a directory with sizes and modification times — what the
/// folder collections (boards, meetings) need to decide what changed.
pub fn scan_dir(dir: &Path) -> Result<Vec<Entry>, String> {
    let mut out = Vec::new();
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
        Err(e) => return Err(format!("read {}: {e}", dir.display())),
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if is_scratch(&name) {
            continue;
        }
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_symlink() {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let is_dir = ft.is_dir();
        let bytes = if is_dir { dir_size(&entry.path(), &[]).map(|s| s.0).unwrap_or(0) } else { meta.len() };
        out.push(Entry { name, is_dir, mtime_ms: mtime_ms(&meta), bytes });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/* ------------------------------------------------------------------ */
/* Watcher                                                             */
/* ------------------------------------------------------------------ */

fn start_watch(app: AppHandle, root: PathBuf, own_id: String) -> Result<Watch, String> {
    use notify::Watcher;
    let (tx, rx) = mpsc::channel::<PathBuf>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            for path in event.paths {
                let _ = tx.send(path);
            }
        }
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(&root, notify::RecursiveMode::Recursive)
        .map_err(|e| format!("watch {}: {e}", root.display()))?;
    // Our own subtree is filtered by the device id component: the paths notify
    // reports may differ from the chosen folder in case or `\\?\` prefix, so a
    // prefix comparison would be fragile.
    let own = std::ffi::OsString::from(own_id);
    let is_ours = move |p: &Path| p.components().any(|c| c.as_os_str() == own.as_os_str());
    std::thread::Builder::new()
        .name("sync-watch".into())
        .spawn(move || {
            while let Ok(first) = rx.recv() {
                let mut count: u32 = if is_ours(&first) { 0 } else { 1 };
                let mut deadline = Instant::now() + DEBOUNCE;
                loop {
                    let wait = deadline.saturating_duration_since(Instant::now());
                    match rx.recv_timeout(wait) {
                        Ok(path) => {
                            if !is_ours(&path) {
                                count += 1;
                                deadline = Instant::now() + DEBOUNCE;
                            }
                        }
                        Err(mpsc::RecvTimeoutError::Timeout) => break,
                        Err(mpsc::RecvTimeoutError::Disconnected) => {
                            if count > 0 {
                                let _ = app.emit(CHANGED_EVENT, serde_json::json!({ "paths": count }));
                            }
                            return;
                        }
                    }
                }
                if count > 0 {
                    log::info!("sync: folder changed ({count} paths), telling the frontend");
                    let _ = app.emit(CHANGED_EVENT, serde_json::json!({ "paths": count }));
                }
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(Watch { _watcher: watcher })
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

fn app_version(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

/// The frontend owns the identity (localStorage); Rust remembers it too, so a
/// wiped WebView profile can adopt the id its files were written under.
#[tauri::command(async)]
pub fn sync_set_device(app: AppHandle, device_id: String, device_name: String) -> Result<(), String> {
    if device_id.trim().is_empty() {
        return Err("device id must not be empty".into());
    }
    let persisted = with_state(&app, |s| {
        s.persisted.device_id = Some(device_id.trim().to_string());
        s.persisted.device_name = Some(device_name.trim().to_string());
        s.persisted.clone()
    });
    save_persisted(&app, &persisted)?;
    // Keep the manifest in step so the other device sees the new name.
    if let (Ok(folder), Ok(device)) = (folder_of(&persisted), device_of(&persisted)) {
        let dir = device_dir(&folder, &device.device_id);
        if dir.is_dir() {
            let _ = write_manifest(&dir, &device, &app_version(&app), now_ms());
        }
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetFolderResult {
    pub ok: bool,
    pub device_dirs: Vec<String>,
}

#[tauri::command(async)]
pub fn sync_set_folder(app: AppHandle, folder: String) -> Result<SetFolderResult, String> {
    let path = PathBuf::from(folder.trim());
    if !path.is_absolute() {
        return Err("choose a full folder path".into());
    }
    let device = with_state(&app, |s| device_of(&s.persisted))?;
    let device_dirs = init_layout(&path, &device, &app_version(&app))?;
    let persisted = with_state(&app, |s| {
        s.persisted.folder = Some(path.to_string_lossy().to_string());
        s.persisted.clone()
    });
    save_persisted(&app, &persisted)?;
    log::info!("sync: folder set to {}", path.display());
    Ok(SetFolderResult { ok: true, device_dirs })
}

/// Forgets the folder. The files stay where they are — they are the person's.
#[tauri::command(async)]
pub fn sync_clear_folder(app: AppHandle) -> Result<(), String> {
    let persisted = with_state(&app, |s| {
        s.watch = None;
        s.persisted.folder = None;
        s.persisted.clone()
    });
    save_persisted(&app, &persisted)?;
    log::info!("sync: folder cleared");
    Ok(())
}

/// Reads every device's files. With `folder` given, peeks at that folder
/// instead of the chosen one (the card looks before it commits) and leaves
/// `lastRead` alone.
#[tauri::command(async)]
pub fn sync_read_all(app: AppHandle, folder: Option<String>) -> Result<ReadAll, String> {
    match folder.filter(|f| !f.trim().is_empty()) {
        Some(peek) => {
            let path = PathBuf::from(peek.trim());
            if !path.is_dir() {
                return Err(format!("{} is not a folder", path.display()));
            }
            read_all(&path)
        }
        None => {
            let folder = with_state(&app, |s| folder_of(&s.persisted))?;
            let read = read_all(&folder)?;
            with_state(&app, |s| s.last_read = Some(read.read_at));
            Ok(read)
        }
    }
}

#[tauri::command(async)]
pub fn sync_write(app: AppHandle, collection: String, json: String) -> Result<i64, String> {
    let (folder, device) = with_state(&app, |s| Ok::<_, String>((folder_of(&s.persisted)?, device_of(&s.persisted)?)))?;
    let dir = device_dir(&folder, &device.device_id);
    let at = write_collection(&dir, &device, &app_version(&app), &collection, &json)?;
    with_state(&app, |s| s.last_write = Some(at));
    Ok(at)
}

/// Copies `<AppData>/<fromAppData>` into this device's subtree at `relPath`.
#[tauri::command(async)]
pub fn sync_copy_out(
    app: AppHandle,
    from_app_data: String,
    rel_path: String,
    max_bytes: Option<u64>,
    exclude: Option<Vec<String>>,
) -> Result<CopyOutcome, String> {
    let (folder, device) = with_state(&app, |s| Ok::<_, String>((folder_of(&s.persisted)?, device_of(&s.persisted)?)))?;
    let src = app_data(&app)?.join(safe_rel(&from_app_data)?);
    let dst = device_dir(&folder, &device.device_id).join(safe_rel(&rel_path)?);
    let outcome = copy_tree(&src, &dst, max_bytes.unwrap_or(DEFAULT_COPY_CAP), &exclude.unwrap_or_default())?;
    if outcome.ok {
        let at = now_ms();
        write_manifest(&device_dir(&folder, &device.device_id), &device, &app_version(&app), at)?;
        with_state(&app, |s| s.last_write = Some(at));
    }
    Ok(outcome)
}

/// Copies `<folder>/owntools-sync/<deviceId>/<relPath>` into `<AppData>/<toAppData>`.
#[tauri::command(async)]
pub fn sync_copy_in(
    app: AppHandle,
    device_id: String,
    rel_path: String,
    to_app_data: String,
    max_bytes: Option<u64>,
    exclude: Option<Vec<String>>,
) -> Result<CopyOutcome, String> {
    let folder = with_state(&app, |s| folder_of(&s.persisted))?;
    let src = device_dir(&folder, &safe_rel(&device_id)?.to_string_lossy()).join(safe_rel(&rel_path)?);
    let dst = app_data(&app)?.join(safe_rel(&to_app_data)?);
    copy_tree(&src, &dst, max_bytes.unwrap_or(DEFAULT_COPY_CAP), &exclude.unwrap_or_default())
}

/// Removes a folder from this device's subtree (a board deleted here).
#[tauri::command(async)]
pub fn sync_remove_out(app: AppHandle, rel_path: String) -> Result<(), String> {
    let (folder, device) = with_state(&app, |s| Ok::<_, String>((folder_of(&s.persisted)?, device_of(&s.persisted)?)))?;
    let target = device_dir(&folder, &device.device_id).join(safe_rel(&rel_path)?);
    if target.is_dir() {
        fs::remove_dir_all(&target).map_err(|e| format!("remove {}: {e}", target.display()))?;
    } else if target.is_file() {
        fs::remove_file(&target).map_err(|e| format!("remove {}: {e}", target.display()))?;
    }
    Ok(())
}

/// Starts or stops the folder watcher. Returns whether it is running.
#[tauri::command(async)]
pub fn sync_watch(app: AppHandle, on: bool) -> Result<bool, String> {
    if !on {
        with_state(&app, |s| s.watch = None);
        return Ok(false);
    }
    let (folder, device) = with_state(&app, |s| Ok::<_, String>((folder_of(&s.persisted)?, device_of(&s.persisted)?)))?;
    let root = layout_root(&folder);
    fs::create_dir_all(&root).map_err(|e| format!("create {}: {e}", root.display()))?;
    let already = with_state(&app, |s| s.watch.is_some());
    if already {
        return Ok(true);
    }
    let watch = start_watch(app.clone(), root, device.device_id)?;
    with_state(&app, |s| s.watch = Some(watch));
    Ok(true)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub folder: Option<String>,
    pub device_id: Option<String>,
    pub device_name: Option<String>,
    pub watching: bool,
    pub last_read: Option<i64>,
    pub last_write: Option<i64>,
    pub hostname: Option<String>,
    pub platform: String,
    pub app_version: String,
}

fn hostname() -> Option<String> {
    ["COMPUTERNAME", "HOSTNAME", "HOST"]
        .iter()
        .find_map(|k| std::env::var(k).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            fs::read_to_string("/etc/hostname")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        })
}

#[tauri::command(async)]
pub fn sync_status(app: AppHandle) -> Result<Status, String> {
    let (persisted, watching, last_read, last_write) =
        with_state(&app, |s| (s.persisted.clone(), s.watch.is_some(), s.last_read, s.last_write));
    Ok(Status {
        folder: persisted.folder,
        device_id: persisted.device_id,
        device_name: persisted.device_name,
        watching,
        last_read,
        last_write,
        hostname: hostname(),
        platform: std::env::consts::OS.to_string(),
        app_version: app_version(&app),
    })
}

/// One level of `<AppData>/<rel>` with sizes and mtimes.
#[tauri::command(async)]
pub fn sync_app_scan(app: AppHandle, rel: String) -> Result<Vec<Entry>, String> {
    scan_dir(&app_data(&app)?.join(safe_rel(&rel)?))
}

/// Removes `<AppData>/<rel>` (a board or meeting deleted on another device).
#[tauri::command(async)]
pub fn sync_app_remove(app: AppHandle, rel: String) -> Result<(), String> {
    let target = app_data(&app)?.join(safe_rel(&rel)?);
    if target.is_dir() {
        fs::remove_dir_all(&target).map_err(|e| format!("remove {}: {e}", target.display()))?;
    } else if target.is_file() {
        fs::remove_file(&target).map_err(|e| format!("remove {}: {e}", target.display()))?;
    }
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!("owntools-sync-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        base
    }

    fn device(id: &str) -> Device {
        Device { device_id: id.into(), device_name: format!("{id} box") }
    }

    #[test]
    fn layout_is_created_with_a_manifest() {
        let base = scratch("layout");
        let dirs = init_layout(&base, &device("dev-a"), "0.2.0").unwrap();
        assert_eq!(dirs, vec!["dev-a".to_string()]);
        let manifest: Manifest =
            serde_json::from_str(&fs::read_to_string(base.join(LAYOUT_DIR).join("dev-a").join("manifest.json")).unwrap())
                .unwrap();
        assert_eq!(manifest.device_id, "dev-a");
        assert_eq!(manifest.device_name, "dev-a box");
        assert!(manifest.updated_at > 0);
        // No probe file left behind.
        let leftovers: Vec<_> = fs::read_dir(base.join(LAYOUT_DIR).join("dev-a"))
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(leftovers, vec!["manifest.json".to_string()]);
        // A second device shows up in the listing.
        init_layout(&base, &device("dev-b"), "0.2.0").unwrap();
        assert_eq!(init_layout(&base, &device("dev-a"), "0.2.0").unwrap(), vec!["dev-a", "dev-b"]);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn set_folder_refuses_a_missing_folder() {
        let base = scratch("missing");
        let err = init_layout(&base.join("nope"), &device("dev-a"), "0.2.0").unwrap_err();
        assert!(err.contains("not a folder"), "{err}");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn write_is_atomic_and_bumps_the_manifest() {
        let base = scratch("write");
        init_layout(&base, &device("dev-a"), "0.2.0").unwrap();
        let dir = base.join(LAYOUT_DIR).join("dev-a");
        let before: Manifest = serde_json::from_str(&fs::read_to_string(dir.join("manifest.json")).unwrap()).unwrap();
        std::thread::sleep(Duration::from_millis(5));
        let json = r#"{"version":1,"updatedAt":5,"items":[{"id":"x","updatedAt":5,"value":1}]}"#;
        let at = write_collection(&dir, &device("dev-a"), "0.2.0", "dictation-history", json).unwrap();
        assert_eq!(fs::read_to_string(dir.join("dictation-history.json")).unwrap(), json);
        let after: Manifest = serde_json::from_str(&fs::read_to_string(dir.join("manifest.json")).unwrap()).unwrap();
        assert!(after.updated_at >= before.updated_at && after.updated_at == at);
        // No temp file survives a write.
        let names: Vec<String> = fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
        assert!(names.iter().all(|n| !n.contains(".tmp-")), "{names:?}");
        // Bad names and bad JSON are refused before anything is touched.
        assert!(write_collection(&dir, &device("dev-a"), "0.2.0", "../escape", "{}").is_err());
        assert!(write_collection(&dir, &device("dev-a"), "0.2.0", "boards", "{not json").is_err());
        assert!(!dir.join("boards.json").exists());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn read_all_skips_a_corrupt_file_and_says_so() {
        let base = scratch("readall");
        init_layout(&base, &device("dev-a"), "0.2.0").unwrap();
        init_layout(&base, &device("dev-b"), "0.2.0").unwrap();
        let a = base.join(LAYOUT_DIR).join("dev-a");
        let b = base.join(LAYOUT_DIR).join("dev-b");
        write_collection(&a, &device("dev-a"), "0.2.0", "look-presets", r#"{"version":1,"updatedAt":1,"items":[]}"#).unwrap();
        write_collection(&b, &device("dev-b"), "0.2.0", "look-presets", r#"{"version":1,"updatedAt":2,"items":[]}"#).unwrap();
        // A half-synced file on B, a cloud client's temp file, and a stray folder.
        fs::write(b.join("dictation-history.json"), b"{\"version\":1,\"upd").unwrap();
        fs::write(b.join(".dictation-history.json.tmp-1"), b"{}").unwrap();
        fs::create_dir_all(base.join(LAYOUT_DIR).join(".stfolder")).unwrap();
        let read = read_all(&base).unwrap();
        assert_eq!(read.devices.len(), 2);
        assert_eq!(read.devices[0].device_id, "dev-a");
        assert!(read.devices[0].collections.contains_key("look-presets"));
        assert!(read.devices[1].collections.contains_key("look-presets"));
        assert!(!read.devices[1].collections.contains_key("dictation-history"));
        assert_eq!(read.warnings.len(), 1, "{:?}", read.warnings);
        assert!(read.warnings[0].starts_with("dev-b/dictation-history.json"), "{}", read.warnings[0]);
        // A device folder with no manifest is skipped with a warning too.
        fs::create_dir_all(base.join(LAYOUT_DIR).join("dev-c")).unwrap();
        let read = read_all(&base).unwrap();
        assert_eq!(read.devices.len(), 2);
        assert_eq!(read.warnings.len(), 2);
        // An empty folder is not an error.
        let empty = scratch("readall-empty");
        assert!(read_all(&empty).unwrap().devices.is_empty());
        let _ = fs::remove_dir_all(&base);
        let _ = fs::remove_dir_all(&empty);
    }

    #[test]
    fn copy_tree_respects_the_cap_and_excludes() {
        let base = scratch("copy");
        let src = base.join("src").join("board-1");
        fs::create_dir_all(src.join("files")).unwrap();
        fs::write(src.join("scene.json"), b"{\"elements\":[]}").unwrap();
        fs::write(src.join("files").join("img.json"), vec![7u8; 4096]).unwrap();
        fs::write(src.join("audio.wav"), vec![1u8; 10_000]).unwrap();
        let dst = base.join("dst").join("board-1");

        // Over the cap: nothing written, honest reason.
        let outcome = copy_tree(&src, &dst, 1000, &[]).unwrap();
        assert!(outcome.skipped && !outcome.ok);
        assert!(outcome.reason.as_deref().unwrap_or("").contains("limit"));
        assert!(!dst.exists());
        assert!(!base.join("dst").exists() || fs::read_dir(base.join("dst")).unwrap().count() == 0);

        // Under the cap with an exclusion: byte-identical copy without the excluded file.
        let outcome = copy_tree(&src, &dst, DEFAULT_COPY_CAP, &["audio.wav".to_string()]).unwrap();
        assert!(outcome.ok && !outcome.skipped);
        assert_eq!(outcome.files, 2);
        assert_eq!(outcome.bytes, 15 + 4096);
        assert_eq!(fs::read(dst.join("scene.json")).unwrap(), b"{\"elements\":[]}");
        assert_eq!(fs::read(dst.join("files").join("img.json")).unwrap(), vec![7u8; 4096]);
        assert!(!dst.join("audio.wav").exists());

        // A second copy replaces the destination whole (a stale file goes away).
        fs::write(dst.join("stale.json"), b"old").unwrap();
        fs::write(src.join("scene.json"), b"{\"elements\":[1]}").unwrap();
        copy_tree(&src, &dst, DEFAULT_COPY_CAP, &["audio.wav".to_string()]).unwrap();
        assert_eq!(fs::read(dst.join("scene.json")).unwrap(), b"{\"elements\":[1]}");
        assert!(!dst.join("stale.json").exists());
        let names: Vec<String> = fs::read_dir(base.join("dst")).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
        assert_eq!(names, vec!["board-1".to_string()], "no temp dirs left: {names:?}");

        let scanned = scan_dir(&base.join("dst")).unwrap();
        assert_eq!(scanned.len(), 1);
        assert!(scanned[0].is_dir && scanned[0].bytes == 16 + 4096 && scanned[0].mtime_ms > 0);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn relative_paths_cannot_escape() {
        assert!(safe_rel("board/boards/abc").is_ok());
        assert!(safe_rel("boards\\abc").is_ok());
        assert_eq!(safe_rel("./meet//m1/").unwrap(), PathBuf::from("meet").join("m1"));
        for bad in ["", "..", "../x", "a/../../b", "C:\\Users", "/etc/passwd", "\\\\server\\share", "a:b"] {
            assert!(safe_rel(bad).is_err(), "{bad:?} should be refused");
        }
        assert!(valid_collection("dictation-history"));
        assert!(!valid_collection("Boards"));
        assert!(!valid_collection("-x"));
        assert!(!valid_collection("a b"));
    }
}
