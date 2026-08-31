import { isTauri } from "./env";

/** Shows the always-on-top recorder overlay and tucks the main window away. */
export async function openRecorderOverlay(): Promise<void> {
  if (!isTauri()) return;
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const overlay = await WebviewWindow.getByLabel("recorder");
  if (!overlay) return;
  await overlay.show();
  await overlay.setFocus();
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().hide();
}

export async function showMainWindow(): Promise<void> {
  if (!isTauri()) return;
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const main = await WebviewWindow.getByLabel("main");
  if (!main) return;
  await main.show();
  await main.unminimize();
  await main.setFocus();
}

export async function hideRecorderOverlay(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().hide();
}
