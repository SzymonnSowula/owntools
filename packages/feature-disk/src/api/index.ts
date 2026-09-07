import { isTauri } from "@core/env";
import type { DiskBackend } from "./backend";

let instance: DiskBackend | null = null;

/** The backend for this window: Rust in the app, the generated demo in a browser. */
export function backend(): DiskBackend {
  if (instance) return instance;
  if (isTauri()) {
    // Static import keeps the Tauri API in the main chunk; the demo tree is only loaded outside the app.
    instance = tauriInstance();
  } else {
    instance = demoInstance();
  }
  return instance;
}

import { tauriBackend } from "./tauri";
import { createDemoBackend } from "./demo";

function tauriInstance(): DiskBackend {
  return tauriBackend;
}

function demoInstance(): DiskBackend {
  return createDemoBackend();
}

export * from "./types";
