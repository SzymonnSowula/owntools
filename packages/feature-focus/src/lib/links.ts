import { isTauri } from "./env";

/**
 * Open a link in the system browser. WebView2 would otherwise navigate the app
 * window itself; in the browser preview a new tab is the closest equivalent.
 */
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    } catch {
      /* fall through to window.open */
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
