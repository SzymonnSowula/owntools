//! One-time import of data from the standalone focus and screeni apps.
//! Copies only — the legacy directories are never modified or deleted.

use std::fs;
use std::path::{Path, PathBuf};
use serde::Serialize;
use tauri::{AppHandle, Manager};

const LEGACY_FOCUS_ID: &str = "com.focus.app";
const LEGACY_SCREENI_ID: &str = "app.screeni.desktop";

#[derive(Debug, Clone, Serialize, Default)]
pub struct ImportReport {
    pub focus_store: bool,
    pub screeni_projects: usize,
}

fn legacy_dir(app: &AppHandle, identifier: &str) -> Option<PathBuf> {
    // AppData dir is <base>/<identifier>; swap the leaf to reach the old apps.
    let current = app.path().app_data_dir().ok()?;
    Some(current.parent()?.join(identifier))
}

fn copy_dir_recursive(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else if !target.exists() {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// Copies focus.json and the screeni projects tree into the owntools AppData folder.
/// Idempotent: existing destination files are never overwritten.
#[tauri::command]
pub fn import_legacy_data(app: AppHandle) -> Result<ImportReport, String> {
    let dest_root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&dest_root).map_err(|e| e.to_string())?;

    let mut report = ImportReport::default();

    if let Some(focus_dir) = legacy_dir(&app, LEGACY_FOCUS_ID) {
        let src = focus_dir.join("focus.json");
        let dst = dest_root.join("focus.json");
        if src.is_file() && !dst.exists() {
            fs::copy(&src, &dst).map_err(|e| e.to_string())?;
            report.focus_store = true;
        }
    }

    if let Some(screeni_dir) = legacy_dir(&app, LEGACY_SCREENI_ID) {
        let src = screeni_dir.join("screeni");
        let dst = dest_root.join("screeni");
        if src.is_dir() {
            copy_dir_recursive(&src, &dst).map_err(|e| e.to_string())?;
            let projects = dst.join("projects");
            if projects.is_dir() {
                report.screeni_projects = fs::read_dir(&projects)
                    .map(|it| it.filter_map(|e| e.ok()).filter(|e| e.path().is_dir()).count())
                    .unwrap_or(0);
            }
        }
    }

    Ok(report)
}
