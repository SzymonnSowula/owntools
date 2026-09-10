/**
 * Keyboard shortcuts shared between UI copy and the native side.
 *
 * The actual global binding is registered in Rust (`src-tauri/src/hotkeys.rs`,
 * `DICTATION_HOTKEY`). Keep the labels here in sync with it; the app can also
 * ask the backend via the `dictation_hotkey` command.
 *
 * The binding string itself is the same on both platforms — Tauri's global
 * shortcut parser maps `ctrl` to Control on macOS too, and Control+Shift+Space
 * is free there, while Command+Shift+Space is Apple's own character picker.
 * Only the way it is *written* changes, so the labels below are resolved once
 * when the module loads (in a webview, where `navigator` exists) rather than
 * being frozen at build time.
 */
import { isMac } from "./env";

const WINDOWS_LABEL = "Ctrl+Shift+Space";
const MAC_LABEL = "⌃⇧Space";

/** How the dictation hotkey is written for the platform the app is on. */
export function dictationHotkeyLabel(): string {
  return isMac() ? MAC_LABEL : WINDOWS_LABEL;
}

/** How the hotkey behaves: one press starts a take, the next press ends it. */
export function dictationHotkeyHint(): string {
  return `press ${dictationHotkeyLabel()} to start, press again to stop`;
}

/**
 * The same two strings for copy written at module scope. They are evaluated
 * when the bundle loads, which in every window the app has is inside a
 * webview — so a Mac reads ⌃⇧Space without a single call site changing.
 */
export const DICTATION_HOTKEY_LABEL = dictationHotkeyLabel();
export const DICTATION_HOTKEY_HINT = dictationHotkeyHint();

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
