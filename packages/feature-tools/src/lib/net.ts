import { isTauri } from "@core/env";
import { trackedFetch } from "@core/net";

export interface NetInit {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}

/**
 * Fetches a URL the way the environment allows: through Tauri's HTTP plugin
 * in the app (no CORS; `https://**` is in the capability), through the dev
 * server's `/__proxy` middleware under `pnpm dev` (vite.config.ts, YouTube
 * hosts only) and plainly anywhere else. Every path goes through
 * `trackedFetch`, so the request shows up in Settings → Privacy with its
 * `purpose` and is refused in Offline mode.
 */
export async function netFetch(url: string, init: NetInit = {}, purpose = "YouTube transcript"): Promise<Response> {
  if (isTauri()) {
    // The plugin stamps the webview's origin (https://tauri.localhost) on
    // every request unless told otherwise, and YouTube answers 403 to a
    // foreign Origin. An empty Origin makes the plugin (built with
    // `unsafe-headers`) send none at all.
    return trackedFetch(url, { ...init, headers: { Origin: "", ...init.headers }, purpose });
  }
  if (import.meta.env.DEV) {
    // The relay is local; the log should still name where the request went.
    return trackedFetch(`/__proxy?url=${encodeURIComponent(url)}`, { ...init, purpose, destination: url });
  }
  return trackedFetch(url, { ...init, purpose });
}

/**
 * Fetches an image as a data URL. The app's CSP allows `data:` images but no
 * remote hosts, so thumbnails have to come in through the HTTP plugin.
 */
export async function fetchDataUrl(url: string, maxBytes = 5_000_000, purpose = "YouTube thumbnail"): Promise<string | null> {
  try {
    const res = await netFetch(url, {}, purpose);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size === 0 || blob.size > maxBytes) return null;
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
