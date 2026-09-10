import { isTauri } from "./env";

/**
 * Pressing Record tucks the main window away so owntools is not in your shot.
 * That is right almost always and exactly wrong once: when the thing being
 * recorded *is* owntools — a demo, a tutorial, the launch video for the app
 * itself. You cannot pick a window that has just hidden itself, so this is a
 * setting rather than something the recorder can work out. It lives in
 * localStorage because both windows are the same origin and the recorder needs
 * to read it before the main window has said anything.
 */
const RECORD_SELF_KEY = "owntools-record-self";

export function recordsItself(): boolean {
  try {
    return localStorage.getItem(RECORD_SELF_KEY) === "1";
  } catch {
    return false;
  }
}

/** Stores the choice and moves the main window to match it right away. */
export async function setRecordsItself(on: boolean): Promise<void> {
  try {
    localStorage.setItem(RECORD_SELF_KEY, on ? "1" : "0");
  } catch {
    /* private mode, a blocked profile — the toggle still works for this session */
  }
  if (!isTauri()) return;
  if (!on) {
    await hideMainWindow();
    return;
  }
  const main = await mainWindow();
  if (!main) return;
  await main.show();
  await main.unminimize();
  // Deliberately not `setFocus`: this is flipped from the recorder, and the
  // window jumping in front of the bar you are still setting up is jarring.
  // Windows can activate a window on show anyway, so take the foreground back.
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setFocus().catch(() => undefined);
}

async function mainWindow() {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  return WebviewWindow.getByLabel("main");
}

/**
 * Fired whenever the recorder window is shown or hidden; payload = visible.
 * The window is built at start-up and only ever hidden, and neither Windows nor
 * Tauri tells a webview that its window went away, so every path that shows or
 * hides the overlay announces it here - the tray item does it from Rust.
 */
export const RECORDER_VISIBILITY_EVENT = "recorder-visibility";

async function emitVisible(visible: boolean): Promise<void> {
  const { emit } = await import("@tauri-apps/api/event");
  await emit(RECORDER_VISIBILITY_EVENT, visible).catch(() => undefined);
}

/**
 * The recorder page runs from the moment owntools opens, inside a window
 * nobody can see - so a getUserMedia on mount lights the webcam LED for the
 * whole session (it did; that was the bug). Nothing on that page may hold a
 * device unless the window is really on screen, and this is how it finds out:
 * the current state at once, then every show and hide. Outside Tauri (the
 * browser preview) the page is the window.
 */
export async function watchRecorderVisible(
  onChange: (visible: boolean) => void,
): Promise<() => void> {
  if (!isTauri()) {
    onChange(true);
    return () => undefined;
  }
  const [{ getCurrentWindow }, { listen }] = await Promise.all([
    import("@tauri-apps/api/window"),
    import("@tauri-apps/api/event"),
  ]);
  const win = getCurrentWindow();
  onChange(await win.isVisible().catch(() => false));
  const stops = await Promise.all([
    listen<boolean>(RECORDER_VISIBILITY_EVENT, (e) => onChange(e.payload === true)),
    // A hidden window cannot take the focus, so gaining it means we are up.
    // Losing it says nothing (the user clicked another app) and is ignored.
    win.onFocusChanged(({ payload }) => {
      if (payload) onChange(true);
    }),
  ]);
  return () => stops.forEach((stop) => stop());
}

/** Shows the always-on-top recorder overlay and tucks the main window away. */
export async function openRecorderOverlay(): Promise<void> {
  if (!isTauri()) return;
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const overlay = await WebviewWindow.getByLabel("recorder");
  if (!overlay) return;
  await overlay.show();
  await overlay.setFocus();
  await emitVisible(true);
  if (!recordsItself()) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().hide();
  }
}

export async function showMainWindow(): Promise<void> {
  if (!isTauri()) return;
  const main = await mainWindow();
  if (!main) return;
  await main.show();
  await main.unminimize();
  await main.setFocus();
}

/** The main window goes away, but the recorder bar keeps the foreground. */
export async function hideMainWindow(): Promise<void> {
  if (!isTauri()) return;
  const main = await mainWindow();
  if (!main) return;
  await main.hide();
}

export async function hideRecorderOverlay(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().hide();
  await emitVisible(false);
}
