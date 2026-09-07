import type { ButtonEvent, InputButton, InputTrack, KeyEvent, KeyKind } from "../types";
import { invokeSafe, isTauri } from "./tauri";

/**
 * The native input track: mouse buttons and keystrokes sampled in-process at
 * 250 Hz for the length of a take (`src-tauri/src/input_track.rs`). It exists
 * because the cursor track is polled over IPC every 33 ms — fine for where
 * the pointer is, a frame late for when it clicked, and blind to a keyboard.
 * The editor's click rings and sound effects prefer it when it is there.
 *
 * Privacy: a key event says when a key went down and what sort of key it was
 * (letter/digit/symbol, space, enter, backspace, modifier) — never which.
 */

export interface RawInputEvent {
  type: string;
  /** Milliseconds on the sampler's own clock. */
  t: number;
  button?: string;
  down?: boolean;
  x?: number;
  y?: number;
  kind?: string;
}

export interface RawInputTrack {
  events: RawInputEvent[];
  rate: number;
  dropped?: boolean;
}

/** A pause in `performance.now()` milliseconds. */
export interface Pause {
  from: number;
  to: number;
}

/**
 * Starts the sampler. Resolves with the `performance.now()` its clock starts
 * at (the middle of the round trip — the thread is spawned inside it), or
 * null when it could not start; the take carries on without a track then.
 */
export async function startInputTrack(): Promise<number | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const before = performance.now();
    await invoke("input_track_start");
    return (before + performance.now()) / 2;
  } catch (err) {
    console.warn("input track did not start", err);
    return null;
  }
}

/** Stops the sampler and returns what it saw; null outside Tauri or on failure. */
export async function stopInputTrack(): Promise<RawInputTrack | null> {
  try {
    return await invokeSafe<RawInputTrack>("input_track_stop");
  } catch {
    return null;
  }
}

const BUTTONS: ReadonlySet<string> = new Set<InputButton>(["left", "right", "middle"]);
const KINDS: ReadonlySet<string> = new Set<KeyKind>(["key", "space", "enter", "backspace", "modifier"]);

/**
 * Rebases the sampler's events onto recording time: seconds since the
 * recorders started, with the pauses taken out. Events inside a pause are
 * dropped — the video has no frames for them either.
 */
export function collectInputTrack(
  raw: RawInputTrack,
  base: number,
  startedAt: number,
  pauses: Pause[],
): InputTrack {
  const sorted = [...pauses].sort((a, b) => a.from - b.from);
  const toRecording = (ms: number): number | null => {
    const abs = base + ms;
    if (abs < startedAt) return null;
    let paused = 0;
    for (const p of sorted) {
      if (abs >= p.from && abs < p.to) return null;
      if (p.to <= abs) paused += Math.max(0, p.to - p.from);
    }
    return (abs - startedAt - paused) / 1000;
  };

  const buttons: ButtonEvent[] = [];
  const keys: KeyEvent[] = [];
  for (const e of raw.events ?? []) {
    if (typeof e.t !== "number" || !Number.isFinite(e.t)) continue;
    const t = toRecording(e.t);
    if (t === null) continue;
    if (e.type === "button" && typeof e.button === "string" && BUTTONS.has(e.button)) {
      buttons.push({
        t,
        button: e.button as InputButton,
        down: Boolean(e.down),
        x: typeof e.x === "number" ? e.x : 0,
        y: typeof e.y === "number" ? e.y : 0,
      });
    } else if (e.type === "key" && typeof e.kind === "string" && KINDS.has(e.kind)) {
      keys.push({ t, kind: e.kind as KeyKind });
    }
  }
  buttons.sort((a, b) => a.t - b.t);
  keys.sort((a, b) => a.t - b.t);
  return { buttons, keys, rate: typeof raw.rate === "number" && raw.rate > 0 ? raw.rate : 250 };
}

/** Brings a stored track up to shape; undefined when there is none worth keeping. */
export function normalizeInputTrack(value: unknown): InputTrack | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Partial<InputTrack> & Record<string, unknown>;
  if (!Array.isArray(v.buttons) || !Array.isArray(v.keys)) return undefined;
  const buttons: ButtonEvent[] = [];
  for (const b of v.buttons as unknown[]) {
    if (!b || typeof b !== "object") continue;
    const e = b as Partial<ButtonEvent>;
    if (typeof e.t !== "number" || typeof e.button !== "string" || !BUTTONS.has(e.button)) continue;
    buttons.push({
      t: e.t,
      button: e.button,
      down: Boolean(e.down),
      x: typeof e.x === "number" ? e.x : 0,
      y: typeof e.y === "number" ? e.y : 0,
    });
  }
  const keys: KeyEvent[] = [];
  for (const k of v.keys as unknown[]) {
    if (!k || typeof k !== "object") continue;
    const e = k as Partial<KeyEvent>;
    if (typeof e.t !== "number" || typeof e.kind !== "string" || !KINDS.has(e.kind)) continue;
    keys.push({ t: e.t, kind: e.kind });
  }
  buttons.sort((a, b) => a.t - b.t);
  keys.sort((a, b) => a.t - b.t);
  return { buttons, keys, rate: typeof v.rate === "number" && v.rate > 0 ? v.rate : 250 };
}
