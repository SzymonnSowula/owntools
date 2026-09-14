//! The scanned tree, in memory.
//!
//! One flat `Vec<Node>`: a directory's children sit in a contiguous range
//! (`first_child .. first_child + child_count`) and every child has a larger
//! index than its parent, because the builder (scan.rs) creates a directory's
//! entries only when that directory's listing comes back — after the
//! directory itself was created as somebody's entry. That ordering is what
//! makes the bottom-up aggregation a single reverse pass, and what lets the
//! frontend ask for *parts* of the tree by id instead of receiving two
//! million nodes over IPC.
//!
//! Nodes are 80 bytes plus the name; directories carry a side record
//! (`DirExtra`) with per-category totals and the newest mtime inside.

use serde::Serialize;
use std::collections::BinaryHeap;
use std::cmp::Reverse;
use std::path::{Path, PathBuf};

use super::category::{CATS, CAT_OTHER};

pub const NONE: u32 = u32::MAX;

pub const F_DIR: u8 = 1;
pub const F_LINK: u8 = 2;
pub const F_ERROR: u8 = 4;
pub const F_HIDDEN: u8 = 8;
pub const F_SYSTEM: u8 = 16;
pub const F_REMOVED: u8 = 32;
/// Compressed, sparse or a cloud placeholder: on-disk size came from the OS.
pub const F_PACKED: u8 = 64;
/// Online-only (a cloud placeholder): reading the content downloads it first.
pub const F_CLOUD: u8 = 128;

#[derive(Debug, Clone)]
pub struct Node {
    pub name: Box<str>,
    pub parent: u32,
    pub first_child: u32,
    pub child_count: u32,
    /// Logical bytes (aggregated for directories).
    pub size: u64,
    /// Bytes on disk (aggregated for directories).
    pub alloc: u64,
    /// Unix seconds; `i64::MIN` when unknown.
    pub mtime: i64,
    pub ctime: i64,
    /// Files inside (directories), 0 for files.
    pub files: u32,
    /// Directories inside (directories), 0 for files.
    pub dirs: u32,
    /// Index into `Arena::extra` for directories, `NONE` for files.
    pub slot: u32,
    pub flags: u8,
    /// Category: a file's own, a directory's dominant one by bytes.
    pub cat: u8,
}

impl Node {
    pub fn is_dir(&self) -> bool {
        self.flags & F_DIR != 0
    }
    pub fn is_link(&self) -> bool {
        self.flags & F_LINK != 0
    }
    pub fn removed(&self) -> bool {
        self.flags & F_REMOVED != 0
    }
    pub fn kind(&self) -> &'static str {
        if self.is_dir() {
            "dir"
        } else if self.is_link() {
            "link"
        } else {
            "file"
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct DirExtra {
    pub cat_bytes: [u64; CATS],
    pub cat_count: [u32; CATS],
    pub newest: i64,
}

#[derive(Debug)]
pub struct Arena {
    /// The scan root as a path string; `path_of(0)` returns it verbatim.
    pub root: String,
    pub nodes: Vec<Node>,
    pub extra: Vec<DirExtra>,
    pub scanned_at: i64,
    pub elapsed_ms: u64,
    pub errors: u32,
    pub cluster: u64,
    /// "scan" or "snapshot" — snapshots keep folders and big files only.
    pub source: &'static str,
}

/// What the frontend gets for one node (list rows, inspector, search hits).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeInfo {
    pub id: u32,
    pub parent: Option<u32>,
    pub name: String,
    pub path: String,
    pub kind: &'static str,
    pub size: u64,
    pub alloc: u64,
    pub mtime: i64,
    pub ctime: i64,
    pub files: u32,
    pub dirs: u32,
    pub cat: u8,
    pub error: bool,
    pub hidden: bool,
    pub depth: u32,
    pub children: u32,
    /// Newest mtime inside (a file: its own).
    pub newest: i64,
}

/// A pruned subtree for the treemap / sunburst. Short keys on purpose: a
/// depth-7 view of a big disk is tens of thousands of these.
#[derive(Debug, Clone, Serialize)]
pub struct TreeNode {
    pub id: u32,
    pub n: String,
    pub s: u64,
    pub a: u64,
    /// 0 file · 1 dir · 2 link
    pub k: u8,
    pub c: u8,
    pub m: i64,
    pub f: u32,
    pub d: u32,
    pub e: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub ch: Vec<TreeNode>,
    /// Children left out of `ch`: how many and how many bytes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r: Option<Rest>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Rest {
    pub n: u32,
    pub s: u64,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct FileFilter {
    pub cat: Option<u8>,
    pub min_bytes: u64,
    /// Unix seconds; only files modified at or after this.
    pub modified_after: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Breakdown {
    pub bytes: Vec<u64>,
    pub count: Vec<u32>,
}

#[cfg(windows)]
fn names_equal(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b) || a.to_lowercase() == b.to_lowercase()
}

#[cfg(not(windows))]
fn names_equal(a: &str, b: &str) -> bool {
    a == b
}

impl Arena {
    pub fn new(root: String) -> Self {
        Arena {
            root,
            nodes: Vec::new(),
            extra: Vec::new(),
            scanned_at: 0,
            elapsed_ms: 0,
            errors: 0,
            cluster: 4096,
            source: "scan",
        }
    }

    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    pub fn get(&self, id: u32) -> Option<&Node> {
        self.nodes.get(id as usize)
    }

    pub fn children_range(&self, id: u32) -> std::ops::Range<usize> {
        let n = &self.nodes[id as usize];
        let start = n.first_child as usize;
        start..start + n.child_count as usize
    }

    /// Live (not removed) children ids.
    pub fn children(&self, id: u32) -> impl Iterator<Item = u32> + '_ {
        self.children_range(id)
            .map(|i| i as u32)
            .filter(move |&i| !self.nodes[i as usize].removed())
    }

    pub fn depth_of(&self, mut id: u32) -> u32 {
        let mut depth = 0;
        while let Some(node) = self.get(id) {
            if node.parent == NONE {
                break;
            }
            id = node.parent;
            depth += 1;
        }
        depth
    }

    pub fn path_of(&self, id: u32) -> String {
        let mut parts: Vec<&str> = Vec::new();
        let mut cur = id;
        while let Some(node) = self.get(cur) {
            if node.parent == NONE {
                break;
            }
            parts.push(&node.name);
            cur = node.parent;
        }
        let mut path = PathBuf::from(&self.root);
        for part in parts.iter().rev() {
            path.push(part);
        }
        path.to_string_lossy().into_owned()
    }

    /// Node id for an absolute path inside the scan, if it is there.
    pub fn find_path(&self, path: &str) -> Option<u32> {
        if self.nodes.is_empty() {
            return None;
        }
        let root = Path::new(&self.root);
        let target = Path::new(path);
        let rel = match target.strip_prefix(root) {
            Ok(rel) => rel,
            Err(_) => {
                // Case-insensitive prefix match for Windows drive letters.
                let r = self.root.trim_end_matches(['\\', '/']);
                let p = path.trim_end_matches(['\\', '/']);
                if !names_equal(r, p.get(..r.len().min(p.len())).unwrap_or("")) {
                    return None;
                }
                let rest = &p[r.len()..];
                let rest = rest.trim_start_matches(['\\', '/']);
                if rest.is_empty() {
                    return Some(0);
                }
                return self.walk_components(rest.split(['\\', '/']));
            }
        };
        let mut comps = rel.components().peekable();
        if comps.peek().is_none() {
            return Some(0);
        }
        self.walk_components(comps.map(|c| c.as_os_str().to_str().unwrap_or("")))
    }

    fn walk_components<'a>(&self, comps: impl Iterator<Item = &'a str>) -> Option<u32> {
        let mut cur = 0u32;
        for comp in comps {
            if comp.is_empty() || comp == "." {
                continue;
            }
            let next = self
                .children(cur)
                .find(|&i| names_equal(&self.nodes[i as usize].name, comp))?;
            cur = next;
        }
        Some(cur)
    }

    /// Bottom-up totals. Call once after the scan (and after a snapshot load).
    pub fn aggregate(&mut self) {
        let n = self.nodes.len();
        if n == 0 {
            return;
        }
        for e in self.extra.iter_mut() {
            *e = DirExtra::default();
            e.newest = i64::MIN;
        }
        // Reset directory aggregates; their own entry never carries bytes.
        for node in self.nodes.iter_mut() {
            if node.is_dir() {
                node.size = 0;
                node.alloc = 0;
                node.files = 0;
                node.dirs = 0;
            }
        }
        for i in (1..n).rev() {
            let (size, alloc, files, dirs, mtime, is_dir, cat, slot, parent, removed) = {
                let node = &self.nodes[i];
                (
                    node.size,
                    node.alloc,
                    node.files,
                    node.dirs,
                    node.mtime,
                    node.is_dir(),
                    node.cat,
                    node.slot,
                    node.parent,
                    node.removed(),
                )
            };
            if removed || parent == NONE {
                continue;
            }
            let pslot = self.nodes[parent as usize].slot as usize;
            let child_extra = if is_dir { Some(self.extra[slot as usize].clone()) } else { None };
            let pnode = &mut self.nodes[parent as usize];
            pnode.size += size;
            pnode.alloc += alloc;
            if is_dir {
                pnode.dirs += 1 + dirs;
                pnode.files += files;
            } else {
                pnode.files += 1;
            }
            let pextra = &mut self.extra[pslot];
            match child_extra {
                Some(ce) => {
                    for c in 0..CATS {
                        pextra.cat_bytes[c] += ce.cat_bytes[c];
                        pextra.cat_count[c] += ce.cat_count[c];
                    }
                    pextra.newest = pextra.newest.max(ce.newest);
                }
                None => {
                    let c = (cat as usize).min(CATS - 1);
                    pextra.cat_bytes[c] += size;
                    pextra.cat_count[c] += 1;
                    pextra.newest = pextra.newest.max(mtime);
                }
            }
        }
        // Dominant category per directory.
        for node in self.nodes.iter_mut() {
            if node.is_dir() {
                let e = &self.extra[node.slot as usize];
                let mut best = CAT_OTHER as usize;
                for c in 0..CATS {
                    if e.cat_bytes[c] > e.cat_bytes[best] {
                        best = c;
                    }
                }
                node.cat = best as u8;
            }
        }
    }

    pub fn info(&self, id: u32) -> Option<NodeInfo> {
        let node = self.get(id)?;
        Some(NodeInfo {
            id,
            parent: if node.parent == NONE { None } else { Some(node.parent) },
            name: node.name.to_string(),
            path: self.path_of(id),
            kind: node.kind(),
            size: node.size,
            alloc: node.alloc,
            mtime: node.mtime,
            ctime: node.ctime,
            files: node.files,
            dirs: node.dirs,
            cat: node.cat,
            error: node.flags & F_ERROR != 0,
            hidden: node.flags & (F_HIDDEN | F_SYSTEM) != 0,
            depth: self.depth_of(id),
            children: self.children(id).count() as u32,
            newest: self.newest(id),
        })
    }

    /// Children sorted by size (desc), at most `limit`; second value = total live children.
    pub fn children_info(&self, id: u32, limit: usize) -> (Vec<NodeInfo>, u32) {
        let mut ids: Vec<u32> = self.children(id).collect();
        let total = ids.len() as u32;
        ids.sort_unstable_by(|&a, &b| {
            let na = &self.nodes[a as usize];
            let nb = &self.nodes[b as usize];
            nb.size.cmp(&na.size).then_with(|| na.name.cmp(&nb.name))
        });
        ids.truncate(limit);
        (ids.into_iter().filter_map(|i| self.info(i)).collect(), total)
    }

    /// The pruned subtree: children under `min_bytes` or past `max_children`
    /// fold into `r`; `budget` caps the node count of the whole answer.
    pub fn subtree(&self, id: u32, depth: u32, min_bytes: u64, max_children: usize, budget: usize) -> Option<TreeNode> {
        let mut used = 0usize;
        self.subtree_inner(id, depth, min_bytes, max_children, budget, &mut used)
    }

    fn subtree_inner(
        &self,
        id: u32,
        depth: u32,
        min_bytes: u64,
        max_children: usize,
        budget: usize,
        used: &mut usize,
    ) -> Option<TreeNode> {
        let node = self.get(id)?;
        *used += 1;
        let mut out = TreeNode {
            id,
            n: node.name.to_string(),
            s: node.size,
            a: node.alloc,
            k: if node.is_dir() { 1 } else if node.is_link() { 2 } else { 0 },
            c: node.cat,
            m: node.mtime,
            f: node.files,
            d: node.dirs,
            e: node.flags & F_ERROR != 0,
            ch: Vec::new(),
            r: None,
        };
        if depth == 0 || !node.is_dir() || node.child_count == 0 || *used >= budget {
            return Some(out);
        }
        let mut ids: Vec<u32> = self.children(id).collect();
        ids.sort_unstable_by(|&a, &b| self.nodes[b as usize].size.cmp(&self.nodes[a as usize].size));
        let mut rest_n = 0u32;
        let mut rest_s = 0u64;
        for (i, cid) in ids.into_iter().enumerate() {
            let child = &self.nodes[cid as usize];
            if i >= max_children || child.size < min_bytes || *used >= budget {
                rest_n += 1;
                rest_s += child.size;
                continue;
            }
            if let Some(t) = self.subtree_inner(cid, depth - 1, min_bytes, max_children, budget, used) {
                out.ch.push(t);
            }
        }
        if rest_n > 0 {
            out.r = Some(Rest { n: rest_n, s: rest_s });
        }
        Some(out)
    }

    /// Every live node under `id` (excluding `id`), pre-order.
    pub fn walk(&self, id: u32, mut f: impl FnMut(u32, &Node) -> bool) {
        let mut stack: Vec<u32> = self.children(id).collect();
        while let Some(cur) = stack.pop() {
            let node = &self.nodes[cur as usize];
            if node.removed() {
                continue;
            }
            let descend = f(cur, node);
            if descend && node.is_dir() {
                stack.extend(self.children(cur));
            }
        }
    }

    /// Largest files under `id` matching the filter.
    pub fn top_files(&self, id: u32, filter: FileFilter, limit: usize) -> Vec<NodeInfo> {
        let mut heap: BinaryHeap<Reverse<(u64, u32)>> = BinaryHeap::with_capacity(limit + 1);
        self.walk(id, |i, node| {
            if node.is_dir() {
                return true;
            }
            if node.is_link() || node.size < filter.min_bytes {
                return false;
            }
            if let Some(c) = filter.cat {
                if node.cat != c {
                    return false;
                }
            }
            if let Some(after) = filter.modified_after {
                if node.mtime < after {
                    return false;
                }
            }
            heap.push(Reverse((node.size, i)));
            if heap.len() > limit {
                heap.pop();
            }
            false
        });
        let mut items: Vec<(u64, u32)> = heap.into_iter().map(|r| r.0).collect();
        items.sort_unstable_by(|a, b| b.cmp(a));
        items.into_iter().filter_map(|(_, i)| self.info(i)).collect()
    }

    /// Name search (case-insensitive substring), biggest hits first.
    pub fn search(&self, query: &str, limit: usize) -> Vec<NodeInfo> {
        let q = query.trim().to_lowercase();
        if q.is_empty() {
            return Vec::new();
        }
        let mut heap: BinaryHeap<Reverse<(u64, u32)>> = BinaryHeap::with_capacity(limit + 1);
        for (i, node) in self.nodes.iter().enumerate().skip(1) {
            if node.removed() {
                continue;
            }
            let name = &node.name;
            let hit = if name.is_ascii() && q.is_ascii() {
                name.len() >= q.len() && name.as_bytes().windows(q.len()).any(|w| w.eq_ignore_ascii_case(q.as_bytes()))
            } else {
                name.to_lowercase().contains(&q)
            };
            if hit {
                heap.push(Reverse((node.size, i as u32)));
                if heap.len() > limit {
                    heap.pop();
                }
            }
        }
        let mut items: Vec<(u64, u32)> = heap.into_iter().map(|r| r.0).collect();
        items.sort_unstable_by(|a, b| b.cmp(a));
        items.into_iter().filter_map(|(_, i)| self.info(i)).collect()
    }

    pub fn breakdown(&self, id: u32) -> Breakdown {
        let node = match self.get(id) {
            Some(n) => n,
            None => return Breakdown { bytes: vec![0; CATS], count: vec![0; CATS] },
        };
        if node.is_dir() {
            let e = &self.extra[node.slot as usize];
            Breakdown { bytes: e.cat_bytes.to_vec(), count: e.cat_count.to_vec() }
        } else {
            let mut b = Breakdown { bytes: vec![0; CATS], count: vec![0; CATS] };
            let c = (node.cat as usize).min(CATS - 1);
            b.bytes[c] = node.size;
            b.count[c] = 1;
            b
        }
    }

    /// Newest mtime inside a directory (its own for a file).
    pub fn newest(&self, id: u32) -> i64 {
        match self.get(id) {
            Some(n) if n.is_dir() => self.extra[n.slot as usize].newest,
            Some(n) => n.mtime,
            None => i64::MIN,
        }
    }

    /// Marks a node (and everything under it) gone and takes its totals off
    /// every ancestor, so the views stay right without a rescan.
    pub fn remove(&mut self, id: u32) {
        let Some(node) = self.get(id) else { return };
        if node.removed() {
            return;
        }
        let (size, alloc, files, dirs, is_dir, cat, mtime) =
            (node.size, node.alloc, node.files, node.dirs, node.is_dir(), node.cat, node.mtime);
        let own_extra = if is_dir { Some(self.extra[node.slot as usize].clone()) } else { None };
        let mut parent = node.parent;
        self.nodes[id as usize].flags |= F_REMOVED;
        while parent != NONE {
            let pnode = &mut self.nodes[parent as usize];
            pnode.size = pnode.size.saturating_sub(size);
            pnode.alloc = pnode.alloc.saturating_sub(alloc);
            if is_dir {
                pnode.dirs = pnode.dirs.saturating_sub(1 + dirs);
                pnode.files = pnode.files.saturating_sub(files);
            } else {
                pnode.files = pnode.files.saturating_sub(1);
            }
            let pextra = &mut self.extra[pnode.slot as usize];
            match &own_extra {
                Some(ce) => {
                    for c in 0..CATS {
                        pextra.cat_bytes[c] = pextra.cat_bytes[c].saturating_sub(ce.cat_bytes[c]);
                        pextra.cat_count[c] = pextra.cat_count[c].saturating_sub(ce.cat_count[c]);
                    }
                }
                None => {
                    let c = (cat as usize).min(CATS - 1);
                    pextra.cat_bytes[c] = pextra.cat_bytes[c].saturating_sub(size);
                    pextra.cat_count[c] = pextra.cat_count[c].saturating_sub(1);
                }
            }
            let _ = mtime;
            parent = pnode.parent;
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::disk::category::{category_of_name, CAT_DOCUMENT, CAT_VIDEO};

    /// Builds a small arena by hand, the way the scanner does (parents first,
    /// children contiguous).
    pub fn sample() -> Arena {
        let mut a = Arena::new("C:\\root".into());
        let mut slot = 0u32;
        let mut dir = |name: &str, parent: u32| Node {
            name: name.into(),
            parent,
            first_child: 0,
            child_count: 0,
            size: 0,
            alloc: 0,
            mtime: 100,
            ctime: 50,
            files: 0,
            dirs: 0,
            slot: {
                slot += 1;
                slot - 1
            },
            flags: F_DIR,
            cat: 0,
        };
        let file = |name: &str, parent: u32, size: u64, mtime: i64| Node {
            name: name.into(),
            parent,
            first_child: 0,
            child_count: 0,
            size,
            alloc: (size + 4095) / 4096 * 4096,
            mtime,
            ctime: 10,
            files: 0,
            dirs: 0,
            slot: NONE,
            flags: 0,
            cat: category_of_name(name),
        };
        // 0 root
        a.nodes.push(dir("C:\\root", NONE));
        // root children: 1 Downloads, 2 Docs, 3 readme.txt
        a.nodes.push(dir("Downloads", 0));
        a.nodes.push(dir("Docs", 0));
        a.nodes.push(file("readme.txt", 0, 1000, 500));
        a.nodes[0].first_child = 1;
        a.nodes[0].child_count = 3;
        // Downloads children: 4 movie.mp4, 5 setup.exe
        a.nodes.push(file("movie.mp4", 1, 3_000_000, 900));
        a.nodes.push(file("setup.exe", 1, 500_000, 200));
        a.nodes[1].first_child = 4;
        a.nodes[1].child_count = 2;
        // Docs children: 6 a.pdf, 7 sub (dir)
        a.nodes.push(file("a.pdf", 2, 20_000, 300));
        a.nodes.push(dir("sub", 2));
        a.nodes[2].first_child = 6;
        a.nodes[2].child_count = 2;
        // sub children: 8 b.pdf
        a.nodes.push(file("b.pdf", 7, 30_000, 1000));
        a.nodes[7].first_child = 8;
        a.nodes[7].child_count = 1;
        a.extra = vec![DirExtra::default(); slot as usize];
        a.aggregate();
        a
    }

    #[test]
    fn aggregates_bottom_up() {
        let a = sample();
        assert_eq!(a.nodes[0].size, 3_551_000);
        assert_eq!(a.nodes[0].files, 5);
        assert_eq!(a.nodes[0].dirs, 3);
        assert_eq!(a.nodes[2].size, 50_000);
        assert_eq!(a.nodes[2].files, 2);
        assert_eq!(a.nodes[2].dirs, 1);
        assert_eq!(a.nodes[1].cat, CAT_VIDEO);
        assert_eq!(a.nodes[2].cat, CAT_DOCUMENT);
        assert_eq!(a.newest(2), 1000);
        assert_eq!(a.breakdown(0).bytes[CAT_VIDEO as usize], 3_000_000);
        assert_eq!(a.breakdown(0).count[CAT_DOCUMENT as usize], 3);
    }

    #[test]
    fn paths_round_trip() {
        let a = sample();
        assert_eq!(a.path_of(0), "C:\\root");
        assert_eq!(a.path_of(8), "C:\\root\\Docs\\sub\\b.pdf");
        assert_eq!(a.find_path("C:\\root\\Docs\\sub\\b.pdf"), Some(8));
        assert_eq!(a.find_path("C:\\root"), Some(0));
        assert_eq!(a.find_path("C:\\root\\"), Some(0));
        assert_eq!(a.find_path("C:\\root\\nope"), None);
        assert_eq!(a.find_path("D:\\other"), None);
        assert_eq!(a.depth_of(8), 3);
    }

    #[test]
    fn subtree_prunes_and_folds() {
        let a = sample();
        let t = a.subtree(0, 5, 0, 100, 1000).unwrap();
        assert_eq!(t.ch.len(), 3);
        assert_eq!(t.ch[0].n, "Downloads");
        assert!(t.r.is_none());
        let t = a.subtree(0, 5, 10_000, 100, 1000).unwrap();
        assert_eq!(t.ch.len(), 2);
        assert_eq!(t.r.as_ref().unwrap().n, 1);
        assert_eq!(t.r.as_ref().unwrap().s, 1000);
        let t = a.subtree(0, 1, 0, 100, 1000).unwrap();
        assert!(t.ch[0].ch.is_empty());
        let t = a.subtree(0, 5, 0, 1, 1000).unwrap();
        assert_eq!(t.ch.len(), 1);
        assert_eq!(t.r.as_ref().unwrap().n, 2);
    }

    #[test]
    fn top_files_search_and_remove() {
        let mut a = sample();
        let top = a.top_files(0, FileFilter::default(), 2);
        assert_eq!(top.len(), 2);
        assert_eq!(top[0].name, "movie.mp4");
        assert_eq!(top[1].name, "setup.exe");
        let docs = a.top_files(0, FileFilter { cat: Some(CAT_DOCUMENT), ..Default::default() }, 10);
        assert_eq!(docs.len(), 3);
        let recent = a.top_files(0, FileFilter { modified_after: Some(800), ..Default::default() }, 10);
        assert_eq!(recent.len(), 2);
        let hits = a.search("PDF", 10);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].name, "b.pdf");
        a.remove(1);
        assert_eq!(a.nodes[0].size, 51_000);
        assert_eq!(a.nodes[0].files, 3);
        assert_eq!(a.nodes[0].dirs, 2);
        assert_eq!(a.children(0).count(), 2);
        assert_eq!(a.breakdown(0).bytes[CAT_VIDEO as usize], 0);
        assert!(a.top_files(0, FileFilter::default(), 10).iter().all(|f| f.name != "movie.mp4"));
    }
}
