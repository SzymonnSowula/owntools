//! Installed applications. Windows keeps them in the registry's Uninstall
//! keys (64-bit, 32-bit and per-user views); the size there is whatever the
//! installer guessed, so when the install folder is inside the current scan
//! we measure it instead. Other platforms return nothing yet — macOS will
//! list `/Applications` from the arena.

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
            let location = key
                .get_value::<String, _>("InstallLocation")
                .ok()
                .map(|l| l.trim().trim_matches('"').trim_end_matches(['\\', '/']).to_string())
                .filter(|l| !l.is_empty());
            let estimated_bytes = key.get_value::<u32, _>("EstimatedSize").map(|kb| kb as u64 * 1024).unwrap_or(0);
            let uninstall = key
                .get_value::<String, _>("QuietUninstallString")
                .or_else(|_| key.get_value::<String, _>("UninstallString"))
                .ok()
                .filter(|s| !s.trim().is_empty());
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
