//! Global shortcuts. The dictation hotkey is registered at startup; Escape is
//! only claimed while the pill is listening, because the pill window never
//! takes focus and therefore never sees keyboard events of its own.

use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// The one hotkey the app owns system-wide. UI copy reads it through the
/// `dictation_hotkey` command (and `@core/hotkeys` for the static label)
/// instead of repeating the string.
pub const DICTATION_HOTKEY: &str = "ctrl+shift+space";
const CANCEL_HOTKEY: &str = "escape";
/// Ctrl+Shift+4 — the macOS screenshot chord, moved to Ctrl. Handled in Rust
/// end to end (`capture_tool::on_hotkey`), so the overlay is up before any
/// JavaScript wakes; the label lives in `@core/hotkeys` (`CAPTURE_HOTKEY_LABEL`).
pub const CAPTURE_HOTKEY: &str = "ctrl+shift+4";

pub fn register_dictation_hotkey(app: &AppHandle) {
    let result = app
        .global_shortcut()
        .on_shortcut(DICTATION_HOTKEY, |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                crate::dictation::toggle(app);
            }
        });
    match result {
        Ok(()) => log::info!("dictation hotkey {DICTATION_HOTKEY} registered"),
        Err(e) => log::error!(
            "could not register the dictation hotkey {DICTATION_HOTKEY} (another app owns it?): {e}"
        ),
    }
}

pub fn register_capture_hotkey(app: &AppHandle) {
    let result = app
        .global_shortcut()
        .on_shortcut(CAPTURE_HOTKEY, |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                crate::capture_tool::on_hotkey(app);
            }
        });
    match result {
        Ok(()) => log::info!("capture hotkey {CAPTURE_HOTKEY} registered"),
        Err(e) => log::error!(
            "could not register the capture hotkey {CAPTURE_HOTKEY} (another app owns it?): {e}"
        ),
    }
}

/// Machine-readable hotkey, for UI copy that must match the binding.
#[tauri::command]
pub fn dictation_hotkey() -> String {
    DICTATION_HOTKEY.to_string()
}

/// False when another application grabbed the combination first; the dictate
/// tool shows a warning instead of a hotkey that silently does nothing.
#[tauri::command]
pub fn dictation_hotkey_registered(app: AppHandle) -> bool {
    app.global_shortcut().is_registered(DICTATION_HOTKEY)
}

/// Claims/releases Escape system-wide for the duration of a take.
#[tauri::command]
pub fn dictation_cancel_hotkey(app: AppHandle, enable: bool) -> Result<(), String> {
    let shortcuts = app.global_shortcut();
    if enable {
        if shortcuts.is_registered(CANCEL_HOTKEY) {
            return Ok(());
        }
        shortcuts
            .on_shortcut(CANCEL_HOTKEY, |app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    let _ = app.emit_to("dictation", "dictation-cancel", ());
                }
            })
            .map_err(|e| e.to_string())
    } else {
        if !shortcuts.is_registered(CANCEL_HOTKEY) {
            return Ok(());
        }
        shortcuts.unregister(CANCEL_HOTKEY).map_err(|e| e.to_string())
    }
}
