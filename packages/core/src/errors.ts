import { isTauri } from "./env";

/** Turns anything thrown into one loggable line. */
export function describeError(detail: unknown): string {
  if (detail instanceof Error) {
    return `${detail.name}: ${detail.message}${detail.stack ? `\n${detail.stack}` : ""}`;
  }
  if (typeof detail === "string") return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

/**
 * Writes to the app log file (tauri-plugin-log → <AppData>/logs/shipshape.log)
 * in the desktop app and to the console everywhere. Never throws.
 */
export function logError(scope: string, kind: string, detail: unknown): void {
  const line = `[${scope}] ${kind}: ${describeError(detail)}`;
  console.error(line);
  if (!isTauri()) return;
  void import("@tauri-apps/plugin-log")
    .then(({ error }) => error(line))
    .catch(() => undefined);
}

/**
 * A breadcrumb in the same log file — for flows that cross windows (the
 * dictation pill → whisper → another app), where "nothing happened" is the
 * only symptom a user can report.
 */
export function logInfo(scope: string, message: string): void {
  const line = `[${scope}] ${message}`;
  console.info(line);
  if (!isTauri()) return;
  void import("@tauri-apps/plugin-log")
    .then(({ info }) => info(line))
    .catch(() => undefined);
}

let installed = false;

/**
 * Uncaught exceptions and unhandled promise rejections used to vanish into a
 * devtools console that production builds do not expose. Call once per window.
 */
export function installGlobalErrorHandlers(scope: string): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (event) => {
    logError(scope, "uncaught error", event.error ?? event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    logError(scope, "unhandled rejection", event.reason);
  });
}
