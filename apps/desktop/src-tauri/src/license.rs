//! What the window knows about the Pro key, for the Rust side to gate on.
//!
//! The key itself is verified in TypeScript (`packages/licensing`): an Ed25519
//! signature checked against the public key baked into the app. The result is
//! pushed here on start and on every change (`license_set_pro`), and the one
//! part of Rust that cares - the social agent server, whose writes are part of
//! Pro - reads it from here instead of verifying again. Until the first push
//! nothing is Pro, so a write that reaches the server in the first second
//! after launch is refused rather than let through.

use std::sync::atomic::{AtomicBool, Ordering};

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
