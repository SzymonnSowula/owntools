/**
 * Things one tool announces and another may act on.
 *
 * These are DOM events on `window` — the tools are lazy chunks of one page,
 * so a CustomEvent reaches every mounted tool with no Tauri round trip and
 * works in the browser preview. The dictation pill is its own window, so
 * its take is *also* sent as the Tauri event of the same name to `main`
 * (see `DICTATION_TAKE_EVENT`); listeners in the main window subscribe to
 * both through `onToolEvent`.
 *
 * Automations (Settings → Automations) are the main consumer: every trigger
 * a rule can have is one of these events or a Tauri event named here.
 */

/** A meeting was stopped and its files are on disk. */
export const MEET_FINISHED_EVENT = "owntools:meet-finished";
export interface MeetFinished {
  id: string;
  /** Absolute path of `<AppData>/meet/<id>/`. */
  dir: string;
  title: string;
  durationMs: number;
  /** Absolute path of `transcript.md` when it exists. */
  transcriptPath?: string;
}

/** A capture was saved (PNG on disk; OCR text when it ran). */
export const CAPTURE_SAVED_EVENT = "owntools:capture-saved";
export interface CaptureSaved {
  id: string;
  path: string;
  width: number;
  height: number;
  ocrText?: string;
}

/**
 * A dictation take was delivered. Emitted by whichever window took it: the
 * pill (as a Tauri event to `main` *and* a DOM event in its own window) or
 * the main window (DOM event only).
 */
export const DICTATION_TAKE_EVENT = "owntools:dictation-take";
export interface DictationTake {
  text: string;
  /** Length of the take in ms. */
  ms: number;
  /** Foreground process name at the time ("slack.exe", "Code.exe"), null when unknown. */
  app: string | null;
  /** Where the text went. */
  target: "app" | "field" | "sink" | "clipboard";
  engine: "whisper" | "parakeet";
}

/**
 * screeni finished a recording: the Tauri event `recording-finished`
 * (`{ projectId }`) from the recorder window. Named here so automations
 * do not spell it twice.
 */
export const RECORDING_FINISHED_TAURI_EVENT = "recording-finished";

/** A screeni export finished and the file is on disk. */
export const EXPORT_FINISHED_EVENT = "owntools:export-finished";
export interface ExportFinished {
  projectId: string;
  path: string;
  mime: string;
  durationMs: number;
}

/**
 * Settings → Storage deleted files a tool may be holding in memory. The editor
 * closes a project whose folder is gone; meet forgets the audio of a meeting.
 * Not a trigger for automations: nothing was made.
 */
export const STORAGE_CLEARED_EVENT = "owntools:storage-cleared";
export interface StorageCleared {
  kind: "captures" | "recordings" | "meeting-audio" | "cache" | "downloads";
  /** Ids of what was deleted (capture, project or meeting ids); empty for cache and downloads. */
  ids: string[];
}

export type ToolEventMap = {
  [MEET_FINISHED_EVENT]: MeetFinished;
  [CAPTURE_SAVED_EVENT]: CaptureSaved;
  [DICTATION_TAKE_EVENT]: DictationTake;
  [EXPORT_FINISHED_EVENT]: ExportFinished;
  [STORAGE_CLEARED_EVENT]: StorageCleared;
};

export function emitToolEvent<K extends keyof ToolEventMap>(name: K, detail: ToolEventMap[K]): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/**
 * Subscribes to a tool event in this window and, under Tauri, to the Tauri
 * event of the same name (another window announcing it). Returns the
 * unsubscribe.
 */
export function onToolEvent<K extends keyof ToolEventMap>(
  name: K,
  cb: (detail: ToolEventMap[K]) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => cb((e as CustomEvent<ToolEventMap[K]>).detail);
  window.addEventListener(name, handler);
  let unlistenTauri: (() => void) | null = null;
  let disposed = false;
  if ("__TAURI_INTERNALS__" in window) {
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<ToolEventMap[K]>(name, (event) => cb(event.payload)).then((un) => {
        if (disposed) un();
        else unlistenTauri = un;
      }),
    );
  }
  return () => {
    disposed = true;
    window.removeEventListener(name, handler);
    unlistenTauri?.();
  };
}
