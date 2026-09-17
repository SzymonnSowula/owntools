//! Automations — the Rust half.
//!
//! Two things the webview cannot do on its own. **Watching a folder** outside
//! AppData: one `notify` watcher over every folder the enabled `file-added`
//! rules name, and a settle-time debounce on top — a file counts as "added"
//! only once its size has held still for 1.5 s, so a download or a copy that
//! is still growing is not transcribed half-way (`automation-file-added
//! { ruleId, path, size }`). **Writing where the person pointed**: plugin-fs is
//! scoped to AppData, so `<AppData>/automations/folders.json` is the allowlist
//! — appended by `automations_allow_folder` when the UI's folder picker
//! returns, checked by every write and every listing. A file from a watched
//! folder is copied into `<AppData>/automations/tmp/` (`automations_import_file`)
//! so plugin-fs can read it for transcription; the frontend removes the copy.
//!
//! Every command is `#[tauri::command(async)]`: a sync command runs on the
//! main thread and freezes all three windows (CLAUDE.md, the disk cleanup).

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use notify::event::ModifyKind;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

pub const FILE_ADDED_EVENT: &str = "automation-file-added";
const FOLDERS_FILE: &str = "folders.json";
const TMP_DIR: &str = "tmp";
/// A file has to keep its size this long before it counts as added.
const STABLE_FOR: Duration = Duration::from_millis(1500);
const POLL_EVERY: Duration = Duration::from_millis(500);
/// Imported copies older than this are pruned on the next import (and by
/// Settings → Storage's "Clear cache", at the same age).
pub(crate) const TMP_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);
const LIST_LIMIT: usize = 300;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchFolder {
    pub rule_id: String,
    pub folder: String,
    /// Lower-case, no dot; empty = any file.
    #[serde(default)]
    pub extensions: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAdded {
    pub rule_id: String,
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderEntry {
    pub name: String,
    pub path: String,
    pub size: u64,
    /// Epoch milliseconds.
    pub mtime: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WrittenFile {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedFile {
    pub path: String,
    pub size: u64,
}

/* ------------------------------------------------------------------------- */
/* Paths                                                                     */
/* ------------------------------------------------------------------------- */

#[cfg(windows)]
const SEP: char = '\\';
#[cfg(not(windows))]
const SEP: char = '/';

/// One spelling per folder, for comparisons: Windows paths compare without
/// case and with one separator; trailing separators go (except a drive root).
#[cfg(windows)]
fn path_key(path: &Path) -> String {
    let mut s = path.to_string_lossy().replace('/', "\\");
    while s.len() > 3 && s.ends_with('\\') {
        s.pop();
    }
    s.to_lowercase()
}

#[cfg(not(windows))]
fn path_key(path: &Path) -> String {
    let mut s = path.to_string_lossy().into_owned();
    while s.len() > 1 && s.ends_with('/') {
        s.pop();
    }
    s
}

/// `candidate` is `root` itself or somewhere inside it.
fn same_or_under(candidate: &Path, root: &Path) -> bool {
    let (c, r) = (path_key(candidate), path_key(root));
    if r.is_empty() {
        return false;
    }
    if c == r {
        return true;
    }
    let prefix = if r.ends_with(SEP) { r } else { format!("{r}{SEP}") };
    c.starts_with(&prefix)
}

fn clean_folder(raw: &str) -> String {
    let mut s = raw.trim().to_string();
    while s.len() > 3 && (s.ends_with('\\') || s.ends_with('/')) {
        s.pop();
    }
    s
}

/// A single usable file name: separators and reserved characters become `-`,
/// nothing leading or trailing that Windows drops silently, never `..`.
fn safe_component(name: &str) -> Option<String> {
    let replaced: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c if c.is_control() => '-',
            c => c,
        })
        .collect();
    let mut out: String = replaced.trim_matches(|c| c == '.' || c == ' ').to_string();
    if out.chars().count() > 200 {
        out = out.chars().take(200).collect();
        out = out.trim_end_matches(|c| c == '.' || c == ' ').to_string();
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn split_name(name: &str) -> (&str, Option<&str>) {
    match name.rfind('.') {
        Some(i) if i > 0 && i + 1 < name.len() => (&name[..i], Some(&name[i + 1..])),
        _ => (name, None),
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// `name`, else `name (2)`, `name (3)`… — a rule never overwrites a file.
fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = split_name(name);
    let with = |suffix: String| match ext {
        Some(e) => dir.join(format!("{stem} ({suffix}).{e}")),
        None => dir.join(format!("{stem} ({suffix})")),
    };
    for n in 2..1000u32 {
        let candidate = with(n.to_string());
        if !candidate.exists() {
            return candidate;
        }
    }
    with(now_millis().to_string())
}

fn automations_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("automations"))
        .map_err(|e| e.to_string())
}

/* ------------------------------------------------------------------------- */
/* Allowlist                                                                 */
/* ------------------------------------------------------------------------- */

#[derive(Default)]
struct Allowlist {
    folders: Vec<String>,
}

impl Allowlist {
    fn load(path: &Path) -> Self {
        let folders = fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
            .unwrap_or_default();
        Self { folders }
    }

    fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let tmp = path.with_extension("json.tmp");
        let bytes = serde_json::to_vec_pretty(&self.folders).map_err(|e| e.to_string())?;
        fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
        fs::rename(&tmp, path).map_err(|e| e.to_string())
    }

    /// Adds the folder; `false` when it was already there or is empty.
    fn allow(&mut self, folder: &str) -> bool {
        let clean = clean_folder(folder);
        if clean.is_empty() {
            return false;
        }
        let key = path_key(Path::new(&clean));
        if self.folders.iter().any(|f| path_key(Path::new(f)) == key) {
            return false;
        }
        self.folders.push(clean);
        true
    }

    fn permits(&self, folder: &Path) -> bool {
        self.folders.iter().any(|f| same_or_under(folder, Path::new(f)))
    }
}

fn load_allowlist(app: &AppHandle) -> Result<(Allowlist, PathBuf), String> {
    let file = automations_dir(app)?.join(FOLDERS_FILE);
    Ok((Allowlist::load(&file), file))
}

fn not_allowed(folder: &Path) -> String {
    format!(
        "{} is not a folder automations may use. Pick it again in the rule to allow it.",
        folder.display()
    )
}

/* ------------------------------------------------------------------------- */
/* Debounce                                                                  */
/* ------------------------------------------------------------------------- */

struct Pending {
    size: Option<u64>,
    since: Instant,
}

/// Paths the watcher saw appear, each waiting for its size to hold still.
pub struct Debouncer {
    pending: HashMap<PathBuf, Pending>,
    stable_for: Duration,
}

impl Debouncer {
    fn new(stable_for: Duration) -> Self {
        Self {
            pending: HashMap::new(),
            stable_for,
        }
    }

    fn observe(&mut self, path: PathBuf, now: Instant) {
        self.pending.entry(path).or_insert(Pending { size: None, since: now });
    }

    fn is_pending(&self, path: &Path) -> bool {
        self.pending.contains_key(path)
    }

    fn clear(&mut self) {
        self.pending.clear();
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.pending.len()
    }

    /// One look at every pending file: a size that changed restarts its clock,
    /// one that held for `stable_for` is returned (and forgotten), a file that
    /// is gone is forgotten.
    fn poll(&mut self, now: Instant, size_of: impl Fn(&Path) -> Option<u64>) -> Vec<(PathBuf, u64)> {
        let mut ready = Vec::new();
        let mut gone = Vec::new();
        for (path, pending) in self.pending.iter_mut() {
            match size_of(path) {
                None => gone.push(path.clone()),
                Some(size) => {
                    if pending.size == Some(size) {
                        if now.saturating_duration_since(pending.since) >= self.stable_for {
                            ready.push((path.clone(), size));
                        }
                    } else {
                        pending.size = Some(size);
                        pending.since = now;
                    }
                }
            }
        }
        for path in gone {
            self.pending.remove(&path);
        }
        for (path, _) in &ready {
            self.pending.remove(path);
        }
        ready.sort();
        ready
    }
}

fn file_size(path: &Path) -> Option<u64> {
    fs::metadata(path).ok().filter(|m| m.is_file()).map(|m| m.len())
}

/// Which rules want this file: its parent is their folder (watching is not
/// recursive) and its extension is one they listed (or they listed none).
fn matching_rules(folders: &[WatchFolder], path: &Path) -> Vec<String> {
    let Some(parent) = path.parent() else {
        return Vec::new();
    };
    let parent_key = path_key(parent);
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    folders
        .iter()
        .filter(|f| path_key(Path::new(&f.folder)) == parent_key)
        .filter(|f| {
            f.extensions.is_empty()
                || f
                    .extensions
                    .iter()
                    .any(|e| e.trim_start_matches('.').eq_ignore_ascii_case(&ext))
        })
        .map(|f| f.rule_id.clone())
        .collect()
}

/* ------------------------------------------------------------------------- */
/* The watcher                                                               */
/* ------------------------------------------------------------------------- */

struct WatchState {
    watcher: Option<RecommendedWatcher>,
    config: Arc<Mutex<Vec<WatchFolder>>>,
    debouncer: Arc<Mutex<Debouncer>>,
    poller: bool,
}

fn state() -> &'static Mutex<WatchState> {
    static STATE: OnceLock<Mutex<WatchState>> = OnceLock::new();
    STATE.get_or_init(|| {
        Mutex::new(WatchState {
            watcher: None,
            config: Arc::new(Mutex::new(Vec::new())),
            debouncer: Arc::new(Mutex::new(Debouncer::new(STABLE_FOR))),
            poller: false,
        })
    })
}

/// The poller: every half second, ask the debouncer what settled and tell
/// the frontend. Started once, lives for the process.
fn ensure_poller(st: &mut WatchState, app: AppHandle) {
    if st.poller {
        return;
    }
    let debouncer = st.debouncer.clone();
    let config = st.config.clone();
    let spawned = std::thread::Builder::new()
        .name("automations-watch".into())
        .spawn(move || loop {
            std::thread::sleep(POLL_EVERY);
            let ready = match debouncer.lock() {
                Ok(mut d) => d.poll(Instant::now(), file_size),
                Err(_) => continue,
            };
            if ready.is_empty() {
                continue;
            }
            let folders = config.lock().map(|c| c.clone()).unwrap_or_default();
            for (path, size) in ready {
                for rule_id in matching_rules(&folders, &path) {
                    let payload = FileAdded {
                        rule_id,
                        path: path.to_string_lossy().into_owned(),
                        size,
                    };
                    log::info!(
                        "automations: {} settled at {} B → rule {}",
                        payload.path,
                        size,
                        payload.rule_id
                    );
                    if let Err(e) = app.emit(FILE_ADDED_EVENT, payload) {
                        log::warn!("automations: emit failed: {e}");
                    }
                }
            }
        });
    match spawned {
        Ok(_) => st.poller = true,
        Err(e) => log::error!("automations: poller thread not started: {e}"),
    }
}

/// Replaces the watched set. Folders that do not exist are logged and
/// skipped; the rule still shows in the UI, it just cannot fire.
#[tauri::command(async)]
pub fn automations_watch_set(app: AppHandle, folders: Vec<WatchFolder>) -> Result<usize, String> {
    let mut st = state().lock().map_err(|_| "watch state unavailable".to_string())?;
    // Dropping the old watcher stops it.
    st.watcher = None;

    let wanted: Vec<WatchFolder> = folders
        .into_iter()
        .filter_map(|f| {
            let folder = clean_folder(&f.folder);
            if folder.is_empty() {
                return None;
            }
            Some(WatchFolder {
                rule_id: f.rule_id,
                folder,
                extensions: f
                    .extensions
                    .iter()
                    .map(|e| e.trim().trim_start_matches('.').to_lowercase())
                    .filter(|e| !e.is_empty())
                    .collect(),
            })
        })
        .collect();
    if let Ok(mut c) = st.config.lock() {
        *c = wanted.clone();
    }
    if let Ok(mut d) = st.debouncer.lock() {
        d.clear();
    }

    let mut unique: Vec<String> = Vec::new();
    for f in &wanted {
        let key = path_key(Path::new(&f.folder));
        if unique.iter().any(|u| path_key(Path::new(u)) == key) {
            continue;
        }
        if !Path::new(&f.folder).is_dir() {
            log::warn!("automations: watched folder does not exist: {}", f.folder);
            continue;
        }
        unique.push(f.folder.clone());
    }
    if unique.is_empty() {
        log::info!("automations: watching nothing");
        return Ok(0);
    }

    let config = st.config.clone();
    let debouncer = st.debouncer.clone();
    let handler = move |res: notify::Result<Event>| {
        let event = match res {
            Ok(e) => e,
            Err(e) => {
                log::warn!("automations: watch error: {e}");
                return;
            }
        };
        // A new name in the folder (created, or renamed into place — browsers
        // download to `.crdownload` and rename) starts a pending entry; a
        // plain modify only refreshes one that is already pending, so an old
        // file someone edits is not "added".
        let created = matches!(
            event.kind,
            EventKind::Create(_) | EventKind::Modify(ModifyKind::Name(_))
        );
        let modified = !created && matches!(event.kind, EventKind::Modify(_));
        if !created && !modified {
            return;
        }
        let folders = config.lock().map(|c| c.clone()).unwrap_or_default();
        let Ok(mut deb) = debouncer.lock() else {
            return;
        };
        for path in event.paths {
            if !path.is_file() {
                continue;
            }
            if modified && !deb.is_pending(&path) {
                continue;
            }
            if matching_rules(&folders, &path).is_empty() {
                continue;
            }
            deb.observe(path, Instant::now());
        }
    };
    let mut watcher = RecommendedWatcher::new(handler, notify::Config::default()).map_err(|e| e.to_string())?;
    let mut watched = 0usize;
    for folder in &unique {
        match watcher.watch(Path::new(folder), RecursiveMode::NonRecursive) {
            Ok(()) => watched += 1,
            Err(e) => log::warn!("automations: cannot watch {folder}: {e}"),
        }
    }
    st.watcher = Some(watcher);
    ensure_poller(&mut st, app);
    log::info!("automations: watching {watched} folder(s)");
    Ok(watched)
}

/* ------------------------------------------------------------------------- */
/* Files                                                                     */
/* ------------------------------------------------------------------------- */

#[tauri::command(async)]
pub fn automations_allow_folder(app: AppHandle, folder: String) -> Result<Vec<String>, String> {
    let (mut list, file) = load_allowlist(&app)?;
    if list.allow(&folder) {
        list.save(&file)?;
        log::info!("automations: folder allowed: {}", clean_folder(&folder));
    }
    Ok(list.folders)
}

#[tauri::command(async)]
pub fn automations_allowed_folders(app: AppHandle) -> Result<Vec<String>, String> {
    Ok(load_allowlist(&app)?.0.folders)
}

/// Writes `text` as `name` into an allowlisted folder, never over an
/// existing file. Returns the path it ended up at.
#[tauri::command(async)]
pub fn automations_write_text(
    app: AppHandle,
    folder: String,
    name: String,
    text: String,
) -> Result<WrittenFile, String> {
    let folder_path = PathBuf::from(clean_folder(&folder));
    if folder_path.as_os_str().is_empty() {
        return Err("No folder to save into.".into());
    }
    let (list, _) = load_allowlist(&app)?;
    if !list.permits(&folder_path) {
        return Err(not_allowed(&folder_path));
    }
    let name = safe_component(&name).ok_or_else(|| "That file name is not usable.".to_string())?;
    fs::create_dir_all(&folder_path).map_err(|e| format!("cannot create {}: {e}", folder_path.display()))?;
    let target = unique_path(&folder_path, &name);
    fs::write(&target, text.as_bytes()).map_err(|e| format!("cannot write {}: {e}", target.display()))?;
    let file_name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or(name);
    log::info!("automations: wrote {}", target.display());
    Ok(WrittenFile {
        path: target.to_string_lossy().into_owned(),
        name: file_name,
    })
}

/// Copies a file into `<AppData>/automations/tmp/` so plugin-fs may read it.
#[tauri::command(async)]
pub fn automations_import_file(app: AppHandle, path: String) -> Result<ImportedFile, String> {
    let src = PathBuf::from(path.trim());
    let meta = fs::metadata(&src).map_err(|e| format!("cannot read {}: {e}", src.display()))?;
    if !meta.is_file() {
        return Err(format!("{} is not a file.", src.display()));
    }
    let tmp = automations_dir(&app)?.join(TMP_DIR);
    fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    prune_tmp(&tmp, TMP_MAX_AGE);
    let name = src
        .file_name()
        .and_then(|n| safe_component(&n.to_string_lossy()))
        .unwrap_or_else(|| "file".to_string());
    let dest = unique_path(&tmp, &format!("{}-{name}", now_millis()));
    fs::copy(&src, &dest).map_err(|e| format!("cannot copy {}: {e}", src.display()))?;
    Ok(ImportedFile {
        path: dest.to_string_lossy().into_owned(),
        size: meta.len(),
    })
}

fn prune_tmp(dir: &Path, max_age: Duration) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        let old = meta
            .modified()
            .ok()
            .and_then(|m| now.duration_since(m).ok())
            .map(|age| age > max_age)
            .unwrap_or(false);
        if old && meta.is_file() {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// Files in an allowlisted folder, newest first — for "run this rule on an
/// existing file".
#[tauri::command(async)]
pub fn automations_list_folder(app: AppHandle, folder: String) -> Result<Vec<FolderEntry>, String> {
    let folder_path = PathBuf::from(clean_folder(&folder));
    let (list, _) = load_allowlist(&app)?;
    if !list.permits(&folder_path) {
        return Err(not_allowed(&folder_path));
    }
    let entries = fs::read_dir(&folder_path).map_err(|e| format!("cannot list {}: {e}", folder_path.display()))?;
    let mut out: Vec<FolderEntry> = entries
        .flatten()
        .filter_map(|entry| {
            let meta = entry.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            let mtime = meta
                .modified()
                .ok()
                .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            Some(FolderEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                path: entry.path().to_string_lossy().into_owned(),
                size: meta.len(),
                mtime,
            })
        })
        .collect();
    out.sort_by(|a, b| b.mtime.cmp(&a.mtime).then_with(|| a.name.cmp(&b.name)));
    out.truncate(LIST_LIMIT);
    Ok(out)
}

/* ------------------------------------------------------------------------- */
/* Tests                                                                     */
/* ------------------------------------------------------------------------- */

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp(tag: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!("owntools-automations-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        base
    }

    #[test]
    fn allowlist_permits_folder_and_children_only() {
        let base = temp("allow");
        let notes = base.join("Notes");
        let mut list = Allowlist::default();
        assert!(list.allow(&format!("{}{}", notes.display(), SEP)));
        assert!(!list.allow(&notes.to_string_lossy()), "same folder twice is one entry");
        assert!(!list.allow("   "));
        assert_eq!(list.folders.len(), 1);

        assert!(list.permits(&notes));
        assert!(list.permits(&notes.join("2026").join("deep")));
        assert!(!list.permits(&base), "the parent is not inside the allowed folder");
        assert!(!list.permits(&base.join("Notes2")), "a sibling sharing the prefix is not inside it");
        #[cfg(windows)]
        assert!(list.permits(&PathBuf::from(notes.to_string_lossy().to_uppercase())));

        let file = base.join("folders.json");
        list.save(&file).unwrap();
        let loaded = Allowlist::load(&file);
        assert_eq!(loaded.folders, list.folders);
        assert!(Allowlist::load(&base.join("missing.json")).folders.is_empty());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn unique_path_appends_counter() {
        let base = temp("unique");
        assert_eq!(unique_path(&base, "note.md"), base.join("note.md"));
        fs::write(base.join("note.md"), "a").unwrap();
        assert_eq!(unique_path(&base, "note.md"), base.join("note (2).md"));
        fs::write(base.join("note (2).md"), "b").unwrap();
        assert_eq!(unique_path(&base, "note.md"), base.join("note (3).md"));
        fs::write(base.join("plain"), "c").unwrap();
        assert_eq!(unique_path(&base, "plain"), base.join("plain (2)"));
        fs::write(base.join(".hidden"), "d").unwrap();
        assert_eq!(unique_path(&base, ".hidden"), base.join(".hidden (2)"));
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn safe_component_strips_separators_and_reserved() {
        assert_eq!(safe_component("2026-09-11 Standup.md").as_deref(), Some("2026-09-11 Standup.md"));
        assert_eq!(safe_component("a/b\\c:d*e?f\"g<h>i|j").as_deref(), Some("a-b-c-d-e-f-g-h-i-j"));
        assert_eq!(safe_component("  ..trailing dots... ").as_deref(), Some("trailing dots"));
        assert_eq!(safe_component(".."), None);
        assert_eq!(safe_component("   "), None);
        assert_eq!(safe_component("tab\there").as_deref(), Some("tab-here"));
        assert_eq!(safe_component(&"x".repeat(500)).unwrap().chars().count(), 200);
    }

    #[test]
    fn debouncer_waits_for_size_to_settle() {
        let base = temp("debounce");
        let file = base.join("take.mp3");
        fs::write(&file, [0u8; 10]).unwrap();
        let mut d = Debouncer::new(Duration::from_millis(1500));
        let t0 = Instant::now();
        let at = |ms: u64| t0 + Duration::from_millis(ms);

        d.observe(file.clone(), t0);
        d.observe(file.clone(), t0);
        assert_eq!(d.len(), 1, "observing twice is one entry");
        assert!(d.poll(t0, file_size).is_empty(), "first look learns the size");
        assert!(d.poll(at(1000), file_size).is_empty(), "not stable yet");

        // Still being written: more bytes arrive.
        {
            let mut f = fs::OpenOptions::new().append(true).open(&file).unwrap();
            f.write_all(&[1u8; 5]).unwrap();
        }
        assert!(d.poll(at(1600), file_size).is_empty(), "size changed, clock restarts");
        assert!(d.poll(at(3000), file_size).is_empty(), "1.4 s of stillness is not 1.5");
        assert_eq!(d.poll(at(3100), file_size), vec![(file.clone(), 15)]);
        assert_eq!(d.len(), 0, "a settled file is forgotten");

        // A file that vanishes is forgotten too.
        d.observe(base.join("gone.mp3"), t0);
        assert!(d.poll(t0, file_size).is_empty());
        assert_eq!(d.len(), 0);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn matching_rules_filters_by_folder_and_extension() {
        let base = temp("match");
        let folders = vec![
            WatchFolder {
                rule_id: "audio".into(),
                folder: format!("{}{}", base.display(), SEP),
                extensions: vec!["mp3".into(), "wav".into()],
            },
            WatchFolder {
                rule_id: "any".into(),
                folder: base.to_string_lossy().into_owned(),
                extensions: vec![],
            },
            WatchFolder {
                rule_id: "elsewhere".into(),
                folder: base.join("sub").to_string_lossy().into_owned(),
                extensions: vec![],
            },
        ];
        assert_eq!(matching_rules(&folders, &base.join("Call.MP3")), vec!["audio", "any"]);
        assert_eq!(matching_rules(&folders, &base.join("notes.txt")), vec!["any"]);
        assert_eq!(matching_rules(&folders, &base.join("sub").join("x.mp3")), vec!["elsewhere"]);
        assert!(matching_rules(&folders, &base.join("deep").join("x.mp3")).is_empty());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn same_or_under_handles_roots_and_separators() {
        let base = temp("under");
        assert!(same_or_under(&base.join("a"), &base));
        assert!(same_or_under(&base, &base));
        assert!(!same_or_under(&base, &base.join("a")));
        assert!(!same_or_under(&base, Path::new("")));
        #[cfg(windows)]
        {
            assert!(same_or_under(Path::new("C:\\Users\\me"), Path::new("C:\\")));
            assert!(same_or_under(Path::new("c:/users/me/x"), Path::new("C:\\Users\\Me\\")));
            assert!(!same_or_under(Path::new("C:\\Users\\meow"), Path::new("C:\\Users\\me")));
        }
        let _ = fs::remove_dir_all(&base);
    }
}
