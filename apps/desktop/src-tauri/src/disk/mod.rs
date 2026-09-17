//! disk — the analyzer's backend. The scanned tree stays here, in memory
//! (`arena.rs`); the frontend asks for the parts it draws. Long jobs (scan,
//! duplicates) run on their own threads and report through events:
//! `disk-scan-progress` / `disk-scan-done` / `disk-dupes-progress` /
//! `disk-dupes-done`. Every event carries the scan generation it belongs
//! to, so a cancelled scan's late messages are ignored by the UI.

pub mod apps;
pub mod arena;
pub mod bin;
pub mod category;
pub mod dupes;
pub mod installed;
pub mod protect;
pub mod quickwins;
pub mod scan;
pub mod snapshot;
pub mod sys;
pub mod volumes;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Instant;

use tauri::{AppHandle, Emitter, Manager, State};

use arena::{Arena, Breakdown, FileFilter, NodeInfo, TreeNode};

pub const SCAN_PROGRESS_EVENT: &str = "disk-scan-progress";
pub const SCAN_DONE_EVENT: &str = "disk-scan-done";
pub const DUPES_PROGRESS_EVENT: &str = "disk-dupes-progress";
pub const DUPES_DONE_EVENT: &str = "disk-dupes-done";
pub const TRASH_PROGRESS_EVENT: &str = "disk-trash-progress";

const MAX_RECENT: usize = 8;
/// How long the installed-programs and services lists are trusted.
const INSTALLED_TTL_S: u64 = 120;

#[derive(Default)]
pub struct DiskState {
    arena: RwLock<Option<Arena>>,
    /// Bumps on every scan start and every arena swap.
    generation: AtomicU64,
    scan_cancel: Mutex<Option<Arc<AtomicBool>>>,
    scanning: AtomicBool,
    dupes_cancel: Mutex<Option<Arc<AtomicBool>>>,
    dupes_running: AtomicBool,
    dupes: Mutex<Option<dupes::DupesResult>>,
    apps_cache: Mutex<Option<(Instant, Vec<apps::AppInfo>)>>,
    services_cache: Mutex<Option<(Instant, Vec<installed::ServiceInfo>)>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub scan_id: u64,
    pub root: String,
    pub name: String,
    pub size: u64,
    pub alloc: u64,
    pub files: u32,
    pub dirs: u32,
    pub errors: u32,
    pub scanned_at: i64,
    pub elapsed_ms: u64,
    pub source: &'static str,
    pub node_count: u64,
    pub volume: Option<volumes::VolumeInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgressEvent {
    pub scan_id: u64,
    pub root: String,
    pub files: u64,
    pub dirs: u64,
    pub bytes: u64,
    pub current: String,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanDoneEvent {
    pub scan_id: u64,
    pub ok: bool,
    pub cancelled: bool,
    pub error: Option<String>,
    pub summary: Option<ScanSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentRoot {
    pub path: String,
    pub label: String,
    pub at: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChildrenPage {
    pub items: Vec<NodeInfo>,
    pub total: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashFailure {
    pub id: u32,
    pub path: String,
    pub error: String,
    /// Windows refused for want of rights: asking again with `elevated` may work.
    pub needs_admin: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashOutcome {
    pub removed: Vec<u32>,
    pub freed: u64,
    pub failed: Vec<TrashFailure>,
    /// Left where they are: parts of installed programs (see `installed.rs`).
    pub skipped: Vec<installed::Protection>,
}

fn app_data(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn root_label(root: &str) -> String {
    let trimmed = root.trim_end_matches(['\\', '/']);
    if trimmed.len() == 2 && trimmed.ends_with(':') {
        return trimmed.to_string();
    }
    trimmed.rsplit(['\\', '/']).next().filter(|s| !s.is_empty()).unwrap_or(root).to_string()
}

fn summary_of(arena: &Arena, scan_id: u64) -> ScanSummary {
    let root = &arena.nodes[0];
    let vols = volumes::list_volumes();
    ScanSummary {
        scan_id,
        root: arena.root.clone(),
        name: root_label(&arena.root),
        size: root.size,
        alloc: root.alloc,
        files: root.files,
        dirs: root.dirs,
        errors: arena.errors,
        scanned_at: arena.scanned_at,
        elapsed_ms: arena.elapsed_ms,
        source: arena.source,
        node_count: arena.len() as u64,
        volume: volumes::volume_for(&arena.root, &vols),
    }
}

fn recent_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data(app)?.join("disk").join("recent.json"))
}

fn read_recent(app: &AppHandle) -> Vec<RecentRoot> {
    recent_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn remember_recent(app: &AppHandle, root: &str, size: u64) {
    let mut list = read_recent(app);
    let same = |a: &str, b: &str| {
        if cfg!(windows) {
            a.eq_ignore_ascii_case(b)
        } else {
            a == b
        }
    };
    list.retain(|r| !same(&r.path, root));
    list.insert(
        0,
        RecentRoot {
            path: root.to_string(),
            label: root_label(root),
            at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
            size,
        },
    );
    list.truncate(MAX_RECENT);
    if let Ok(path) = recent_path(app) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(text) = serde_json::to_string_pretty(&list) {
            let _ = std::fs::write(path, text);
        }
    }
}

fn with_arena<T>(state: &DiskState, f: impl FnOnce(&Arena) -> T) -> Result<T, String> {
    let guard = state.arena.read().map_err(|_| "disk state poisoned".to_string())?;
    match guard.as_ref() {
        Some(arena) => Ok(f(arena)),
        None => Err("nothing scanned yet".into()),
    }
}

/// Installed programs from the registry, re-read at most every two minutes.
/// Reads the registry: keep it off the main thread.
fn apps_list(state: &DiskState, refresh: bool) -> Vec<apps::AppInfo> {
    let mut cache = state.apps_cache.lock().ok();
    if !refresh {
        if let Some((at, list)) = cache.as_deref().and_then(|c| c.as_ref()) {
            if at.elapsed().as_secs() < INSTALLED_TTL_S {
                return list.clone();
            }
        }
    }
    let list = apps::installed_apps();
    if let Some(c) = cache.as_deref_mut() {
        *c = Some((Instant::now(), list.clone()));
    }
    list
}

/// Services and drivers that run from outside Windows' own folder; same cache rule.
fn services_list(state: &DiskState, refresh: bool) -> Vec<installed::ServiceInfo> {
    let mut cache = state.services_cache.lock().ok();
    if !refresh {
        if let Some((at, list)) = cache.as_deref().and_then(|c| c.as_ref()) {
            if at.elapsed().as_secs() < INSTALLED_TTL_S {
                return list.clone();
            }
        }
    }
    let list = installed::installed_services();
    if let Some(c) = cache.as_deref_mut() {
        *c = Some((Instant::now(), list.clone()));
    }
    list
}

/// The main window, for the UAC prompt to belong to.
fn owner_window(app: &AppHandle) -> isize {
    #[cfg(windows)]
    {
        app.get_webview_window("main").and_then(|w| w.hwnd().ok()).map(|h| h.0 as isize).unwrap_or(0)
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        0
    }
}

// ---- volumes & roots ---------------------------------------------------------

#[tauri::command(async)]
pub fn disk_volumes() -> Vec<volumes::VolumeInfo> {
    volumes::list_volumes()
}

#[tauri::command]
pub fn disk_home() -> Option<String> {
    dirs::home_dir().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn disk_recent(app: AppHandle) -> Vec<RecentRoot> {
    read_recent(&app)
}

// ---- scanning ---------------------------------------------------------------------

#[tauri::command]
pub fn disk_scan_start(app: AppHandle, state: State<'_, DiskState>, root: String) -> Result<u64, String> {
    let path = scan::normalize_root(&root).map_err(|e| e.to_string())?;
    // A running scan is told to stop; its late events carry the old id.
    if let Ok(mut slot) = state.scan_cancel.lock() {
        if let Some(old) = slot.take() {
            old.store(true, Ordering::SeqCst);
        }
    }
    let scan_id = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let cancel = Arc::new(AtomicBool::new(false));
    if let Ok(mut slot) = state.scan_cancel.lock() {
        *slot = Some(Arc::clone(&cancel));
    }
    state.scanning.store(true, Ordering::SeqCst);
    let root_str = path.to_string_lossy().into_owned();
    let app2 = app.clone();
    std::thread::Builder::new()
        .name("disk-scan".into())
        .spawn(move || {
            let state = app2.state::<DiskState>();
            let opts = scan::ScanOptions { cluster: volumes::cluster_size(&path), ..Default::default() };
            log::info!("disk: scanning {root_str} ({} threads)", opts.threads);
            let result = scan::scan(&path, opts, Arc::clone(&cancel), |p| {
                let _ = app2.emit(
                    SCAN_PROGRESS_EVENT,
                    ScanProgressEvent {
                        scan_id,
                        root: root_str.clone(),
                        files: p.files,
                        dirs: p.dirs,
                        bytes: p.bytes,
                        current: p.current.clone(),
                        elapsed_ms: p.elapsed_ms,
                    },
                );
            });
            let stale = state.generation.load(Ordering::SeqCst) != scan_id;
            match result {
                Ok(arena) if !stale => {
                    log::info!(
                        "disk: {} files, {} folders, {} bytes in {} ms ({} errors)",
                        arena.nodes[0].files,
                        arena.nodes[0].dirs,
                        arena.nodes[0].size,
                        arena.elapsed_ms,
                        arena.errors
                    );
                    let summary = summary_of(&arena, scan_id);
                    remember_recent(&app2, &arena.root, arena.nodes[0].size);
                    if let Ok(mut guard) = state.arena.write() {
                        *guard = Some(arena);
                    }
                    if let Ok(mut d) = state.dupes.lock() {
                        *d = None;
                    }
                    state.scanning.store(false, Ordering::SeqCst);
                    let _ = app2.emit(
                        SCAN_DONE_EVENT,
                        ScanDoneEvent { scan_id, ok: true, cancelled: false, error: None, summary: Some(summary) },
                    );
                }
                Ok(_) => {
                    let _ = app2.emit(
                        SCAN_DONE_EVENT,
                        ScanDoneEvent { scan_id, ok: false, cancelled: true, error: None, summary: None },
                    );
                }
                Err(err) => {
                    let cancelled = matches!(err, scan::ScanError::Cancelled);
                    if !cancelled {
                        log::warn!("disk: scan of {root_str} failed: {err}");
                    }
                    if !stale {
                        state.scanning.store(false, Ordering::SeqCst);
                    }
                    let _ = app2.emit(
                        SCAN_DONE_EVENT,
                        ScanDoneEvent {
                            scan_id,
                            ok: false,
                            cancelled,
                            error: if cancelled { None } else { Some(err.to_string()) },
                            summary: None,
                        },
                    );
                }
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(scan_id)
}

#[tauri::command]
pub fn disk_scan_cancel(state: State<'_, DiskState>) {
    if let Ok(mut slot) = state.scan_cancel.lock() {
        if let Some(c) = slot.take() {
            c.store(true, Ordering::SeqCst);
        }
    }
    state.scanning.store(false, Ordering::SeqCst);
}

#[tauri::command(async)]
pub fn disk_summary(state: State<'_, DiskState>) -> Option<ScanSummary> {
    let gen = state.generation.load(Ordering::SeqCst);
    with_arena(&state, |a| summary_of(a, gen)).ok()
}

// ---- tree queries ---------------------------------------------------------------

#[tauri::command]
pub fn disk_node(state: State<'_, DiskState>, id: u32) -> Result<Option<NodeInfo>, String> {
    with_arena(&state, |a| a.info(id))
}

#[tauri::command(async)]
pub fn disk_children(state: State<'_, DiskState>, id: u32, limit: Option<usize>) -> Result<ChildrenPage, String> {
    with_arena(&state, |a| {
        let (items, total) = a.children_info(id, limit.unwrap_or(2000).clamp(1, 20000));
        ChildrenPage { items, total }
    })
}

#[tauri::command(async)]
pub fn disk_subtree(
    state: State<'_, DiskState>,
    id: u32,
    depth: Option<u32>,
    min_bytes: Option<u64>,
    max_children: Option<usize>,
    budget: Option<usize>,
) -> Result<Option<TreeNode>, String> {
    with_arena(&state, |a| {
        a.subtree(
            id,
            depth.unwrap_or(4).clamp(1, 12),
            min_bytes.unwrap_or(0),
            max_children.unwrap_or(400).clamp(1, 5000),
            budget.unwrap_or(40_000).clamp(100, 200_000),
        )
    })
}

#[tauri::command(async)]
pub fn disk_find(state: State<'_, DiskState>, path: String) -> Result<Option<u32>, String> {
    with_arena(&state, |a| a.find_path(&path))
}

#[tauri::command(async)]
pub fn disk_search(state: State<'_, DiskState>, query: String, limit: Option<usize>) -> Result<Vec<NodeInfo>, String> {
    with_arena(&state, |a| a.search(&query, limit.unwrap_or(200).clamp(1, 2000)))
}

#[tauri::command(async)]
pub fn disk_top_files(
    state: State<'_, DiskState>,
    id: u32,
    cat: Option<u8>,
    min_bytes: Option<u64>,
    modified_after: Option<i64>,
    limit: Option<usize>,
) -> Result<Vec<NodeInfo>, String> {
    with_arena(&state, |a| {
        a.top_files(
            id,
            FileFilter { cat, min_bytes: min_bytes.unwrap_or(0), modified_after },
            limit.unwrap_or(200).clamp(1, 5000),
        )
    })
}

#[tauri::command]
pub fn disk_breakdown(state: State<'_, DiskState>, id: u32) -> Result<Breakdown, String> {
    with_arena(&state, |a| a.breakdown(id))
}

#[tauri::command(async)]
pub fn disk_quick_wins(state: State<'_, DiskState>) -> Result<Vec<quickwins::QuickWin>, String> {
    let apps = apps_list(&state, false);
    let services = services_list(&state, false);
    with_arena(&state, |a| quickwins::quick_wins(a, &installed::installed_node_ids(a, &apps, &services)))
}

// ---- shell -------------------------------------------------------------------------

#[tauri::command]
pub fn disk_reveal(path: String) -> Result<(), String> {
    sys::reveal(&path)
}

#[tauri::command]
pub fn disk_open(path: String) -> Result<(), String> {
    sys::open(&path)
}

/// How far the Recycle Bin move has got. `path` is the item being moved right
/// now, empty on the final tick.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashProgress {
    pub done: usize,
    pub total: usize,
    pub path: String,
}

/// Moves the given nodes to the Recycle Bin and folds them out of the arena.
/// `elevated`: let Windows ask for administrator permission — the second try
/// for the items the first one reported with `needsAdmin`.
///
/// **Async on purpose.** A synchronous command runs on the main thread, and the
/// shell empties a folder file by file: 15 items / 19.6 GB took minutes here and
/// froze all three windows, the tray and the single-instance handler with it —
/// the app looked dead while the delete was in fact working. The shell work now
/// runs on a blocking worker and reports `disk-trash-progress` as it goes.
#[tauri::command]
pub async fn disk_trash(app: AppHandle, state: State<'_, DiskState>, ids: Vec<u32>, elevated: Option<bool>) -> Result<TrashOutcome, String> {
    let targets: Vec<(u32, String, u64)> = with_arena(&state, |a| {
        ids.iter()
            .filter_map(|&id| a.get(id).filter(|n| !n.removed()).map(|n| (id, a.path_of(id), n.size)))
            .collect()
    })?;
    let outcome = trash_targets(&app, targets, elevated.unwrap_or(false)).await?;
    // Whatever moved is no longer a duplicate of anything; a folder's files are
    // caught by the duplicates re-check instead, which finds them gone.
    if let Ok(mut stored) = state.dupes.lock() {
        if let Some(stored) = stored.as_mut() {
            dupes::forget(stored, &outcome.removed.iter().copied().collect());
        }
    }
    Ok(outcome)
}

/// The one road out of the scanned tree, for every caller that removes
/// anything: `(id, path, size)` in, what happened out. In order: parts of
/// installed programs are left alone (`installed.rs`), drives the Recycle Bin
/// cannot take are refused, the rest goes through the shell on its own thread
/// with progress events, and whatever moved is folded out of the arena.
pub async fn trash_targets(app: &AppHandle, targets: Vec<(u32, String, u64)>, elevate: bool) -> Result<TrashOutcome, String> {
    let mut outcome = TrashOutcome { removed: Vec::new(), freed: 0, failed: Vec::new(), skipped: Vec::new() };
    if targets.is_empty() {
        return Ok(outcome);
    }
    let generation = app.state::<DiskState>().generation.load(Ordering::SeqCst);
    let owner = owner_window(app);
    let worker_app = app.clone();
    let worker_targets = targets.clone();
    let (skipped, refused, failures) = tauri::async_runtime::spawn_blocking(move || {
        let state = worker_app.state::<DiskState>();
        let apps = apps_list(&state, false);
        let services = services_list(&state, false);
        let mut skipped: Vec<installed::Protection> = Vec::new();
        let mut movable: Vec<(u32, String, u64)> = Vec::new();
        for (id, path, size) in &worker_targets {
            if let Some(protection) = installed::protection(*id, path, &apps, &services) {
                skipped.push(protection);
            } else {
                movable.push((*id, path.clone(), *size));
            }
        }
        // The Recycle Bin guard (bin.rs): a drive with no bin, a bin set to delete
        // right away, or a batch bigger than the bin — Windows would delete those
        // for good, so they are refused before the shell ever sees them.
        let bins = bin::recyclable(&movable);
        let refused: Vec<(String, String)> = bins.refused.into_iter().map(|(_, path, why)| (path, why)).collect();
        let paths: Vec<String> = bins.ok.into_iter().map(|(_, path, _)| path).collect();
        let total = paths.len();
        let failures = if paths.is_empty() {
            Vec::new()
        } else {
            let progress_app = worker_app.clone();
            sys::trash_with_progress(&paths, sys::TrashOptions { elevate, owner }, move |done, path| {
                let _ = progress_app.emit(TRASH_PROGRESS_EVENT, TrashProgress { done, total, path: path.to_string() });
            })
        };
        (skipped, refused, failures)
    })
    .await
    .map_err(|e| format!("the cleanup worker stopped: {e}"))?;

    let state = app.state::<DiskState>();
    let mut guard = state.arena.write().map_err(|_| "disk state poisoned".to_string())?;
    // A scan that finished meanwhile replaced the tree: those ids mean nothing in it.
    let same_tree = state.generation.load(Ordering::SeqCst) == generation;
    for (id, path, size) in targets {
        if skipped.iter().any(|s| s.id == id) {
            continue;
        }
        if let Some((_, why)) = refused.iter().find(|(p, _)| *p == path) {
            outcome.failed.push(TrashFailure { id, path, error: why.clone(), needs_admin: false });
            continue;
        }
        match failures.iter().find(|(p, _)| *p == path) {
            Some((_, error)) => {
                log::warn!("disk: could not trash {path}: {}", error.message);
                outcome.failed.push(TrashFailure { id, path, error: error.message.clone(), needs_admin: error.needs_admin });
            }
            None => {
                if same_tree {
                    if let Some(arena) = guard.as_mut() {
                        arena.remove(id);
                    }
                }
                outcome.removed.push(id);
                outcome.freed += size;
            }
        }
    }
    if !skipped.is_empty() {
        log::info!("disk: {} item(s) left alone as parts of installed programs", skipped.len());
    }
    outcome.skipped = skipped;
    if !outcome.removed.is_empty() {
        log::info!("disk: {} item(s) moved to the recycle bin, {} bytes", outcome.removed.len(), outcome.freed);
    }
    Ok(outcome)
}

/// What a cleanup would run into, for the confirmation to say before anything moves.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupCheck {
    /// Items left alone as parts of installed programs.
    pub protections: Vec<installed::Protection>,
    /// Per drive, what the rest would put in its Recycle Bin (`bin.rs`).
    pub bins: Vec<bin::BinUse>,
}

/// What a cleanup of `ids` would leave alone and what it would ask of each
/// Recycle Bin, asked before the confirmation so the dialog can say so. Reads
/// the registry the first time: not on the main thread.
#[tauri::command(async)]
pub fn disk_cleanup_check(state: State<'_, DiskState>, ids: Vec<u32>) -> Result<CleanupCheck, String> {
    let targets: Vec<(u32, String, u64)> = with_arena(&state, |a| {
        ids.iter().filter_map(|&id| a.get(id).filter(|n| !n.removed()).map(|n| (id, a.path_of(id), n.size))).collect()
    })?;
    if targets.is_empty() {
        return Ok(CleanupCheck { protections: Vec::new(), bins: Vec::new() });
    }
    let apps = apps_list(&state, false);
    let services = services_list(&state, false);
    let protections: Vec<installed::Protection> =
        targets.iter().filter_map(|(id, path, _)| installed::protection(*id, path, &apps, &services)).collect();
    let movable: Vec<(u32, String, u64)> =
        targets.into_iter().filter(|(id, _, _)| !protections.iter().any(|p| p.id == *id)).collect();
    Ok(CleanupCheck { protections, bins: bin::recyclable(&movable).bins })
}

// ---- duplicates -----------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DupesDoneEvent {
    pub ok: bool,
    pub error: Option<String>,
    pub result: Option<dupes::DupesResult>,
}

#[tauri::command]
pub fn disk_dupes_start(app: AppHandle, state: State<'_, DiskState>, root_id: Option<u32>, min_bytes: Option<u64>) -> Result<(), String> {
    if state.dupes_running.swap(true, Ordering::SeqCst) {
        return Err("already looking for duplicates".into());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    if let Ok(mut slot) = state.dupes_cancel.lock() {
        *slot = Some(Arc::clone(&cancel));
    }
    let root_id = root_id.unwrap_or(0);
    let min_bytes = min_bytes.unwrap_or(1024 * 1024);
    let generation = state.generation.load(Ordering::SeqCst);
    let app2 = app.clone();
    std::thread::Builder::new()
        .name("disk-dupes".into())
        .spawn(move || {
            let state = app2.state::<DiskState>();
            let finish = |event: DupesDoneEvent| {
                state.dupes_running.store(false, Ordering::SeqCst);
                let _ = app2.emit(DUPES_DONE_EVENT, event);
            };
            let _ = app2.emit(
                DUPES_PROGRESS_EVENT,
                dupes::DupesProgress { phase: "collect", done: 0, total: 0, bytes_done: 0, bytes_total: 0 },
            );
            // Installed programs' own folders (as the registry records them) are
            // left out along with Windows, AppData and the rest — see protect.rs.
            let app_dirs: Vec<String> = apps_list(&state, false).into_iter().filter_map(|app| app.location).collect();
            let collected = with_arena(&state, |a| {
                if a.source == "snapshot" {
                    return Err("a snapshot keeps folder sizes, not the files themselves — scan the folder to look for duplicates".to_string());
                }
                let guard = protect::Guard::new(a, root_id, &app_dirs);
                Ok(dupes::collect_candidates(a, root_id, min_bytes, &guard))
            });
            let collected = match collected.and_then(|c| c) {
                Ok(c) => c,
                Err(e) => return finish(DupesDoneEvent { ok: false, error: Some(e), result: None }),
            };
            let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(2, 8);
            let found = dupes::find_duplicates(&collected.candidates, threads, &cancel, |p| {
                let _ = app2.emit(DUPES_PROGRESS_EVENT, p.clone());
            });
            if state.generation.load(Ordering::SeqCst) != generation {
                return finish(DupesDoneEvent { ok: false, error: Some("the scan changed".into()), result: None });
            }
            let result = with_arena(&state, |a| dupes::build_result(a, root_id, min_bytes, &collected, found));
            match result {
                Ok(r) => {
                    log::info!(
                        "disk: duplicates — {} groups, {} extra copies, {} bytes; left out {:?}",
                        r.group_count,
                        r.extra_copies,
                        r.wasted,
                        r.left_out
                    );
                    if let Ok(mut d) = state.dupes.lock() {
                        *d = Some(r.clone());
                    }
                    finish(DupesDoneEvent { ok: true, error: None, result: Some(r) });
                }
                Err(e) => finish(DupesDoneEvent { ok: false, error: Some(e), result: None }),
            }
        })
        .map_err(|e| {
            state.dupes_running.store(false, Ordering::SeqCst);
            e.to_string()
        })?;
    Ok(())
}

#[tauri::command]
pub fn disk_dupes_cancel(state: State<'_, DiskState>) {
    if let Ok(slot) = state.dupes_cancel.lock() {
        if let Some(c) = slot.as_ref() {
            c.store(true, Ordering::SeqCst);
        }
    }
}

#[tauri::command(async)]
pub fn disk_dupes_result(state: State<'_, DiskState>) -> Option<dupes::DupesResult> {
    state.dupes.lock().ok().and_then(|d| d.clone())
}

/// Moves ticked copies from the last duplicates search to the Recycle Bin —
/// after reading each of them again, and a copy that stays, right before they
/// go (`dupes::verify_plan`). Only copies still identical to a surviving copy
/// move; the rest are reported and left alone. The move itself is
/// `trash_targets`, the same road as every other cleanup.
#[tauri::command]
pub async fn disk_dupes_trash(app: AppHandle, state: State<'_, DiskState>, ids: Vec<u32>, elevated: Option<bool>) -> Result<TrashOutcome, String> {
    let result = state.dupes.lock().ok().and_then(|d| d.clone()).ok_or_else(|| "look for duplicates again first".to_string())?;
    let plan = with_arena(&state, |a| dupes::removal_plan(a, &result, &ids))?;
    let worker_app = app.clone();
    let checked = tauri::async_runtime::spawn_blocking(move || {
        let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(2, 8);
        dupes::verify_plan(plan, threads, &AtomicBool::new(false), |done, total| {
            let _ = worker_app.emit(
                DUPES_PROGRESS_EVENT,
                dupes::DupesProgress { phase: "check", done, total, bytes_done: 0, bytes_total: 0 },
            );
        })
    })
    .await
    .map_err(|e| format!("the duplicates check stopped: {e}"))?;
    if !checked.refused.is_empty() {
        log::info!("disk: {} ticked duplicate(s) left alone by the re-check", checked.refused.len());
    }
    let targets = checked.ok.iter().map(|f| (f.id, f.path.to_string_lossy().into_owned(), f.size)).collect();
    let mut outcome = trash_targets(&app, targets, elevated.unwrap_or(false)).await?;
    outcome
        .failed
        .extend(checked.refused.into_iter().map(|(id, path, error)| TrashFailure { id, path, error, needs_admin: false }));
    if let Ok(mut stored) = state.dupes.lock() {
        if let Some(stored) = stored.as_mut() {
            dupes::forget(stored, &outcome.removed.iter().copied().collect());
        }
    }
    Ok(outcome)
}

// ---- applications -----------------------------------------------------------------

#[tauri::command(async)]
pub fn disk_apps(state: State<'_, DiskState>, refresh: Option<bool>) -> Vec<apps::AppInfo> {
    let refresh = refresh.unwrap_or(false);
    let mut list = apps_list(&state, refresh);
    if refresh {
        let _ = services_list(&state, true);
    }
    let guard = state.arena.read().ok();
    apps::attach_sizes(&mut list, guard.as_deref().and_then(|a| a.as_ref()));
    list
}

#[tauri::command(async)]
pub fn disk_app_uninstall(state: State<'_, DiskState>, id: String) -> Result<(), String> {
    let command = apps_list(&state, false)
        .into_iter()
        .find(|a| a.id == id)
        .and_then(|a| a.uninstall)
        .ok_or_else(|| "this app has no uninstaller entry".to_string())?;
    let command = apps::quote_command(&command, &|p| std::path::Path::new(p).is_file());
    log::info!("disk: launching uninstaller for {id}");
    sys::run_uninstall(&command)
}

#[tauri::command]
pub fn disk_open_apps_settings() -> Result<(), String> {
    sys::open_apps_settings()
}

// ---- monitor -----------------------------------------------------------------------

#[tauri::command(async)]
pub fn disk_monitor_start() {
    volumes::monitor_start();
}

#[tauri::command]
pub fn disk_monitor_read() -> volumes::MonitorData {
    volumes::monitor_read()
}

// ---- snapshots ---------------------------------------------------------------------

#[tauri::command(async)]
pub fn disk_snapshot_save(app: AppHandle, state: State<'_, DiskState>, name: Option<String>) -> Result<snapshot::SnapshotMeta, String> {
    let dir = app_data(&app)?;
    with_arena(&state, |a| snapshot::save(&dir, a, name.as_deref().unwrap_or("")))?
}

#[tauri::command]
pub fn disk_snapshot_list(app: AppHandle) -> Result<Vec<snapshot::SnapshotMeta>, String> {
    Ok(snapshot::list(&app_data(&app)?))
}

#[tauri::command]
pub fn disk_snapshot_delete(app: AppHandle, id: String) -> Result<(), String> {
    snapshot::delete(&app_data(&app)?, &id)
}

/// Compare snapshot `id` (before) with snapshot `against` or, without one,
/// the current scan (after).
#[tauri::command(async)]
pub fn disk_snapshot_diff(
    app: AppHandle,
    state: State<'_, DiskState>,
    id: String,
    against: Option<String>,
) -> Result<snapshot::SnapshotDiff, String> {
    let dir = app_data(&app)?;
    let before = snapshot::load(&dir, &id)?;
    let (after_meta, after_tree) = match against {
        Some(other) => {
            let snap = snapshot::load(&dir, &other)?;
            (snap.meta, snap.tree)
        }
        None => with_arena(&state, |a| {
            let root = &a.nodes[0];
            (
                // The tree as it is now (cleanups included), so it is stamped "now",
                // not with the scan time — which can predate the snapshot.
                snapshot::SnapshotMeta {
                    id: "current".into(),
                    name: "current scan".into(),
                    root: a.root.clone(),
                    created: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
                    size: root.size,
                    alloc: root.alloc,
                    files: root.files,
                    dirs: root.dirs,
                    file_bytes: 0,
                },
                snapshot::tree_from_arena(a),
            )
        })?,
    };
    let same_root = if cfg!(windows) {
        before.meta.root.eq_ignore_ascii_case(&after_meta.root)
    } else {
        before.meta.root == after_meta.root
    };
    if !same_root {
        return Err(format!("different roots: {} vs {}", before.meta.root, after_meta.root));
    }
    let (entries, truncated) = snapshot::diff_trees(&before.tree, &after_tree);
    Ok(snapshot::SnapshotDiff {
        delta: after_meta.size as i64 - before.meta.size as i64,
        before: before.meta,
        after: after_meta,
        entries,
        truncated,
    })
}

/// Loads a snapshot as the current tree (folders + files ≥ 1 MiB).
#[tauri::command(async)]
pub fn disk_snapshot_open(app: AppHandle, state: State<'_, DiskState>, id: String) -> Result<ScanSummary, String> {
    let dir = app_data(&app)?;
    let snap = snapshot::load(&dir, &id)?;
    disk_scan_cancel(state.clone());
    let arena = snapshot::arena_from(&snap);
    let scan_id = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let summary = summary_of(&arena, scan_id);
    if let Ok(mut guard) = state.arena.write() {
        *guard = Some(arena);
    }
    if let Ok(mut d) = state.dupes.lock() {
        *d = None;
    }
    let _ = app.emit(
        SCAN_DONE_EVENT,
        ScanDoneEvent { scan_id, ok: true, cancelled: false, error: None, summary: Some(summary.clone()) },
    );
    Ok(summary)
}
