//! Quick wins: the folders and files most people are happy to lose. Rules,
//! not heuristics about the user — a `node_modules` is a `node_modules`.
//! "Container" rules (caches, package caches, node_modules, build output,
//! leftovers, emulators) take the topmost match and do not look inside it,
//! so nothing is counted twice; file rules (large media, installers, disk
//! images) run everywhere else.

use serde::Serialize;

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

const RULES: [(Rule, &str, &str, &str, bool); 10] = [
    (Rule::Downloads, "downloads", "Downloads", "Everything in your Downloads folders", false),
    (Rule::Caches, "caches", "Caches & logs", "App caches, temp folders, logs and crash dumps — apps rebuild these", false),
    (Rule::PackageCaches, "packages", "Package caches", "npm, pnpm, pip, cargo, NuGet, Gradle, Maven, Playwright stores — re-downloaded on demand", false),
    (Rule::NodeModules, "node_modules", "node_modules", "Dependencies of projects; `npm install` brings them back", false),
    (Rule::Build, "build", "Build artifacts", "target, dist, build, .next, __pycache__ and friends — rebuilt by the next build", true),
    (Rule::LargeMedia, "media", "Large media", "Video and audio files over 100 MB", true),
    (Rule::Installers, "installers", "Installers", "Setup files, disk images and ISOs sitting in Downloads", false),
    (Rule::DiskImages, "vm", "Disk images & VMs", "Virtual disks (vhdx, vmdk, iso…) over 100 MB — WSL and Docker live here too", true),
    (Rule::Leftovers, "leftovers", "System leftovers", "Windows.old, the Recycle Bin, update downloads", false),
    (Rule::Emulators, "emulators", "Emulators & simulators", "Android system images and AVDs, iOS simulators", true),
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

fn is_leftover(name: &str, parent: &str) -> bool {
    matches!(name, "windows.old" | "$recycle.bin" | "$windows.~bt" | "$windows.~ws" | "$getcurrent")
        || (name == "download" && parent == "softwaredistribution")
        || (name == "temp" && parent == "windows")
        || (name == "livekernelreports" && parent == "windows")
        || (name == "minidump" && parent == "windows")
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

pub fn quick_wins(arena: &Arena) -> Vec<QuickWin> {
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
            } else if is_cache_dir(&name) {
                Some(Rule::Caches)
            } else if is_leftover(&name, &parent_name) {
                Some(Rule::Leftovers)
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
        .map(|((_, id, label, hint, caution), mut b)| {
            b.ids.sort_unstable_by(|a, c| c.cmp(a));
            b.ids.truncate(MAX_ITEMS);
            QuickWin {
                id,
                label,
                hint,
                bytes: b.bytes,
                count: b.count,
                caution: *caution,
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
        let wins = quick_wins(&a);
        let downloads = wins.iter().find(|w| w.id == "downloads").expect("downloads rule");
        assert_eq!(downloads.bytes, 3_500_000);
        assert_eq!(downloads.count, 2);
        assert_eq!(downloads.items[0].name, "movie.mp4");
        // setup.exe is 500 KB — under the 5 MB installer threshold.
        assert!(wins.iter().all(|w| w.id != "installers"));
        assert!(wins.windows(2).all(|p| p[0].bytes >= p[1].bytes));
    }
}
