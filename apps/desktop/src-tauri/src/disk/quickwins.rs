//! Quick wins: the folders and files most people are happy to lose. Rules,
//! not heuristics about the user — a `node_modules` is a `node_modules`.
//! "Container" rules (caches, package caches, node_modules, build output,
//! leftovers, emulators) take the topmost match and do not look inside it,
//! so nothing is counted twice; file rules (large media, installers, disk
//! images) run everywhere else.
//!
//! Two places are never walked: installed programs' own folders (passed in as
//! `keep_out` — the `node_modules` inside an Electron app or npm's inside
//! `Program Files\nodejs` is part of that program, see `installed.rs`) and the
//! Recycle Bin / System Volume Information, which are not anybody's to move
//! into the Recycle Bin.

use serde::Serialize;
use std::collections::HashSet;

use super::arena::{Arena, Node, NodeInfo};
use super::category::{CAT_AUDIO, CAT_VIDEO};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickWin {
    pub id: &'static str,
    pub label: &'static str,
    pub hint: &'static str,
    pub bytes: u64,
    pub count: u32,
    /// Ask before cleaning: build output and disk images can be live work.
    pub caution: bool,
    /// Windows protects these: moving them takes administrator permission,
    /// which Windows asks for during the cleanup.
    pub admin: bool,
    pub items: Vec<NodeInfo>,
}

const MAX_ITEMS: usize = 80;
const MB: u64 = 1024 * 1024;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Rule {
    Downloads,
    Caches,
    PackageCaches,
    NodeModules,
    Build,
    LargeMedia,
    Installers,
    DiskImages,
    Leftovers,
    Emulators,
}

/// `(rule, id, label, hint, caution, admin)`
const RULES: [(Rule, &str, &str, &str, bool, bool); 10] = [
    (Rule::Downloads, "downloads", "Downloads", "Everything in your Downloads folders", false, false),
    (Rule::Caches, "caches", "Caches & logs", "App caches, temp folders, logs and crash dumps — apps rebuild these", false, false),
    (Rule::PackageCaches, "packages", "Package caches", "npm, pnpm, pip, cargo, NuGet, Gradle, Maven, Playwright stores — re-downloaded on demand", false, false),
    (Rule::NodeModules, "node_modules", "node_modules", "Dependencies of projects; `npm install` brings them back", false, false),
    (Rule::Build, "build", "Build artifacts", "target, dist, build, .next, __pycache__ and friends — rebuilt by the next build", true, false),
    (Rule::LargeMedia, "media", "Large media", "Video and audio files over 100 MB", true, false),
    (Rule::Installers, "installers", "Installers", "Setup files, disk images and ISOs sitting in Downloads", false, false),
    (Rule::DiskImages, "vm", "Disk images & VMs", "Virtual disks (vhdx, vmdk, iso…) over 100 MB — WSL and Docker live here too", true, false),
    (Rule::Leftovers, "leftovers", "System leftovers", "Windows.old, update downloads, Windows' own temp files and crash reports", false, true),
    (Rule::Emulators, "emulators", "Emulators & simulators", "Android system images and AVDs, iOS simulators", true, false),
];

fn lower(name: &str) -> String {
    name.to_lowercase()
}

fn ext_of(name: &str) -> &str {
    match name.rfind('.') {
        Some(i) if i > 0 && i + 1 < name.len() => &name[i + 1..],
        _ => "",
    }
}

fn is_cache_dir(name: &str) -> bool {
    matches!(
        name,
        "cache"
            | "caches"
            | ".cache"
            | "code cache"
            | "gpucache"
            | "cachedata"
            | "cachestorage"
            | "shadercache"
            | "dawncache"
            | "dawngraphitecache"
            | "dawnwebgpucache"
            | "cache_data"
            | "cache2"
            | "temp"
            | "tmp"
            | ".tmp"
            | "logs"
            | "crashdumps"
            | "crashpad"
            | "crashreports"
            | "inetcache"
            | "webcache"
            | "thumbnails"
            | ".thumbnails"
            | "diagnosticlogs"
            | "cacheddata"
            | "cachedextensions"
            | "cachedextensionvsixs"
            | "cachedprofiles"
            | "d3dscache"
            | "nvidia"
            | "amd"
            | "__jb_cache__"
    )
}

fn is_package_cache(name: &str, parent: &str) -> bool {
    matches!(name, "_cacache" | "npm-cache" | ".npm" | ".pnpm-store" | "pnpm-store" | "ms-playwright" | "pub-cache" | ".pub-cache" | "cypress")
        || (name == "registry" && parent == ".cargo")
        || (name == "packages" && parent == ".nuget")
        || (name == "repository" && parent == ".m2")
        || (name == "mod" && parent == "pkg")
        || (name == "cache" && parent == "pip")
        || (name == "cache" && parent == ".yarn")
        || (name == "cache" && parent == "yarn")
        || (name == "berry" && parent == ".yarn")
        || (name == "huggingface" && parent == ".cache")
}

fn is_build_dir(arena: &Arena, id: u32, name: &str, parent: &str) -> bool {
    match name {
        "target" => arena.children(id).any(|c| matches!(&*arena.nodes[c as usize].name.to_lowercase(), "debug" | "release")),
        "dist" | "build" | "out" => {
            // Only next to something that builds; a "build" full of photos is not ours.
            let p = arena.nodes[id as usize].parent;
            p != super::arena::NONE
                && arena.children(p).any(|c| {
                    matches!(
                        &*arena.nodes[c as usize].name.to_lowercase(),
                        "package.json" | "cargo.toml" | "cmakelists.txt" | "build.gradle" | "pom.xml" | "pyproject.toml" | "setup.py" | "tsconfig.json" | "makefile" | "vite.config.ts" | "next.config.js" | "next.config.ts"
                    )
                })
        }
        ".next" | ".nuxt" | ".turbo" | ".parcel-cache" | "__pycache__" | "cmake-build-debug" | "cmake-build-release" | "deriveddata"
        | ".angular" | ".svelte-kit" | "storybook-static" | ".nyc_output" | ".pytest_cache" | ".mypy_cache" | ".ruff_cache" | ".tox" => true,
        ".gradle" => parent != "" && !parent.starts_with('~'),
        "obj" => {
            let p = arena.nodes[id as usize].parent;
            p != super::arena::NONE
                && arena.children(p).any(|c| arena.nodes[c as usize].name.to_lowercase().ends_with(".csproj"))
        }
        _ => false,
    }
}

/// Checked before the cache names: `Windows\Temp` is a cache by name, but only
/// an administrator can empty it.
fn is_leftover(name: &str, parent: &str) -> bool {
    matches!(name, "windows.old" | "$windows.~bt" | "$windows.~ws" | "$getcurrent")
        || (name == "download" && parent == "softwaredistribution")
        || (name == "temp" && parent == "windows")
        || (name == "livekernelreports" && parent == "windows")
        || (name == "minidump" && parent == "windows")
}

/// Folders nothing here may suggest or walk into. The Recycle Bin cannot be
/// moved into itself (emptying it deletes for good, which this tool does not
/// do), and walking it would offer last week's cleanup back as fresh
/// `node_modules`.
fn is_off_limits(name: &str) -> bool {
    matches!(name, "$recycle.bin" | "system volume information")
}

fn is_emulator(name: &str, parent: &str) -> bool {
    (name == "avd" && parent == ".android")
        || (name == "system-images" && (parent == "sdk" || parent == "android"))
        || name == "coresimulator"
        || (name == "ios devicesupport" && parent == "xcode")
}

struct Bucket {
    ids: Vec<(u64, u32)>,
    bytes: u64,
    count: u32,
}

impl Bucket {
    fn new() -> Self {
        Bucket { ids: Vec::new(), bytes: 0, count: 0 }
    }
    fn add(&mut self, id: u32, node: &Node) {
        self.bytes += node.size;
        self.count += 1;
        self.ids.push((node.size, id));
    }
}

/// `keep_out`: node ids of installed programs' folders (`installed::installed_node_ids`).
pub fn quick_wins(arena: &Arena, keep_out: &HashSet<u32>) -> Vec<QuickWin> {
    if arena.nodes.is_empty() {
        return Vec::new();
    }
    let mut buckets: Vec<Bucket> = (0..RULES.len()).map(|_| Bucket::new()).collect();
    let idx = |rule: Rule| RULES.iter().position(|r| r.0 == rule).unwrap();

    // (id, in_downloads)
    let mut stack: Vec<(u32, bool)> = arena.children(0).map(|c| (c, false)).collect();
    while let Some((id, in_downloads)) = stack.pop() {
        let node = &arena.nodes[id as usize];
        if node.removed() || node.is_link() {
            continue;
        }
        let name = lower(&node.name);
        let parent_name = if node.parent == super::arena::NONE || node.parent == 0 {
            String::new()
        } else {
            lower(&arena.nodes[node.parent as usize].name)
        };
        if node.is_dir() {
            if keep_out.contains(&id) || is_off_limits(&name) {
                continue;
            }
            let depth_from_root = arena.depth_of(id);
            if name == "downloads" && depth_from_root <= 4 && !in_downloads {
                let b = &mut buckets[idx(Rule::Downloads)];
                b.bytes += node.size;
                b.count += node.child_count;
                for c in arena.children(id) {
                    b.ids.push((arena.nodes[c as usize].size, c));
                }
                stack.extend(arena.children(id).map(|c| (c, true)));
                continue;
            }
            let container = if name == "node_modules" {
                Some(Rule::NodeModules)
            } else if is_package_cache(&name, &parent_name) {
                Some(Rule::PackageCaches)
            } else if is_leftover(&name, &parent_name) {
                Some(Rule::Leftovers)
            } else if is_cache_dir(&name) {
                Some(Rule::Caches)
            } else if is_emulator(&name, &parent_name) {
                Some(Rule::Emulators)
            } else if is_build_dir(arena, id, &name, &parent_name) {
                Some(Rule::Build)
            } else {
                None
            };
            if let Some(rule) = container {
                if node.size > 0 {
                    buckets[idx(rule)].add(id, node);
                }
                continue;
            }
            stack.extend(arena.children(id).map(|c| (c, in_downloads)));
            continue;
        }
        // Files.
        let ext = ext_of(&name);
        if (node.cat == CAT_VIDEO || node.cat == CAT_AUDIO) && node.size >= 100 * MB {
            buckets[idx(Rule::LargeMedia)].add(id, node);
        }
        if matches!(ext, "vhd" | "vhdx" | "vmdk" | "vdi" | "qcow2" | "ova" | "hdd" | "img") && node.size >= 100 * MB {
            buckets[idx(Rule::DiskImages)].add(id, node);
        } else if matches!(ext, "iso") && node.size >= 100 * MB && !in_downloads {
            buckets[idx(Rule::DiskImages)].add(id, node);
        }
        if in_downloads && matches!(ext, "exe" | "msi" | "msix" | "appx" | "appxbundle" | "msixbundle" | "dmg" | "pkg" | "iso") && node.size >= 5 * MB {
            buckets[idx(Rule::Installers)].add(id, node);
        }
        if matches!(ext, "log" | "dmp" | "etl" | "tmp") && node.size >= MB {
            buckets[idx(Rule::Caches)].add(id, node);
        }
    }

    let mut out: Vec<QuickWin> = RULES
        .iter()
        .zip(buckets.into_iter())
        .filter(|(_, b)| b.count > 0 && b.bytes > 0)
        .map(|((_, id, label, hint, caution, admin), mut b)| {
            b.ids.sort_unstable_by(|a, c| c.cmp(a));
            b.ids.truncate(MAX_ITEMS);
            QuickWin {
                id,
                label,
                hint,
                bytes: b.bytes,
                count: b.count,
                caution: *caution,
                admin: *admin,
                items: b.ids.into_iter().filter_map(|(_, i)| arena.info(i)).collect(),
            }
        })
        .collect();
    out.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::disk::arena::tests::sample;

    #[test]
    fn finds_downloads_and_installers() {
        let a = sample();
        let wins = quick_wins(&a, &HashSet::new());
        let downloads = wins.iter().find(|w| w.id == "downloads").expect("downloads rule");
        assert_eq!(downloads.bytes, 3_500_000);
        assert_eq!(downloads.count, 2);
        assert_eq!(downloads.items[0].name, "movie.mp4");
        // setup.exe is 500 KB — under the 5 MB installer threshold.
        assert!(wins.iter().all(|w| w.id != "installers"));
        assert!(wins.windows(2).all(|p| p[0].bytes >= p[1].bytes));
    }

    /// A drive-shaped tree on disk: Windows' own temp folder, a Recycle Bin
    /// holding last week's cleanup, and an installed app with dependencies inside.
    #[test]
    fn protected_places_are_not_quick_wins() {
        use crate::disk::scan::{scan, ScanOptions};
        use std::sync::{atomic::AtomicBool, Arc};

        let base = std::env::temp_dir().join(format!("owntools-quickwins-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let put = |rel: &str, bytes: usize| {
            let path = base.join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, vec![1u8; bytes]).unwrap();
        };
        put("Windows/Temp/cbs.persist.log", 4096);
        put("$Recycle.Bin/S-1-5-21/$R123/node_modules/left-pad/index.js", 4096);
        put("Program Files/Some App/resources/app/node_modules/dep/index.js", 4096);
        put("Projects/site/node_modules/dep/index.js", 4096);

        let arena = scan(&base, ScanOptions { threads: 2, ..Default::default() }, Arc::new(AtomicBool::new(false)), |_| {}).unwrap();
        let app = arena.find_path(&base.join("Program Files").join("Some App").to_string_lossy()).unwrap();
        let wins = quick_wins(&arena, &HashSet::from([app]));

        let leftovers = wins.iter().find(|w| w.id == "leftovers").expect("Windows\\Temp is a system leftover, not a cache");
        assert!(leftovers.admin);
        assert_eq!(leftovers.items.iter().map(|i| i.name.as_str()).collect::<Vec<_>>(), ["Temp"]);
        assert!(wins.iter().all(|w| w.id != "caches"), "Windows\\Temp must not also count as a cache");

        let modules = wins.iter().find(|w| w.id == "node_modules").expect("the project's node_modules");
        assert!(!modules.admin);
        let paths: Vec<&str> = modules.items.iter().map(|i| i.path.as_str()).collect();
        assert_eq!(paths.len(), 1, "only the project's: {paths:?}");
        assert!(paths[0].contains("Projects"), "{paths:?}");

        let _ = std::fs::remove_dir_all(&base);
    }
}
