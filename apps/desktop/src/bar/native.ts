/**
 * The bar's calls into Rust (`src-tauri/src/bar.rs`) and the window API. Every
 * one is a no-op outside Tauri, so the bar also renders in the browser preview.
 */
import { isTauri } from "@core/env";
import type { BarCommand } from "@core/bar";
import { BAR_COMMAND_EVENT, BAR_STATE_REQUEST_EVENT } from "@core/bar";
import type { Box } from "./geometry";

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauri()) return null;
  try {
    const core = await import("@tauri-apps/api/core");
    return await core.invoke<T>(cmd, args);
  } catch {
    return null;
  }
}

/** Moves and resizes the window in one step (physical pixels). */
export function setBounds(box: Box): Promise<unknown> {
  return invoke("bar_set_bounds", { x: box.x, y: box.y, width: box.width, height: box.height });
}

/** Starts or stops the full-screen watcher and ticks the tray item. */
export function syncNative(enabled: boolean): Promise<unknown> {
  return invoke("bar_sync", { enabled });
}

/** Keeps the bar out of screen recordings, screenshots and screen sharing. */
export function setCaptureExclusion(exclude: boolean): Promise<unknown> {
  return invoke("bar_capture_exclusion", { exclude });
}

/** Remembers the app in front before the pointer reaches the bar. */
export function noteForeground(): void {
  void invoke("bar_note_foreground");
}

/** Gives the foreground back to that app if a click on the bar took it. */
export async function restoreForeground(): Promise<void> {
  await invoke("bar_restore_foreground");
}

/** Shows the main window (rescued if it was stranded off-screen). */
export function showMain(): Promise<unknown> {
  return invoke("capture_show_main");
}

export function screenshot(): Promise<unknown> {
  return invoke("capture_grab", { target: "cursor" });
}

async function currentWindow() {
  if (!isTauri()) return null;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow();
  } catch {
    return null;
  }
}

export async function showWindow(): Promise<void> {
  const win = await currentWindow();
  await win?.show().catch(() => undefined);
}

export async function hideWindow(): Promise<void> {
  const win = await currentWindow();
  await win?.hide().catch(() => undefined);
}

/**
 * Hands the window to the system's move loop. Rust watches the mouse button
 * and sends `bar-drag-end` when it is released: a drag never tells the page.
 */
export function beginDrag(): Promise<unknown> {
  return invoke("bar_drag");
}

export async function sendCommand(command: BarCommand): Promise<void> {
  if (!isTauri()) return;
  try {
    const { emitTo } = await import("@tauri-apps/api/event");
    await emitTo("main", BAR_COMMAND_EVENT, command);
  } catch {
    /* the main window is gone; nothing to do the command */
  }
}

export async function requestState(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { emitTo } = await import("@tauri-apps/api/event");
    await emitTo("main", BAR_STATE_REQUEST_EVENT);
  } catch {
    /* the main window will send its state when it is ready */
  }
}

/** Starts or ends a take, the same as the hotkey. */
export async function toggleDictation(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { emitTo } = await import("@tauri-apps/api/event");
    await emitTo("dictation", "dictation-toggle");
  } catch {
    /* the pill listens in this very window; nothing else to try */
  }
}

/**
 * Subscribes to a Tauri event for as long as the returned function is not
 * called; safe when the subscription resolves after the cleanup.
 */
export function listenTauri<T>(name: string, cb: (payload: T) => void): () => void {
  return listenTauriReady(name, cb).off;
}

/** `listenTauri`, plus a promise that settles once the listener is in place. */
export function listenTauriReady<T>(
  name: string,
  cb: (payload: T) => void,
): { off: () => void; ready: Promise<void> } {
  if (!isTauri()) return { off: () => {}, ready: Promise.resolve() };
  let off: (() => void) | null = null;
  let disposed = false;
  const ready = import("@tauri-apps/api/event")
    .then(({ listen }) => listen<T>(name, (e) => cb(e.payload)))
    .then((un) => {
      if (disposed) un();
      else off = un;
    })
    .catch(() => undefined);
  return {
    off: () => {
      disposed = true;
      off?.();
    },
    ready,
  };
}

export interface MonitorInfo {
  name: string | null;
  scaleFactor: number;
  position: { x: number; y: number };
  size: { width: number; height: number };
  workArea?: { position: { x: number; y: number }; size: { width: number; height: number } };
}

/** All monitors and the primary one, as Tauri reports them. */
export async function monitors(): Promise<{ all: MonitorInfo[]; primary: MonitorInfo | null }> {
  if (!isTauri()) return { all: [], primary: null };
  try {
    const api = await import("@tauri-apps/api/window");
    const [all, primary] = await Promise.all([api.availableMonitors(), api.primaryMonitor()]);
    return { all, primary };
  } catch {
    return { all: [], primary: null };
  }
}

/** The window's outer rectangle in physical pixels. */
export async function windowBox(): Promise<Box | null> {
  const win = await currentWindow();
  if (!win) return null;
  try {
    const [pos, size] = await Promise.all([win.outerPosition(), win.outerSize()]);
    return { x: pos.x, y: pos.y, width: size.width, height: size.height };
  } catch {
    return null;
  }
}

/** Calls `cb` when the window is moved by anyone, including a drag. */
export async function onMoved(cb: () => void): Promise<() => void> {
  const win = await currentWindow();
  if (!win) return () => {};
  try {
    return await win.onMoved(() => cb());
  } catch {
    return () => {};
  }
}
