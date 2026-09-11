/**
 * Live captions — the pure part.
 *
 * What the overlay shows (a short ring of lines with a fade), what it is
 * configured with (sources, translation, text size, click-through; one
 * localStorage JSON shared by the main window and the `captions` window
 * through the `storage` event), and the exact arguments the Rust audio
 * capture (`audio_capture_start`, contract §3) is started with. Everything
 * that touches a window or the microphone is in `captionsControl.ts`.
 */

export type CaptionSource = "mic" | "system";

export interface CaptionsSettings {
  /** What to listen to: what the speakers play, the microphone, or both. */
  sources: CaptionSource[];
  /** Translate every line to English — whisper only. */
  translate: boolean;
  /** Line height in CSS pixels. */
  fontSize: number;
  /** The overlay ignores the mouse (it can then only be hidden from the Captions page). */
  clickThrough: boolean;
  /** How many lines stay on screen. */
  lines: number;
}

export const CAPTIONS_SETTINGS_KEY = "owntools-captions-settings";
export const CAPTIONS_SETTINGS_EVENT = "owntools:captions-settings";
export const CAPTIONS_STATE_KEY = "owntools-captions-state";
export const CAPTIONS_STATE_EVENT = "owntools:captions-state";

/** The capture session name and the folder (relative to AppData) its segments land in. */
export const CAPTIONS_SESSION = "captions";
export const CAPTIONS_DIR = "captions";

/** Events the Rust audio capture emits (contract §3). */
export const AUDIO_CAPTURE_SEGMENT_EVENT = "audio-capture-segment";
export const AUDIO_CAPTURE_LEVEL_EVENT = "audio-capture-level";
export const AUDIO_CAPTURE_ERROR_EVENT = "audio-capture-error";

/** Logical size of the `captions` window (tauri.conf.json) at the default text size. */
export const CAPTIONS_WIDTH = 920;
export const MIN_FONT = 18;
export const MAX_FONT = 44;

export const DEFAULT_CAPTIONS_SETTINGS: CaptionsSettings = {
  sources: ["system"],
  translate: false,
  fontSize: 26,
  clickThrough: false,
  lines: 3,
};

export interface CaptureSegment {
  session: string;
  source: CaptionSource;
  startMs: number;
  endMs: number;
  /** Absolute path of a 16 kHz mono PCM16 WAV inside AppData. */
  path: string;
  /** Browser preview only: the demo feed carries its text, there is no file. */
  text?: string;
}

export interface CaptureError {
  session: string;
  message: string;
}

export function isCaptureSegment(payload: unknown): payload is CaptureSegment {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Partial<CaptureSegment>;
  return (
    typeof p.session === "string" &&
    (p.source === "mic" || p.source === "system") &&
    typeof p.path === "string" &&
    typeof p.startMs === "number" &&
    typeof p.endMs === "number"
  );
}

export function normalizeCaptionsSettings(raw: unknown): CaptionsSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof CaptionsSettings, unknown>>;
  const sources = Array.isArray(r.sources)
    ? (r.sources.filter((s): s is CaptionSource => s === "mic" || s === "system") as CaptionSource[])
    : [];
  const fontSize =
    typeof r.fontSize === "number" && Number.isFinite(r.fontSize)
      ? Math.min(MAX_FONT, Math.max(MIN_FONT, Math.round(r.fontSize)))
      : DEFAULT_CAPTIONS_SETTINGS.fontSize;
  const lines = r.lines === 2 || r.lines === 3 ? r.lines : DEFAULT_CAPTIONS_SETTINGS.lines;
  return {
    sources: sources.length ? [...new Set(sources)] : DEFAULT_CAPTIONS_SETTINGS.sources,
    translate: r.translate === true,
    fontSize,
    clickThrough: r.clickThrough === true,
    lines,
  };
}

export function loadCaptionsSettings(): CaptionsSettings {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(CAPTIONS_SETTINGS_KEY);
    return normalizeCaptionsSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_CAPTIONS_SETTINGS;
  }
}

export function saveCaptionsSettings(patch: Partial<CaptionsSettings>): CaptionsSettings {
  const next = normalizeCaptionsSettings({ ...loadCaptionsSettings(), ...patch });
  try {
    localStorage.setItem(CAPTIONS_SETTINGS_KEY, JSON.stringify(next));
  } catch {
    /* private mode / tests */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CAPTIONS_SETTINGS_EVENT));
  return next;
}

/** Fires on a change in this window and on one from the other window (`storage`). */
export function subscribeCaptionsSettings(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === CAPTIONS_SETTINGS_KEY) listener();
  };
  window.addEventListener(CAPTIONS_SETTINGS_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CAPTIONS_SETTINGS_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Whether a capture is running — written by whichever window started or stopped it. */
export function captionsRunning(): boolean {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(CAPTIONS_STATE_KEY);
    return raw ? (JSON.parse(raw) as { running?: boolean }).running === true : false;
  } catch {
    return false;
  }
}

export function setCaptionsRunning(running: boolean): void {
  try {
    localStorage.setItem(CAPTIONS_STATE_KEY, JSON.stringify({ running, at: Date.now() }));
  } catch {
    /* */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CAPTIONS_STATE_EVENT));
}

export function subscribeCaptionsState(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === CAPTIONS_STATE_KEY) listener();
  };
  window.addEventListener(CAPTIONS_STATE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CAPTIONS_STATE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * The `audio_capture_start` arguments (contract §3). Short hangover and short
 * segments: a caption that arrives two seconds after the words is late, and
 * the recognizer is fast on short clips. No archive — nothing is kept.
 */
export function captureStartArgs(settings: CaptionsSettings) {
  return {
    session: CAPTIONS_SESSION,
    sources: settings.sources,
    dir: CAPTIONS_DIR,
    archive: false,
    vad: { hangoverMs: 400, maxSegmentMs: 8000 },
  } as const;
}

/* ------------------------------------------------------------------------- */
/* Lines                                                                     */
/* ------------------------------------------------------------------------- */

export interface CaptionLine {
  id: number;
  text: string;
  /** Epoch ms when it was shown. */
  at: number;
  source: CaptionSource | "demo" | "error";
}

/** Appends and keeps the last `max`. */
export function pushLine(lines: CaptionLine[], line: CaptionLine, max: number): CaptionLine[] {
  const next = [...lines, line];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** Nothing new for this long and the lines start to go. */
export const HOLD_MS = 9000;
/** …and are gone this much later. */
export const FADE_MS = 3000;

/**
 * Opacity of a line: the newest is opaque, each older one softer, and a line
 * nobody has added to for `HOLD_MS` fades out over `FADE_MS` so a silent room
 * ends with an empty overlay instead of a stale sentence.
 */
export function lineOpacity(indexFromNewest: number, ageMs: number): number {
  const byRank = Math.pow(0.68, Math.max(0, indexFromNewest));
  const overdue = ageMs - HOLD_MS;
  const byAge = overdue <= 0 ? 1 : Math.max(0, 1 - overdue / FADE_MS);
  return Math.round(byRank * byAge * 100) / 100;
}

/** Window height that fits the bar, the lines at this text size, and the padding. */
export function overlayHeight(settings: CaptionsSettings, gearOpen = false): number {
  const bar = 34;
  const lines = Math.ceil(settings.lines * settings.fontSize * 1.32) + 26;
  return bar + lines + (gearOpen ? 176 : 0);
}
