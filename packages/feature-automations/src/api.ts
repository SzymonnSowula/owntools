import { isTauri } from "@core/env";
import type { AutomationsBackend } from "./backend";
import { createDemoBackend, type DemoBackend } from "./demo";
import { tauriBackend } from "./tauri";

let instance: AutomationsBackend | null = null;
let demoInstance: DemoBackend | null = null;

/** The backend for this window: Rust + plugin-fs in the app, memory in a browser. */
export function backend(): AutomationsBackend {
  if (instance) return instance;
  if (isTauri()) {
    instance = tauriBackend;
  } else {
    demoInstance = createDemoBackend();
    instance = demoInstance;
  }
  return instance;
}

/** The demo instance (for the dev page's simulate buttons); `null` in the app. */
export function demoBackend(): DemoBackend | null {
  backend();
  return demoInstance;
}
