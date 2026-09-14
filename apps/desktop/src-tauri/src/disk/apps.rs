//! Installed applications. Windows keeps them in the registry's Uninstall
//! keys (64-bit, 32-bit and per-user views); the size there is whatever the
//! installer guessed, so when the install folder is inside the current scan
//! we measure it instead. Other platforms return nothing yet — macOS will
//! list `/Applications` from the arena.
//!
//! Two things the registry does not hand over cleanly. Many installers (OBS,
//! Code::Blocks, most NSIS setups) leave `InstallLocation` empty, so the folder
//! is read off where the uninstaller sits. And the uninstaller is always the
//! interactive `UninstallString` — the one Windows Settings runs — never
//! `QuietUninstallString`, which Inno Setup fills with `/SILENT`: preferring it
//! meant "Open uninstaller" could remove a program without a word, under a
//! dialog promising that nothing happens until you confirm inside the uninstaller.

use serde::Serialize;

use super::arena::Arena;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub publisher: String,
    /// YYYY-MM-DD when the installer recorded it.
    pub installed: Option<String>,
    pub location: Option<String>,
    pub estimated_bytes: u64,
    /// Measured from the scan when the location is inside it.
    pub scanned_bytes: Option<u64>,
    pub node_id: Option<u32>,
    pub uninstall: Option<String>,
    /// machine · user
    pub scope: &'static str,
}

#[cfg(windows)]
pub fn installed_apps() -> Vec<AppInfo> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY};
    use winreg::RegKey;

    const PATH: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";
    let views: [(winreg::HKEY, u32, &str, &'static str); 3] = [
        (HKEY_LOCAL_MACHINE, KEY_WOW64_64KEY, "hklm64", "machine"),
        (HKEY_LOCAL_MACHINE, KEY_WOW64_32KEY, "hklm32", "machine"),
        (HKEY_CURRENT_USER, 0, "hkcu", "user"),
    ];
    let mut out: Vec<AppInfo> = Vec::new();
    for (hive, view, tag, scope) in views {
        let root = match RegKey::predef(hive).open_subkey_with_flags(PATH, KEY_READ | view) {
            Ok(k) => k,
            Err(_) => continue,
        };
        let names: Vec<String> = root.enum_keys().filter_map(Result::ok).collect();
        for key_name in names {
            let Ok(key) = root.open_subkey_with_flags(&key_name, KEY_READ | view) else { continue };
            let Ok(name) = key.get_value::<String, _>("DisplayName") else { continue };
            let name = name.trim().to_string();
            if name.is_empty() {
                continue;
            }
            if key.get_value::<u32, _>("SystemComponent").map(|v| v == 1).unwrap_or(false) {
                continue;
            }
            if key.get_value::<String, _>("ParentKeyName").map(|v| !v.is_empty()).unwrap_or(false) {
                continue;
            }
            if let Ok(rt) = key.get_value::<String, _>("ReleaseType") {
                if matches!(rt.as_str(), "Update" | "Hotfix" | "Security Update" | "Service Pack") {
                    continue;
                }
            }
            if name.starts_with("KB") && name[2..].chars().all(|c| c.is_ascii_digit()) {
                continue;
            }
            let version = key.get_value::<String, _>("DisplayVersion").unwrap_or_default();
            let publisher = key.get_value::<String, _>("Publisher").unwrap_or_default();
            let installed = key
                .get_value::<String, _>("InstallDate")
                .ok()
                .filter(|d| d.len() == 8 && d.chars().all(|c| c.is_ascii_digit()))
                .map(|d| format!("{}-{}-{}", &d[..4], &d[4..6], &d[6..8]));
            let estimated_bytes = key.get_value::<u32, _>("EstimatedSize").map(|kb| kb as u64 * 1024).unwrap_or(0);
            let uninstall = key.get_value::<String, _>("UninstallString").ok().filter(|s| !s.trim().is_empty());
            let location = key
                .get_value::<String, _>("InstallLocation")
                .ok()
                .map(|l| l.trim().trim_matches('"').trim_end_matches(['\\', '/']).to_string())
                .filter(|l| !l.is_empty())
                .or_else(|| uninstall.as_deref().and_then(|u| location_from_uninstaller(u, &|p| std::path::Path::new(p).is_file())));
            out.push(AppInfo {
                id: format!("{tag}:{key_name}"),
                name,
                version,
                publisher,
                installed,
                location,
                estimated_bytes,
                scanned_bytes: None,
                node_id: None,
                uninstall,
                scope,
            });
        }
    }
    // The 32-bit view can repeat 64-bit entries; keep the one that knows its folder.
    let mut seen: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut deduped: Vec<AppInfo> = Vec::new();
    for app in out {
        let key = format!("{}|{}", app.name.to_lowercase(), app.version.to_lowercase());
        match seen.get(&key) {
            Some(&i) => {
                let keep_new = deduped[i].location.is_none() && app.location.is_some();
                if keep_new {
                    deduped[i] = app;
                }
            }
            None => {
                seen.insert(key, deduped.len());
                deduped.push(app);
            }
        }
    }
    deduped.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    deduped
}

#[cfg(not(windows))]
pub fn installed_apps() -> Vec<AppInfo> {
    Vec::new()
}

/// Fills `scanned_bytes` / `node_id` for apps whose folder is inside the scan.
pub fn attach_sizes(apps: &mut [AppInfo], arena: Option<&Arena>) {
    for app in apps.iter_mut() {
        app.scanned_bytes = None;
        app.node_id = None;
        let (Some(arena), Some(location)) = (arena, app.location.as_deref()) else { continue };
        if let Some(id) = arena.find_path(location) {
            if let Some(node) = arena.get(id) {
                if node.is_dir() {
                    app.scanned_bytes = Some(node.size);
                    app.node_id = Some(id);
                }
            }
        }
    }
}

/// Folders that hold many programs rather than one: a drive or share root,
/// `Program Files`, `ProgramData`, a profile, `AppData\Local\Programs`… An
/// installer that records one of these as its home (they exist) must not make
/// the whole folder "an installed program".
pub fn is_shared_root(path: &str) -> bool {
    let trimmed = path.trim_start();
    let unc = (trimmed.starts_with(r"\\") || trimmed.starts_with("//")) && !trimmed.starts_with(r"\\?\");
    let lower = path.trim().replace('/', "\\").to_lowercase();
    let parts: Vec<&str> = lower.split('\\').filter(|c| !c.is_empty() && *c != "?").collect();
    match parts.as_slice() {
        [] | [_] => true,
        [_, _] if unc => true,
        [_, "users", _] => true,
        _ => matches!(
            parts.last().copied(),
            Some(
                "program files"
                    | "program files (x86)"
                    | "programdata"
                    | "common files"
                    | "users"
                    | "windows"
                    | "system32"
                    | "syswow64"
                    | "appdata"
                    | "local"
                    | "roaming"
                    | "locallow"
                    | "programs"
            )
        ),
    }
}

/// The executable a registry command line runs, when it names one by path.
/// Quoted (`"C:\Program Files\X\uninstall.exe" /S`) is easy. Unquoted — which
/// is how Code::Blocks records `C:\Program Files\CodeBlocks\uninstall.exe` — is
/// cut at the first `.exe` that ends a word and `exists`, or at the first such
/// `.exe` when none does.
pub fn command_exe(command: &str, exists: &dyn Fn(&str) -> bool) -> Option<String> {
    let s = command.trim();
    if let Some(rest) = s.strip_prefix('"') {
        let exe = rest.split('"').next()?.trim();
        return (!exe.is_empty()).then(|| exe.to_string());
    }
    let lower = s.to_ascii_lowercase();
    let mut first: Option<String> = None;
    let mut from = 0;
    while let Some(pos) = lower[from..].find(".exe") {
        let end = from + pos + 4;
        if end == s.len() || s.as_bytes()[end].is_ascii_whitespace() {
            let candidate = &s[..end];
            if exists(candidate) {
                return Some(candidate.to_string());
            }
            first.get_or_insert_with(|| candidate.to_string());
        }
        from = end;
    }
    first
}

/// `run_uninstall` hands the command to `cmd /C start`, which cannot run an
/// unquoted path with a space in it: `C:\Program Files\CodeBlocks\uninstall.exe`
/// turns into an attempt to start `C:\Program`. Windows Settings copes (it tries
/// each space), so the executable gets the quotes the installer forgot.
pub fn quote_command(command: &str, exists: &dyn Fn(&str) -> bool) -> String {
    let s = command.trim();
    if s.starts_with('"') {
        return s.to_string();
    }
    match command_exe(s, exists) {
        Some(exe) if exe.contains(' ') => format!("\"{exe}\"{}", &s[exe.len()..]),
        _ => s.to_string(),
    }
}

/// Where an app lives, judged by where its uninstaller sits, for the installers
/// that leave `InstallLocation` empty. Refuses what is not the app's own folder:
/// an MSI (`MsiExec.exe /X{…}`), Windows' own tools, installer caches
/// (`Package Cache`, `InstallShield Installation Information`, `{GUID}`
/// folders, `Temp`) and shared roots.
pub fn location_from_uninstaller(command: &str, exists: &dyn Fn(&str) -> bool) -> Option<String> {
    let exe = command_exe(command, exists)?.replace('/', "\\");
    let bytes = exe.as_bytes();
    let absolute = (bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'\\') || exe.starts_with(r"\\");
    if !absolute {
        return None;
    }
    let mut dir = exe[..exe.rfind('\\')?].to_string();
    let last = dir.rsplit('\\').next().unwrap_or("").to_ascii_lowercase();
    if matches!(last.as_str(), "bin" | "uninstall" | "uninstaller" | "uninst" | "_uninst") {
        dir.truncate(dir.rfind('\\')?);
    }
    let lower = dir.to_lowercase();
    let parts: Vec<&str> = lower.split('\\').collect();
    if parts.get(1) == Some(&"windows") {
        return None;
    }
    let cache = |part: &&str| {
        matches!(*part, "package cache" | "installshield installation information" | "temp")
            || (part.len() == 38 && part.starts_with('{') && part.ends_with('}'))
    };
    if parts.iter().any(cache) || is_shared_root(&dir) {
        return None;
    }
    Some(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nothing_exists(_: &str) -> bool {
        false
    }

    #[test]
    fn the_executable_in_a_command_line() {
        assert_eq!(
            command_exe(r#""C:\Program Files (x86)\Microsoft Visual Studio\Installer\setup.exe" uninstall --installPath "C:\X""#, &nothing_exists).as_deref(),
            Some(r"C:\Program Files (x86)\Microsoft Visual Studio\Installer\setup.exe")
        );
        assert_eq!(command_exe(r"C:\Program Files\CodeBlocks\uninstall.exe", &nothing_exists).as_deref(), Some(r"C:\Program Files\CodeBlocks\uninstall.exe"));
        assert_eq!(command_exe(r"C:\Program Files\App\uninst.exe /S /D=C:\Program Files\App", &nothing_exists).as_deref(), Some(r"C:\Program Files\App\uninst.exe"));
        assert_eq!(command_exe("MsiExec.exe /X{9F8EBC43-FEA5-43FD-8DAF-FBB503D2CBC8}", &nothing_exists).as_deref(), Some("MsiExec.exe"));
        // `.exe` inside a folder name: the candidate that exists wins.
        let real = |p: &str| p == r"C:\Tools\my.exe files\uninstall.exe";
        assert_eq!(command_exe(r"C:\Tools\my.exe files\uninstall.exe /quiet", &real).as_deref(), Some(r"C:\Tools\my.exe files\uninstall.exe"));
        assert_eq!(command_exe("   ", &nothing_exists), None);
    }

    #[test]
    fn unquoted_paths_with_spaces_get_quotes() {
        assert_eq!(quote_command(r"C:\Program Files\CodeBlocks\uninstall.exe", &nothing_exists), r#""C:\Program Files\CodeBlocks\uninstall.exe""#);
        assert_eq!(quote_command(r"C:\Program Files\App\uninst.exe /S", &nothing_exists), r#""C:\Program Files\App\uninst.exe" /S"#);
        assert_eq!(quote_command(r#""C:\Program Files\FACEIT AC\unins000.exe""#, &nothing_exists), r#""C:\Program Files\FACEIT AC\unins000.exe""#);
        assert_eq!(quote_command("MsiExec.exe /I{9F8EBC43-FEA5-43FD-8DAF-FBB503D2CBC8}", &nothing_exists), "MsiExec.exe /I{9F8EBC43-FEA5-43FD-8DAF-FBB503D2CBC8}");
    }

    #[test]
    fn a_location_read_off_the_uninstaller() {
        let from = |c: &str| location_from_uninstaller(c, &nothing_exists);
        assert_eq!(from(r"C:\Program Files\CodeBlocks\uninstall.exe").as_deref(), Some(r"C:\Program Files\CodeBlocks"));
        assert_eq!(from(r#""C:\Program Files\obs-studio\uninstall.exe""#).as_deref(), Some(r"C:\Program Files\obs-studio"));
        assert_eq!(from(r#""C:\Program Files\JetBrains\PyCharm 2026.1\bin\Uninstall.exe""#).as_deref(), Some(r"C:\Program Files\JetBrains\PyCharm 2026.1"));
        assert_eq!(from(r#""C:\Users\me\AppData\Local\MongoDBCompass\Update.exe" --uninstall"#).as_deref(), Some(r"C:\Users\me\AppData\Local\MongoDBCompass"));
        // Not the app's own folder.
        assert_eq!(from("MsiExec.exe /X{9F8EBC43-FEA5-43FD-8DAF-FBB503D2CBC8}"), None);
        assert_eq!(from(r"C:\Windows\SysWOW64\rundll32.exe shell32.dll,Control_RunDLL"), None);
        assert_eq!(from(r#""C:\ProgramData\Package Cache\{0b5169e3-39da-4313-808e-1f9c0407f3bf}\VC_redist.x64.exe" /uninstall"#), None);
        assert_eq!(from(r#""C:\Program Files (x86)\InstallShield Installation Information\{ABCDEF01-2345-6789-ABCD-EF0123456789}\setup.exe" -removeonly"#), None);
        assert_eq!(from(r#""C:\ProgramData\{ABCDEF01-2345-6789-ABCD-EF0123456789}\setup.exe""#), None);
        assert_eq!(from(r"C:\Program Files\uninstall_everything.exe"), None);
        assert_eq!(from(r#""C:\Users\me\AppData\Local\Programs\uninstall.exe""#), None);
    }

    #[test]
    fn shared_roots() {
        for root in [r"C:\", "C:", r"C:\Program Files\", r"C:\Program Files (x86)", r"C:\ProgramData", r"C:\Users\me", r"C:\Users\me\AppData\Local", r"C:\Users\me\AppData\Local\Programs", r"\\server\share", r"C:\Program Files\Common Files"] {
            assert!(is_shared_root(root), "{root} holds many programs");
        }
        for app in [r"C:\Program Files\obs-studio", r"C:\Users\me\AppData\Local\Programs\Obsidian", r"D:\Games\Steam", r"\\server\share\tools"] {
            assert!(!is_shared_root(app), "{app} is one program");
        }
    }
}
