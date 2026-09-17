/**
 * The bar: the small strip at the bottom of the screen with what you do over
 * other apps — dictate, record, a focus session, a meeting.
 *
 * It lives in the `dictation` window (the dictation pill is one of its states,
 * so it costs no web view of its own) and talks to the main window, where the
 * focus timer and meet actually run, through the Tauri events named here.
 * Everything a desk tool is — board, social, disk, launch, the quick tools —
 * stays in the main window, one click away from the bar's mark.
 *
 * Settings are one JSON in localStorage. Both windows share the origin, so
 * the bar reads what Settings → General and the onboarding write.
 */
import { isTauri } from "./env";

export const BAR_SETTINGS_KEY = "owntools-bar";
/** Fired on `window` in the window that wrote, and as a Tauri event to every window. */
export const BAR_SETTINGS_EVENT = "owntools:bar-settings";

/** bar → main: do something the main window owns (the timer, meet, the recorder). */
export const BAR_COMMAND_EVENT = "bar-command";
/** main → bar: the focus timer and the meeting as they are now. */
export const BAR_STATE_EVENT = "bar-state";
/** bar → main: send the state again (the bar has just loaded). */
export const BAR_STATE_REQUEST_EVENT = "bar-state-request";
/** main → bar: onboarding is done; show the bar and say what it is. */
export const BAR_HELLO_EVENT = "bar-hello";
/** Inside the main window: meet's phase changed (a DOM event from feature-meet/store.ts). */
export const MEET_PHASE_EVENT = "owntools:meet-phase";

/** The lengths the bar's focus widget offers, in minutes. */
export const FOCUS_CHOICES = [15, 25, 50, 90] as const;

export interface BarAnchor {
  /** The monitor's name as the OS reports it; null means the primary monitor. */
  monitor: string | null;
  /** Where the bar's centre sits across the work area: 0 is the left edge, 1 the right. */
  x: number;
  /** Logical pixels between the bar's bottom edge and the bottom of the work area. */
  gap: number;
}

export interface BarSettings {
  enabled: boolean;
  /** Where the bar was dragged to; null is the default spot, bottom centre. */
  anchor: BarAnchor | null;
  /** The first-run tip has been seen. */
  introduced: boolean;
  /** The focus length picked last in the bar, in minutes. */
  focusMinutes: number;
}

export const DEFAULT_BAR_SETTINGS: BarSettings = {
  enabled: true,
  anchor: null,
  introduced: false,
  focusMinutes: 25,
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeAnchor(raw: unknown): BarAnchor | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (!finite(a.x) || !finite(a.gap)) return null;
  return {
    monitor: typeof a.monitor === "string" && a.monitor ? a.monitor : null,
    x: Math.min(1, Math.max(0, a.x)),
    gap: Math.max(0, Math.round(a.gap)),
  };
}

/** Whatever was stored, as settings the bar can use. */
export function normalizeBarSettings(raw: unknown): BarSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_BAR_SETTINGS };
  const r = raw as Record<string, unknown>;
  const minutes = finite(r.focusMinutes) ? Math.round(r.focusMinutes) : DEFAULT_BAR_SETTINGS.focusMinutes;
  return {
    enabled: r.enabled !== false,
    anchor: normalizeAnchor(r.anchor),
    introduced: r.introduced === true,
    focusMinutes: Math.min(240, Math.max(1, minutes)),
  };
}

let cachedRaw: string | null | undefined;
let cachedSettings: BarSettings = { ...DEFAULT_BAR_SETTINGS };

/**
 * The stored settings. The same object comes back until the stored JSON
 * changes, so it can feed `useSyncExternalStore` directly.
 */
export function getBarSettings(): BarSettings {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(BAR_SETTINGS_KEY);
  } catch {
    raw = null;
  }
  if (raw === cachedRaw) return cachedSettings;
  cachedRaw = raw;
  try {
    cachedSettings = normalizeBarSettings(raw ? JSON.parse(raw) : null);
  } catch {
    cachedSettings = { ...DEFAULT_BAR_SETTINGS };
  }
  return cachedSettings;
}

export function setBarSettings(patch: Partial<BarSettings>): BarSettings {
  const next = normalizeBarSettings({ ...getBarSettings(), ...patch });
  try {
    localStorage.setItem(BAR_SETTINGS_KEY, JSON.stringify(next));
  } catch {
    /* private mode or a blocked profile: this window still follows the change */
    cachedRaw = JSON.stringify(next);
    cachedSettings = next;
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(BAR_SETTINGS_EVENT));
  if (isTauri()) {
    void import("@tauri-apps/api/event")
      .then(({ emit }) => emit(BAR_SETTINGS_EVENT))
      .catch(() => undefined);
  }
  return next;
}

/**
 * Calls `cb` whenever the settings may have changed: in this window, in
 * another window (the `storage` event), or as announced over Tauri.
 */
export function subscribeBarSettings(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === BAR_SETTINGS_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(BAR_SETTINGS_EVENT, cb);
  let unlisten: (() => void) | null = null;
  let disposed = false;
  if (isTauri()) {
    void import("@tauri-apps/api/event")
      .then(({ listen }) => listen(BAR_SETTINGS_EVENT, () => cb()))
      .then((off) => {
        if (disposed) off();
        else unlisten = off;
      })
      .catch(() => undefined);
  }
  return () => {
    disposed = true;
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(BAR_SETTINGS_EVENT, cb);
    unlisten?.();
  };
}

/* ------------------------------------------------------------------ */
/* What the bar asks of the main window, and what it hears back         */
/* ------------------------------------------------------------------ */

export type BarCommand =
  | { kind: "focus-start"; minutes: number; session: string }
  | { kind: "focus-pause" }
  | { kind: "focus-resume" }
  | { kind: "focus-stop" }
  | { kind: "meet-start" }
  | { kind: "meet-pause" }
  | { kind: "meet-resume" }
  | { kind: "meet-stop" }
  | { kind: "record" }
  | { kind: "open"; tool?: string; section?: string };

export interface BarFocusState {
  running: boolean;
  mode: "focus" | "break";
  stopwatch: boolean;
  /** Epoch ms at which a running countdown reaches zero. */
  endAt: number | null;
  /** A running stopwatch: epoch ms such that elapsed = now - startedAt. */
  startedAt: number | null;
  /** Not running: what is left of a countdown, or what a stopwatch has counted. */
  remainingMs: number;
  durationMs: number;
  /** What the session is for, when it has a name. */
  session: string;
  /** Up to three open tasks, to name a session after. */
  tasks: string[];
}

export type BarMeetPhase = "idle" | "starting" | "recording" | "paused" | "stopping" | "finished";

export interface BarMeetState {
  phase: BarMeetPhase;
  /** Recorded time when the phase last changed. */
  elapsedMs: number;
  /** Epoch ms of that change; a recording counts on from here. */
  at: number;
  error: string | null;
}

export interface BarState {
  focus: BarFocusState;
  meet: BarMeetState;
}

export const IDLE_BAR_STATE: BarState = {
  focus: {
    running: false,
    mode: "focus",
    stopwatch: false,
    endAt: null,
    startedAt: null,
    remainingMs: 0,
    durationMs: 0,
    session: "",
    tasks: [],
  },
  meet: { phase: "idle", elapsedMs: 0, at: 0, error: null },
};

/** Payload of `MEET_PHASE_EVENT`. */
export type MeetPhaseDetail = BarMeetState;

/** A session is under way: running, or paused part-way through. */
export function focusActive(focus: BarFocusState): boolean {
  if (focus.running) return true;
  if (focus.stopwatch) return focus.remainingMs > 0;
  return focus.remainingMs > 0 && focus.remainingMs < focus.durationMs;
}

const SECOND = 1000;

/** Exactly what is left of a countdown, or what a stopwatch has counted, in ms. */
function focusExactMs(focus: BarFocusState, now: number): number {
  if (focus.stopwatch) {
    return focus.running && focus.startedAt !== null ? Math.max(0, now - focus.startedAt) : Math.max(0, focus.remainingMs);
  }
  if (focus.running && focus.endAt !== null) return Math.max(0, focus.endAt - now);
  return Math.max(0, focus.remainingMs);
}

/**
 * What the clock shows, in whole seconds (as ms). A countdown rounds up, so it
 * reads 25:00 when it starts and 0:00 only when it is over; a stopwatch rounds
 * down, the way stopwatches do.
 */
export function focusClockMs(focus: BarFocusState, now: number): number {
  const exact = focusExactMs(focus, now);
  return focus.stopwatch ? Math.floor(exact / SECOND) * SECOND : Math.ceil(exact / SECOND) * SECOND;
}

/** How far through a countdown the session is, 0 to 1; 0 for a stopwatch. */
export function focusProgress(focus: BarFocusState, now: number): number {
  if (focus.stopwatch || focus.durationMs <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - focusExactMs(focus, now) / focus.durationMs));
}

/** Recorded time of a meeting, in whole seconds (as ms). */
export function meetElapsedMs(meet: BarMeetState, now: number): number {
  const exact = meet.phase === "recording" ? meet.elapsedMs + (now - meet.at) : meet.elapsedMs;
  return Math.floor(Math.max(0, exact) / SECOND) * SECOND;
}

/**
 * The moments a running clock changes are whole seconds counted from the
 * epoch ms these return (null when nothing runs). The bar ticks on exactly
 * those boundaries, so a countdown never skips a second or shows one twice.
 */
export function focusTickPhase(focus: BarFocusState): number | null {
  if (!focus.running) return null;
  return focus.stopwatch ? focus.startedAt : focus.endAt;
}

export function meetTickPhase(meet: BarMeetState): number | null {
  return meet.phase === "recording" ? meet.at - meet.elapsedMs : null;
}

/** "4:05", "18:32", "1:02:07" — a clock that never shows a negative. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** "18 min", "1 h 5 min", "<1 min" — for places where a ticking second is noise. */
export function formatMinutes(ms: number): string {
  if (ms < 60_000) return "<1 min";
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
