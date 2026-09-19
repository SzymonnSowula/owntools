/**
 * Where the background-removal models live and how they get there.
 *
 * In the app a model is one file under `<AppData>/images/matting/`, fetched
 * by the Rust downloader (`download_file`: streamed to `.part`, resumed with a
 * Range request, checked against the pinned SHA-256, renamed into place), and
 * read back through the asset protocol so 176 MB never crosses IPC as JSON.
 *
 * Outside Tauri (`pnpm dev`, the browser preview) the same contract is kept
 * by a twin: the file is fetched from the pinned URL, hashed with
 * `crypto.subtle`, and kept in Cache Storage under the same relative path —
 * so the whole tool, download included, runs in a browser tab.
 */
import { isTauri } from "@core/env";
import { trackedFetch } from "@core/net";
import { mattingModelDest, type MattingModel } from "./models";

const BROWSER_CACHE = "owntools-matting-models";
const PURPOSE = "background removal model download";
const DOWNLOAD_PROGRESS_EVENT = "download-progress";
/** The rejection string `download_file` uses after `download_cancel`. */
const DOWNLOAD_CANCELLED = "cancelled";

export class DownloadPaused extends Error {
  constructor() {
    super("Download paused.");
    this.name = "DownloadPaused";
  }
}

export function isDownloadPaused(err: unknown): err is DownloadPaused {
  return err instanceof DownloadPaused || (err instanceof Error && err.name === "DownloadPaused");
}

function downloadId(model: MattingModel): string {
  return `matting-model:${model.id}`;
}

function cacheKey(model: MattingModel): string {
  return `/${mattingModelDest(model)}`;
}

/* ------------------------------------------------------------------------- */
/* Status                                                                    */
/* ------------------------------------------------------------------------- */

export async function modelInstalled(model: MattingModel): Promise<boolean> {
  try {
    if (isTauri()) {
      const { exists, stat, BaseDirectory } = await import("@tauri-apps/plugin-fs");
      const dest = mattingModelDest(model);
      if (!(await exists(dest, { baseDir: BaseDirectory.AppData }))) return false;
      // The downloader only renames a file into place after the checksum
      // matched, so a size check is a guard against a hand-copied file.
      const info = await stat(dest, { baseDir: BaseDirectory.AppData });
      return info.size === model.bytes;
    }
    if (typeof caches === "undefined") return false;
    const cache = await caches.open(BROWSER_CACHE);
    return (await cache.match(cacheKey(model))) !== undefined;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------------- */
/* Install                                                                   */
/* ------------------------------------------------------------------------- */

export type DownloadProgress = (loaded: number, total: number) => void;

let browserAbort: AbortController | null = null;
const inflight = new Set<string>();

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function installInBrowser(model: MattingModel, onProgress: DownloadProgress): Promise<void> {
  if (typeof caches === "undefined") throw new Error("This browser has no Cache Storage to keep the model in.");
  browserAbort = new AbortController();
  try {
    const res = await trackedFetch(model.url, { purpose: PURPOSE, signal: browserAbort.signal });
    if (!res.ok || !res.body) throw new Error(`The model download answered ${res.status}.`);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress(loaded, model.bytes);
    }
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (loaded !== model.bytes || (await sha256Hex(bytes.buffer)) !== model.sha256) {
      throw new Error("The downloaded model does not match its pinned checksum - nothing was kept.");
    }
    const cache = await caches.open(BROWSER_CACHE);
    await cache.put(
      cacheKey(model),
      new Response(bytes, { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(loaded) } }),
    );
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new DownloadPaused();
    throw err;
  } finally {
    browserAbort = null;
  }
}

async function installInApp(model: MattingModel, onProgress: DownloadProgress): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const id = downloadId(model);
  const unlisten = await listen<{ id: string; loaded: number; total: number }>(DOWNLOAD_PROGRESS_EVENT, (event) => {
    if (event.payload.id === id) onProgress(event.payload.loaded, event.payload.total || model.bytes);
  });
  inflight.add(id);
  try {
    await invoke<string>("download_file", {
      request: {
        id,
        url: model.url,
        dest: mattingModelDest(model),
        sha256: model.sha256,
        expectedSize: model.bytes,
        purpose: PURPOSE,
      },
    });
  } catch (err) {
    if (err === DOWNLOAD_CANCELLED) throw new DownloadPaused();
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    inflight.delete(id);
    unlisten();
  }
}

/** Fetches one model. Rejects with `DownloadPaused` after `pauseModelDownload()`. */
export async function installModel(model: MattingModel, onProgress: DownloadProgress): Promise<void> {
  if (await modelInstalled(model)) return;
  await (isTauri() ? installInApp(model, onProgress) : installInBrowser(model, onProgress));
}

/** Stops the running download. In the app the `.part` file stays, so the next start resumes. */
export async function pauseModelDownload(): Promise<void> {
  browserAbort?.abort();
  if (!isTauri() || inflight.size === 0) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await Promise.all([...inflight].map((id) => invoke("download_cancel", { id }).catch(() => undefined)));
}

export async function removeModel(model: MattingModel): Promise<void> {
  if (isTauri()) {
    const { exists, remove, BaseDirectory } = await import("@tauri-apps/plugin-fs");
    const dest = mattingModelDest(model);
    if (await exists(dest, { baseDir: BaseDirectory.AppData })) await remove(dest, { baseDir: BaseDirectory.AppData });
    return;
  }
  if (typeof caches === "undefined") return;
  const cache = await caches.open(BROWSER_CACHE);
  await cache.delete(cacheKey(model));
}

/* ------------------------------------------------------------------------- */
/* Reading                                                                   */
/* ------------------------------------------------------------------------- */

/** The model's bytes, for the worker. Throws when the model is not installed. */
export async function readModel(model: MattingModel): Promise<ArrayBuffer> {
  if (isTauri()) {
    const { convertFileSrc } = await import("@tauri-apps/api/core");
    const { appDataDir, join } = await import("@tauri-apps/api/path");
    const dest = mattingModelDest(model);
    try {
      const response = await fetch(convertFileSrc(await join(await appDataDir(), dest)));
      if (response.ok) return await response.arrayBuffer();
    } catch {
      /* read it over IPC instead */
    }
    const { readFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
    const bytes = await readFile(dest, { baseDir: BaseDirectory.AppData });
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }
  const cache = await caches.open(BROWSER_CACHE);
  const hit = await cache.match(cacheKey(model));
  if (!hit) throw new Error(`${model.label} is not installed yet.`);
  return hit.arrayBuffer();
}
