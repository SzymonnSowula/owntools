//! Duplicate files. Three passes, each one cheaper than reading everything:
//! group by size (free — it is in the arena), hash the first 64 KB of the
//! files that share a size, then hash the whole of the files that still
//! match. SHA-256 through the `sha2` crate the downloader already uses;
//! hashing is spread over a few threads while this thread reports progress.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use super::arena::{Arena, NodeInfo};

const PREFIX: usize = 64 * 1024;
const MAX_GROUPS: usize = 600;
const MAX_PER_GROUP: usize = 60;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DupeGroup {
    pub hash: String,
    pub size: u64,
    /// Oldest first, so "keep the first" keeps the original.
    pub files: Vec<NodeInfo>,
    pub more: u32,
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
    pub scanned_files: u64,
    pub candidate_files: u64,
    pub group_count: u32,
    pub extra_copies: u32,
    pub wasted: u64,
    pub groups: Vec<DupeGroup>,
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
}

/// Files under `root` (≥ `min_bytes`) whose size at least one other file shares.
pub fn collect_candidates(arena: &Arena, root: u32, min_bytes: u64) -> Collected {
    let mut by_size: HashMap<u64, Vec<u32>> = HashMap::new();
    let mut scanned = 0u64;
    arena.walk(root, |id, node| {
        if node.is_dir() {
            return true;
        }
        if node.is_link() || node.size < min_bytes.max(1) {
            return false;
        }
        scanned += 1;
        by_size.entry(node.size).or_default().push(id);
        false
    });
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
    Collected { candidates, scanned_files: scanned }
}

fn hash_file(path: &PathBuf, limit: Option<usize>) -> Option<[u8; 32]> {
    let mut file = std::fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    let mut left = limit.unwrap_or(usize::MAX);
    while left > 0 {
        let want = buf.len().min(left);
        let n = file.read(&mut buf[..want]).ok()?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        left -= n;
    }
    Some(hasher.finalize().into())
}

/// Hashes `jobs` on `threads` workers; `None` for unreadable files.
fn hash_all(
    jobs: &[(usize, PathBuf, u64)],
    limit: Option<usize>,
    threads: usize,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(u64, u64),
) -> Vec<Option<[u8; 32]>> {
    let next = AtomicUsize::new(0);
    let done = AtomicU64::new(0);
    let bytes = AtomicU64::new(0);
    let results: Mutex<Vec<Option<[u8; 32]>>> = Mutex::new(vec![None; jobs.len()]);
    std::thread::scope(|scope| {
        for _ in 0..threads.max(1) {
            scope.spawn(|| {
                let mut local: Vec<(usize, Option<[u8; 32]>)> = Vec::new();
                loop {
                    if cancel.load(Ordering::Relaxed) {
                        break;
                    }
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    if i >= jobs.len() {
                        break;
                    }
                    let (_, path, size) = &jobs[i];
                    let h = hash_file(path, limit);
                    local.push((i, h));
                    done.fetch_add(1, Ordering::Relaxed);
                    bytes.fetch_add(limit.map(|l| (l as u64).min(*size)).unwrap_or(*size), Ordering::Relaxed);
                    if local.len() >= 64 {
                        if let Ok(mut r) = results.lock() {
                            for (i, h) in local.drain(..) {
                                r[i] = h;
                            }
                        }
                    }
                }
                if let Ok(mut r) = results.lock() {
                    for (i, h) in local.drain(..) {
                        r[i] = h;
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

/// Groups of identical files among the candidates: `(hash, size, ids)`.
pub fn find_duplicates(
    candidates: &[Candidate],
    threads: usize,
    cancel: &AtomicBool,
    mut progress: impl FnMut(&DupesProgress),
) -> (Vec<(String, u64, Vec<u32>)>, bool) {
    // Pass 1: first 64 KB.
    let jobs: Vec<(usize, PathBuf, u64)> =
        candidates.iter().enumerate().map(|(i, c)| (i, c.path.clone(), c.size)).collect();
    let bytes_total: u64 = jobs.iter().map(|j| j.2.min(PREFIX as u64)).sum();
    let total = jobs.len() as u64;
    let prefix = hash_all(&jobs, Some(PREFIX), threads, cancel, &mut |done, bytes| {
        progress(&DupesProgress { phase: "prefix", done, total, bytes_done: bytes, bytes_total })
    });
    if cancel.load(Ordering::Relaxed) {
        return (Vec::new(), true);
    }
    let mut by_prefix: HashMap<(u64, [u8; 32]), Vec<usize>> = HashMap::new();
    for (i, h) in prefix.iter().enumerate() {
        if let Some(h) = h {
            by_prefix.entry((candidates[i].size, *h)).or_default().push(i);
        }
    }
    // Pass 2: whole file for the survivors bigger than the prefix.
    let mut final_groups: HashMap<(u64, [u8; 32]), Vec<usize>> = HashMap::new();
    let mut full_jobs: Vec<(usize, PathBuf, u64)> = Vec::new();
    for ((size, h), idxs) in by_prefix {
        if idxs.len() < 2 {
            continue;
        }
        if size <= PREFIX as u64 {
            final_groups.insert((size, h), idxs);
        } else {
            for i in idxs {
                full_jobs.push((i, candidates[i].path.clone(), size));
            }
        }
    }
    if !full_jobs.is_empty() {
        let bytes_total: u64 = full_jobs.iter().map(|j| j.2).sum();
        let total = full_jobs.len() as u64;
        let full = hash_all(&full_jobs, None, threads, cancel, &mut |done, bytes| {
            progress(&DupesProgress { phase: "full", done, total, bytes_done: bytes, bytes_total })
        });
        if cancel.load(Ordering::Relaxed) {
            return (Vec::new(), true);
        }
        for (j, h) in full.iter().enumerate() {
            if let Some(h) = h {
                let i = full_jobs[j].0;
                final_groups.entry((candidates[i].size, *h)).or_default().push(i);
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
    (groups, false)
}

pub fn build_result(
    arena: &Arena,
    root_id: u32,
    min_bytes: u64,
    scanned_files: u64,
    candidate_files: u64,
    groups: Vec<(String, u64, Vec<u32>)>,
    cancelled: bool,
) -> DupesResult {
    let mut extra = 0u32;
    let mut wasted = 0u64;
    let group_count = groups.len() as u32;
    let mut out = Vec::with_capacity(groups.len().min(MAX_GROUPS));
    for (hash, size, ids) in groups {
        extra += ids.len() as u32 - 1;
        wasted += size * (ids.len() as u64 - 1);
        if out.len() >= MAX_GROUPS {
            continue;
        }
        let more = ids.len().saturating_sub(MAX_PER_GROUP) as u32;
        let files: Vec<NodeInfo> = ids.iter().take(MAX_PER_GROUP).filter_map(|&i| arena.info(i)).collect();
        out.push(DupeGroup { hash, size, files, more });
    }
    DupesResult {
        root_id,
        min_bytes,
        scanned_files,
        candidate_files,
        group_count,
        extra_copies: extra,
        wasted,
        groups: out,
        cancelled,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn finds_identical_files_and_skips_same_size_different_content() {
        let base = std::env::temp_dir().join(format!("owntools-dupes-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
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
        let cancel = std::sync::Arc::new(AtomicBool::new(false));
        let arena = crate::disk::scan::scan(&base, crate::disk::scan::ScanOptions::default(), cancel.clone(), |_| {}).unwrap();
        let collected = collect_candidates(&arena, 0, 1);
        assert_eq!(collected.scanned_files, 6);
        assert_eq!(collected.candidates.len(), 6);
        let (groups, cancelled) = find_duplicates(&collected.candidates, 3, &cancel, |_| {});
        assert!(!cancelled);
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].1, 200_000);
        assert_eq!(groups[0].2.len(), 2);
        assert_eq!(groups[1].1, 5);
        assert_eq!(groups[1].2.len(), 2);
        let result = build_result(&arena, 0, 1, 6, 6, groups, false);
        assert_eq!(result.extra_copies, 2);
        assert_eq!(result.wasted, 200_005);
        let _ = fs::remove_dir_all(&base);
    }
}
