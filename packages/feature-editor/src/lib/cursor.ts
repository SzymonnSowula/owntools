import { invokeSafe, isTauri } from "./tauri";
import type { CursorSample, ScreenBounds } from "../types";

/**
 * The pointer's position on the desktop, or null when it cannot be read — in
 * the browser preview, or while Windows shows a secure desktop (a UAC prompt
 * blanks it). Null rather than a zeroed sample on purpose: (0, 0) is a real
 * position, and a run of them would pin the drawn pointer to the top-left
 * corner and invent a dwell for auto-zoom to frame.
 */
export async function getCursor(): Promise<CursorSample | null> {
  const result = await invokeSafe<{ x: number; y: number; down: boolean }>("get_cursor");
  if (!result || typeof result.x !== "number" || typeof result.y !== "number") return null;
  return { t: 0, x: result.x, y: result.y, down: Boolean(result.down) };
}

export async function getScreenSize(): Promise<ScreenBounds> {
  const result = await invokeSafe<ScreenBounds>("get_screen_size");
  if (result && result.width > 0 && result.height > 0) return result;
  return {
    x: 0,
    y: 0,
    width: window.screen.width,
    height: window.screen.height,
  };
}

export { isTauri };
