import { isTauri } from "@core/env";
import type { CaptureBackend } from "./backend";
import { demoBackend } from "./demo";
import { tauriBackend } from "./tauri";

export type { CaptureBackend } from "./backend";
export type * from "./types";

/** The Rust side in the app, the painted demo everywhere else (`pnpm dev`, tests). */
export function getCaptureBackend(): CaptureBackend {
  return isTauri() ? tauriBackend : demoBackend;
}
