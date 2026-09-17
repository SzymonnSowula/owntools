/**
 * Starting, stopping and placing the live captions — the side-effect half of
 * `captions.ts`. Called from the Captions page in the main window (Show /
 * Hide) and from the overlay's own gear (sources, size, click-through).
 *
 * The capture itself is Rust (`audio_capture_start`, owned by the meet
 * package): the overlay only listens for its segment events. Outside Tauri
 * the same functions drive a demo — the overlay page feeds itself sample
 * lines — so the UI can be seen under `pnpm dev`.
 */

import { isTauri } from "@core/env";
import { logInfo } from "@core/errors";
import { ensureWindow, releaseWindow } from "@core/overlay";
import {
  CAPTIONS_SESSION,
  CAPTIONS_WIDTH,
  captureStartArgs,
  captionsRunning,
  loadCaptionsSettings,
  overlayHeight,
  setCaptionsRunning,
  type CaptionsSettings,
} from "./captions";

/** Gap between the overlay's bottom edge and the bottom of the work area. */
const BOTTOM_GAP = 72;

type WebviewWindowT = import("@tauri-apps/api/webviewWindow").WebviewWindow;

async function captionsWindow(): Promise<WebviewWindowT | null> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  return WebviewWindow.getByLabel("captions");
}

/**
 * Bottom-centre of a monitor — by default the one the calling window is on:
 * from the main window that is where the person works, from the overlay it
 * is where they dragged it. Sizes are logical, monitors physical, so the
 * scale factor converts once and the position is applied as physical pixels.
 */
export async function positionCaptionsWindow(
  win: { setPosition: (p: import("@tauri-apps/api/dpi").PhysicalPosition) => Promise<void> },
  settings: CaptionsSettings,
  gearOpen = false,
): Promise<void> {
  if (!isTauri()) return;
  try {
    const api = await import("@tauri-apps/api/window");
    const monitor = (await api.currentMonitor()) ?? (await api.primaryMonitor());
    if (!monitor) return;
    const scale = monitor.scaleFactor > 0 ? monitor.scaleFactor : 1;
    const area = monitor.workArea ?? { position: monitor.position, size: monitor.size };
    const height = overlayHeight(settings, gearOpen);
    const x = area.position.x + (area.size.width - CAPTIONS_WIDTH * scale) / 2;
    const y = area.position.y + area.size.height - (height + BOTTOM_GAP) * scale;
    await win.setPosition(new api.PhysicalPosition(Math.round(x), Math.round(y)));
  } catch {
    /* placement is cosmetic */
  }
}

/** From inside the overlay: fit the window to the text size and keep it at the bottom. */
export async function fitCaptionsWindow(settings: CaptionsSettings, gearOpen: boolean): Promise<void> {
  if (!isTauri()) return;
  try {
    const api = await import("@tauri-apps/api/window");
    const win = api.getCurrentWindow();
    // Where the bottom edge is now, so a bigger font grows the window upwards
    // rather than pushing it under the taskbar.
    const [pos, size] = await Promise.all([win.outerPosition(), win.outerSize()]);
    const scale = await win.scaleFactor();
    const bottom = pos.y + size.height;
    const height = overlayHeight(settings, gearOpen);
    await win.setSize(new api.LogicalSize(CAPTIONS_WIDTH, height));
    await win.setPosition(new api.PhysicalPosition(pos.x, Math.round(bottom - height * scale)));
  } catch {
    /* cosmetic */
  }
}

/** The overlay ignores the mouse; only the Captions page can switch it back. */
export async function applyClickThrough(on: boolean): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setIgnoreCursorEvents(on);
  } catch (err) {
    logInfo("captions", `click-through not applied: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function startCaptionsDragging(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().startDragging().catch(() => undefined);
}

/**
 * Starts the capture and shows the overlay. Rejects with the Rust error when
 * the capture cannot start (no audio capture on this platform yet, a device
 * missing) — the page shows the message; the overlay is closed again.
 *
 * The overlay's window only exists while captions run (`overlays.rs`), and it
 * is built before the capture starts, so its page is listening by the time the
 * first segment comes in.
 */
export async function showCaptions(settings: CaptionsSettings = loadCaptionsSettings()): Promise<void> {
  if (!isTauri()) {
    setCaptionsRunning(true);
    openDemoOverlay();
    return;
  }
  await ensureWindow("captions");
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    await invoke("audio_capture_start", { request: captureStartArgs(settings), ...captureStartArgs(settings) });
  } catch (err) {
    await releaseWindow("captions").catch(() => undefined);
    throw err;
  }
  setCaptionsRunning(true);
  logInfo("captions", `capture started (${settings.sources.join("+")})`);
  const win = await captionsWindow();
  if (!win) return;
  await positionCaptionsWindow(win, settings);
  await win.show();
}

export async function hideCaptions(): Promise<void> {
  setCaptionsRunning(false);
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("audio_capture_stop", { session: CAPTIONS_SESSION }).catch((err: unknown) =>
    logInfo("captions", `capture stop: ${err instanceof Error ? err.message : String(err)}`),
  );
  // Logged first: called from the overlay's own button, this page closes right after.
  logInfo("captions", "hidden");
  await releaseWindow("captions").catch(() => undefined);
}

/** A source change needs a new capture; the overlay stays where it is. */
export async function restartCaptions(settings: CaptionsSettings): Promise<void> {
  if (!captionsRunning()) return;
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("audio_capture_stop", { session: CAPTIONS_SESSION }).catch(() => undefined);
  await invoke("audio_capture_start", { request: captureStartArgs(settings), ...captureStartArgs(settings) });
  logInfo("captions", `capture restarted (${settings.sources.join("+")})`);
}

/** Browser preview: the overlay page in its own tab, fed by its demo lines. */
function openDemoOverlay(): void {
  if (typeof window === "undefined") return;
  window.open("/captions.html", "owntools-captions", "popup=yes,width=920,height=180");
}
