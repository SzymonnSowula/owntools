import { isTauri } from "./env";

/**
 * The helper windows Rust builds when they are needed and destroys when they
 * are put away (`src-tauri/src/overlays.rs`). Each WebView2 window is a
 * renderer process of 55–95 MB, visible or not, so they no longer exist until
 * asked for. The dictation pill and the main window are not on this list:
 * they live for the whole session.
 */
export type OnDemandWindow = "recorder" | "captions" | "capture";

/**
 * Builds the window when it does not exist and waits until its page is
 * listening (`@ui/OverlayReady`). It stays hidden: position it, then show it.
 * The first call after a while pays for a new window — a few hundred ms.
 */
export async function ensureWindow(label: OnDemandWindow): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("overlay_ensure", { label });
}

/**
 * Hides the window; Rust destroys it a moment later (the capture overlay only
 * after a quiet spell, since screenshots come in runs). Called from inside the
 * window itself too — the answer arrives before the page goes.
 */
export async function releaseWindow(label: OnDemandWindow): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("overlay_release", { label });
}
