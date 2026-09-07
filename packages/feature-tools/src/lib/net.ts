import { isTauri } from "@core/env";

export interface NetInit {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}

/**
 * Fetches a URL the way the environment allows: through Tauri's HTTP plugin
 * in the app (no CORS; `https://**` is in the capability), through the dev
 * server's `/__proxy` middleware under `pnpm dev` (vite.config.ts, YouTube
 * hosts only) and plainly anywhere else.
 */
export async function netFetch(url: string, init: NetInit = {}): Promise<Response> {
  if (isTauri()) {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    // The plugin stamps the webview's origin (https://tauri.localhost) on
    // every request unless told otherwise, and YouTube answers 403 to a
    // foreign Origin. An empty Origin makes the plugin (built with
    // `unsafe-headers`) send none at all.
    return tauriFetch(url, { ...init, headers: { Origin: "", ...init.headers } });
  }
  if (import.meta.env.DEV) {
    return fetch(`/__proxy?url=${encodeURIComponent(url)}`, init);
  }
  return fetch(url, init);
}

/**
 * Fetches an image as a data URL. The app's CSP allows `data:` images but no
 * remote hosts, so thumbnails have to come in through the HTTP plugin.
 */
export async function fetchDataUrl(url: string, maxBytes = 5_000_000): Promise<string | null> {
  try {
    const res = await netFetch(url);
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
