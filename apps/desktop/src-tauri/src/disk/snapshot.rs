//! Snapshots: a scan kept for later, and the diff between two of them.
//!
//! A snapshot keeps every folder (with its totals) and every file of at
//! least 1 MiB; smaller files fold into their folder's numbers. That is
//! enough to answer "what grew since Tuesday" per folder and to browse the
//! old tree, at a few megabytes per snapshot instead of a hundred. Stored as
//! gzip-compressed JSON under `<AppData>/disk/snapshots/<id>.json.gz`, with
//! `index.json` beside them.

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use super::arena::{Arena, DirExtra, Node, F_DIR, NONE};
use super::category::category_of_name;

const MIN_FILE: u64 = 1024 * 1024;
const FORMAT: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotMeta {
    pub id: String,
    pub name: String,
    pub root: String,
    pub created: String,
    pub size: u64,
    pub alloc: u64,
    pub files: u32,
    pub dirs: u32,
    #[serde(default)]
    pub file_bytes: u64,
}

/// `[name, kind, size, alloc, files, dirs, mtime, children]`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry(
    pub String,
    pub u8,
    pub u64,
    pub u64,
    pub u32,
    pub u32,
    pub i64,
    pub Option<Vec<Entry>>,
);

impl Entry {
    pub fn is_dir(&self) -> bool {
        self.1 == 1
    }
    pub fn size(&self) -> u64 {
        self.2
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotFile {
    pub v: u32,
    #[serde(flatten)]
    pub meta: SnapshotMeta,
    pub tree: Entry,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffEntry {
    pub path: String,
    pub name: String,
    pub kind: &'static str,
    pub before: u64,
    pub after: u64,
    pub delta: i64,
    pub depth: u32,
    /// grew · shrank · new · gone
    pub state: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotDiff {
    pub before: SnapshotMeta,
    pub after: SnapshotMeta,
    pub delta: i64,
    pub entries: Vec<DiffEntry>,
    pub truncated: bool,
}

pub fn dir(app_data: &Path) -> PathBuf {
    app_data.join("disk").join("snapshots")
}

fn index_path(app_data: &Path) -> PathBuf {
    dir(app_data).join("index.json")
}

fn file_path(app_data: &Path, id: &str) -> PathBuf {
    dir(app_data).join(format!("{id}.json.gz"))
}

pub fn list(app_data: &Path) -> Vec<SnapshotMeta> {
    let text = match fs::read_to_string(index_path(app_data)) {
        Ok(t) => t,
        Err(_) => return Vec::new(),
    };
    let mut list: Vec<SnapshotMeta> = serde_json::from_str(&text).unwrap_or_default();
    list.sort_by(|a, b| b.created.cmp(&a.created));
    list
}

fn write_index(app_data: &Path, list: &[SnapshotMeta]) -> Result<(), String> {
    fs::create_dir_all(dir(app_data)).map_err(|e| e.to_string())?;
    let path = index_path(app_data);
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// The arena as an entry tree (folders + files ≥ 1 MiB). Also what the
/// diff compares the current scan with.
pub fn tree_from_arena(arena: &Arena) -> Entry {
    fn build(arena: &Arena, id: u32) -> Entry {
        let node = &arena.nodes[id as usize];
        let children = if node.is_dir() {
            let mut kids: Vec<Entry> = arena
                .children(id)
                .filter_map(|c| {
                    let n = &arena.nodes[c as usize];
                    if n.is_dir() || n.size >= MIN_FILE {
                        Some(build(arena, c))
                    } else {
                        None
                    }
                })
                .collect();
            kids.sort_by(|a, b| b.2.cmp(&a.2));
            Some(kids)
        } else {
            None
        };
        Entry(
            if id == 0 { String::new() } else { node.name.to_string() },
            if node.is_dir() { 1 } else { 0 },
            node.size,
            node.alloc,
            node.files,
            node.dirs,
            node.mtime,
            children,
        )
    }
    build(arena, 0)
}

fn write_entry(out: &mut impl Write, e: &Entry) -> std::io::Result<()> {
    write!(out, "[{},{},{},{},{},{},{},", serde_json::to_string(&e.0).unwrap_or_default(), e.1, e.2, e.3, e.4, e.5, e.6)?;
    match &e.7 {
        None => write!(out, "null]")?,
        Some(kids) => {
            out.write_all(b"[")?;
            for (i, k) in kids.iter().enumerate() {
                if i > 0 {
                    out.write_all(b",")?;
                }
                write_entry(out, k)?;
            }
            out.write_all(b"]]")?;
        }
    }
    Ok(())
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn new_id() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 6];
    rand::rng().fill_bytes(&mut bytes);
    format!("snap_{}", hex::encode(bytes))
}

pub fn save(app_data: &Path, arena: &Arena, name: &str) -> Result<SnapshotMeta, String> {
    if arena.nodes.is_empty() {
        return Err("nothing scanned yet".into());
    }
    fs::create_dir_all(dir(app_data)).map_err(|e| e.to_string())?;
    let root = &arena.nodes[0];
    let id = new_id();
    let name = if name.trim().is_empty() {
        let short = arena.root.trim_end_matches(['\\', '/']);
        let short = short.rsplit(['\\', '/']).next().filter(|s| !s.is_empty()).unwrap_or(short);
        format!("{short} · {}", chrono::Local::now().format("%b %-d, %H:%M"))
    } else {
        name.trim().to_string()
    };
    let mut meta = SnapshotMeta {
        id: id.clone(),
        name,
        root: arena.root.clone(),
        created: now_iso(),
        size: root.size,
        alloc: root.alloc,
        files: root.files,
        dirs: root.dirs,
        file_bytes: 0,
    };
    let path = file_path(app_data, &id);
    let tmp = path.with_extension("tmp");
    {
        let file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        let mut out = BufWriter::new(GzEncoder::new(file, Compression::fast()));
        let head = serde_json::json!({
            "v": FORMAT,
            "id": meta.id, "name": meta.name, "root": meta.root, "created": meta.created,
            "size": meta.size, "alloc": meta.alloc, "files": meta.files, "dirs": meta.dirs,
        });
        let mut head = serde_json::to_string(&head).map_err(|e| e.to_string())?;
        head.pop(); // strip the closing brace, the tree follows
        write!(out, "{head},\"tree\":").map_err(|e| e.to_string())?;
        let tree = tree_from_arena(arena);
        write_entry(&mut out, &tree).map_err(|e| e.to_string())?;
        out.write_all(b"}").map_err(|e| e.to_string())?;
        let enc = out.into_inner().map_err(|e| e.to_string())?;
        enc.finish().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    meta.file_bytes = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let mut index = list(app_data);
    index.retain(|m| m.id != meta.id);
    index.push(meta.clone());
    write_index(app_data, &index)?;
    Ok(meta)
}

pub fn load(app_data: &Path, id: &str) -> Result<SnapshotFile, String> {
    let file = fs::File::open(file_path(app_data, id)).map_err(|e| format!("snapshot missing: {e}"))?;
    let reader = std::io::BufReader::new(GzDecoder::new(file));
    let snap: SnapshotFile = serde_json::from_reader(reader).map_err(|e| format!("snapshot unreadable: {e}"))?;
    if snap.v != FORMAT {
        return Err(format!("snapshot format {} not supported", snap.v));
    }
    Ok(snap)
}

pub fn delete(app_data: &Path, id: &str) -> Result<(), String> {
    let _ = fs::remove_file(file_path(app_data, id));
    let mut index = list(app_data);
    index.retain(|m| m.id != id);
    write_index(app_data, &index)
}

/// A browsable arena out of a snapshot; folders whose small files were
/// folded get one synthetic "(N smaller files)" child so the totals add up.
pub fn arena_from(snap: &SnapshotFile) -> Arena {
    let mut arena = Arena::new(snap.meta.root.clone());
    arena.source = "snapshot";
    arena.scanned_at = chrono::DateTime::parse_from_rfc3339(&snap.meta.created)
        .map(|d| d.timestamp())
        .unwrap_or(0);
    // BFS so parents precede children and siblings stay contiguous.
    let mut queue: std::collections::VecDeque<(&Entry, u32)> = std::collections::VecDeque::new();
    arena.nodes.push(Node {
        name: snap.meta.root.clone().into_boxed_str(),
        parent: NONE,
        first_child: 0,
        child_count: 0,
        size: 0,
        alloc: 0,
        mtime: snap.tree.6,
        ctime: i64::MIN,
        files: 0,
        dirs: 0,
        slot: 0,
        flags: F_DIR,
        cat: 0,
    });
    arena.extra.push(DirExtra::default());
    queue.push_back((&snap.tree, 0));
    while let Some((entry, id)) = queue.pop_front() {
        let Some(kids) = &entry.7 else { continue };
        let start = arena.nodes.len() as u32;
        let mut kept_size = 0u64;
        let mut kept_alloc = 0u64;
        let mut kept_files = 0u32;
        for k in kids {
            let is_dir = k.is_dir();
            let slot = if is_dir {
                arena.extra.push(DirExtra::default());
                (arena.extra.len() - 1) as u32
            } else {
                NONE
            };
            let cid = arena.nodes.len() as u32;
            arena.nodes.push(Node {
                name: k.0.clone().into_boxed_str(),
                parent: id,
                first_child: 0,
                child_count: 0,
                size: if is_dir { 0 } else { k.2 },
                alloc: if is_dir { 0 } else { k.3 },
                mtime: k.6,
                ctime: i64::MIN,
                files: 0,
                dirs: 0,
                slot,
                flags: if is_dir { F_DIR } else { 0 },
                cat: if is_dir { 0 } else { category_of_name(&k.0) },
            });
            kept_size += k.2;
            kept_alloc += k.3;
            if is_dir {
                kept_files += k.4;
                queue.push_back((k, cid));
            } else {
                kept_files += 1;
            }
        }
        let folded_files = entry.4.saturating_sub(kept_files);
        let folded_size = entry.2.saturating_sub(kept_size);
        if folded_files > 0 && folded_size > 0 {
            arena.nodes.push(Node {
                name: format!("({folded_files} smaller files)").into_boxed_str(),
                parent: id,
                first_child: 0,
                child_count: 0,
                size: folded_size,
                alloc: entry.3.saturating_sub(kept_alloc),
                mtime: entry.6,
                ctime: i64::MIN,
                files: 0,
                dirs: 0,
                slot: NONE,
                flags: 0,
                cat: 0,
            });
        }
        let count = arena.nodes.len() as u32 - start;
        arena.nodes[id as usize].first_child = start;
        arena.nodes[id as usize].child_count = count;
    }
    arena.aggregate();
    arena
}

#[cfg(windows)]
fn key(name: &str) -> String {
    name.to_lowercase()
}
#[cfg(not(windows))]
fn key(name: &str) -> String {
    name.to_string()
}

const MAX_ENTRIES: usize = 800;

/// Per-folder deltas between two trees, deepest meaningful cause included:
/// a folder is listed when its change is at least the threshold, and its
/// children are then examined the same way. Siblings sort by |delta|.
pub fn diff_trees(before: &Entry, after: &Entry) -> (Vec<DiffEntry>, bool) {
    fn children_map(e: &Entry) -> HashMap<String, &Entry> {
        e.7.as_ref().map(|kids| kids.iter().map(|k| (key(&k.0), k)).collect()).unwrap_or_default()
    }
    let a = children_map(before);
    let b = children_map(after);
    let mut names: Vec<&String> = a.keys().chain(b.keys()).collect();
    names.sort();
    names.dedup();
    let total_abs: u64 = names
        .iter()
        .map(|n| {
            let x = a.get(*n).map(|e| e.size()).unwrap_or(0) as i64;
            let y = b.get(*n).map(|e| e.size()).unwrap_or(0) as i64;
            (y - x).unsigned_abs()
        })
        .sum();
    let threshold = (total_abs / 1000).max(MIN_FILE);
    let mut out = Vec::new();
    let mut truncated = false;

    fn visit(
        a: Option<&Entry>,
        b: Option<&Entry>,
        path: &str,
        depth: u32,
        threshold: u64,
        out: &mut Vec<DiffEntry>,
        truncated: &mut bool,
    ) {
        let ka = a.map(children_map).unwrap_or_default();
        let kb = b.map(children_map).unwrap_or_default();
        let mut names: Vec<String> = ka.keys().chain(kb.keys()).cloned().collect();
        names.sort();
        names.dedup();
        let mut rows: Vec<(i64, String)> = names
            .into_iter()
            .map(|n| {
                let x = ka.get(&n).map(|e| e.size()).unwrap_or(0) as i64;
                let y = kb.get(&n).map(|e| e.size()).unwrap_or(0) as i64;
                (y - x, n)
            })
            .filter(|(d, _)| d.unsigned_abs() >= threshold)
            .collect();
        rows.sort_by(|p, q| q.0.unsigned_abs().cmp(&p.0.unsigned_abs()));
        for (delta, n) in rows {
            if out.len() >= MAX_ENTRIES {
                *truncated = true;
                return;
            }
            let ea = ka.get(&n).copied();
            let eb = kb.get(&n).copied();
            let shown = eb.or(ea).map(|e| e.0.clone()).unwrap_or(n.clone());
            let child_path = if path.is_empty() { shown.clone() } else { format!("{path}{}{shown}", std::path::MAIN_SEPARATOR) };
            let is_dir = eb.or(ea).map(|e| e.is_dir()).unwrap_or(false);
            out.push(DiffEntry {
                path: child_path.clone(),
                name: shown,
                kind: if is_dir { "dir" } else { "file" },
                before: ea.map(|e| e.size()).unwrap_or(0),
                after: eb.map(|e| e.size()).unwrap_or(0),
                delta,
                depth,
                state: match (ea, eb) {
                    (None, Some(_)) => "new",
                    (Some(_), None) => "gone",
                    _ if delta > 0 => "grew",
                    _ => "shrank",
                },
            });
            if is_dir && ea.is_some() && eb.is_some() {
                visit(ea, eb, &child_path, depth + 1, threshold, out, truncated);
            }
        }
    }
    visit(Some(before), Some(after), "", 0, threshold, &mut out, &mut truncated);
    (out, truncated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::disk::arena::tests::sample;

    fn e(name: &str, size: u64, kids: Option<Vec<Entry>>) -> Entry {
        Entry(name.into(), if kids.is_some() { 1 } else { 0 }, size, size, 0, 0, 0, kids)
    }

    #[test]
    fn diff_lists_growth_by_folder() {
        let mb = 1024 * 1024;
        let before = e("", 100 * mb, Some(vec![e("a", 60 * mb, Some(vec![e("x", 60 * mb, None)])), e("b", 40 * mb, Some(vec![]))]));
        let after = e(
            "",
            250 * mb,
            Some(vec![
                e("a", 200 * mb, Some(vec![e("x", 60 * mb, None), e("y", 140 * mb, None)])),
                e("c", 50 * mb, Some(vec![])),
            ]),
        );
        let (rows, truncated) = diff_trees(&before, &after);
        assert!(!truncated);
        let paths: Vec<&str> = rows.iter().map(|r| r.path.as_str()).collect();
        assert_eq!(rows[0].name, "a");
        assert_eq!(rows[0].delta, 140 * mb as i64);
        assert_eq!(rows[0].state, "grew");
        assert!(paths.contains(&format!("a{}y", std::path::MAIN_SEPARATOR).as_str()));
        let c = rows.iter().find(|r| r.name == "c").unwrap();
        assert_eq!(c.state, "new");
        let b = rows.iter().find(|r| r.name == "b").unwrap();
        assert_eq!(b.state, "gone");
        assert_eq!(b.delta, -(40 * mb as i64));
        // x did not change: not listed.
        assert!(rows.iter().all(|r| r.name != "x"));
    }

    #[test]
    fn save_load_round_trip_and_reopen() {
        let base = std::env::temp_dir().join(format!("owntools-snap-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let arena = sample();
        let meta = save(&base, &arena, "").unwrap();
        assert!(meta.name.contains("root"));
        assert_eq!(meta.size, arena.nodes[0].size);
        assert_eq!(list(&base).len(), 1);
        let snap = load(&base, &meta.id).unwrap();
        assert_eq!(snap.tree.2, arena.nodes[0].size);
        // Every file in the sample is under 1 MiB, so the tree keeps folders only…
        let root_kids = snap.tree.7.as_ref().unwrap();
        assert_eq!(root_kids.len(), 2);
        // …and the reopened arena reproduces the totals through folded files.
        let reopened = arena_from(&snap);
        assert_eq!(reopened.nodes[0].size, arena.nodes[0].size);
        assert_eq!(reopened.source, "snapshot");
        let downloads = reopened.find_path("C:\\root\\Downloads").unwrap();
        assert_eq!(reopened.nodes[downloads as usize].size, 3_500_000);
        delete(&base, &meta.id).unwrap();
        assert!(list(&base).is_empty());
        let _ = fs::remove_dir_all(&base);
    }
}
