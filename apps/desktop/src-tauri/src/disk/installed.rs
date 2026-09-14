//! What the cleanup never moves: the folders of installed programs and the
//! binaries of services and drivers. (The duplicate finder has its own, wider
//! rules in `protect.rs`; these are the ones every Recycle Bin move obeys.)
//!
//! A program's folder in the Recycle Bin is not space freed, it is a broken
//! install — its uninstall entry, services, drivers, shortcuts and file
//! associations stay behind and point at nothing, and a running service holds
//! its files open, so the move fails half-way anyway. The first real cleanup of
//! `C:\Program Files` (2026-09-13) queued Visual Studio (the MSVC every Rust
//! build on that machine links with), MongoDB (its databases live in that
//! folder) and an anti-cheat with two kernel drivers loaded from it. The only
//! thing between them and the Recycle Bin was that owntools does not run as
//! administrator; with the elevated retry that stopped being a safety, so this
//! is one.
//!
//! Matching goes both ways: an item that *is* or *holds* a program's folder,
//! and an item *inside* one (a `node_modules` inside an Electron app, npm inside
//! `Program Files\nodejs`) — part of a program is the program.

use serde::Serialize;
use std::collections::HashSet;

use super::apps::{is_shared_root, AppInfo};
use super::arena::Arena;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRef {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceRef {
    pub name: String,
    pub display: String,
}

/// An item the cleanup leaves where it is, and why.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Protection {
    pub id: u32,
    pub path: String,
    pub apps: Vec<AppRef>,
    pub services: Vec<ServiceRef>,
}

/// A service or driver that runs a binary outside Windows' own folder.
#[derive(Debug, Clone)]
pub struct ServiceInfo {
    pub name: String,
    pub display: String,
    /// Full path of the binary it starts.
    pub binary: String,
}

/// Lower-case, backslashes, no trailing separator: the form two Windows paths
/// are compared in.
pub fn norm(path: &str) -> String {
    let p = path.trim().replace('/', "\\");
    let p = p.strip_prefix(r"\\?\").unwrap_or(&p);
    p.trim_end_matches('\\').to_lowercase()
}

/// `inner` is `outer` or somewhere below it (both already `norm`ed).
pub fn is_within(inner: &str, outer: &str) -> bool {
    if outer.is_empty() {
        return false;
    }
    inner == outer || (inner.len() > outer.len() && inner.starts_with(outer) && inner.as_bytes()[outer.len()] == b'\\')
}

fn parent_dir(path: &str) -> Option<&str> {
    let trimmed = path.trim_end_matches(['\\', '/']);
    let cut = trimmed.rfind(['\\', '/'])?;
    let parent = &trimmed[..cut];
    (!parent.is_empty()).then_some(parent)
}

/// Why `path` must stay, or `None` when nothing installed lives in, above or
/// under it.
pub fn protection(id: u32, path: &str, apps: &[AppInfo], services: &[ServiceInfo]) -> Option<Protection> {
    let item = norm(path);
    if item.is_empty() {
        return None;
    }
    let mut app_refs: Vec<AppRef> = Vec::new();
    for app in apps {
        let Some(location) = app.location.as_deref() else { continue };
        if is_shared_root(location) {
            continue;
        }
        let location = norm(location);
        if (is_within(&location, &item) || is_within(&item, &location)) && !app_refs.iter().any(|r| r.name == app.name) {
            app_refs.push(AppRef { id: app.id.clone(), name: app.name.clone() });
        }
    }
    let mut service_refs: Vec<ServiceRef> = Vec::new();
    for service in services {
        let binary = norm(&service.binary);
        let folder = parent_dir(&service.binary).filter(|f| !is_shared_root(f)).map(norm);
        let hit = is_within(&binary, &item) || folder.as_deref().is_some_and(|f| is_within(&item, f));
        if hit && !service_refs.iter().any(|r| r.name == service.name) {
            service_refs.push(ServiceRef { name: service.name.clone(), display: service.display.clone() });
        }
    }
    if app_refs.is_empty() && service_refs.is_empty() {
        None
    } else {
        Some(Protection { id, path: path.to_string(), apps: app_refs, services: service_refs })
    }
}

/// Nodes quick wins must not suggest or look inside: every installed program's
/// folder and every service binary's folder that is part of the scan.
pub fn installed_node_ids(arena: &Arena, apps: &[AppInfo], services: &[ServiceInfo]) -> HashSet<u32> {
    let mut ids = HashSet::new();
    for location in apps.iter().filter_map(|a| a.location.as_deref()) {
        if is_shared_root(location) {
            continue;
        }
        if let Some(id) = arena.find_path(location) {
            ids.insert(id);
        }
    }
    for service in services {
        if let Some(folder) = parent_dir(&service.binary).filter(|f| !is_shared_root(f)) {
            if let Some(id) = arena.find_path(folder) {
                ids.insert(id);
            }
        }
    }
    // The scan root itself is never "an app": that would hide the whole tree.
    ids.remove(&0);
    ids
}

/// `%ProgramFiles%\X` → `C:\Program Files\X`; unknown variables stay as written.
fn expand_env(raw: &str, env: &dyn Fn(&str) -> Option<String>) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) if end > 0 => match env(&after[..end]) {
                Some(value) => {
                    out.push_str(&value);
                    rest = &after[end + 1..];
                }
                None => {
                    out.push('%');
                    rest = after;
                }
            },
            _ => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// The binary a service's `ImagePath` starts, as an absolute drive path.
/// Handles `"C:\…\x.exe" --args`, the unquoted `C:\Program Files\x.exe --args`,
/// a driver's `\??\C:\…\x.sys` and `%Variables%`; Windows' own relative forms
/// (`system32\drivers\…`, `\SystemRoot\…`) give `None`.
pub fn image_binary(image: &str, env: &dyn Fn(&str) -> Option<String>) -> Option<String> {
    let s = image.trim();
    let s = s.strip_prefix(r"\??\").unwrap_or(s);
    let raw = if let Some(rest) = s.strip_prefix('"') {
        rest.split('"').next()?.trim().to_string()
    } else {
        let lower = s.to_ascii_lowercase();
        let mut end: Option<usize> = None;
        for ext in [".exe", ".sys", ".dll"] {
            let mut from = 0;
            while let Some(pos) = lower[from..].find(ext) {
                let stop = from + pos + ext.len();
                if stop == s.len() || s.as_bytes()[stop].is_ascii_whitespace() {
                    end = Some(end.map_or(stop, |e| e.min(stop)));
                    break;
                }
                from = stop;
            }
        }
        match end {
            Some(stop) => s[..stop].to_string(),
            None => s.split_whitespace().next()?.to_string(),
        }
    };
    let expanded = expand_env(&raw, env);
    let bytes = expanded.as_bytes();
    let absolute = bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && (bytes[2] == b'\\' || bytes[2] == b'/');
    absolute.then_some(expanded)
}

/// A service's `DisplayName` can be a resource reference (`@oem3.inf,%desc%;FACEIT`):
/// keep the fallback text after the last `;`, or nothing.
fn display_name(raw: &str) -> String {
    let raw = raw.trim();
    if raw.starts_with('@') {
        raw.rsplit_once(';').map(|(_, text)| text.trim().to_string()).unwrap_or_default()
    } else {
        raw.to_string()
    }
}

#[cfg(windows)]
pub fn installed_services() -> Vec<ServiceInfo> {
    use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ};
    use winreg::RegKey;

    let Ok(root) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey_with_flags(r"SYSTEM\CurrentControlSet\Services", KEY_READ) else {
        return Vec::new();
    };
    let windows_dir = std::env::var("SystemRoot").or_else(|_| std::env::var("windir")).unwrap_or_else(|_| r"C:\Windows".into());
    let windows_dir = norm(&windows_dir);
    let env = |name: &str| std::env::var(name).ok();
    let mut out = Vec::new();
    for name in root.enum_keys().filter_map(Result::ok) {
        let Ok(key) = root.open_subkey_with_flags(&name, KEY_READ) else { continue };
        let Ok(image) = key.get_value::<String, _>("ImagePath") else { continue };
        let Some(binary) = image_binary(&image, &env) else { continue };
        if is_within(&norm(&binary), &windows_dir) {
            continue;
        }
        let display = key
            .get_value::<String, _>("DisplayName")
            .ok()
            .map(|d| display_name(&d))
            .filter(|d| !d.is_empty())
            .unwrap_or_else(|| name.clone());
        out.push(ServiceInfo { name, display, binary });
    }
    out
}

#[cfg(not(windows))]
pub fn installed_services() -> Vec<ServiceInfo> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app(name: &str, location: Option<&str>) -> AppInfo {
        AppInfo {
            id: format!("hklm64:{name}"),
            name: name.into(),
            version: String::new(),
            publisher: String::new(),
            installed: None,
            location: location.map(Into::into),
            estimated_bytes: 0,
            scanned_bytes: None,
            node_id: None,
            uninstall: None,
            scope: "machine",
        }
    }

    fn service(name: &str, binary: &str) -> ServiceInfo {
        ServiceInfo { name: name.into(), display: format!("{name} service"), binary: binary.into() }
    }

    /// The machine this was written on, as its registry described it.
    fn machine() -> (Vec<AppInfo>, Vec<ServiceInfo>) {
        (
            vec![
                app("PyCharm 2026.1", Some(r"C:\Program Files\JetBrains\PyCharm 2026.1")),
                app("Visual Studio Community 2026", Some(r"C:\Program Files\Microsoft Visual Studio\18\Community")),
                app("FACEIT Anti-Cheat", Some(r"C:\Program Files\FACEIT AC")),
                app("OBS Studio", Some(r"C:\Program Files\obs-studio")),
                app("MongoDB 8.3.4 2008R2Plus SSL (64 bit)", None),
                app("Broken installer", Some(r"C:\Program Files\")),
            ],
            vec![
                service("MongoDB", r"C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe"),
                service("FACEIT", r"C:\Program Files\FACEIT AC\FACEIT_AC.sys"),
            ],
        )
    }

    fn names(p: &Protection) -> Vec<String> {
        p.apps.iter().map(|a| a.name.clone()).chain(p.services.iter().map(|s| s.name.clone())).collect()
    }

    #[test]
    fn a_folder_that_holds_a_program_is_protected() {
        let (apps, services) = machine();
        let jetbrains = protection(1, r"C:\Program Files\JetBrains", &apps, &services).expect("JetBrains holds PyCharm");
        assert_eq!(names(&jetbrains), ["PyCharm 2026.1"]);
        let vs = protection(2, r"c:\program files\microsoft visual studio\", &apps, &services).expect("case and trailing slash");
        assert_eq!(names(&vs), ["Visual Studio Community 2026"]);
    }

    #[test]
    fn a_service_binary_protects_a_program_the_registry_does_not_locate() {
        let (apps, services) = machine();
        // MongoDB's MSI records no InstallLocation; its service gives it away.
        let mongo = protection(3, r"C:\Program Files\MongoDB", &apps, &services).expect("the service runs from here");
        assert!(mongo.apps.is_empty());
        assert_eq!(names(&mongo), ["MongoDB"]);
        // The driver and the uninstall entry name the same folder: both are reported.
        let faceit = protection(4, r"C:\Program Files\FACEIT AC", &apps, &services).unwrap();
        assert_eq!(names(&faceit), ["FACEIT Anti-Cheat", "FACEIT"]);
    }

    #[test]
    fn part_of_a_program_is_the_program() {
        let (apps, services) = machine();
        assert!(protection(5, r"C:\Program Files\obs-studio\bin\64bit\obs64.exe", &apps, &services).is_some());
        assert!(protection(6, r"C:\Program Files\MongoDB\Server\8.3\bin\mongod.pdb", &apps, &services).is_some());
    }

    #[test]
    fn neighbours_and_shared_roots_are_not_programs() {
        let (apps, services) = machine();
        // A sibling whose name only starts the same way.
        assert!(protection(7, r"C:\Program Files\obs-studio-old", &apps, &services).is_none());
        assert!(protection(8, r"C:\Program Files\Mongo", &apps, &services).is_none());
        // A service's data folder beside its bin folder is not the binary's folder.
        assert!(protection(9, r"C:\Program Files\MongoDB\Server\8.3\data", &apps, &services).is_none());
        // An installer that recorded `Program Files` itself does not make every
        // folder under it "part of" that program.
        assert!(protection(10, r"C:\Program Files\Some leftover", &apps, &services).is_none());
        assert!(protection(11, r"C:\Users\me\Downloads", &apps, &services).is_none());
    }

    #[test]
    fn image_paths_in_every_shape_the_registry_uses() {
        let env = |name: &str| match name {
            "ProgramFiles" => Some(r"C:\Program Files".to_string()),
            _ => None,
        };
        assert_eq!(
            image_binary(r#""C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe" --config "C:\Program Files\MongoDB\Server\8.3\bin\mongod.cfg" --service"#, &env).as_deref(),
            Some(r"C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe")
        );
        assert_eq!(image_binary(r"\??\C:\Program Files\FACEIT AC\FACEIT_AC.sys", &env).as_deref(), Some(r"C:\Program Files\FACEIT AC\FACEIT_AC.sys"));
        assert_eq!(image_binary(r"C:\Program Files\Some Vendor\agent.exe -k run", &env).as_deref(), Some(r"C:\Program Files\Some Vendor\agent.exe"));
        assert_eq!(image_binary(r"%ProgramFiles%\Vendor\svc.exe", &env).as_deref(), Some(r"C:\Program Files\Vendor\svc.exe"));
        assert_eq!(image_binary(r"%SystemRoot%\system32\svchost.exe -k netsvcs -p", &env), None);
        assert_eq!(image_binary(r"system32\drivers\ACPI.sys", &env), None);
        assert_eq!(image_binary(r"\SystemRoot\System32\drivers\disk.sys", &env), None);
    }

    #[test]
    fn display_names_that_point_at_resources() {
        assert_eq!(display_name("@oem12.inf,%svcdesc%;FACEIT Anti-Cheat"), "FACEIT Anti-Cheat");
        assert_eq!(display_name("@%SystemRoot%\\system32\\wuaueng.dll,-105"), "");
        assert_eq!(display_name("MongoDB Server (MongoDB)"), "MongoDB Server (MongoDB)");
    }

    /// The seven folders from the cleanup that started this (2026-09-13), read
    /// against this machine's real registry: each must come back protected, and
    /// say by what. Skips a folder that is not there.
    /// `cargo test -- --ignored --nocapture installed_programs_on_this_machine`
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn installed_programs_on_this_machine() {
        let apps = crate::disk::apps::installed_apps();
        let services = installed_services();
        let mut checked = 0;
        for folder in [
            r"C:\Program Files\JetBrains",
            r"C:\Program Files\Microsoft Visual Studio",
            r"C:\Program Files\MongoDB",
            r"C:\Program Files\CodeBlocks",
            r"C:\Program Files\obs-studio",
            r"C:\Program Files\FACEIT AC",
            r"C:\Program Files (x86)\Microsoft Visual Studio",
        ] {
            if !std::path::Path::new(folder).exists() {
                continue;
            }
            checked += 1;
            let found = protection(0, folder, &apps, &services);
            println!("{folder}: {:?}", found.as_ref().map(names));
            assert!(found.is_some(), "{folder} was not recognised as an installed program");
        }
        println!("{checked} folders checked, {} apps, {} services outside Windows", apps.len(), services.len());
        // A folder of a person's own stays movable.
        assert!(protection(0, r"C:\Users\Public\Documents", &apps, &services).is_none());
    }

    #[test]
    fn paths_compare_on_component_boundaries() {
        assert!(is_within(&norm(r"C:\A\B"), &norm(r"c:\a")));
        assert!(is_within(&norm(r"C:\A"), &norm(r"C:\A\")));
        assert!(!is_within(&norm(r"C:\AB"), &norm(r"C:\A")));
        assert!(!is_within(&norm(r"C:\A"), ""));
        assert!(is_within(&norm(r"\\?\C:\A\B"), &norm(r"C:\A")));
    }
}
