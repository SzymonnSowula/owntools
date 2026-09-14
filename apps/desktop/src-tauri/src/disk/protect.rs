//! What the duplicate finder leaves alone, and why.
//!
//! Identical bytes do not make a spare copy. Windows keeps one file under two
//! names (System32 and WinSxS are hard links), an installer puts the same DLL
//! next to every component that loads it, and a program loads a library from
//! *its own* folder — it never goes looking for the same bytes somewhere
//! else. A dependency tree carries the same file once per project, and a code
//! project's files are what its build expects to find. Removing "the extra
//! copy" in any of those breaks something. The first real run (2026-09-13, a
//! whole C:) proved it: 3,145 files ticked, Visual Studio Installer's own
//! `msalruntime_x86.dll` among them, kept instead as one of 56 copies in Temp.
//!
//! So duplicates are looked for only among a person's own files. Everything
//! else is *left out* — never read, never listed, never offered — and counted
//! by reason, so the page can say what it skipped. Note that attributes alone
//! are not enough: on a real profile `AppData` is not hidden, while Documents
//! and Downloads are read-only; names and known places carry most of it.

use serde::Serialize;
use std::collections::HashMap;
use std::path::{Component, Path};

use super::arena::{Arena, Node, F_HIDDEN, F_SYSTEM, NONE};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Why {
    /// Windows, Program Files, ProgramData, AppData, installed programs' own
    /// folders, game libraries, app bundles.
    Apps,
    /// Hidden and system files and folders, dot-folders, dependency trees.
    Tools,
    /// Code projects: a folder that holds `.git`.
    Projects,
    /// Programs, libraries and virtual disks wherever they sit (installers excepted).
    Programs,
}

/// Files over the size limit that were not compared, by reason.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LeftOut {
    pub apps: u64,
    pub tools: u64,
    pub projects: u64,
    pub programs: u64,
    /// One file under several names (hard links): removing a name frees nothing.
    pub links: u64,
    /// Online-only cloud files: comparing them would download them.
    pub cloud: u64,
    /// Unreadable, or no longer what the scan saw by the time they were read.
    pub changed: u64,
}

impl LeftOut {
    pub fn add(&mut self, why: Why) {
        match why {
            Why::Apps => self.apps += 1,
            Why::Tools => self.tools += 1,
            Why::Projects => self.projects += 1,
            Why::Programs => self.programs += 1,
        }
    }
}

/// Folders at the top of a drive that belong to the system.
#[cfg(windows)]
const TOP_LEVEL: &[&str] = &[
    "windows", "program files", "program files (x86)", "programdata", "$recycle.bin",
    "system volume information", "recovery", "windows.old", "$windows.~bt", "$windows.~ws",
    "$winreagent", "$sysreset", "$getcurrent", "config.msi", "msocache", "perflogs", "boot", "efi",
    "intel", "amd", "nvidia", "drivers", "inetpub", "xboxgames", "onedrivetemp",
];

/// Folders at the top of `/` that belong to the system.
#[cfg(not(windows))]
const TOP_LEVEL: &[&str] = &[
    "system", "library", "applications", "usr", "bin", "sbin", "lib", "lib32", "lib64", "libx32",
    "opt", "private", "cores", "etc", "var", "snap", "boot", "proc", "sys", "dev", "run", "srv",
    "tmp", "lost+found",
];

/// Folders that hold installed software wherever they sit.
const APP_FOLDERS: &[&str] = &[
    "appdata", "program files", "program files (x86)", "windowsapps", "$recycle.bin",
    "system volume information", "steamapps", "steamlibrary", "epic games", "gog games",
    "xboxgames", "origin games", "ea games", "riot games", "ubisoft game launcher", "battle.net",
    "rockstar games",
];

/// Folders that look like one file on a Mac and belong to an app.
const APP_BUNDLES: &[&str] = &[
    ".app", ".framework", ".bundle", ".plugin", ".kext", ".appex", ".photoslibrary",
    ".photolibrary", ".fcpbundle", ".imovielibrary", ".musiclibrary", ".tvlibrary", ".logicx",
    ".lrdata", ".band",
];

/// Dependency trees: the same file once per project, on purpose.
const DEPENDENCY_FOLDERS: &[&str] =
    &["node_modules", "bower_components", "jspm_packages", "site-packages", "dist-packages", "__pycache__"];

/// Loaded, booted or mounted by something else from exactly where they are.
const PROGRAM_EXTS: &[&str] = &[
    "exe", "dll", "sys", "drv", "ocx", "cpl", "scr", "mui", "efi", "winmd", "node", "pyd", "so",
    "dylib", "vhd", "vhdx", "avhd", "avhdx", "vmdk", "vdi", "qcow2", "hdd",
];

/// Why a folder is left out by its name alone; `top_level` = it sits at the top of a drive.
pub fn folder_rule(name: &str, top_level: bool) -> Option<Why> {
    let name = name.to_lowercase();
    if top_level && TOP_LEVEL.contains(&name.as_str()) {
        return Some(Why::Apps);
    }
    if APP_FOLDERS.contains(&name.as_str()) || APP_BUNDLES.iter().any(|s| name.len() > s.len() && name.ends_with(s)) {
        return Some(Why::Apps);
    }
    if (name.len() > 1 && name.starts_with('.')) || DEPENDENCY_FOLDERS.contains(&name.as_str()) {
        return Some(Why::Tools);
    }
    None
}

/// Why a file is left out by its attributes and kind; `parent` is its folder's name.
pub fn file_rule(name: &str, flags: u8, parent: &str) -> Option<Why> {
    if flags & (F_HIDDEN | F_SYSTEM) != 0 {
        return Some(Why::Tools);
    }
    let name = name.to_lowercase();
    let ext = match name.rfind('.') {
        Some(i) if i > 0 => &name[i + 1..],
        _ => "",
    };
    if !PROGRAM_EXTS.contains(&ext) {
        return None;
    }
    // A downloaded installer is a person's file like any other: three copies of
    // the same setup.exe are exactly what the duplicates page is for.
    if ext == "exe" && (name.contains("setup") || name.contains("install") || parent.eq_ignore_ascii_case("downloads")) {
        return None;
    }
    Some(Why::Programs)
}

/// The rules for one search, with the protected places resolved against the scan.
pub struct Guard {
    /// Protected folders by arena id: the system's own and every installed program's.
    marked: HashMap<u32, Why>,
    /// Set when the search starts inside a protected place: then nothing in it is offered.
    pub root: Option<Why>,
    /// The scan root is a drive root (`C:\`) or `/`, so its folders are top level.
    top_is_drive: bool,
    /// The home folder is never "a code project", even with a `.git` in it (dotfile managers).
    home: Option<u32>,
}

impl Guard {
    /// `app_dirs`: install folders from the registry (`apps::installed_apps`).
    pub fn new(arena: &Arena, root_id: u32, app_dirs: &[String]) -> Self {
        let home = dirs::home_dir();
        let mut places = known_places();
        places.extend(
            app_dirs.iter().filter(|d| plausible_app_dir(d, home.as_deref())).map(|d| (d.clone(), Why::Apps)),
        );
        Self::with_places(arena, root_id, &places, home.as_deref())
    }

    pub fn with_places(arena: &Arena, root_id: u32, places: &[(String, Why)], home: Option<&Path>) -> Self {
        let mut marked = HashMap::new();
        for (path, why) in places {
            // Id 0 is the scan root itself; `root_rule` covers a search that starts in there.
            if let Some(id) = arena.find_path(path).filter(|&id| id != 0) {
                if arena.get(id).map(|n| n.is_dir()).unwrap_or(false) {
                    marked.entry(id).or_insert(*why);
                }
            }
        }
        Guard {
            marked,
            root: root_rule(&arena.path_of(root_id), places, home),
            top_is_drive: Path::new(&arena.root).parent().is_none(),
            home: home.and_then(|h| arena.find_path(&h.to_string_lossy())),
        }
    }

    /// Why a folder inside the search is left out, if it is. Everything under it inherits the answer.
    pub fn folder(&self, arena: &Arena, id: u32, node: &Node) -> Option<Why> {
        if let Some(why) = self.marked.get(&id) {
            return Some(*why);
        }
        if let Some(why) = folder_rule(&node.name, self.top_is_drive && node.parent == 0) {
            return Some(why);
        }
        if node.flags & (F_HIDDEN | F_SYSTEM) != 0 {
            return Some(Why::Tools);
        }
        if Some(id) != self.home {
            for c in arena.children(id) {
                let child = &*arena.nodes[c as usize].name;
                if child.eq_ignore_ascii_case(".git") {
                    return Some(Why::Projects);
                }
                if child.eq_ignore_ascii_case("pyvenv.cfg") {
                    return Some(Why::Tools);
                }
            }
        }
        None
    }

    /// Why a file outside every protected folder is still left out, if it is.
    pub fn file(&self, arena: &Arena, node: &Node) -> Option<Why> {
        let parent = if node.parent == NONE { "" } else { &*arena.nodes[node.parent as usize].name };
        file_rule(&node.name, node.flags, parent)
    }
}

/// `path` is `dir` or somewhere inside it (case-insensitive on Windows).
pub fn same_or_inside(path: &str, dir: &str) -> bool {
    let norm = |s: &str| {
        let t = s.trim().trim_end_matches(['\\', '/']);
        if cfg!(windows) {
            t.replace('/', "\\").to_lowercase()
        } else {
            t.to_string()
        }
    };
    let (p, d) = (norm(path), norm(dir));
    !d.is_empty() && (p == d || (p.starts_with(&d) && matches!(p.as_bytes().get(d.len()), Some(b'\\' | b'/'))))
}

/// A search that starts inside a protected place: a code project, virtualenv
/// or hidden folder at or above the root (those are on disk, above what the
/// arena holds), a folder a rule names on the way down, or a known folder.
/// The most specific answer wins; any answer means nothing in there is offered.
pub fn root_rule(root_path: &str, places: &[(String, Why)], home: Option<&Path>) -> Option<Why> {
    let path = Path::new(root_path);
    let home = home.map(|h| h.to_string_lossy().into_owned());
    let mut cur = Some(path);
    while let Some(dir) = cur {
        let here = dir.to_string_lossy();
        let at_home = home.as_deref().is_some_and(|h| same_or_inside(h, &here) && same_or_inside(&here, h));
        if dir.parent().is_none() || at_home {
            break;
        }
        if dir.join(".git").exists() {
            return Some(Why::Projects);
        }
        if dir.join("pyvenv.cfg").exists() || hidden_on_disk(dir) {
            return Some(Why::Tools);
        }
        cur = dir.parent();
    }
    let names = path.components().filter_map(|c| match c {
        Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
        _ => None,
    });
    for (i, name) in names.enumerate() {
        if let Some(why) = folder_rule(&name, i == 0) {
            return Some(why);
        }
    }
    places.iter().find(|(dir, _)| same_or_inside(root_path, dir)).map(|(_, why)| *why)
}

#[cfg(windows)]
fn hidden_on_disk(dir: &Path) -> bool {
    use std::os::windows::fs::MetadataExt;
    const HIDDEN: u32 = 0x2;
    const SYSTEM: u32 = 0x4;
    std::fs::metadata(dir).map(|m| m.file_attributes() & (HIDDEN | SYSTEM) != 0).unwrap_or(false)
}

#[cfg(not(windows))]
fn hidden_on_disk(_dir: &Path) -> bool {
    false // a dot-name, which `folder_rule` already caught
}

/// Some installers record a drive root, the profile or Downloads as their
/// "install location"; taking that at its word would leave out a person's
/// whole home. Only a folder of the program's own counts.
fn plausible_app_dir(dir: &str, home: Option<&Path>) -> bool {
    let path = Path::new(dir.trim());
    if !path.is_absolute() || path.parent().is_none() {
        return false;
    }
    let Some(home) = home else { return true };
    let personal = ["", "Desktop", "Documents", "Downloads", "Pictures", "Videos", "Music", "OneDrive"];
    !personal.iter().any(|name| {
        let folder = if name.is_empty() { home.to_path_buf() } else { home.join(name) };
        same_or_inside(&folder.to_string_lossy(), dir)
    })
}

#[cfg(windows)]
fn known_places() -> Vec<(String, Why)> {
    let mut out: Vec<(String, Why)> = [
        "SystemRoot",
        "windir",
        "ProgramFiles",
        "ProgramFiles(x86)",
        "ProgramW6432",
        "ProgramData",
        "CommonProgramFiles",
        "CommonProgramFiles(x86)",
        "LOCALAPPDATA",
        "APPDATA",
    ]
    .iter()
    .filter_map(|var| std::env::var(var).ok())
    .filter(|v| !v.trim().is_empty())
    .map(|v| (v, Why::Apps))
    .collect();
    if let Some(home) = dirs::home_dir() {
        out.push((home.join("AppData").to_string_lossy().into_owned(), Why::Apps));
    }
    out
}

#[cfg(target_os = "macos")]
fn known_places() -> Vec<(String, Why)> {
    let mut out: Vec<(String, Why)> = ["/System", "/Library", "/Applications", "/usr", "/bin", "/sbin", "/opt", "/private", "/cores"]
        .iter()
        .map(|p| (p.to_string(), Why::Apps))
        .collect();
    if let Some(home) = dirs::home_dir() {
        out.push((home.join("Library").to_string_lossy().into_owned(), Why::Apps));
        out.push((home.join("Applications").to_string_lossy().into_owned(), Why::Apps));
    }
    out
}

#[cfg(all(unix, not(target_os = "macos")))]
fn known_places() -> Vec<(String, Why)> {
    ["/usr", "/bin", "/sbin", "/lib", "/lib32", "/lib64", "/etc", "/var", "/opt", "/snap", "/boot", "/proc", "/sys", "/dev", "/run", "/srv"]
        .iter()
        .map(|p| (p.to_string(), Why::Apps))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folders_by_name() {
        #[cfg(windows)]
        {
            assert_eq!(folder_rule("Windows", true), Some(Why::Apps));
            assert_eq!(folder_rule("ProgramData", true), Some(Why::Apps));
            // Only at the top of a drive: a "windows" folder of screenshots is a person's.
            assert_eq!(folder_rule("Windows", false), None);
        }
        assert_eq!(folder_rule("AppData", false), Some(Why::Apps));
        assert_eq!(folder_rule("Program Files (x86)", false), Some(Why::Apps));
        assert_eq!(folder_rule("steamapps", false), Some(Why::Apps));
        assert_eq!(folder_rule("Final Cut.fcpbundle", false), Some(Why::Apps));
        assert_eq!(folder_rule(".cargo", false), Some(Why::Tools));
        assert_eq!(folder_rule("node_modules", false), Some(Why::Tools));
        assert_eq!(folder_rule("Pictures", false), None);
        assert_eq!(folder_rule("Downloads", true), None);
        assert_eq!(folder_rule(".", false), None);
    }

    #[test]
    fn files_by_kind() {
        assert_eq!(file_rule("msalruntime_x86.dll", 0, "Feedback"), Some(Why::Programs));
        assert_eq!(file_rule("ffmpeg.exe", 0, "bin"), Some(Why::Programs));
        assert_eq!(file_rule("disk.vhdx", 0, "VMs"), Some(Why::Programs));
        // Installers stay a person's files.
        assert_eq!(file_rule("cursor-setup-x64-1.6.2.exe", 0, "Desktop"), None);
        assert_eq!(file_rule("OllamaInstaller.exe", 0, "tools"), None);
        assert_eq!(file_rule("anything.exe", 0, "Downloads"), None);
        assert_eq!(file_rule("thumbs.db", F_HIDDEN, "Pictures"), Some(Why::Tools));
        assert_eq!(file_rule("Keynote.mkv", 0, "Videos"), None);
        assert_eq!(file_rule("README", 0, "x"), None);
    }

    #[test]
    fn paths_nest() {
        let (a, b) = if cfg!(windows) { ("C:\\Program Files\\App\\x.dll", "c:\\program files") } else { ("/usr/lib/x.so", "/usr") };
        assert!(same_or_inside(a, b));
        assert!(same_or_inside(b, b));
        let (c, d) = if cfg!(windows) { ("C:\\Program Files2\\x", "C:\\Program Files") } else { ("/usrx/lib", "/usr") };
        assert!(!same_or_inside(c, d));
        assert!(!same_or_inside(a, ""));
    }

    #[test]
    fn registered_folders_must_be_an_apps_own() {
        let home = if cfg!(windows) { Path::new("C:\\Users\\me") } else { Path::new("/home/me") };
        let good = if cfg!(windows) { "C:\\Games\\Something" } else { "/home/me/apps/something" };
        assert!(plausible_app_dir(good, Some(home)));
        let inside_downloads = if cfg!(windows) { "C:\\Users\\me\\Downloads\\portable-app" } else { "/home/me/Downloads/portable-app" };
        assert!(plausible_app_dir(inside_downloads, Some(home)));
        for bad in if cfg!(windows) {
            ["C:\\", "C:\\Users", "C:\\Users\\me", "C:\\Users\\me\\Downloads", "relative\\path"]
        } else {
            ["/", "/home", "/home/me", "/home/me/Downloads", "relative/path"]
        } {
            assert!(!plausible_app_dir(bad, Some(home)), "{bad} should not be taken as an app's own folder");
        }
    }
}
