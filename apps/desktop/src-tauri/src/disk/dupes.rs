//! Duplicate files. Three passes, each one cheaper than reading everything:
//! group by size (free — it is in the arena), hash the first 64 KB of the
//! files that share a size, then hash the whole of the files that still
//! match. SHA-256 through the `sha2` crate the downloader already uses;
//! hashing is spread over a few threads while this thread reports progress.
//!
//! Only a person's own files take part — `protect.rs` says what is left out
//! and why — and a file is only read while it is still the file the scan saw:
//! same size, same modification time, one name (a hard link is one file under
//! two names, not two copies) and really on this device (an online-only cloud
//! file would be downloaded just to be compared).
//!
//! Removing is its own step, and it trusts nothing from the search:
//! `removal_plan` + `verify_plan` read every ticked copy again, and a copy
//! that stays, right before anything moves. A copy leaves only when it is
//! still byte-for-byte what a surviving copy is; a group whose surviving
//! copies are gone or changed loses nothing; the last copy never goes.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use super::arena::{Arena, NodeInfo, F_CLOUD};
use super::protect::{Guard, LeftOut};

const PREFIX: usize = 64 * 1024;
const MAX_GROUPS: usize = 600;
const MAX_PER_GROUP: usize = 60;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DupeGroup {
    pub hash: String,
    pub size: u64,
    /// Oldest first, at most `MAX_PER_GROUP` of them.
    pub files: Vec<NodeInfo>,
    pub more: u32,
    /// Every copy (ids, oldest first) — `files` may be cut short, and a removal
    /// has to know about all the copies that stay.
    #[serde(skip)]
    pub members: Vec<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DupesProgress {
    /// collect · prefix · full · done
    pub phase: &'static str,
    pub done: u64,
    pub total: u64,
    pub bytes_done: u64,
    pub bytes_total: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DupesResult {
    pub root_id: u32,
    pub min_bytes: u64,
    /// Files over the limit that took part.
    pub scanned_files: u64,
    pub candidate_files: u64,
    pub group_count: u32,
    pub extra_copies: u32,
    pub wasted: u64,
    pub groups: Vec<DupeGroup>,
    /// Files over the limit that were not compared, by reason.
    pub left_out: LeftOut,
    pub cancelled: bool,
}

#[derive(Debug, Clone)]
pub struct Candidate {
    pub id: u32,
    pub size: u64,
    pub mtime: i64,
    pub path: PathBuf,
}

pub struct Collected {
    pub candidates: Vec<Candidate>,
    pub scanned_files: u64,
    pub left_out: LeftOut,
}

/// A person's files under `root` (≥ `min_bytes`) whose size at least one other
/// shares; everything the guard protects is counted into `left_out` instead.
pub fn collect_candidates(arena: &Arena, root: u32, min_bytes: u64, guard: &Guard) -> Collected {
    let min_bytes = min_bytes.max(1);
    let mut by_size: HashMap<u64, Vec<u32>> = HashMap::new();
    let mut scanned = 0u64;
    let mut left_out = LeftOut::default();
    // (id, why its folder is left out) — a protected folder is still walked,
    // so the page can say how many files it holds, but nothing in it is read.
    let mut stack: Vec<(u32, Option<super::protect::Why>)> = arena.children(root).map(|c| (c, guard.root)).collect();
    while let Some((id, inherited)) = stack.pop() {
        let node = &arena.nodes[id as usize];
        if node.removed() || node.is_link() {
            continue;
        }
        if node.is_dir() {
            let why = inherited.or_else(|| guard.folder(arena, id, node));
            stack.extend(arena.children(id).map(|c| (c, why)));
            continue;
        }
        if node.size < min_bytes {
            continue;
        }
        match inherited.or_else(|| guard.file(arena, node)) {
            Some(why) => left_out.add(why),
            None if node.flags & F_CLOUD != 0 => left_out.cloud += 1,
            None => {
                scanned += 1;
                by_size.entry(node.size).or_default().push(id);
            }
        }
    }
    let mut candidates = Vec::new();
    for (size, ids) in by_size {
        if ids.len() < 2 {
            continue;
        }
        for id in ids {
            let node = &arena.nodes[id as usize];
            candidates.push(Candidate { id, size, mtime: node.mtime, path: PathBuf::from(arena.path_of(id)) });
        }
    }
    Collected { candidates, scanned_files: scanned, left_out }
}

/// What reading one file found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Probe {
    Hash([u8; 32]),
    /// The file has more than one name: a hard link, not a copy.
    Linked,
    /// Online-only: reading it would download it.
    Cloud,
    /// Gone, unreadable, or no longer the size / modification time the scan saw.
    Changed,
}

struct Identity {
    size: u64,
    mtime: i64,
    links: u32,
    cloud: bool,
}

#[cfg(windows)]
fn identity(file: &std::fs::File) -> Option<Identity> {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_OFFLINE,
        FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS, FILE_ATTRIBUTE_RECALL_ON_OPEN,
    };
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    unsafe { GetFileInformationByHandle(HANDLE(file.as_raw_handle() as _), &mut info) }.ok()?;
    let written = ((info.ftLastWriteTime.dwHighDateTime as u64) << 32) | info.ftLastWriteTime.dwLowDateTime as u64;
    let offline = FILE_ATTRIBUTE_OFFLINE.0 | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS.0 | FILE_ATTRIBUTE_RECALL_ON_OPEN.0;
    Some(Identity {
        size: ((info.nFileSizeHigh as u64) << 32) | info.nFileSizeLow as u64,
        mtime: super::scan::filetime_secs(written),
        links: info.nNumberOfLinks,
        cloud: info.dwFileAttributes & offline != 0,
    })
}

#[cfg(not(windows))]
fn identity(file: &std::fs::File) -> Option<Identity> {
    use std::os::unix::fs::MetadataExt;
    let meta = file.metadata().ok()?;
    #[cfg(target_os = "macos")]
    let cloud = {
        use std::os::macos::fs::MetadataExt as _;
        meta.st_flags() & 0x4000_0000 != 0 // SF_DATALESS
    };
    #[cfg(not(target_os = "macos"))]
    let cloud = false;
    Some(Identity { size: meta.len(), mtime: meta.mtime(), links: meta.nlink() as u32, cloud })
}

/// Hashes the first `limit` bytes of `path` (all of it without a limit) — but
/// only while it is still the file the scan saw, with a single name, on this
/// device. Opening does not download a placeholder; reading would, so the
/// attributes are checked on the open handle before the first read.
pub fn probe_file(path: &Path, size: u64, mtime: i64, limit: Option<usize>) -> Probe {
    let Ok(mut file) = std::fs::File::open(path) else { return Probe::Changed };
    let Some(id) = identity(&file) else { return Probe::Changed };
    if id.cloud {
        return Probe::Cloud;
    }
    if id.links > 1 {
        return Probe::Linked;
    }
    if id.size != size || id.mtime != mtime {
        return Probe::Changed;
    }
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    let mut left = limit.unwrap_or(usize::MAX);
    let mut read = 0u64;
    while left > 0 {
        let want = buf.len().min(left);
        let n = match file.read(&mut buf[..want]) {
            Ok(n) => n,
            Err(_) => return Probe::Changed,
        };
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        left -= n;
        read += n as u64;
    }
    // A whole-file hash that did not read the whole file hashed something else.
    if limit.is_none() && read != size {
        return Probe::Changed;
    }
    Probe::Hash(hasher.finalize().into())
}

struct Job {
    path: PathBuf,
    size: u64,
    mtime: i64,
}

/// Probes `jobs` on `threads` workers, in order.
fn probe_all(
    jobs: &[Job],
    limit: Option<usize>,
    threads: usize,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(u64, u64),
) -> Vec<Probe> {
    let next = AtomicUsize::new(0);
    let done = AtomicU64::new(0);
    let bytes = AtomicU64::new(0);
    let results: Mutex<Vec<Probe>> = Mutex::new(vec![Probe::Changed; jobs.len()]);
    std::thread::scope(|scope| {
        for _ in 0..threads.max(1) {
            scope.spawn(|| {
                let mut local: Vec<(usize, Probe)> = Vec::new();
                loop {
                    if cancel.load(Ordering::Relaxed) {
                        break;
                    }
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    if i >= jobs.len() {
                        break;
                    }
                    let job = &jobs[i];
                    local.push((i, probe_file(&job.path, job.size, job.mtime, limit)));
                    done.fetch_add(1, Ordering::Relaxed);
                    bytes.fetch_add(limit.map(|l| (l as u64).min(job.size)).unwrap_or(job.size), Ordering::Relaxed);
                    if local.len() >= 64 {
                        if let Ok(mut r) = results.lock() {
                            for (i, p) in local.drain(..) {
                                r[i] = p;
                            }
                        }
                    }
                }
                if let Ok(mut r) = results.lock() {
                    for (i, p) in local.drain(..) {
                        r[i] = p;
                    }
                }
            });
        }
        // Progress from this thread while the workers run.
        loop {
            let d = done.load(Ordering::Relaxed);
            progress(d, bytes.load(Ordering::Relaxed));
            if d >= jobs.len() as u64 || cancel.load(Ordering::Relaxed) {
                break;
            }
            std::thread::sleep(Duration::from_millis(120));
        }
    });
    results.into_inner().unwrap_or_default()
}

pub struct Found {
    /// `(hash, size, ids oldest first)`, most wasted space first.
    pub groups: Vec<(String, u64, Vec<u32>)>,
    pub cancelled: bool,
    pub links: u64,
    pub cloud: u64,
    pub changed: u64,
}

/// Groups of identical files among the candidates.
pub fn find_duplicates(candidates: &[Candidate], threads: usize, cancel: &AtomicBool, mut progress: impl FnMut(&DupesProgress)) -> Found {
    let mut found = Found { groups: Vec::new(), cancelled: false, links: 0, cloud: 0, changed: 0 };
    let tally = |probe: Probe, found: &mut Found| match probe {
        Probe::Linked => found.links += 1,
        Probe::Cloud => found.cloud += 1,
        Probe::Changed => found.changed += 1,
        Probe::Hash(_) => {}
    };
    // Pass 1: first 64 KB.
    let jobs: Vec<Job> = candidates.iter().map(|c| Job { path: c.path.clone(), size: c.size, mtime: c.mtime }).collect();
    let bytes_total: u64 = jobs.iter().map(|j| j.size.min(PREFIX as u64)).sum();
    let total = jobs.len() as u64;
    let prefix = probe_all(&jobs, Some(PREFIX), threads, cancel, &mut |done, bytes| {
        progress(&DupesProgress { phase: "prefix", done, total, bytes_done: bytes, bytes_total })
    });
    if cancel.load(Ordering::Relaxed) {
        found.cancelled = true;
        return found;
    }
    let mut by_prefix: HashMap<(u64, [u8; 32]), Vec<usize>> = HashMap::new();
    for (i, probe) in prefix.iter().enumerate() {
        match probe {
            Probe::Hash(h) => by_prefix.entry((candidates[i].size, *h)).or_default().push(i),
            other => tally(*other, &mut found),
        }
    }
    // Pass 2: whole file for the survivors bigger than the prefix.
    let mut final_groups: HashMap<(u64, [u8; 32]), Vec<usize>> = HashMap::new();
    let mut full_idx: Vec<usize> = Vec::new();
    for ((size, h), idxs) in by_prefix {
        if idxs.len() < 2 {
            continue;
        }
        if size <= PREFIX as u64 {
            final_groups.insert((size, h), idxs);
        } else {
            full_idx.extend(idxs);
        }
    }
    if !full_idx.is_empty() {
        let full_jobs: Vec<Job> = full_idx.iter().map(|&i| Job { path: candidates[i].path.clone(), size: candidates[i].size, mtime: candidates[i].mtime }).collect();
        let bytes_total: u64 = full_jobs.iter().map(|j| j.size).sum();
        let total = full_jobs.len() as u64;
        let full = probe_all(&full_jobs, None, threads, cancel, &mut |done, bytes| {
            progress(&DupesProgress { phase: "full", done, total, bytes_done: bytes, bytes_total })
        });
        if cancel.load(Ordering::Relaxed) {
            found.cancelled = true;
            return found;
        }
        for (j, probe) in full.iter().enumerate() {
            let i = full_idx[j];
            match probe {
                Probe::Hash(h) => final_groups.entry((candidates[i].size, *h)).or_default().push(i),
                other => tally(*other, &mut found),
            }
        }
    }
    let mut groups: Vec<(String, u64, Vec<u32>)> = final_groups
        .into_iter()
        .filter(|(_, idxs)| idxs.len() >= 2)
        .map(|((size, h), mut idxs)| {
            idxs.sort_by_key(|&i| (candidates[i].mtime, candidates[i].id));
            (hex::encode(h), size, idxs.into_iter().map(|i| candidates[i].id).collect())
        })
        .collect();
    // Most wasted space first.
    groups.sort_by(|a, b| {
        let wa = a.1 * (a.2.len() as u64 - 1);
        let wb = b.1 * (b.2.len() as u64 - 1);
        wb.cmp(&wa).then_with(|| a.0.cmp(&b.0))
    });
    found.groups = groups;
    found
}

pub fn build_result(arena: &Arena, root_id: u32, min_bytes: u64, collected: &Collected, found: Found) -> DupesResult {
    let mut extra = 0u32;
    let mut wasted = 0u64;
    let group_count = found.groups.len() as u32;
    let mut out = Vec::with_capacity(found.groups.len().min(MAX_GROUPS));
    for (hash, size, ids) in found.groups {
        extra += ids.len() as u32 - 1;
        wasted += size * (ids.len() as u64 - 1);
        if out.len() >= MAX_GROUPS {
            continue;
        }
        let more = ids.len().saturating_sub(MAX_PER_GROUP) as u32;
        let files: Vec<NodeInfo> = ids.iter().take(MAX_PER_GROUP).filter_map(|&i| arena.info(i)).collect();
        out.push(DupeGroup { hash, size, files, more, members: ids });
    }
    let mut left_out = collected.left_out.clone();
    left_out.links += found.links;
    left_out.cloud += found.cloud;
    left_out.changed += found.changed;
    DupesResult {
        root_id,
        min_bytes,
        scanned_files: collected.scanned_files,
        candidate_files: collected.candidates.len() as u64,
        group_count,
        extra_copies: extra,
        wasted,
        groups: out,
        left_out,
        cancelled: found.cancelled,
    }
}

// ---- removing ---------------------------------------------------------------------

/// One copy as a removal needs it, lifted off the arena so the checks can run
/// without holding the arena lock.
#[derive(Debug, Clone)]
pub struct FileRef {
    pub id: u32,
    pub path: PathBuf,
    pub size: u64,
    pub mtime: i64,
}

#[derive(Debug)]
pub struct PlanGroup {
    hash: [u8; 32],
    /// Copies that stay, oldest first; one of them has to still match.
    keep: Vec<FileRef>,
    remove: Vec<FileRef>,
}

#[derive(Debug, Default)]
pub struct RemovalPlan {
    groups: Vec<PlanGroup>,
    /// `(id, path, why)` — refused before anything was read.
    pub refused: Vec<(u32, String, String)>,
}

/// Sorts the ticked ids into their groups, with every copy that stays.
pub fn removal_plan(arena: &Arena, result: &DupesResult, remove: &[u32]) -> RemovalPlan {
    let wanted: HashSet<u32> = remove.iter().copied().collect();
    let mut claimed: HashSet<u32> = HashSet::new();
    let mut plan = RemovalPlan::default();
    let file = |id: u32| {
        arena
            .get(id)
            .filter(|n| !n.removed() && !n.is_dir())
            .map(|n| FileRef { id, path: PathBuf::from(arena.path_of(id)), size: n.size, mtime: n.mtime })
    };
    let path_of = |id: u32| if arena.get(id).is_some() { arena.path_of(id) } else { String::new() };
    for g in &result.groups {
        let (ticked, stays): (Vec<u32>, Vec<u32>) = g.members.iter().partition(|id| wanted.contains(id));
        if ticked.is_empty() {
            continue;
        }
        claimed.extend(ticked.iter().copied());
        let hash: Option<[u8; 32]> = hex::decode(&g.hash).ok().and_then(|b| b.try_into().ok());
        let keep: Vec<FileRef> = stays.into_iter().filter_map(file).collect();
        let why = match (hash, keep.is_empty()) {
            (None, _) => Some("this group's fingerprint is unreadable — look for duplicates again"),
            (_, true) => Some("every copy of this file was ticked — one copy always stays"),
            _ => None,
        };
        if let Some(why) = why {
            plan.refused.extend(ticked.into_iter().map(|id| (id, path_of(id), why.to_string())));
            continue;
        }
        let mut gone = Vec::new();
        for id in ticked {
            match file(id) {
                Some(f) => gone.push(f),
                None => plan.refused.push((id, path_of(id), "already gone".into())),
            }
        }
        if !gone.is_empty() {
            plan.groups.push(PlanGroup { hash: hash.unwrap_or_default(), keep, remove: gone });
        }
    }
    for &id in remove {
        if !claimed.contains(&id) {
            plan.refused.push((id, path_of(id), "not on the duplicates list any more — look for duplicates again".into()));
        }
    }
    plan
}

pub struct Verified {
    /// Checked just now: identical to a copy that stays, which was checked too.
    pub ok: Vec<FileRef>,
    pub refused: Vec<(u32, String, String)>,
}

/// Reads every ticked copy and the copies that stay again. A ticked copy is
/// cleared when it still hashes to the group's fingerprint *and* a copy that
/// stays does too; the copies that stay are tried one after another until one
/// matches, so a single moved or edited original does not block the group.
pub fn verify_plan(plan: RemovalPlan, threads: usize, cancel: &AtomicBool, mut progress: impl FnMut(u64, u64)) -> Verified {
    let RemovalPlan { groups, mut refused } = plan;
    let mut keeper_ok = vec![false; groups.len()];
    let mut next_keeper = vec![0usize; groups.len()];
    let mut remove_ok: Vec<Vec<bool>> = groups.iter().map(|g| vec![false; g.remove.len()]).collect();
    let total = groups.iter().map(|g| g.remove.len() + 1).sum::<usize>() as u64;
    let mut done_before = 0u64;
    let mut first_round = true;
    loop {
        // (group, Some(ticked index) | None for a copy that stays)
        let mut slots: Vec<(usize, Option<usize>)> = Vec::new();
        let mut jobs: Vec<Job> = Vec::new();
        for (gi, g) in groups.iter().enumerate() {
            if first_round {
                for (ri, f) in g.remove.iter().enumerate() {
                    slots.push((gi, Some(ri)));
                    jobs.push(Job { path: f.path.clone(), size: f.size, mtime: f.mtime });
                }
            }
            if !keeper_ok[gi] && next_keeper[gi] < g.keep.len() {
                let f = &g.keep[next_keeper[gi]];
                next_keeper[gi] += 1;
                slots.push((gi, None));
                jobs.push(Job { path: f.path.clone(), size: f.size, mtime: f.mtime });
            }
        }
        if jobs.is_empty() {
            break;
        }
        let probes = probe_all(&jobs, None, threads, cancel, &mut |done, _| progress((done_before + done).min(total), total));
        done_before += jobs.len() as u64;
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        for ((gi, slot), probe) in slots.into_iter().zip(probes) {
            let same = probe == Probe::Hash(groups[gi].hash);
            match slot {
                Some(ri) => remove_ok[gi][ri] = same,
                None => keeper_ok[gi] |= same,
            }
        }
        first_round = false;
    }
    let stopped = cancel.load(Ordering::Relaxed);
    let mut ok = Vec::new();
    for (gi, g) in groups.into_iter().enumerate() {
        for (ri, f) in g.remove.into_iter().enumerate() {
            let why = if stopped {
                Some("stopped before this copy was checked")
            } else if !keeper_ok[gi] {
                Some("the copy that stays is gone or changed since the search — nothing in this group was touched")
            } else if !remove_ok[gi][ri] {
                Some("no longer identical to the copy that stays (changed, moved or gained a second name)")
            } else {
                None
            };
            match why {
                Some(why) => refused.push((f.id, f.path.to_string_lossy().into_owned(), why.to_string())),
                None => ok.push(f),
            }
        }
    }
    Verified { ok, refused }
}

/// Takes removed files out of a stored result — groups left with one copy go,
/// and the totals follow.
pub fn forget(result: &mut DupesResult, removed: &HashSet<u32>) {
    if removed.is_empty() {
        return;
    }
    for g in result.groups.iter_mut() {
        let before = g.members.len();
        g.members.retain(|id| !removed.contains(id));
        g.files.retain(|f| !removed.contains(&f.id));
        let after = g.members.len();
        if after == before {
            continue;
        }
        let fewer = (before.max(1) - 1) - (after.max(1) - 1);
        result.extra_copies = result.extra_copies.saturating_sub(fewer as u32);
        result.wasted = result.wasted.saturating_sub(g.size * fewer as u64);
        if after < 2 {
            result.group_count = result.group_count.saturating_sub(1);
        }
    }
    result.groups.retain(|g| g.members.len() >= 2);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::disk::protect::Why;
    use std::fs;

    fn scan(base: &Path) -> Arena {
        let cancel = std::sync::Arc::new(AtomicBool::new(false));
        crate::disk::scan::scan(base, crate::disk::scan::ScanOptions::default(), cancel, |_| {}).unwrap()
    }

    /// The rules inside the tree, with the root taken as a person's folder.
    /// The test trees live in the system temp folder, which is itself left
    /// out on purpose (`AppData\Local\Temp`, `/var/folders`, `/tmp`), so a
    /// guard built for them would rightly offer nothing at all.
    fn open_guard(arena: &Arena) -> Guard {
        let mut guard = Guard::with_places(arena, 0, &[], None);
        guard.root = None;
        guard
    }

    fn search(arena: &Arena, min: u64, guard: &Guard) -> DupesResult {
        let collected = collect_candidates(arena, 0, min, guard);
        let found = find_duplicates(&collected.candidates, 3, &AtomicBool::new(false), |_| {});
        build_result(arena, 0, min, &collected, found)
    }

    fn temp(tag: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!("owntools-dupes-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        base
    }

    #[test]
    fn finds_identical_files_and_skips_same_size_different_content() {
        let base = temp("basic");
        fs::create_dir_all(base.join("x")).unwrap();
        let big: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
        let mut other = big.clone();
        other[199_999] ^= 0xff; // same prefix, different tail
        fs::write(base.join("a.bin"), &big).unwrap();
        fs::write(base.join("x/b.bin"), &big).unwrap();
        fs::write(base.join("c.bin"), &other).unwrap();
        fs::write(base.join("small1.txt"), b"hello").unwrap();
        fs::write(base.join("x/small2.txt"), b"hello").unwrap();
        fs::write(base.join("x/small3.txt"), b"hallo").unwrap();
        let arena = scan(&base);
        let collected = collect_candidates(&arena, 0, 1, &open_guard(&arena));
        assert_eq!(collected.scanned_files, 6);
        assert_eq!(collected.candidates.len(), 6);
        let found = find_duplicates(&collected.candidates, 3, &AtomicBool::new(false), |_| {});
        assert!(!found.cancelled);
        assert_eq!(found.groups.len(), 2);
        assert_eq!(found.groups[0].1, 200_000);
        assert_eq!(found.groups[0].2.len(), 2);
        assert_eq!(found.groups[1].1, 5);
        assert_eq!(found.groups[1].2.len(), 2);
        let result = build_result(&arena, 0, 1, &collected, found);
        assert_eq!(result.extra_copies, 2);
        assert_eq!(result.wasted, 200_005);
        assert_eq!(result.left_out, LeftOut::default());
        let _ = fs::remove_dir_all(&base);
    }

    /// The same bytes everywhere; only the copies a person made are offered.
    #[test]
    fn leaves_out_apps_tools_projects_and_programs() {
        let base = temp("guard");
        let blob = vec![7u8; 70_000];
        for rel in [
            "Downloads/talk.mkv",
            "Videos/talk.mkv",
            "AppData/Local/Temp/abc/talk.mkv",
            "code/app/.git/HEAD",
            "code/app/assets/talk.mkv",
            "code/web/node_modules/pkg/talk.mkv",
            ".cargo/registry/talk.mkv",
            "venvs/ml/pyvenv.cfg",
            "venvs/ml/lib/talk.mkv",
            "Installer/Feedback/msalruntime_x86.dll",
            "Installer/runtimes/msalruntime_x86.dll",
            "Program Files/App/talk.mkv",
        ] {
            let path = base.join(rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            if rel.ends_with("HEAD") || rel.ends_with(".cfg") {
                fs::write(path, b"x").unwrap();
            } else {
                fs::write(path, &blob).unwrap();
            }
        }
        let arena = scan(&base);
        let result = search(&arena, 1000, &open_guard(&arena));
        assert_eq!(result.group_count, 1, "only Downloads + Videos form a group");
        let names: Vec<&str> = result.groups[0].files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(names.len(), 2, "{names:?}");
        assert!(names.iter().all(|p| p.contains("Downloads") || p.contains("Videos")), "{names:?}");
        let left = &result.left_out;
        assert_eq!(left.apps, 2, "AppData + Program Files: {left:?}");
        assert_eq!(left.tools, 3, "node_modules + .cargo + a virtualenv: {left:?}");
        assert_eq!(left.projects, 1, "a folder with .git: {left:?}");
        assert_eq!(left.programs, 2, "the two DLLs: {left:?}");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn a_search_inside_a_project_offers_nothing() {
        let base = temp("inside");
        fs::create_dir_all(base.join(".git")).unwrap();
        fs::write(base.join("a.bin"), vec![1u8; 5000]).unwrap();
        fs::write(base.join("b.bin"), vec![1u8; 5000]).unwrap();
        let arena = scan(&base);
        let guard = Guard::with_places(&arena, 0, &[], None);
        assert_eq!(guard.root, Some(Why::Projects));
        let result = search(&arena, 1, &guard);
        assert_eq!(result.group_count, 0);
        assert_eq!(result.left_out.projects, 2);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn hard_links_are_one_file_not_two_copies() {
        let base = temp("links");
        let blob = vec![3u8; 90_000];
        fs::write(base.join("one.bin"), &blob).unwrap();
        fs::hard_link(base.join("one.bin"), base.join("same-file.bin")).unwrap();
        fs::write(base.join("real-copy.bin"), &blob).unwrap();
        let arena = scan(&base);
        let result = search(&arena, 1, &open_guard(&arena));
        assert_eq!(result.group_count, 0, "one real copy is left, and it has no twin");
        assert_eq!(result.left_out.links, 2);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn a_file_changed_after_the_scan_is_not_compared() {
        let base = temp("changed");
        fs::write(base.join("a.bin"), vec![5u8; 4000]).unwrap();
        fs::write(base.join("b.bin"), vec![5u8; 4000]).unwrap();
        let arena = scan(&base);
        std::thread::sleep(Duration::from_millis(1100));
        fs::write(base.join("b.bin"), vec![6u8; 4000]).unwrap();
        let result = search(&arena, 1, &open_guard(&arena));
        assert_eq!(result.group_count, 0);
        assert_eq!(result.left_out.changed, 1);
        let _ = fs::remove_dir_all(&base);
    }

    fn ids_by_name(result: &DupesResult) -> HashMap<String, u32> {
        result.groups.iter().flat_map(|g| g.files.iter()).map(|f| (f.name.clone(), f.id)).collect()
    }

    #[test]
    fn removal_rechecks_every_copy_and_never_takes_the_last() {
        let base = temp("verify");
        let blob = vec![9u8; 150_000];
        for name in ["keep.bin", "copy1.bin", "copy2.bin", "copy3.bin"] {
            fs::write(base.join(name), &blob).unwrap();
        }
        let arena = scan(&base);
        let result = search(&arena, 1, &open_guard(&arena));
        assert_eq!(result.group_count, 1);
        let ids = ids_by_name(&result);
        let cancel = AtomicBool::new(false);

        // Every copy ticked: nothing is even read.
        let all: Vec<u32> = ids.values().copied().collect();
        let plan = removal_plan(&arena, &result, &all);
        assert_eq!(plan.refused.len(), 4);
        assert!(plan.refused[0].2.contains("one copy always stays"));
        assert_eq!(verify_plan(plan, 2, &cancel, |_, _| {}).ok.len(), 0);

        // A ticked copy edited since the search stays; the untouched one may go.
        // Same size, possibly the same second: the fingerprint is what catches it.
        let mut edited = blob.clone();
        edited[10] = 0;
        fs::write(base.join("copy1.bin"), &edited).unwrap();
        let plan = removal_plan(&arena, &result, &[ids["copy1.bin"], ids["copy2.bin"]]);
        let checked = verify_plan(plan, 2, &cancel, |_, _| {});
        assert_eq!(checked.ok.iter().map(|f| f.id).collect::<Vec<_>>(), vec![ids["copy2.bin"]]);
        assert_eq!(checked.refused.len(), 1);
        assert!(checked.refused[0].2.contains("no longer identical"));

        // The copies that stay are gone or changed: the group loses nothing.
        fs::remove_file(base.join("keep.bin")).unwrap();
        let plan = removal_plan(&arena, &result, &[ids["copy2.bin"], ids["copy3.bin"]]);
        let checked = verify_plan(plan, 2, &cancel, |_, _| {});
        assert!(checked.ok.is_empty(), "copy1 changed and keep.bin is gone, so nothing may leave: {:?}", checked.ok);
        assert!(checked.refused.iter().all(|r| r.2.contains("the copy that stays")));

        // Not from this search at all.
        let plan = removal_plan(&arena, &result, &[0]);
        assert!(plan.refused[0].2.contains("not on the duplicates list"));
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn a_second_copy_that_stays_is_enough() {
        let base = temp("keepers");
        let blob = vec![4u8; 80_000];
        for name in ["a.bin", "b.bin", "c.bin"] {
            fs::write(base.join(name), &blob).unwrap();
        }
        let arena = scan(&base);
        let result = search(&arena, 1, &open_guard(&arena));
        // The copies that stay are tried in order: the first is deleted behind
        // our back, the second still matches, so the ticked copy may go.
        let members = result.groups[0].members.clone();
        let (first_to_stay, ticked) = (members[0], members[2]);
        fs::remove_file(arena.path_of(first_to_stay)).unwrap();
        let plan = removal_plan(&arena, &result, &[ticked]);
        let checked = verify_plan(plan, 2, &AtomicBool::new(false), |_, _| {});
        assert_eq!(checked.ok.iter().map(|f| f.id).collect::<Vec<_>>(), vec![ticked], "refused: {:?}", checked.refused);
        let _ = fs::remove_dir_all(&base);
    }

    /// The real search on this machine, read-only (nothing is moved):
    /// `OWNTOOLS_DUPES_ROOT=C:\ cargo test --lib -- --ignored real_disk_dry_run --nocapture`.
    /// Prints what the page would offer and what it left out.
    #[test]
    #[ignore]
    fn real_disk_dry_run() {
        let root = std::env::var("OWNTOOLS_DUPES_ROOT").unwrap_or_else(|_| if cfg!(windows) { "C:\\".into() } else { "/".into() });
        let min: u64 = std::env::var("OWNTOOLS_DUPES_MIN").ok().and_then(|v| v.parse().ok()).unwrap_or(1024 * 1024);
        let started = std::time::Instant::now();
        let arena = scan(Path::new(&root));
        println!("scanned {root}: {} files in {:?}", arena.nodes[0].files, started.elapsed());
        let app_dirs: Vec<String> = crate::disk::apps::installed_apps().into_iter().filter_map(|a| a.location).collect();
        let guard = Guard::new(&arena, 0, &app_dirs);
        println!("registered install folders: {}; search root left out: {:?}", app_dirs.len(), guard.root);
        let collected = collect_candidates(&arena, 0, min, &guard);
        println!("compared: {} files, candidates sharing a size: {}", collected.scanned_files, collected.candidates.len());
        let found = find_duplicates(&collected.candidates, 8, &AtomicBool::new(false), |_| {});
        let result = build_result(&arena, 0, min, &collected, found);
        println!(
            "groups {} · extra copies {} · reclaimable {} · left out {:?} · took {:?}",
            result.group_count,
            result.extra_copies,
            crate::disk::bin::human(result.wasted),
            result.left_out,
            started.elapsed()
        );
        for g in result.groups.iter().take(25) {
            println!("\n{} × {} ({} each)", g.members.len(), g.files[0].name, crate::disk::bin::human(g.size));
            for f in g.files.iter().take(6) {
                println!("    {}", f.path);
            }
        }
    }

    #[test]
    fn forgetting_updates_the_totals() {
        let base = temp("forget");
        let blob = vec![2u8; 10_000];
        for name in ["a.bin", "b.bin", "c.bin"] {
            fs::write(base.join(name), &blob).unwrap();
        }
        let arena = scan(&base);
        let mut result = search(&arena, 1, &open_guard(&arena));
        assert_eq!((result.group_count, result.extra_copies, result.wasted), (1, 2, 20_000));
        let first = result.groups[0].members[1];
        forget(&mut result, &HashSet::from([first]));
        assert_eq!((result.group_count, result.extra_copies, result.wasted), (1, 1, 10_000));
        let second = result.groups[0].members[1];
        forget(&mut result, &HashSet::from([second]));
        assert_eq!((result.group_count, result.extra_copies, result.wasted, result.groups.len()), (0, 0, 0, 0));
        let _ = fs::remove_dir_all(&base);
    }
}
