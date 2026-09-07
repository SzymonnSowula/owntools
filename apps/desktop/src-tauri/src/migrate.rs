//! One-time moves of the app's data folders.
//!
//! The app was called "suite" before it was shipshape, and its bundle
//! identifier — the name of every data folder the OS gives it — stayed
//! `app.suite.desktop` long after the rename. `migrate_identifier` renames
//! those folders to the current identifier the first time a build with the
//! new identifier starts, *before* any plugin opens a file in the new place,
//! so settings, whisper models, recordings, the WebView2 profile (localStorage)
//! and the log all carry over. A rename on the same volume is instant, however
//! large the folder.
//!
//! `migrate_layout` does the same for folders inside AppData that were named
//! after a tool's old name (`screeni` → `recordings`).

use std::path::{Path, PathBuf};

pub const OLD_IDENTIFIER: &str = "app.suite.desktop";
pub const IDENTIFIER: &str = "app.shipshape.desktop";

/// Every base folder the OS resolves per identifier. Roaming + Local on
/// Windows, Application Support / Caches / Logs on macOS, the XDG trio on Linux.
fn base_dirs() -> Vec<PathBuf> {
    let mut bases: Vec<PathBuf> = Vec::new();
    for base in [
        dirs::data_dir(),
        dirs::data_local_dir(),
        dirs::config_dir(),
        dirs::cache_dir(),
        #[cfg(target_os = "macos")]
        dirs::home_dir().map(|h| h.join("Library").join("Logs")),
    ]
    .into_iter()
    .flatten()
    {
        if !bases.contains(&base) {
            bases.push(base);
        }
    }
    bases
}

fn rename_dir(old: &Path, new: &Path, notes: &mut Vec<String>) {
    if !old.is_dir() {
        return;
    }
    if new.exists() {
        notes.push(format!(
            "data migration: both {} and {} exist; leaving the old folder alone",
            old.display(),
            new.display()
        ));
        return;
    }
    match std::fs::rename(old, new) {
        Ok(()) => notes.push(format!(
            "data migration: moved {} -> {}",
            old.display(),
            new.display()
        )),
        Err(e) => notes.push(format!(
            "data migration FAILED for {} -> {}: {e}",
            old.display(),
            new.display()
        )),
    }
}

/// Runs before the Tauri builder; returns what it did so the caller can log it
/// once the log plugin exists.
pub fn migrate_identifier() -> Vec<String> {
    let mut notes = Vec::new();
    if OLD_IDENTIFIER == IDENTIFIER {
        return notes;
    }
    for base in base_dirs() {
        rename_dir(&base.join(OLD_IDENTIFIER), &base.join(IDENTIFIER), &mut notes);
    }
    notes
}

/// Folders inside AppData renamed after the tools they belong to were.
const LAYOUT: &[(&str, &str)] = &[("screeni", "recordings")];

pub fn migrate_layout(app_data: &Path) -> Vec<String> {
    let mut notes = Vec::new();
    for (old, new) in LAYOUT {
        rename_dir(&app_data.join(old), &app_data.join(new), &mut notes);
    }
    notes
}
