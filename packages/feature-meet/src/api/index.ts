import { isTauri } from "@core/env";
import type { MeetBackend } from "./backend";
import { createDemoBackend } from "./demo";
import { tauriBackend } from "./tauri";

let instance: MeetBackend | null = null;

/** The backend for this window: Rust + the speech engines in the app, the scripted call in a browser. */
export function backend(): MeetBackend {
  if (!instance) instance = isTauri() ? tauriBackend : createDemoBackend();
  return instance;
}

export type * from "./backend";
