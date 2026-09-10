//! One-time moves of the app's data folders.
//!
//! The app has shipped under three names — suite, then shipshape, now
//! owntools — and the bundle identifier is the name of every data folder the
//! OS gives it. `migrate_identifier` renames those folders to the current
//! identifier the first time a build with the new identifier starts, *before*
//! any plugin opens a file in the new place, so settings, whisper models,
//! recordings, the WebView2 profile (localStorage) and the log all carry over.
//! A rename on the same volume is instant, however large the folder.
//!
//! Every past identifier has to stay in `LEGACY_IDENTIFIERS` forever: a machine
//! that skipped a release still holds its data under whichever name it last ran,
//! and dropping an entry here orphans that install silently.
//!
//! `migrate_layout` does the same for folders inside AppData that were named
//! after a tool's old name (`screeni` → `recordings`).

use std::path::{Path, PathBuf};

/// Newest first: the first folder found wins, so a machine carrying both a
/// stale `app.suite.desktop` and a real `app.shipshape.desktop` keeps the
/// newer one and leaves the stale folder untouched.
pub const LEGACY_IDENTIFIERS: &[&str] = &["app.shipshape.desktop", "app.suite.desktop"];
pub const IDENTIFIER: &str = "app.owntools.desktop";

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
    for base in base_dirs() {
        let new = base.join(IDENTIFIER);
        for old in LEGACY_IDENTIFIERS {
            if *old == IDENTIFIER {
                continue;
            }
            rename_dir(&base.join(old), &new, &mut notes);
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!(
            "owntools-migrate-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        base
    }

    fn migrate_into(base: &Path) -> Vec<String> {
        let mut notes = Vec::new();
        let new = base.join(IDENTIFIER);
        for old in LEGACY_IDENTIFIERS {
            rename_dir(&base.join(old), &new, &mut notes);
        }
        notes
    }

    /// The name we ship under must never also sit in the legacy list, or the
    /// migration would try to rename a folder onto itself.
    #[test]
    fn current_identifier_is_not_listed_as_legacy() {
        assert!(!LEGACY_IDENTIFIERS.contains(&IDENTIFIER));
        assert!(LEGACY_IDENTIFIERS.len() >= 2);
    }

    /// A machine that ran every release holds several old folders. The newest
    /// one has to win, and the staler one must be left where it is rather than
    /// merged in or deleted.
    #[test]
    fn newest_legacy_folder_wins() {
        let base = scratch("newest");
        for id in LEGACY_IDENTIFIERS {
            std::fs::create_dir_all(base.join(id)).unwrap();
            std::fs::write(base.join(id).join("marker.txt"), id.as_bytes()).unwrap();
        }

        migrate_into(&base);

        let moved = std::fs::read_to_string(base.join(IDENTIFIER).join("marker.txt")).unwrap();
        assert_eq!(moved, LEGACY_IDENTIFIERS[0]);
        assert!(base.join(LEGACY_IDENTIFIERS[1]).is_dir());
        let _ = std::fs::remove_dir_all(&base);
    }

    /// Someone who skipped a release only has the oldest folder, and it still
    /// has to be picked up.
    #[test]
    fn oldest_legacy_folder_still_migrates() {
        let base = scratch("oldest");
        let oldest = LEGACY_IDENTIFIERS[LEGACY_IDENTIFIERS.len() - 1];
        std::fs::create_dir_all(base.join(oldest)).unwrap();
        std::fs::write(base.join(oldest).join("marker.txt"), b"old").unwrap();

        migrate_into(&base);

        assert!(base.join(IDENTIFIER).join("marker.txt").is_file());
        assert!(!base.join(oldest).exists());
        let _ = std::fs::remove_dir_all(&base);
    }
}
