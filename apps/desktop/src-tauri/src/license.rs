//! What the window knows about the Pro key, for the Rust side to gate on.
//!
//! The key itself is verified in TypeScript (`packages/licensing`): an Ed25519
//! signature checked against the public key baked into the app. The result is
//! pushed here on start and on every change (`license_set_pro`), and the parts
//! of Rust that act without the window asking - the screenshot hotkey, the
//! tray's items, the social agent server's writes - read it from here instead
//! of verifying again. Until the first push nothing is Pro, so whatever
//! reaches them in the first second after launch is refused rather than let
//! through.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, Manager};

static PRO: AtomicBool = AtomicBool::new(false);

/// Is a Pro key active in this install, as far as the window has said?
pub fn is_pro() -> bool {
    PRO.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn license_set_pro(pro: bool) {
    if PRO.swap(pro, Ordering::Relaxed) != pro {
        log::info!("license: pro = {pro}");
    }
}

/// Without a key, an entry point that lives in Rust answers with the tool's
/// lock screen: the main window comes forward and opens `tool` (a shell tool
/// id - `create` is screeni), where `@ui/ProGate` says what the key buys.
/// Doing nothing would read as a broken shortcut.
pub fn show_lock_screen(app: &AppHandle, tool: &str) {
    log::info!("license: {tool} asked for without a Pro key, showing its lock screen");
    if let Some(window) = app.get_webview_window("main") {
        crate::reveal(&window);
    }
    // The same event, sent the same way, as the pill's "set up dictation" jump
    // (App.tsx listens): only the main window acts on it.
    let _ = app.emit("open-tool", serde_json::json!({ "tool": tool }));
}
