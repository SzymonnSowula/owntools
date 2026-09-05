/**
 * Keyboard shortcuts shared between UI copy and the native side.
 *
 * The actual global binding is registered in Rust (`src-tauri/src/hotkeys.rs`,
 * `DICTATION_HOTKEY`). Keep the label here in sync with it; the app can also
 * ask the backend via the `dictation_hotkey` command. Ctrl on Windows/Linux,
 * the same combination is Cmd-free on macOS for now.
 */
export const DICTATION_HOTKEY_LABEL = "Ctrl+Shift+Space";

/** How the hotkey behaves: one press starts a take, the next press ends it. */
export const DICTATION_HOTKEY_HINT = `press ${DICTATION_HOTKEY_LABEL} to start, press again to stop`;
