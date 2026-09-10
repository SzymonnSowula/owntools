export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export type PlatformOs = "windows" | "macos" | "linux" | "unknown";

/**
 * Which desktop the app is running on.
 *
 * The webview's user agent is the one signal available in every window
 * (main, recorder, pill) without adding a plugin, and it is honest in a Tauri
 * webview: WKWebView says "Macintosh", WebView2 says "Windows NT". The modern
 * `userAgentData.platform` is preferred where it exists because a user agent
 * can be overridden per request, and that is exactly what the YouTube tool
 * does elsewhere in the app.
 *
 * Used for things the two platforms genuinely differ on — which engine archive
 * to download, whether a tool exists here at all, how a shortcut is written.
 * Never for styling: the design language is the same on both.
 */
export function platformOs(): PlatformOs {
  if (typeof navigator === "undefined") return "unknown";
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const hint = `${data?.platform ?? ""} ${navigator.userAgent ?? ""}`.toLowerCase();
  if (/mac|iphone|ipad/.test(hint)) return "macos";
  if (/win/.test(hint)) return "windows";
  if (/linux|android|x11/.test(hint)) return "linux";
  return "unknown";
}

export function isMac(): boolean {
  return platformOs() === "macos";
}

export function isWindows(): boolean {
  return platformOs() === "windows";
}
