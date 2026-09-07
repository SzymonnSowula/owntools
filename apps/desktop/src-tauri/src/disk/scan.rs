//! The scanner: worker threads list directories, one builder thread turns
//! the listings into the arena. Workers never touch the arena, the builder
//! never touches the disk, and both stop the moment `cancel` is raised.
//!
//! Windows: `DirEntry::metadata()` comes straight out of the find data (no
//! extra syscall per file), so a listing costs one `FindFirstFileEx` walk.
//! The on-disk size is the logical size rounded up to the cluster, except
//! for compressed, sparse and cloud-placeholder files, where the OS is asked
//! (`GetCompressedFileSize`) — that is the difference between "logical" and
//! "on disk" in the inspector. Reparse points that are name surrogates
//! (symlinks, junctions) are recorded and not followed, so `C:\Users\All
//! Users` and friends do not get counted twice or loop.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use super::arena::{Arena, DirExtra, Node, F_DIR, F_ERROR, F_HIDDEN, F_LINK, F_PACKED, F_SYSTEM, NONE};
use super::category::category_of_name;

#[derive(Debug, Clone, Default)]
pub struct Progress {
    pub files: u64,
    pub dirs: u64,
    pub bytes: u64,
    pub current: String,
    pub elapsed_ms: u64,
}

#[derive(Debug)]
pub enum ScanError {
    Cancelled,
    Root(String),
}

impl std::fmt::Display for ScanError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ScanError::Cancelled => write!(f, "cancelled"),
            ScanError::Root(e) => write!(f, "{e}"),
        }
    }
}

struct Job {
    id: u32,
    path: PathBuf,
}

struct Entry {
    name: Box<str>,
    is_dir: bool,
    size: u64,
    alloc: u64,
    mtime: i64,
    ctime: i64,
    flags: u8,
    cat: u8,
}

struct Listing {
    id: u32,
    path: PathBuf,
    entries: Vec<Entry>,
    error: bool,
}

/// FILETIME (100 ns since 1601) → unix seconds.
#[cfg(windows)]
fn filetime_secs(ft: u64) -> i64 {
    if ft == 0 {
        return i64::MIN;
    }
    (ft / 10_000_000) as i64 - 11_644_473_600
}

fn system_time_secs(t: std::io::Result<SystemTime>) -> i64 {
    match t {
        Ok(t) => match t.duration_since(UNIX_EPOCH) {
            Ok(d) => d.as_secs() as i64,
            Err(e) => -(e.duration().as_secs() as i64),
        },
        Err(_) => i64::MIN,
    }
}

fn round_up(size: u64, cluster: u64) -> u64 {
    if cluster == 0 {
        return size;
    }
    size.div_ceil(cluster) * cluster
}

#[cfg(windows)]
fn packed_size(path: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{GetCompressedFileSizeW, INVALID_FILE_SIZE};
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut high: u32 = 0;
    let low = unsafe { GetCompressedFileSizeW(PCWSTR(wide.as_ptr()), Some(&mut high)) };
    if low == INVALID_FILE_SIZE && high == 0 {
        // Either a real error or a size that happens to be 0xFFFFFFFF; the
        // error case is the common one, so treat it as unknown.
        return None;
    }
    Some(((high as u64) << 32) | low as u64)
}

#[cfg(windows)]
fn read_entry(entry: &std::fs::DirEntry, cluster: u64) -> Option<Entry> {
    use std::os::windows::fs::MetadataExt;
    use windows::Win32::Storage::FileSystem::{
        FILE_ATTRIBUTE_COMPRESSED, FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_OFFLINE,
        FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS, FILE_ATTRIBUTE_REPARSE_POINT, FILE_ATTRIBUTE_SPARSE_FILE,
        FILE_ATTRIBUTE_SYSTEM,
    };
    let name = entry.file_name();
    let name: Box<str> = name.to_string_lossy().into_owned().into_boxed_str();
    let ft = entry.file_type().ok()?;
    let meta = entry.metadata().ok()?;
    let attrs = meta.file_attributes();
    let mut flags = 0u8;
    if attrs & FILE_ATTRIBUTE_HIDDEN.0 != 0 {
        flags |= F_HIDDEN;
    }
    if attrs & FILE_ATTRIBUTE_SYSTEM.0 != 0 {
        flags |= F_SYSTEM;
    }
    let mtime = filetime_secs(meta.last_write_time());
    let ctime = filetime_secs(meta.creation_time());
    if ft.is_symlink() {
        return Some(Entry { name, is_dir: false, size: 0, alloc: 0, mtime, ctime, flags: flags | F_LINK, cat: 0 });
    }
    if ft.is_dir() {
        return Some(Entry { name, is_dir: true, size: 0, alloc: 0, mtime, ctime, flags: flags | F_DIR, cat: 0 });
    }
    let size = meta.file_size();
    let packed = attrs
        & (FILE_ATTRIBUTE_COMPRESSED.0
            | FILE_ATTRIBUTE_SPARSE_FILE.0
            | FILE_ATTRIBUTE_REPARSE_POINT.0
            | FILE_ATTRIBUTE_OFFLINE.0
            | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS.0)
        != 0;
    let alloc = if packed {
        flags |= F_PACKED;
        match packed_size(&entry.path()) {
            Some(s) => round_up(s, cluster),
            None => round_up(size, cluster),
        }
    } else {
        round_up(size, cluster)
    };
    let cat = category_of_name(&name);
    Some(Entry { name, is_dir: false, size, alloc, mtime, ctime, flags, cat })
}

#[cfg(not(windows))]
fn read_entry(entry: &std::fs::DirEntry, cluster: u64) -> Option<Entry> {
    use std::os::unix::fs::MetadataExt;
    let name = entry.file_name();
    let name: Box<str> = name.to_string_lossy().into_owned().into_boxed_str();
    let ft = entry.file_type().ok()?;
    let meta = entry.metadata().ok()?;
    let mut flags = 0u8;
    if name.starts_with('.') {
        flags |= F_HIDDEN;
    }
    let mtime = meta.mtime();
    let ctime = system_time_secs(meta.created());
    if ft.is_symlink() {
        return Some(Entry { name, is_dir: false, size: 0, alloc: 0, mtime, ctime, flags: flags | F_LINK, cat: 0 });
    }
    if ft.is_dir() {
        return Some(Entry { name, is_dir: true, size: 0, alloc: 0, mtime, ctime, flags: flags | F_DIR, cat: 0 });
    }
    let size = meta.len();
    let alloc = meta.blocks() * 512;
    let alloc = if alloc == 0 && size > 0 { round_up(size, cluster) } else { alloc };
    if alloc < size {
        flags |= F_PACKED;
    }
    let cat = category_of_name(&name);
    Some(Entry { name, is_dir: false, size, alloc, mtime, ctime, flags, cat })
}

fn list_dir(job: Job, cluster: u64, cancel: &AtomicBool) -> Listing {
    let mut entries = Vec::new();
    let mut error = false;
    match std::fs::read_dir(&job.path) {
        Ok(iter) => {
            for (i, entry) in iter.enumerate() {
                if i & 1023 == 1023 && cancel.load(Ordering::Relaxed) {
                    break;
                }
                let Ok(entry) = entry else {
                    error = true;
                    continue;
                };
                if let Some(e) = read_entry(&entry, cluster) {
                    entries.push(e);
                }
            }
        }
        Err(_) => error = true,
    }
    Listing { id: job.id, path: job.path, entries, error }
}

fn worker(jobs: Arc<Mutex<Receiver<Job>>>, out: Sender<Listing>, cluster: u64, cancel: Arc<AtomicBool>) {
    loop {
        let job = {
            let guard = match jobs.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            match guard.recv() {
                Ok(job) => job,
                Err(_) => return,
            }
        };
        if cancel.load(Ordering::Relaxed) {
            // Keep draining so the builder's pending count reaches zero.
            let _ = out.send(Listing { id: job.id, path: job.path, entries: Vec::new(), error: false });
            continue;
        }
        let listing = list_dir(job, cluster, &cancel);
        if out.send(listing).is_err() {
            return;
        }
    }
}

/// Normalises a root: a bare drive letter gets its separator, trailing
/// separators are dropped (except on a drive root), and the path must exist
/// and be a directory.
pub fn normalize_root(raw: &str) -> Result<PathBuf, ScanError> {
    let mut s = raw.trim().to_string();
    if s.is_empty() {
        return Err(ScanError::Root("no folder given".into()));
    }
    #[cfg(windows)]
    {
        if s.len() == 2 && s.ends_with(':') {
            s.push('\\');
        }
        let trimmed = s.trim_end_matches(['\\', '/']);
        if trimmed.len() == 2 && trimmed.ends_with(':') {
            s = format!("{trimmed}\\");
        } else if !trimmed.is_empty() {
            s = trimmed.to_string();
        }
    }
    #[cfg(not(windows))]
    {
        let trimmed = s.trim_end_matches('/');
        s = if trimmed.is_empty() { "/".into() } else { trimmed.to_string() };
    }
    let path = PathBuf::from(&s);
    match std::fs::metadata(&path) {
        Ok(m) if m.is_dir() => Ok(path),
        Ok(_) => Err(ScanError::Root(format!("{s} is not a folder"))),
        Err(e) => Err(ScanError::Root(format!("{s}: {e}"))),
    }
}

pub struct ScanOptions {
    pub threads: usize,
    pub cluster: u64,
    pub progress_every: Duration,
}

impl Default for ScanOptions {
    fn default() -> Self {
        let cpus = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
        ScanOptions { threads: cpus.clamp(4, 16), cluster: 4096, progress_every: Duration::from_millis(100) }
    }
}

/// Scans `root` into a fresh arena. `progress` is called from this thread
/// every `progress_every`; `cancel` makes it return `ScanError::Cancelled`.
pub fn scan(
    root: &Path,
    opts: ScanOptions,
    cancel: Arc<AtomicBool>,
    mut progress: impl FnMut(&Progress),
) -> Result<Arena, ScanError> {
    let started = Instant::now();
    let root_meta = std::fs::metadata(root).map_err(|e| ScanError::Root(e.to_string()))?;
    let root_str = root.to_string_lossy().into_owned();
    let mut arena = Arena::new(root_str);
    arena.cluster = opts.cluster;
    arena.nodes.push(Node {
        name: arena.root.clone().into_boxed_str(),
        parent: NONE,
        first_child: 0,
        child_count: 0,
        size: 0,
        alloc: 0,
        mtime: system_time_secs(root_meta.modified()),
        ctime: system_time_secs(root_meta.created()),
        files: 0,
        dirs: 0,
        slot: 0,
        flags: F_DIR,
        cat: 0,
    });
    arena.extra.push(DirExtra::default());

    let (job_tx, job_rx) = channel::<Job>();
    let (out_tx, out_rx) = channel::<Listing>();
    let job_rx = Arc::new(Mutex::new(job_rx));
    let mut handles = Vec::with_capacity(opts.threads);
    for _ in 0..opts.threads {
        let rx = Arc::clone(&job_rx);
        let tx = out_tx.clone();
        let cancel = Arc::clone(&cancel);
        let cluster = opts.cluster;
        handles.push(std::thread::spawn(move || worker(rx, tx, cluster, cancel)));
    }
    drop(out_tx);

    let mut pending = 0usize;
    let _ = job_tx.send(Job { id: 0, path: root.to_path_buf() });
    pending += 1;

    let mut prog = Progress::default();
    let mut last_report = Instant::now();
    let mut cancelled = false;

    while pending > 0 {
        let listing = match out_rx.recv() {
            Ok(l) => l,
            Err(_) => break,
        };
        pending -= 1;
        if cancel.load(Ordering::Relaxed) {
            cancelled = true;
            // Let the workers drain whatever is queued; nothing new goes in.
            if pending == 0 {
                break;
            }
            continue;
        }
        let start = arena.nodes.len() as u32;
        let parent = listing.id;
        if listing.error {
            arena.nodes[parent as usize].flags |= F_ERROR;
            arena.errors += 1;
        }
        for e in listing.entries {
            let id = arena.nodes.len() as u32;
            let slot = if e.is_dir {
                arena.extra.push(DirExtra::default());
                (arena.extra.len() - 1) as u32
            } else {
                NONE
            };
            if e.is_dir {
                prog.dirs += 1;
            } else {
                prog.files += 1;
                prog.bytes += e.size;
            }
            arena.nodes.push(Node {
                name: e.name,
                parent,
                first_child: 0,
                child_count: 0,
                size: e.size,
                alloc: e.alloc,
                mtime: e.mtime,
                ctime: e.ctime,
                files: 0,
                dirs: 0,
                slot,
                flags: e.flags,
                cat: e.cat,
            });
            if e.is_dir {
                let path = listing.path.join(&*arena.nodes[id as usize].name);
                if job_tx.send(Job { id, path }).is_ok() {
                    pending += 1;
                }
            }
        }
        let count = arena.nodes.len() as u32 - start;
        arena.nodes[parent as usize].first_child = start;
        arena.nodes[parent as usize].child_count = count;

        if last_report.elapsed() >= opts.progress_every {
            prog.current = listing.path.to_string_lossy().into_owned();
            prog.elapsed_ms = started.elapsed().as_millis() as u64;
            progress(&prog);
            last_report = Instant::now();
        }
    }
    drop(job_tx);
    for h in handles {
        let _ = h.join();
    }
    if cancelled {
        return Err(ScanError::Cancelled);
    }
    arena.aggregate();
    arena.scanned_at = system_time_secs(Ok(SystemTime::now()));
    arena.elapsed_ms = started.elapsed().as_millis() as u64;
    prog.current.clear();
    prog.elapsed_ms = arena.elapsed_ms;
    progress(&prog);
    Ok(arena)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_tree(tag: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!("shipshape-disk-test-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("a/deep/er")).unwrap();
        fs::create_dir_all(base.join("b")).unwrap();
        fs::write(base.join("a/one.txt"), vec![1u8; 1000]).unwrap();
        fs::write(base.join("a/deep/two.mp4"), vec![2u8; 5000]).unwrap();
        fs::write(base.join("a/deep/er/three.pdf"), vec![3u8; 300]).unwrap();
        fs::write(base.join("b/four.zip"), vec![4u8; 42]).unwrap();
        fs::write(base.join("five.rs"), b"fn main() {}").unwrap();
        base
    }

    #[test]
    fn scans_a_temp_tree() {
        let base = temp_tree("scan");
        let cancel = Arc::new(AtomicBool::new(false));
        let mut reports = 0;
        let arena = scan(&base, ScanOptions { threads: 3, ..Default::default() }, cancel, |_| reports += 1).unwrap();
        assert!(reports >= 1);
        let root = &arena.nodes[0];
        assert_eq!(root.files, 5);
        assert_eq!(root.dirs, 4);
        assert_eq!(root.size, 1000 + 5000 + 300 + 42 + 12);
        assert!(root.alloc >= root.size);
        let a = arena.find_path(&base.join("a").to_string_lossy()).unwrap();
        assert_eq!(arena.nodes[a as usize].files, 3);
        assert_eq!(arena.nodes[a as usize].dirs, 2);
        let three = arena.find_path(&base.join("a/deep/er/three.pdf").to_string_lossy()).unwrap();
        assert_eq!(arena.nodes[three as usize].size, 300);
        assert_eq!(arena.path_of(three), base.join("a").join("deep").join("er").join("three.pdf").to_string_lossy());
        assert_eq!(arena.errors, 0);
        // Every child has a larger index than its parent.
        for (i, n) in arena.nodes.iter().enumerate().skip(1) {
            assert!((n.parent as usize) < i);
        }
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn cancel_returns_cancelled() {
        let base = temp_tree("cancel");
        let cancel = Arc::new(AtomicBool::new(true));
        let result = scan(&base, ScanOptions::default(), cancel, |_| {});
        assert!(matches!(result, Err(ScanError::Cancelled)));
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn normalizes_roots() {
        let base = temp_tree("norm");
        let with_sep = format!("{}{}", base.to_string_lossy(), std::path::MAIN_SEPARATOR);
        assert_eq!(normalize_root(&with_sep).unwrap(), base);
        assert!(normalize_root("").is_err());
        assert!(normalize_root(&base.join("five.rs").to_string_lossy()).is_err());
        let _ = fs::remove_dir_all(&base);
    }
}
