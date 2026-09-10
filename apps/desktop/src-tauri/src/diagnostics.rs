//! What a user can hand us when something breaks: the log tail plus a few
//! facts about the machine. Nothing here leaves the device on its own.

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Log file stem; tauri-plugin-log appends `.log`.
pub const LOG_FILE_STEM: &str = "owntools";

fn log_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_log_dir()
        .map_err(|e| e.to_string())?
        .join(format!("{LOG_FILE_STEM}.log")))
}

/// Last `lines` lines of the app log (default 200, max 2000).
#[tauri::command]
pub fn read_log_tail(app: AppHandle, lines: Option<usize>) -> Result<String, String> {
    let path = log_path(&app)?;
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(String::new()),
        Err(e) => return Err(e.to_string()),
    };
    let keep = lines.unwrap_or(200).clamp(1, 2000);
    let all: Vec<&str> = text.lines().collect();
    let start = all.len().saturating_sub(keep);
    Ok(all[start..].join("\n"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    pub version: String,
    pub os: String,
    pub arch: String,
    pub webview: String,
    pub log_path: String,
    pub app_data_dir: String,
    pub hotkey: String,
    pub hotkey_registered: bool,
    pub whisper: crate::dictation::DictationStatus,
}

#[tauri::command]
pub fn diagnostics_info(app: AppHandle) -> Result<Diagnostics, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    Ok(Diagnostics {
        version: app.package_info().version.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        webview: tauri::webview_version().unwrap_or_else(|_| "unknown".into()),
        log_path: log_path(&app)?.to_string_lossy().to_string(),
        app_data_dir,
        hotkey: crate::hotkeys::DICTATION_HOTKEY.to_string(),
        hotkey_registered: crate::hotkeys::dictation_hotkey_registered(app.clone()),
        whisper: crate::dictation::dictation_status(app.clone())?,
    })
}
