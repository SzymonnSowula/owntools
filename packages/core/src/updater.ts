import { isTauri } from "./env";
import { logError, logInfo } from "./errors";
import { OfflineMode, noteRequest, offlineMode } from "./net";

/**
 * The updater, for the banner at start-up and the button in Settings → About.
 *
 * The plugin does the work (tauri.conf.json → plugins.updater: one endpoint,
 * the GitHub release's latest.json, one public key); this is what asks it and
 * what installs. A newer *signed* build is downloaded, verified and run in
 * passive mode, and the app relaunches - the Pro key and every file in AppData
 * stay where they are.
 */

export interface AvailableUpdate {
  version: string;
  notes?: string;
  /** Downloads, installs and relaunches. Progress is 0..1 while downloading. */
  install: (onProgress?: (fraction: number) => void) => Promise<void>;
}

export type UpdateCheck =
  | { state: "available"; update: AvailableUpdate }
  | { state: "current"; version: string }
  /** Offline mode is on: nothing leaves the machine, so nothing is asked. */
  | { state: "offline" }
  /** The browser preview and `tauri dev`: the endpoint only ever answers for a published build. */
  | { state: "unavailable"; reason: "browser" | "dev" }
  | { state: "failed"; message: string };

/**
 * Where the manifest and the installer come from (tauri.conf.json →
 * plugins.updater.endpoints, a GitHub release). The updater plugin does its
 * own HTTP, so the request is noted here rather than wrapped: the log names
 * the host and the purpose, sizes and status stay null because the plugin
 * does not report them.
 */
const UPDATE_HOST = "github.com";

function isDev(): boolean {
  const meta = import.meta as { env?: { DEV?: boolean } };
  return meta.env?.DEV === true;
}

async function currentVersion(): Promise<string> {
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return "";
  }
}

/**
 * Asks the updater endpoint whether a newer signed build exists and says what
 * it found. Never rejects: an update check must never get in the way of using
 * the app, so every failure is a `failed` result with the reason.
 */
export async function checkForUpdateDetailed(): Promise<UpdateCheck> {
  if (!isTauri()) return { state: "unavailable", reason: "browser" };
  if (isDev()) return { state: "unavailable", reason: "dev" };
  if (offlineMode()) {
    logInfo("main", "update check skipped: Offline mode is on");
    return { state: "offline" };
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
    if (!update) return { state: "current", version: await currentVersion() };
    return {
      state: "available",
      update: {
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
      },
    };
  } catch (err) {
    logError("main", "update check failed", err);
    return { state: "failed", message: err instanceof Error ? err.message : String(err) };
  }
}

/** The start-up check: the update when there is one, silence otherwise. */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  const result = await checkForUpdateDetailed();
  return result.state === "available" ? result.update : null;
}
