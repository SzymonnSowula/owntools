//! disk — the analyzer's backend. The scanned tree stays here, in memory
//! (`arena.rs`); the frontend asks for the parts it draws. Long jobs (scan,
//! duplicates) run on their own threads and report through events:
//! `disk-scan-progress` / `disk-scan-done` / `disk-dupes-progress` /
//! `disk-dupes-done`. Every event carries the scan generation it belongs
//! to, so a cancelled scan's late messages are ignored by the UI.

pub mod apps;
pub mod arena;
pub mod category;
pub mod dupes;
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

const MAX_RECENT: usize = 8;

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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashOutcome {
    pub removed: Vec<u32>,
    pub freed: u64,
    pub failed: Vec<TrashFailure>,
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

// ---- volumes & roots ---------------------------------------------------------

#[tauri::command]
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

#[tauri::command]
pub fn disk_summary(state: State<'_, DiskState>) -> Option<ScanSummary> {
    let gen = state.generation.load(Ordering::SeqCst);
    with_arena(&state, |a| summary_of(a, gen)).ok()
}

// ---- tree queries ---------------------------------------------------------------

#[tauri::command]
pub fn disk_node(state: State<'_, DiskState>, id: u32) -> Result<Option<NodeInfo>, String> {
    with_arena(&state, |a| a.info(id))
}

#[tauri::command]
pub fn disk_children(state: State<'_, DiskState>, id: u32, limit: Option<usize>) -> Result<ChildrenPage, String> {
    with_arena(&state, |a| {
        let (items, total) = a.children_info(id, limit.unwrap_or(2000).clamp(1, 20000));
        ChildrenPage { items, total }
    })
}

#[tauri::command]
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

#[tauri::command]
pub fn disk_find(state: State<'_, DiskState>, path: String) -> Result<Option<u32>, String> {
    with_arena(&state, |a| a.find_path(&path))
}

#[tauri::command(async)]
pub fn disk_search(state: State<'_, DiskState>, query: String, limit: Option<usize>) -> Result<Vec<NodeInfo>, String> {
    with_arena(&state, |a| a.search(&query, limit.unwrap_or(200).clamp(1, 2000)))
}

#[tauri::command]
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
    with_arena(&state, quickwins::quick_wins)
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
///
/// **Async on purpose.** A synchronous command runs on the main thread, and the
/// shell empties a folder file by file: 15 items / 19.6 GB took minutes here and
/// froze all three windows, the tray and the single-instance handler with it —
/// the app looked dead while the delete was in fact working. The shell work now
/// runs on a blocking worker and reports `disk-trash-progress` as it goes.
#[tauri::command]
pub async fn disk_trash(app: AppHandle, state: State<'_, DiskState>, ids: Vec<u32>) -> Result<TrashOutcome, String> {
    let targets: Vec<(u32, String, u64)> = with_arena(&state, |a| {
        ids.iter()
            .filter_map(|&id| a.get(id).filter(|n| !n.removed()).map(|n| (id, a.path_of(id), n.size)))
            .collect()
    })?;
    if targets.is_empty() {
        return Ok(TrashOutcome { removed: Vec::new(), freed: 0, failed: Vec::new() });
    }
    let paths: Vec<String> = targets.iter().map(|t| t.1.clone()).collect();
    let total = paths.len();
    let worker_paths = paths.clone();
    let progress_app = app.clone();
    let failures = tauri::async_runtime::spawn_blocking(move || {
        sys::trash_with_progress(&worker_paths, |done, path| {
            let _ = progress_app.emit(
                "disk-trash-progress",
                TrashProgress { done, total, path: path.to_string() },
            );
        })
    })
    .await
    .map_err(|e| format!("the cleanup worker stopped: {e}"))?;
    let mut outcome = TrashOutcome { removed: Vec::new(), freed: 0, failed: Vec::new() };
    let mut guard = state.arena.write().map_err(|_| "disk state poisoned".to_string())?;
    let arena = guard.as_mut().ok_or_else(|| "nothing scanned yet".to_string())?;
    for (id, path, size) in targets {
        match failures.iter().find(|(p, _)| *p == path) {
            Some((_, error)) => {
                log::warn!("disk: could not trash {path}: {error}");
                outcome.failed.push(TrashFailure { id, path, error: error.clone() });
            }
            None => {
                arena.remove(id);
                outcome.removed.push(id);
                outcome.freed += size;
            }
        }
    }
    if !outcome.removed.is_empty() {
        log::info!("disk: {} item(s) moved to the recycle bin, {} bytes", outcome.removed.len(), outcome.freed);
    }
    Ok(outcome)
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
            let collected = match with_arena(&state, |a| dupes::collect_candidates(a, root_id, min_bytes)) {
                Ok(c) => c,
                Err(e) => return finish(DupesDoneEvent { ok: false, error: Some(e), result: None }),
            };
            let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(2, 8);
            let candidate_files = collected.candidates.len() as u64;
            let (groups, cancelled) = dupes::find_duplicates(&collected.candidates, threads, &cancel, |p| {
                let _ = app2.emit(DUPES_PROGRESS_EVENT, p.clone());
            });
            if state.generation.load(Ordering::SeqCst) != generation {
                return finish(DupesDoneEvent { ok: false, error: Some("the scan changed".into()), result: None });
            }
            let result = with_arena(&state, |a| {
                dupes::build_result(a, root_id, min_bytes, collected.scanned_files, candidate_files, groups, cancelled)
            });
            match result {
                Ok(r) => {
                    log::info!(
                        "disk: duplicates — {} groups, {} extra copies, {} bytes",
                        r.group_count,
                        r.extra_copies,
                        r.wasted
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

#[tauri::command]
pub fn disk_dupes_result(state: State<'_, DiskState>) -> Option<dupes::DupesResult> {
    state.dupes.lock().ok().and_then(|d| d.clone())
}

// ---- applications -----------------------------------------------------------------

#[tauri::command(async)]
pub fn disk_apps(state: State<'_, DiskState>, refresh: Option<bool>) -> Vec<apps::AppInfo> {
    let mut list = {
        let mut cache = state.apps_cache.lock().ok();
        let fresh = cache
            .as_deref()
            .and_then(|c| c.as_ref())
            .filter(|(at, _)| !refresh.unwrap_or(false) && at.elapsed().as_secs() < 120)
            .map(|(_, list)| list.clone());
        match fresh {
            Some(list) => list,
            None => {
                let list = apps::installed_apps();
                if let Some(c) = cache.as_deref_mut() {
                    *c = Some((Instant::now(), list.clone()));
                }
                list
            }
        }
    };
    let guard = state.arena.read().ok();
    apps::attach_sizes(&mut list, guard.as_deref().and_then(|a| a.as_ref()));
    list
}

#[tauri::command]
pub fn disk_app_uninstall(state: State<'_, DiskState>, id: String) -> Result<(), String> {
    let command = state
        .apps_cache
        .lock()
        .ok()
        .and_then(|c| c.as_ref().and_then(|(_, list)| list.iter().find(|a| a.id == id).and_then(|a| a.uninstall.clone())))
        .ok_or_else(|| "this app has no uninstaller entry".to_string())?;
    log::info!("disk: launching uninstaller for {id}");
    sys::run_uninstall(&command)
}

#[tauri::command]
pub fn disk_open_apps_settings() -> Result<(), String> {
    sys::open_apps_settings()
}

// ---- monitor -----------------------------------------------------------------------

#[tauri::command]
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
