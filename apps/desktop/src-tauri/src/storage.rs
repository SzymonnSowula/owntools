//! Settings → Storage: what owntools keeps on this device, and taking some of
//! it back.
//!
//! Three kinds of thing, handled differently on purpose:
//!
//! - **Cache** — the WAV a dictation take was transcribed from, the full-screen
//!   frame of a capture that never finished, meeting segments once the meeting
//!   is written, the audio a YouTube transcript was made from, leftovers of
//!   atomic writes and sync swaps, and the web view's disk cache. Nobody made
//!   any of it and owntools recreates what it needs. `sweep` lists it,
//!   `storage_usage` adds it up and `storage_clear_cache` deletes that same
//!   list, so the number on the button is the number freed.
//! - **Unfinished downloads** — `.part` files and installer archives. Nobody's
//!   work either, but a paused 2 GB model would have to be fetched again, so it
//!   is a button of its own.
//! - **Files people made** — screenshots, screen recordings, meeting audio.
//!   Listed one by one (so the page can offer "older than a month") and
//!   deleted by id: what the confirmation named is what goes, and a capture
//!   taken while the dialog was open is not part of it.
//!
//! Whatever a tool may be writing or about to read is left alone: the frame the
//! capture overlay shows, a download in flight, a meeting or captions session,
//! a take the recorder is still streaming (a project folder with no
//! `project.json` that changed within a day), and scratch files young enough
//! that the job that wrote them may still be reading them.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};

use crate::capture_tool;

/// A file written this recently may still be on its way to disk.
const FRESH_WRITE: Duration = Duration::from_secs(60);
/// A dictation take reads its WAV right after writing it.
const SCRATCH_AGE: Duration = Duration::from_secs(2 * 60);
/// Long enough for any job to get from writing a file to reading it (a
/// download finishing and unpacking, OCR, a YouTube transcript starting).
const JOB_AGE: Duration = Duration::from_secs(10 * 60);
/// Temp files of an atomic write live for milliseconds; an hour means a crash.
const LEFTOVER_AGE: Duration = Duration::from_secs(60 * 60);
/// A recording folder without `project.json` younger than this may be a take
/// being recorded right now (or one whose rescue card is still on screen).
const UNLISTED_RECORDING_AGE: Duration = Duration::from_secs(24 * 60 * 60);

/// Folders the leftover walk never enters: files whose names people choose
/// (media, overlay images) and the folders that have rules of their own.
const LEFTOVER_SKIP: &[&str] = &[
    "recordings/projects",
    "social/media",
    "whisper",
    "parakeet",
    "llm",
    "tools",
    "capture/tmp",
    "automations/tmp",
    "captions",
];

/// How deep the leftover walk lists (`board/boards/<id>` is 3).
const LEFTOVER_DEPTH: usize = 3;

/// WebView2's disk caches inside its profile folder — what
/// `ClearBrowsingData(DISK_CACHE)` empties. Local storage and IndexedDB, which
/// hold real settings, sit next to these and are never counted or touched.
#[cfg(windows)]
const WEB_CACHE_DIRS: &[&str] = &["Default/Cache", "Default/Code Cache", "Default/GPUCache"];

/* ------------------------------------------------------------------ */
/* What the page reads                                                  */
/* ------------------------------------------------------------------ */

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageUsage {
    /// `<AppData>` — where "Show in folder" goes.
    pub root: String,
    /// Every byte counted in `groups`.
    pub total: u64,
    pub groups: Groups,
    pub cache: CacheUsage,
    /// Newest first.
    pub captures: Vec<Item>,
    pub recordings: Vec<Item>,
    /// `bytes` is the audio archive; the transcript and notes are not counted here.
    pub meetings: Vec<Item>,
}

/// The bar across the top of the page. Every byte is in exactly one group.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Groups {
    pub captures: u64,
    pub recordings: u64,
    pub meetings: u64,
    /// Dictation engines and models (whisper, Parakeet).
    pub speech: u64,
    /// The language model and its runtime.
    pub language: u64,
    pub boards: u64,
    pub social: u64,
    /// What "Clear cache" takes: `cache.temp + cache.web`.
    pub cache: u64,
    pub downloads: u64,
    /// Settings, notes, logs, snapshots, the web view's own files.
    pub other: u64,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheUsage {
    pub temp: u64,
    pub temp_files: u64,
    /// The web view's disk cache (Windows; 0 elsewhere).
    pub web: u64,
    pub downloads: u64,
    pub download_files: u64,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub bytes: u64,
    /// Epoch ms: when a capture was taken; when a recording or a meeting's
    /// audio was last written.
    pub at: i64,
    /// On disk but not listed by its tool: a PNG the capture index lost, a take
    /// that never became a project, the audio of a meeting that never saved.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub unlisted: bool,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearOutcome {
    pub freed: u64,
    pub removed: u64,
    /// Would not go (in use, no permission) — left for next time.
    pub kept: u64,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteOutcome {
    pub removed: Vec<String>,
    pub freed: u64,
    /// Asked for, but not (entirely) deleted.
    pub failed: Vec<String>,
    /// Being recorded right now, so not touched.
    pub skipped: Vec<String>,
}

/* ------------------------------------------------------------------ */
/* What is in use                                                       */
/* ------------------------------------------------------------------ */

pub struct Guards {
    pub now: SystemTime,
    pub active_parts: Vec<PathBuf>,
    pub recording_dirs: Vec<PathBuf>,
    pub open_frame: Option<PathBuf>,
}

impl Guards {
    fn live(app: &AppHandle) -> Self {
        Self {
            now: SystemTime::now(),
            active_parts: crate::downloader::active_parts(),
            recording_dirs: crate::audio_capture::recording_dirs(),
            open_frame: capture_tool::open_frame_path(app),
        }
    }

    fn older(&self, meta: &fs::Metadata, age: Duration) -> bool {
        older_than(touched(meta), self.now, age)
    }

    fn recording(&self, dir: &Path) -> bool {
        self.recording_dirs.iter().any(|d| d == dir)
    }

    fn downloading(&self, part: &Path) -> bool {
        self.active_parts.iter().any(|p| p == part)
    }
}

/// The later of modified and created. A copy keeps its source's modified time
/// (automations import watched files that way), but its creation is now.
fn touched(meta: &fs::Metadata) -> SystemTime {
    let modified = meta.modified().unwrap_or(UNIX_EPOCH);
    match meta.created() {
        Ok(created) if created > modified => created,
        _ => modified,
    }
}

/// A time in the future (a clock change) counts as young.
fn older_than(time: SystemTime, now: SystemTime, age: Duration) -> bool {
    now.duration_since(time).map(|d| d >= age).unwrap_or(false)
}

fn epoch_ms(time: SystemTime) -> i64 {
    time.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/* ------------------------------------------------------------------ */
/* Walking                                                              */
/* ------------------------------------------------------------------ */

fn name_of(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

#[derive(Default)]
struct Listing {
    files: Vec<(PathBuf, fs::Metadata)>,
    dirs: Vec<(PathBuf, fs::Metadata)>,
}

/// One directory, split into real files and folders (links are never
/// followed). Type and metadata come from the listing itself, which on
/// Windows costs no call per file.
fn list(dir: &Path) -> Listing {
    let mut out = Listing::default();
    let Ok(entries) = fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_symlink() {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if ft.is_dir() {
            out.dirs.push((entry.path(), meta));
        } else if ft.is_file() {
            out.files.push((entry.path(), meta));
        }
    }
    out
}

fn files_in(dir: &Path) -> Vec<(PathBuf, fs::Metadata)> {
    list(dir).files
}

fn dirs_in(dir: &Path) -> Vec<(PathBuf, fs::Metadata)> {
    list(dir).dirs
}

fn files_under(dir: &Path) -> Vec<(PathBuf, fs::Metadata)> {
    let Listing { mut files, dirs } = list(dir);
    for (sub, _) in dirs {
        files.extend(files_under(&sub));
    }
    files
}

/// Bytes and files under a path; a file counts itself. Unreadable parts are skipped.
fn size_of(path: &Path) -> (u64, u64) {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return (0, 0);
    };
    if meta.file_type().is_symlink() {
        return (0, 0);
    }
    if meta.is_file() {
        return (meta.len(), 1);
    }
    fn walk(dir: &Path) -> (u64, u64) {
        let Listing { files, dirs } = list(dir);
        let mut acc = (files.iter().map(|(_, m)| m.len()).sum(), files.len() as u64);
        for (sub, _) in dirs {
            let (bytes, count) = walk(&sub);
            acc.0 += bytes;
            acc.1 += count;
        }
        acc
    }
    walk(path)
}

/// The last time anything under `path` (itself included) was written.
fn newest(path: &Path) -> SystemTime {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return UNIX_EPOCH;
    };
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return touched(&meta);
    }
    fn walk(dir: &Path, mut latest: SystemTime) -> SystemTime {
        let Listing { files, dirs } = list(dir);
        for (_, meta) in &files {
            latest = latest.max(touched(meta));
        }
        for (sub, meta) in dirs {
            latest = walk(&sub, latest.max(touched(&meta)));
        }
        latest
    }
    walk(path, touched(&meta))
}

/* ------------------------------------------------------------------ */
/* The sweep                                                            */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Bucket {
    Cache,
    Downloads,
}

#[derive(Debug)]
pub struct Candidate {
    pub path: PathBuf,
    pub bytes: u64,
    pub files: u64,
    pub bucket: Bucket,
}

fn candidate(path: PathBuf, bucket: Bucket) -> Candidate {
    let (bytes, files) = size_of(&path);
    Candidate { path, bytes, files, bucket }
}

fn is_installer_archive(engine: &str, name: &str) -> bool {
    match engine {
        "whisper" => name.starts_with("whisper-bin") && name.ends_with(".zip"),
        "parakeet" => name == "runtime.tar.bz2",
        "llm" => name == "runtime.zip" || name == "runtime.tar.gz",
        _ => false,
    }
}

/// Everything "Clear cache" and "Delete unfinished downloads" would take right
/// now. `temp` is the system temp folder (whisper's JSON answers land there).
pub fn sweep(root: &Path, temp: &Path, g: &Guards) -> Vec<Candidate> {
    let mut out = Vec::new();

    // capture: the full-screen frame of a capture that was never finished or
    // cancelled (a second grab replaces the first without deleting it), the
    // downscaled copy OCR reads, a half-written index.
    let capture = root.join("capture");
    for (path, meta) in files_in(&capture.join("tmp")) {
        if g.open_frame.as_deref() == Some(path.as_path()) || !g.older(&meta, FRESH_WRITE) {
            continue;
        }
        out.push(candidate(path, Bucket::Cache));
    }
    for (path, meta) in files_in(&capture) {
        let name = name_of(&path);
        if (name.ends_with(".ocr.png") && g.older(&meta, JOB_AGE)) || (name.ends_with(".part") && g.older(&meta, LEFTOVER_AGE)) {
            out.push(candidate(path, Bucket::Cache));
        }
    }

    // dictation: the WAV each take is transcribed from, and whisper's JSON answer.
    for (path, meta) in files_in(&root.join("whisper")) {
        let name = name_of(&path);
        if name.starts_with("input-") && name.ends_with(".wav") && g.older(&meta, SCRATCH_AGE) {
            out.push(candidate(path, Bucket::Cache));
        }
    }
    // The system temp folder can hold anything, and a lot of it: names first.
    if let Ok(entries) = fs::read_dir(temp) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with("owntools-whisper-") || !name.ends_with(".json") {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_file() && g.older(&meta, JOB_AGE) {
                out.push(candidate(entry.path(), Bucket::Cache));
            }
        }
    }

    // live captions: segments still queued when the session ended.
    let captions = root.join("captions");
    if !g.recording(&captions) {
        for (path, meta) in files_in(&captions.join("segments")) {
            if g.older(&meta, FRESH_WRITE) {
                out.push(candidate(path, Bucket::Cache));
            }
        }
    }

    // meet: the per-utterance segments of a meeting that is saved. The
    // transcript was made from them and audio.wav, when kept, is the same sound.
    for (dir, _) in dirs_in(&root.join("meet")) {
        if g.recording(&dir) || !dir.join("meeting.json").is_file() {
            continue;
        }
        let segments = dir.join("segments");
        if segments.is_dir() {
            out.push(candidate(segments, Bucket::Cache));
        }
    }

    // tools: the audio a YouTube transcript was made from.
    for (path, meta) in files_under(&root.join("tools").join("youtube")) {
        if !name_of(&path).ends_with(".part") && g.older(&meta, JOB_AGE) {
            out.push(candidate(path, Bucket::Cache));
        }
    }

    // automations: copies of watched files a rule ran on.
    for (path, meta) in files_in(&root.join("automations").join("tmp")) {
        if g.older(&meta, crate::automations::TMP_MAX_AGE) {
            out.push(candidate(path, Bucket::Cache));
        }
    }

    // Unfinished downloads: partial files (resumable, which is why they are
    // their own button) and installer archives an unpack left behind.
    for engine in ["whisper", "parakeet", "llm", "tools"] {
        let base = root.join(engine);
        for (path, meta) in files_under(&base) {
            let name = name_of(&path);
            if name.ends_with(".part") {
                if !g.downloading(&path) {
                    out.push(candidate(path, Bucket::Downloads));
                }
            } else if path.parent() == Some(base.as_path()) && is_installer_archive(engine, &name) && g.older(&meta, JOB_AGE) {
                out.push(candidate(path, Bucket::Downloads));
            }
        }
    }

    leftovers(root, root, 0, g, &mut out);
    out.retain(|c| c.files > 0 || c.bytes > 0);
    out
}

/// Temp files of atomic writes (`*.tmp`, `*.tmp-<pid>`, `*.sync-tmp`) and the
/// two halves of a sync swap (`.<name>.sync-tmp-<pid>`, `.sync-old-<pid>`)
/// that a crash left behind.
fn leftovers(root: &Path, dir: &Path, depth: usize, g: &Guards, out: &mut Vec<Candidate>) {
    let Listing { files, dirs } = list(dir);
    for (sub, _) in dirs {
        let name = name_of(&sub);
        if name.contains(".sync-tmp-") || name.contains(".sync-old-") {
            if older_than(newest(&sub), g.now, LEFTOVER_AGE) {
                out.push(candidate(sub, Bucket::Cache));
            }
            continue;
        }
        let rel = sub
            .strip_prefix(root)
            .map(|r| r.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/"))
            .unwrap_or_default();
        if depth < LEFTOVER_DEPTH && !LEFTOVER_SKIP.contains(&rel.as_str()) {
            leftovers(root, &sub, depth + 1, g, out);
        }
    }
    for (path, meta) in files {
        let name = name_of(&path);
        let temp_name = name.ends_with(".tmp") || name.contains(".tmp-") || name.ends_with(".sync-tmp");
        if temp_name && g.older(&meta, LEFTOVER_AGE) {
            out.push(candidate(path, Bucket::Cache));
        }
    }
}

/* ------------------------------------------------------------------ */
/* Measuring                                                            */
/* ------------------------------------------------------------------ */

#[cfg(windows)]
fn web_cache_bytes(local: &Path) -> u64 {
    let profile = local.join("EBWebView");
    WEB_CACHE_DIRS.iter().map(|rel| size_of(&profile.join(rel)).0).sum()
}

#[cfg(not(windows))]
fn web_cache_bytes(_local: &Path) -> u64 {
    0
}

fn group_slot<'a>(groups: &'a mut Groups, top: &str) -> &'a mut u64 {
    match top {
        "capture" => &mut groups.captures,
        "recordings" => &mut groups.recordings,
        "meet" => &mut groups.meetings,
        "whisper" | "parakeet" => &mut groups.speech,
        "llm" => &mut groups.language,
        "board" => &mut groups.boards,
        "social" => &mut groups.social,
        _ => &mut groups.other,
    }
}

fn capture_items(dir: &Path, g: &Guards) -> Vec<Item> {
    let index = capture_tool::read_index(dir);
    let mut known = HashSet::new();
    let mut out = Vec::new();
    for item in index.items {
        known.insert(item.id.clone());
        let path = PathBuf::from(&item.path);
        if !path.starts_with(dir) {
            continue;
        }
        if let Ok(meta) = fs::metadata(&path) {
            out.push(Item { id: item.id, bytes: meta.len(), at: item.created_at, unlisted: false });
        }
    }
    for (path, meta) in files_in(dir) {
        let name = name_of(&path);
        let Some(id) = name.strip_suffix(".png") else { continue };
        // A capture being finished is written before its row: give it time.
        if id.ends_with(".ocr") || known.contains(id) || !g.older(&meta, JOB_AGE) {
            continue;
        }
        out.push(Item { id: id.to_string(), bytes: meta.len(), at: epoch_ms(touched(&meta)), unlisted: true });
    }
    out.sort_by(|a, b| b.at.cmp(&a.at));
    out
}

fn recording_items(projects: &Path, g: &Guards) -> Vec<Item> {
    let mut out = Vec::new();
    for (dir, _) in dirs_in(projects) {
        let id = name_of(&dir);
        if id.starts_with('.') {
            continue;
        }
        let listed = dir.join("project.json").is_file();
        let last = newest(&dir);
        if !listed && !older_than(last, g.now, UNLISTED_RECORDING_AGE) {
            continue;
        }
        let (bytes, _) = size_of(&dir);
        out.push(Item { id, bytes, at: epoch_ms(last), unlisted: !listed });
    }
    out.sort_by(|a, b| b.at.cmp(&a.at));
    out
}

fn meeting_items(meet: &Path, g: &Guards) -> Vec<Item> {
    let mut out = Vec::new();
    for (dir, _) in dirs_in(meet) {
        let id = name_of(&dir);
        if id.starts_with('.') || g.recording(&dir) {
            continue;
        }
        if dir.join("meeting.json").is_file() {
            if let Ok(meta) = fs::metadata(dir.join("audio.wav")) {
                out.push(Item { id, bytes: meta.len(), at: epoch_ms(touched(&meta)), unlisted: false });
            }
            continue;
        }
        let last = newest(&dir);
        let (bytes, _) = size_of(&dir);
        if bytes > 0 && older_than(last, g.now, JOB_AGE) {
            out.push(Item { id, bytes, at: epoch_ms(last), unlisted: true });
        }
    }
    out.sort_by(|a, b| b.at.cmp(&a.at));
    out
}

pub fn measure(root: &Path, local: Option<&Path>, temp: &Path, g: &Guards) -> StorageUsage {
    let mut usage = StorageUsage { root: root.to_string_lossy().into_owned(), ..Default::default() };
    let mut groups = Groups::default();

    for (path, _) in files_in(root).into_iter().chain(dirs_in(root)) {
        let top = name_of(&path);
        *group_slot(&mut groups, &top) += size_of(&path).0;
    }

    // What the sweep found moves out of its tool's group into cache / downloads.
    for c in sweep(root, temp, g) {
        if let Ok(rel) = c.path.strip_prefix(root) {
            if let Some(top) = rel.components().next() {
                let slot = group_slot(&mut groups, &top.as_os_str().to_string_lossy());
                *slot = slot.saturating_sub(c.bytes);
            }
        }
        match c.bucket {
            Bucket::Cache => {
                usage.cache.temp += c.bytes;
                usage.cache.temp_files += c.files.max(1);
            }
            Bucket::Downloads => {
                usage.cache.downloads += c.bytes;
                usage.cache.download_files += c.files.max(1);
            }
        }
    }

    // On Windows the web view's profile and the log live in a second folder.
    // (On macOS it is the same folder as `root`, already counted.)
    if let Some(local) = local.filter(|l| *l != root) {
        let (all, _) = size_of(local);
        let web = web_cache_bytes(local);
        usage.cache.web = web;
        groups.other += all.saturating_sub(web);
    }

    groups.cache = usage.cache.temp + usage.cache.web;
    groups.downloads = usage.cache.downloads;
    usage.total = groups.captures
        + groups.recordings
        + groups.meetings
        + groups.speech
        + groups.language
        + groups.boards
        + groups.social
        + groups.cache
        + groups.downloads
        + groups.other;
    usage.captures = capture_items(&root.join("capture"), g);
    usage.recordings = recording_items(&root.join("recordings").join("projects"), g);
    usage.meetings = meeting_items(&root.join("meet"), g);
    usage.groups = groups;
    usage
}

/* ------------------------------------------------------------------ */
/* Deleting                                                             */
/* ------------------------------------------------------------------ */

/// Deletes one file or folder. `Ok(freed)` when it is gone (already gone
/// counts), `Err(freed)` with what did go when part of it stayed.
fn remove_path(path: &Path) -> Result<u64, u64> {
    let (before, _) = size_of(path);
    let result = match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() => fs::remove_dir_all(path),
        Ok(_) => fs::remove_file(path),
        Err(e) => Err(e),
    };
    match result {
        Ok(()) => Ok(before),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(before),
        Err(e) => {
            log::warn!("storage: could not delete {}: {e}", path.display());
            Err(before.saturating_sub(size_of(path).0))
        }
    }
}

fn clear_bucket(candidates: &[Candidate], bucket: Bucket) -> ClearOutcome {
    let mut out = ClearOutcome::default();
    for c in candidates.iter().filter(|c| c.bucket == bucket) {
        match remove_path(&c.path) {
            Ok(_) => {
                out.freed += c.bytes;
                out.removed += c.files.max(1);
            }
            Err(freed) => {
                out.freed += freed;
                out.kept += 1;
            }
        }
    }
    out
}

pub fn delete_recordings(root: &Path, ids: &[String], g: &Guards) -> DeleteOutcome {
    let projects = root.join("recordings").join("projects");
    let mut out = DeleteOutcome::default();
    for id in ids {
        let dir = projects.join(id);
        if !dir.exists() {
            out.removed.push(id.clone());
            continue;
        }
        if !dir.join("project.json").is_file() && !older_than(newest(&dir), g.now, UNLISTED_RECORDING_AGE) {
            out.skipped.push(id.clone());
            continue;
        }
        match remove_path(&dir) {
            Ok(freed) => {
                out.freed += freed;
                out.removed.push(id.clone());
            }
            Err(freed) => {
                out.freed += freed;
                out.failed.push(id.clone());
            }
        }
    }
    if !out.removed.is_empty() {
        let gone: HashSet<&str> = out.removed.iter().map(String::as_str).collect();
        if let Err(e) = prune_recordings_index(root, &gone) {
            // The editor repairs the index against the folders when its list opens.
            log::warn!("storage: recordings index not updated: {e}");
        }
    }
    out
}

/// Drops deleted projects from `recordings/index.json`, leaving every other
/// field of the editor's rows as they are.
fn prune_recordings_index(root: &Path, gone: &HashSet<&str>) -> Result<(), String> {
    let path = root.join("recordings").join("index.json");
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.to_string()),
    };
    let mut rows: Vec<serde_json::Value> = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let before = rows.len();
    rows.retain(|row| row.get("id").and_then(|v| v.as_str()).map(|id| !gone.contains(id)).unwrap_or(true));
    if rows.len() == before {
        return Ok(());
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string_pretty(&rows).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// A saved meeting loses its sound (audio.wav and segments) and keeps its
/// transcript, notes and summary. A meeting that never saved is nothing but
/// sound, so its folder goes.
pub fn delete_meeting_audio(root: &Path, ids: &[String], g: &Guards) -> DeleteOutcome {
    let meet = root.join("meet");
    let mut out = DeleteOutcome::default();
    for id in ids {
        let dir = meet.join(id);
        if g.recording(&dir) {
            out.skipped.push(id.clone());
            continue;
        }
        if !dir.exists() {
            out.removed.push(id.clone());
            continue;
        }
        let targets = if dir.join("meeting.json").is_file() {
            vec![dir.join("audio.wav"), dir.join("segments")]
        } else if older_than(newest(&dir), g.now, JOB_AGE) {
            vec![dir.clone()]
        } else {
            out.skipped.push(id.clone());
            continue;
        };
        let mut ok = true;
        for target in targets {
            match remove_path(&target) {
                Ok(freed) => out.freed += freed,
                Err(freed) => {
                    out.freed += freed;
                    ok = false;
                }
            }
        }
        if ok {
            out.removed.push(id.clone());
        } else {
            out.failed.push(id.clone());
        }
    }
    out
}

/* ------------------------------------------------------------------ */
/* The web view's disk cache                                            */
/* ------------------------------------------------------------------ */

/// Asks WebView2 to empty its disk cache (HTTP, compiled scripts, GPU) for
/// the profile every window shares. Deleting those folders by hand is not an
/// option while the app runs — WebView2 holds them open — and Tauri's own
/// "clear browsing data" would take local storage, i.e. every setting, too.
#[cfg(windows)]
fn clear_web_cache(app: &AppHandle) -> Result<(), String> {
    use std::sync::mpsc;

    let window = app.get_webview_window("main").ok_or_else(|| "the main window is gone".to_string())?;
    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    window
        .with_webview(move |webview| {
            if let Err(e) = start_web_cache_clear(&webview, tx.clone()) {
                let _ = tx.send(Err(e.to_string()));
            }
        })
        .map_err(|e| e.to_string())?;
    // with_webview runs on the main thread; this command never does, so waiting here is fine.
    rx.recv_timeout(Duration::from_secs(20))
        .map_err(|_| "the web view did not answer in time".to_string())?
}

#[cfg(windows)]
fn start_web_cache_clear(
    webview: &tauri::webview::PlatformWebview,
    done: std::sync::mpsc::Sender<Result<(), String>>,
) -> windows::core::Result<()> {
    use webview2_com::ClearBrowsingDataCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Profile2, ICoreWebView2_13, COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE,
    };
    use windows::core::Interface;

    // SAFETY: COM calls on the webview's own thread, where with_webview runs this.
    unsafe {
        let core = webview.controller().CoreWebView2()?;
        let profile = core.cast::<ICoreWebView2_13>()?.Profile()?.cast::<ICoreWebView2Profile2>()?;
        let handler = ClearBrowsingDataCompletedHandler::create(Box::new(move |result| {
            let _ = done.send(result.map_err(|e| e.to_string()));
            Ok(())
        }));
        profile.ClearBrowsingData(COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE, &handler)
    }
}

/* ------------------------------------------------------------------ */
/* Commands                                                             */
/* ------------------------------------------------------------------ */

fn app_data(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| format!("app data folder: {e}"))
}

/// Opens `<AppData>` in the file manager.
#[tauri::command(async)]
pub fn storage_open_folder(app: AppHandle) -> Result<(), String> {
    capture_tool::open_in_shell(&app_data(&app)?, false)
}

#[tauri::command(async)]
pub fn storage_usage(app: AppHandle) -> Result<StorageUsage, String> {
    let root = app_data(&app)?;
    let local = app.path().app_local_data_dir().ok();
    Ok(measure(&root, local.as_deref(), &std::env::temp_dir(), &Guards::live(&app)))
}

#[tauri::command]
pub async fn storage_clear_cache(app: AppHandle) -> Result<ClearOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = app_data(&app)?;
        let candidates = sweep(&root, &std::env::temp_dir(), &Guards::live(&app));
        #[allow(unused_mut)]
        let mut outcome = clear_bucket(&candidates, Bucket::Cache);
        #[cfg(windows)]
        if let Ok(local) = app.path().app_local_data_dir() {
            let before = web_cache_bytes(&local);
            match clear_web_cache(&app) {
                Ok(()) => outcome.freed += before.saturating_sub(web_cache_bytes(&local)),
                Err(e) => log::warn!("storage: web cache not cleared: {e}"),
            }
        }
        log::info!(
            "storage: cache cleared, {} bytes freed, {} removed, {} kept",
            outcome.freed,
            outcome.removed,
            outcome.kept
        );
        Ok(outcome)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
pub fn storage_clear_downloads(app: AppHandle) -> Result<ClearOutcome, String> {
    let root = app_data(&app)?;
    let candidates = sweep(&root, &std::env::temp_dir(), &Guards::live(&app));
    let outcome = clear_bucket(&candidates, Bucket::Downloads);
    log::info!(
        "storage: unfinished downloads cleared, {} bytes freed, {} removed, {} kept",
        outcome.freed,
        outcome.removed,
        outcome.kept
    );
    Ok(outcome)
}

/// `kind`: `captures` | `recordings` | `meeting-audio`; `ids` from `storage_usage`.
#[tauri::command(async)]
pub fn storage_delete(app: AppHandle, kind: String, ids: Vec<String>) -> Result<DeleteOutcome, String> {
    let root = app_data(&app)?;
    let guards = Guards::live(&app);
    let ids: Vec<String> = ids.into_iter().filter(|id| capture_tool::is_plain_name(id)).collect();
    let outcome = match kind.as_str() {
        "captures" => {
            let wanted: HashSet<String> = ids.iter().cloned().collect();
            let removal = capture_tool::remove_from_library(&root.join("capture"), &wanted)?;
            if !removal.removed.is_empty() {
                // The library refreshes on this; `removed` keeps automations' "capture saved" quiet.
                let _ = app.emit_to(
                    "main",
                    "capture-saved",
                    json!({ "id": removal.removed[0], "removed": true, "ids": removal.removed }),
                );
            }
            DeleteOutcome { removed: removal.removed, freed: removal.freed, failed: removal.failed, skipped: Vec::new() }
        }
        "recordings" => delete_recordings(&root, &ids, &guards),
        "meeting-audio" => delete_meeting_audio(&root, &ids, &guards),
        other => return Err(format!("nothing to delete called '{other}'")),
    };
    log::info!(
        "storage: {kind}: {} removed ({} bytes), {} failed, {} in use",
        outcome.removed.len(),
        outcome.freed,
        outcome.failed.len(),
        outcome.skipped.len()
    );
    Ok(outcome)
}

/* ------------------------------------------------------------------ */
/* Tests                                                                */
/* ------------------------------------------------------------------ */

#[cfg(test)]
mod tests {
    use super::*;

    struct Tree(PathBuf);

    impl Tree {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("owntools-storage-{name}-{}", rand::random::<u32>()));
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn file(&self, rel: &str, bytes: usize) -> PathBuf {
            let path = self.0.join(rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, vec![7u8; bytes]).unwrap();
            path
        }

        fn dir(&self, rel: &str) -> PathBuf {
            let path = self.0.join(rel);
            fs::create_dir_all(&path).unwrap();
            path
        }
    }

    impl Drop for Tree {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// Files are created "now"; looking from `ahead` in the future makes them
    /// that old, so every age rule can be tested without touching file times.
    fn guards(ahead: Duration) -> Guards {
        Guards { now: SystemTime::now() + ahead, active_parts: Vec::new(), recording_dirs: Vec::new(), open_frame: None }
    }

    const HOUR: Duration = Duration::from_secs(60 * 60);

    fn names(found: &[Candidate], root: &Path, bucket: Bucket) -> Vec<String> {
        let mut out: Vec<String> = found
            .iter()
            .filter(|c| c.bucket == bucket)
            .map(|c| c.path.strip_prefix(root).unwrap_or(&c.path).to_string_lossy().replace('\\', "/"))
            .collect();
        out.sort();
        out
    }

    /// A tree with one of everything the sweep knows, plus the things it must not touch.
    fn app_tree() -> Tree {
        let t = Tree::new("sweep");
        t.file("capture/tmp/frame.png", 500);
        t.file("capture/abc.png", 100);
        t.file("capture/abc.ocr.png", 40);
        t.file("capture/index.json.part", 5);
        t.file("whisper/input-1-a.wav", 300);
        t.file("whisper/ggml-base.bin", 1000);
        t.file("whisper/whisper-bin-x64.zip", 70);
        t.file("whisper/ggml-large.bin.part", 900);
        t.file("parakeet/models/p/encoder.int8.onnx.part", 800);
        t.file("parakeet/bin/recognizer.log", 3);
        t.file("llm/runtime.zip", 60);
        t.file("tools/youtube/vid.m4a", 200);
        t.file("tools/youtube/other.m4a.part", 150);
        t.file("captions/segments/mic-1.wav", 30);
        t.file("meet/saved/meeting.json", 10);
        t.file("meet/saved/audio.wav", 2000);
        t.file("meet/saved/segments/mic-0.wav", 90);
        t.file("meet/crashed/audio.wav", 1500);
        t.file("meet/crashed/segments/system-0.wav", 50);
        t.file("automations/tmp/1-watched.pdf", 25);
        t.file("social/posts/p1.json", 20);
        t.file("social/posts/p1.json.a1b2c3.tmp", 20);
        t.file("social/media/m_1.tmp", 400);
        t.file("board/boards/b1/scene.json", 30);
        t.file("board/boards/.b2.sync-tmp-42/scene.json", 30);
        t.file("board/index.json.sync-tmp", 8);
        t.file("recordings/projects/r1/project.json", 10);
        t.file("recordings/projects/r1/bg_x_photo.tmp", 90);
        t.file("recordings/projects/r1/screen.webm", 4000);
        t.file("recordings/projects/take/screen.webm", 3000);
        t.file("focus.json", 16);
        t
    }

    #[test]
    fn young_files_are_left_to_the_jobs_that_wrote_them() {
        let t = app_tree();
        let temp = t.dir("systemp");
        let found = sweep(&t.0, &temp, &guards(Duration::ZERO));
        // Only what has no age rule: finished meetings' segments and paused downloads.
        assert_eq!(names(&found, &t.0, Bucket::Cache), vec!["meet/saved/segments"]);
        assert_eq!(
            names(&found, &t.0, Bucket::Downloads),
            vec!["parakeet/models/p/encoder.int8.onnx.part", "tools/youtube/other.m4a.part", "whisper/ggml-large.bin.part"]
        );
    }

    #[test]
    fn an_hour_later_the_leftovers_go_but_not_what_people_made() {
        let t = app_tree();
        let temp = t.dir("systemp");
        fs::write(temp.join("owntools-whisper-9-1.json"), b"{}").unwrap();
        fs::write(temp.join("unrelated.json"), b"{}").unwrap();
        let found = sweep(&t.0, &temp, &guards(HOUR + Duration::from_secs(1)));
        let cache = names(&found, &t.0, Bucket::Cache);
        assert_eq!(
            cache,
            vec![
                "board/boards/.b2.sync-tmp-42",
                "board/index.json.sync-tmp",
                "captions/segments/mic-1.wav",
                "capture/abc.ocr.png",
                "capture/index.json.part",
                "capture/tmp/frame.png",
                "meet/saved/segments",
                "social/posts/p1.json.a1b2c3.tmp",
                "systemp/owntools-whisper-9-1.json",
                "tools/youtube/vid.m4a",
                "whisper/input-1-a.wav",
            ]
        );
        // A day-old rule (automations' copies) is not due yet.
        assert!(!cache.iter().any(|n| n.starts_with("automations")));
        let downloads = names(&found, &t.0, Bucket::Downloads);
        assert!(downloads.contains(&"llm/runtime.zip".to_string()));
        assert!(downloads.contains(&"whisper/whisper-bin-x64.zip".to_string()));
        for c in &found {
            let rel = c.path.to_string_lossy().replace('\\', "/");
            assert!(!rel.contains("social/media"), "people's media is never a leftover: {rel}");
            assert!(!rel.contains("recordings/projects"), "project files are never leftovers: {rel}");
            assert!(!rel.ends_with("ggml-base.bin") && !rel.ends_with("abc.png"), "{rel}");
        }
        let after_a_day = sweep(&t.0, &temp, &guards(Duration::from_secs(25 * 60 * 60)));
        assert!(names(&after_a_day, &t.0, Bucket::Cache).contains(&"automations/tmp/1-watched.pdf".to_string()));
    }

    #[test]
    fn what_is_running_is_never_swept() {
        let t = app_tree();
        let temp = t.dir("systemp");
        let mut g = guards(Duration::from_secs(2 * 24 * 60 * 60));
        g.open_frame = Some(t.0.join("capture/tmp/frame.png"));
        g.active_parts = vec![t.0.join("whisper/ggml-large.bin.part")];
        g.recording_dirs = vec![t.0.join("captions"), t.0.join("meet").join("saved")];
        let found = sweep(&t.0, &temp, &g);
        let all: Vec<String> = names(&found, &t.0, Bucket::Cache).into_iter().chain(names(&found, &t.0, Bucket::Downloads)).collect();
        for busy in ["capture/tmp/frame.png", "whisper/ggml-large.bin.part", "captions/segments/mic-1.wav", "meet/saved/segments"] {
            assert!(!all.contains(&busy.to_string()), "{busy} is in use: {all:?}");
        }
        assert!(all.contains(&"parakeet/models/p/encoder.int8.onnx.part".to_string()));
    }

    #[test]
    fn usage_adds_up_and_moves_the_cache_out_of_its_tools() {
        let t = app_tree();
        let temp = t.dir("systemp");
        let local = Tree::new("local");
        local.file("logs/owntools.log", 64);
        let usage = measure(&t.0, Some(local.0.as_path()), &temp, &guards(HOUR + Duration::from_secs(1)));
        let g = &usage.groups;
        let sum = g.captures + g.recordings + g.meetings + g.speech + g.language + g.boards + g.social + g.cache + g.downloads + g.other;
        assert_eq!(usage.total, sum);
        // Every byte of both folders is in exactly one group: nothing lost, nothing counted twice.
        let (on_disk, _) = size_of(&t.0);
        assert_eq!(usage.total, on_disk + 64);
        // capture: the library PNG stays, the frame / OCR copy / index part are cache.
        assert_eq!(g.captures, 100);
        assert_eq!(g.recordings, 10 + 90 + 4000 + 3000);
        // meet: segments of the saved meeting are cache, the crashed meeting's are not.
        assert_eq!(g.meetings, 10 + 2000 + 1500 + 50);
        assert_eq!(g.speech, 1000 + 3, "models and the recognizer log, not the scratch, the zip or the parts");
        assert_eq!(usage.cache.downloads, 70 + 900 + 800 + 60 + 150);
        assert!(g.other >= 16 + 64);
    }

    #[test]
    fn items_list_what_people_made_and_what_their_tools_lost() {
        let t = app_tree();
        let g = guards(HOUR + Duration::from_secs(1));
        let capture = t.0.join("capture");
        capture_tool::write_index(
            &capture,
            &capture_tool::CaptureIndex {
                version: 1,
                items: vec![capture_tool::CaptureItem {
                    id: "abc".into(),
                    path: capture.join("abc.png").to_string_lossy().into_owned(),
                    width: 1,
                    height: 1,
                    created_at: 42,
                    ocr_text: None,
                    title: None,
                }],
            },
        )
        .unwrap();
        t.file("capture/lost.png", 70);
        let usage = measure(&t.0, None, &t.dir("systemp"), &g);
        let captures: Vec<(&str, u64, bool)> = usage.captures.iter().map(|i| (i.id.as_str(), i.bytes, i.unlisted)).collect();
        assert_eq!(captures, vec![("lost", 70, true), ("abc", 100, false)]);
        // The take without project.json is only a day later a thing to offer.
        let recordings: Vec<&str> = usage.recordings.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(recordings, vec!["r1"]);
        let later = measure(&t.0, None, &t.dir("systemp"), &guards(Duration::from_secs(25 * 60 * 60)));
        let take = later.recordings.iter().find(|i| i.id == "take").expect("an old take is offered");
        assert!(take.unlisted);
        let meetings: Vec<(&str, u64, bool)> = usage.meetings.iter().map(|i| (i.id.as_str(), i.bytes, i.unlisted)).collect();
        assert!(meetings.contains(&("saved", 2000, false)));
        assert!(meetings.contains(&("crashed", 1550, true)));
    }

    #[test]
    fn clearing_the_cache_takes_exactly_the_list() {
        let t = app_tree();
        let temp = t.dir("systemp");
        let g = guards(HOUR + Duration::from_secs(1));
        let found = sweep(&t.0, &temp, &g);
        let expected: u64 = found.iter().filter(|c| c.bucket == Bucket::Cache).map(|c| c.bytes).sum();
        let outcome = clear_bucket(&found, Bucket::Cache);
        assert_eq!(outcome.freed, expected);
        assert_eq!(outcome.kept, 0);
        assert!(!t.0.join("capture/tmp/frame.png").exists());
        assert!(!t.0.join("meet/saved/segments").exists());
        assert!(t.0.join("meet/saved/audio.wav").exists());
        assert!(t.0.join("whisper/ggml-large.bin.part").exists(), "downloads are their own button");
        let again = sweep(&t.0, &temp, &g);
        assert!(names(&again, &t.0, Bucket::Cache).is_empty());
    }

    #[test]
    fn deleting_recordings_updates_the_index_and_spares_a_take_in_progress() {
        let t = app_tree();
        t.file("recordings/projects/r2/project.json", 10);
        fs::write(
            t.0.join("recordings/index.json"),
            r#"[{"id":"r1","name":"One","createdAt":1,"duration":2,"dir":"recordings/projects/r1"},{"id":"r2","name":"Two","createdAt":3,"duration":4}]"#,
        )
        .unwrap();
        let ids = vec!["r1".to_string(), "take".to_string(), "missing".to_string()];
        let out = delete_recordings(&t.0, &ids, &guards(HOUR));
        assert_eq!(out.removed, vec!["r1", "missing"]);
        assert_eq!(out.skipped, vec!["take"]);
        assert_eq!(out.freed, 10 + 90 + 4000);
        assert!(!t.0.join("recordings/projects/r1").exists());
        assert!(t.0.join("recordings/projects/take/screen.webm").exists());
        let index: Vec<serde_json::Value> = serde_json::from_str(&fs::read_to_string(t.0.join("recordings/index.json")).unwrap()).unwrap();
        assert_eq!(index.len(), 1);
        assert_eq!(index[0]["id"], "r2");
        assert_eq!(index[0]["name"], "Two");
    }

    /// What owntools on this machine would show and clear — read only, nothing is deleted:
    /// `cargo test --lib real_app_data_dry_run -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_app_data_dry_run() {
        let root = dirs::data_dir().expect("data dir").join("app.owntools.desktop");
        let local = dirs::data_local_dir().map(|d| d.join("app.owntools.desktop"));
        let g = Guards { now: SystemTime::now(), active_parts: Vec::new(), recording_dirs: Vec::new(), open_frame: None };
        let temp = std::env::temp_dir();
        let started = std::time::Instant::now();
        let usage = measure(&root, local.as_deref(), &temp, &g);
        println!("measured {} in {} ms", root.display(), started.elapsed().as_millis());
        println!("total {} bytes", usage.total);
        println!("groups {}", serde_json::to_string_pretty(&usage.groups).unwrap());
        println!("cache {}", serde_json::to_string(&usage.cache).unwrap());
        println!(
            "items: {} captures, {} recordings, {} meetings with audio",
            usage.captures.len(),
            usage.recordings.len(),
            usage.meetings.len()
        );
        for c in sweep(&root, &temp, &g) {
            println!("  {:?} {:>12} {}", c.bucket, c.bytes, c.path.display());
        }
    }

    #[test]
    fn deleting_meeting_audio_keeps_the_words() {
        let t = app_tree();
        t.file("meet/saved/transcript.md", 12);
        t.file("meet/live/audio.wav", 999);
        let mut g = guards(HOUR);
        g.recording_dirs = vec![t.0.join("meet").join("live")];
        let ids = vec!["saved".to_string(), "crashed".to_string(), "live".to_string()];
        let out = delete_meeting_audio(&t.0, &ids, &g);
        assert_eq!(out.removed, vec!["saved", "crashed"]);
        assert_eq!(out.skipped, vec!["live"]);
        assert_eq!(out.freed, 2000 + 90 + 1500 + 50);
        assert!(t.0.join("meet/saved/meeting.json").exists());
        assert!(t.0.join("meet/saved/transcript.md").exists());
        assert!(!t.0.join("meet/saved/audio.wav").exists());
        assert!(!t.0.join("meet/saved/segments").exists());
        assert!(!t.0.join("meet/crashed").exists());
        assert!(t.0.join("meet/live/audio.wav").exists());
    }
}
