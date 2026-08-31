import { invokeSafe, isTauri } from "./tauri";
import type { CursorSample, ScreenBounds } from "../types";

export async function getCursor(): Promise<CursorSample> {
  const result = await invokeSafe<{ x: number; y: number; down: boolean }>("get_cursor");
  if (result) return { t: 0, x: result.x, y: result.y, down: result.down };
  return { t: 0, x: 0, y: 0, down: false };
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
