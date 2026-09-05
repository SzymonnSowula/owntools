//! Native-side preferences the frontend pushes on startup and on change. They
//! are mirrored here because window events are decided in Rust.

use std::sync::atomic::{AtomicBool, Ordering};

/// Closing the main window hides it to the tray instead of quitting.
static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(true);

pub fn close_to_tray() -> bool {
    CLOSE_TO_TRAY.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn set_close_to_tray(enabled: bool) {
    CLOSE_TO_TRAY.store(enabled, Ordering::Relaxed);
}
