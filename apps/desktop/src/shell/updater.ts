import { isTauri } from "@core/env";
import { logError } from "@core/errors";

export interface AvailableUpdate {
  version: string;
  notes?: string;
  /** Downloads, installs and relaunches. Progress is 0..1 while downloading. */
  install: (onProgress?: (fraction: number) => void) => Promise<void>;
}

/**
 * Asks the updater endpoint (tauri.conf.json → plugins.updater) whether a
 * newer signed build exists. Silent on any failure: an update check must never
 * get in the way of using the app. Skipped in dev, where the endpoint would
 * only ever answer for the published repo.
 */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauri() || import.meta.env.DEV) return null;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return null;
    return {
      version: update.version,
      notes: update.body ?? undefined,
      install: async (onProgress) => {
        let total = 0;
        let done = 0;
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
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      },
    };
  } catch (err) {
    logError("main", "update check failed", err);
    return null;
  }
}
