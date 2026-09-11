import { isTauri } from "@core/env";
import type { SyncBackend } from "./backend";
import { demoBackend } from "./demo";
import { tauriBackend } from "./tauri";

export type { CopyOptions, SyncBackend } from "./backend";

/** Rust under Tauri; the in-memory two-device folder everywhere else. */
export function getSyncBackend(): SyncBackend {
  return isTauri() ? tauriBackend : demoBackend();
}
