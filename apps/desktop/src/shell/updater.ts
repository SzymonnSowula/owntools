import { isTauri } from "@core/env";
import { logError, logInfo } from "@core/errors";
import { OfflineMode, noteRequest, offlineMode } from "@core/net";

export interface AvailableUpdate {
  version: string;
  notes?: string;
  /** Downloads, installs and relaunches. Progress is 0..1 while downloading. */
  install: (onProgress?: (fraction: number) => void) => Promise<void>;
}

/**
 * Where the manifest and the installer come from (tauri.conf.json →
 * plugins.updater.endpoints, a GitHub release). The updater plugin does its
 * own HTTP, so the request is noted here rather than wrapped: the log names
 * the host and the purpose, sizes and status stay null because the plugin
 * does not report them.
 */
const UPDATE_HOST = "github.com";

/**
 * Asks the updater endpoint (tauri.conf.json → plugins.updater) whether a
 * newer signed build exists. Silent on any failure: an update check must never
 * get in the way of using the app. Skipped in dev, where the endpoint would
 * only ever answer for the published repo, and in Offline mode, where nothing
 * leaves the machine.
 */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauri() || import.meta.env.DEV) return null;
  if (offlineMode()) {
    logInfo("main", "update check skipped: Offline mode is on");
    return null;
  }
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const ts = Date.now();
    let update;
    try {
      update = await check();
    } catch (err) {
      noteRequest({ ts, host: UPDATE_HOST, method: "GET", bytesOut: 0, bytesIn: null, purpose: "update check", ok: false, status: null });
      throw err;
    }
    noteRequest({ ts, host: UPDATE_HOST, method: "GET", bytesOut: 0, bytesIn: null, purpose: "update check", ok: true, status: null });
    if (!update) return null;
    return {
      version: update.version,
      notes: update.body ?? undefined,
      install: async (onProgress) => {
        if (offlineMode()) throw new OfflineMode("update download");
        let total = 0;
        let done = 0;
        const started = Date.now();
        try {
          await update.downloadAndInstall((event) => {
            if (event.event === "Started") {
              total = event.data.contentLength ?? 0;
            } else if (event.event === "Progress") {
              done += event.data.chunkLength;
              if (total > 0) onProgress?.(Math.min(1, done / total));
            } else if (event.event === "Finished") {
              onProgress?.(1);
            }
          });
        } finally {
          noteRequest({
            ts: started,
            host: UPDATE_HOST,
            method: "GET",
            bytesOut: 0,
            bytesIn: done > 0 ? done : null,
            purpose: "update download",
            ok: done > 0 && (total === 0 || done >= total),
            status: null,
          });
        }
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      },
    };
  } catch (err) {
    logError("main", "update check failed", err);
    return null;
  }
}
