/**
 * Motion helpers. Everything is a pure function of the frame, so a still at
 * frame N is exactly what the video shows at frame N.
 */
import { interpolate, spring, type SpringConfig } from "remotion";

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const mix = lerp;

/** 0 → 1 over [from, to] frames, clamped. */
export function ramp(frame: number, from: number, to: number): number {
  if (to <= from) return frame >= to ? 1 : 0;
  return clamp01((frame - from) / (to - from));
}

/** Linear map with clamping at both ends — `interpolate` with the usual options. */
export function map(frame: number, input: [number, number], output: [number, number]): number {
  return interpolate(frame, input, output, { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
}

export const ease = {
  outExpo: (t: number): number => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  outQuint: (t: number): number => 1 - Math.pow(1 - t, 5),
  outCubic: (t: number): number => 1 - Math.pow(1 - t, 3),
  inCubic: (t: number): number => t * t * t,
  inQuad: (t: number): number => t * t,
  inOutQuint: (t: number): number => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2),
  inOutCubic: (t: number): number => (t < 0.5 ? 4 * t ** 3 : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number, s = 1.70158): number => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
  /** A snap: nearly there in the first third, then a soft landing. */
  snap: (t: number): number => 1 - Math.pow(1 - t, 4),
};

/** Spring presets: `pop` for things that appear, `glide` for things that move, `slam` for the stamps. */
export const SPRINGS: Record<"pop" | "glide" | "slam" | "soft" | "stiff", Partial<SpringConfig>> = {
  pop: { damping: 14, stiffness: 180, mass: 0.8 },
  glide: { damping: 22, stiffness: 140, mass: 1 },
  slam: { damping: 18, stiffness: 320, mass: 0.9 },
  soft: { damping: 26, stiffness: 90, mass: 1 },
  stiff: { damping: 30, stiffness: 400, mass: 0.7 },
};

export interface SpringOpts {
  frame: number;
  fps: number;
  /** Frame the spring starts on. */
  at?: number;
  from?: number;
  to?: number;
  kind?: keyof typeof SPRINGS;
  config?: Partial<SpringConfig>;
  /** Frames the spring is given to settle; shorter = snappier (Remotion stretches the curve). */
  durationInFrames?: number;
}

/** A spring that starts at `at` and runs from `from` to `to`. Before `at` it sits at `from`. */
export function spr({ frame, fps, at = 0, from = 0, to = 1, kind = "pop", config, durationInFrames }: SpringOpts): number {
  if (frame < at) return from;
  return spring({
    frame: frame - at,
    fps,
    from,
    to,
    config: { ...SPRINGS[kind], ...config },
    durationInFrames,
  });
}

/** Deterministic noise in [0, 1) for meters and jitter — never Math.random in a frame. */
export function noise(n: number, salt = 0): number {
  const x = Math.sin(n * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Smooth 1-D value noise in [0, 1], `t` in "units" (one bump per unit). */
export function smoothNoise(t: number, salt = 0): number {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  return lerp(noise(i, salt), noise(i + 1, salt), u);
}

/**
 * Typewriter: how many characters of `text` are visible at `frame`, with
 * `cps` characters per second starting at `at`.
 */
export function typed(text: string, frame: number, fps: number, at: number, cps: number): string {
  const n = Math.max(0, Math.floor(((frame - at) / fps) * cps));
  return text.slice(0, Math.min(text.length, n));
}

/**
 * Words landing in bursts, the way the streaming recogniser delivers them:
 * `segments` is the text split into the chunks that arrive together, each
 * `every` frames from `at`. Returns the settled text and the chunk still
 * being decoded (shown greyed), or "" once everything has landed.
 */
export function streamed(
  segments: readonly string[],
  frame: number,
  at: number,
  every: number,
): { settled: string; pending: string; done: boolean } {
  if (frame < at) return { settled: "", pending: "", done: false };
  const n = Math.floor((frame - at) / every);
  const settledCount = Math.min(segments.length, n);
  const settled = segments.slice(0, settledCount).join(" ");
  const pending = settledCount < segments.length ? segments[settledCount] : "";
  return { settled, pending, done: settledCount >= segments.length };
}

/** A blinking caret: on for `on` frames, off for `off`. */
export function caretOn(frame: number, on = 32, off = 28): boolean {
  return frame % (on + off) < on;
}

/** Format seconds as m:ss. */
export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Format seconds as mm:ss for the recorder. */
export function clock2(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
