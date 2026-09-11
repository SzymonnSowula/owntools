/**
 * Keyboard shortcuts shared between UI copy and the native side.
 *
 * The actual global bindings are registered in Rust (`src-tauri/src/hotkeys.rs`,
 * `DICTATION_HOTKEY` / `CAPTURE_HOTKEY`). Keep the labels here in sync with
 * them; the app can also ask the backend via the `dictation_hotkey` /
 * `capture_hotkey` commands.
 *
 * The binding strings themselves are the same on both platforms — Tauri's
 * global shortcut parser maps `ctrl` to Control on macOS too, and
 * Control+Shift+Space / Control+Shift+4 are free there, while Command+Shift+
 * Space is Apple's own character picker and Command+Shift+4 is Apple's own
 * screenshot chord. Only the way a shortcut is *written* changes, so the
 * labels below are resolved once when the module loads (in a webview, where
 * `navigator` exists) rather than being frozen at build time.
 */
import { isMac } from "./env";

const WINDOWS_LABEL = "Ctrl+Shift+Space";
const MAC_LABEL = "⌃⇧Space";

const CAPTURE_WINDOWS_LABEL = "Ctrl+Shift+4";
const CAPTURE_MAC_LABEL = "⌃⇧4";

/** How the dictation hotkey is written for the platform the app is on. */
export function dictationHotkeyLabel(): string {
  return isMac() ? MAC_LABEL : WINDOWS_LABEL;
}

/** How the hotkey behaves: one press starts a take, the next press ends it. */
export function dictationHotkeyHint(): string {
  return `press ${dictationHotkeyLabel()} to start, press again to stop`;
}

/**
 * How the capture hotkey is written for the platform the app is on. One
 * press freezes the screen under the pointer; pressing it again while the
 * overlay is up dismisses it.
 */
export function captureHotkeyLabel(): string {
  return isMac() ? CAPTURE_MAC_LABEL : CAPTURE_WINDOWS_LABEL;
}

/**
 * The same strings for copy written at module scope. They are evaluated
 * when the bundle loads, which in every window the app has is inside a
 * webview — so a Mac reads ⌃⇧Space without a single call site changing.
 */
export const DICTATION_HOTKEY_LABEL = dictationHotkeyLabel();
export const DICTATION_HOTKEY_HINT = dictationHotkeyHint();
export const CAPTURE_HOTKEY_LABEL = captureHotkeyLabel();

/**
 * Where the microphone permission lives, named the way the platform names it.
 * The two systems put it in genuinely different places, and "check your
 * settings" helps nobody.
 */
export function microphoneHelp(): string {
  return isMac()
    ? "Microphone unavailable — allow it in System Settings → Privacy & Security → Microphone."
    : "Microphone unavailable — check the permission in Windows settings.";
}
