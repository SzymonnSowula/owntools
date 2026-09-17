/**
 * The cut: eleven scenes on a 128 BPM grid, 64 beats = 30.0 s exactly.
 *
 * Every scene starts on a beat. A transition plays over the first
 * `TRANSITION_FRAMES` of the incoming scene while the outgoing one is still
 * on screen underneath (or on top, for the ones where it leaves), so each
 * Sequence is its nominal length plus that overlap. `sceneFrames()` turns the
 * table into frame ranges for whatever fps the composition runs at; the
 * soundtrack script reads the same table, so the whooshes land where the
 * pictures cut.
 */
// Explicit extension: scripts/make-audio.ts imports this table under plain
// Node (type stripping), which resolves nothing without one.
import { BEAT_SECONDS } from "./theme.ts";

export type SceneId =
  | "dictate"
  | "screeni"
  | "focus"
  | "meet"
  | "board"
  | "social"
  | "disk"
  | "capture"
  | "quick"
  | "promise"
  | "end";

/**
 * How a scene comes in.
 *   whip   both slide left, fast, with a streak of motion blur
 *   zoom   the outgoing frame flies into the camera and fades, the new one
 *          settles in from slightly small
 *   slam   the new scene drops in from above and lands with a small bounce
 *   flash  a hard cut under a one-frame white pop
 *   none   the first scene
 */
export type Transition = "whip" | "zoom" | "slam" | "flash" | "none";

export interface Cut {
  id: SceneId;
  /** Length on the beat grid. */
  beats: number;
  enter: Transition;
}

export const CUTS: readonly Cut[] = [
  { id: "dictate", beats: 7, enter: "none" },
  { id: "screeni", beats: 9, enter: "whip" },
  { id: "focus", beats: 6, enter: "zoom" },
  { id: "meet", beats: 6, enter: "whip" },
  { id: "board", beats: 5, enter: "slam" },
  { id: "social", beats: 6, enter: "whip" },
  { id: "disk", beats: 6, enter: "zoom" },
  { id: "capture", beats: 3, enter: "flash" },
  { id: "quick", beats: 4, enter: "whip" },
  { id: "promise", beats: 3, enter: "flash" },
  { id: "end", beats: 9, enter: "zoom" },
];

export const TOTAL_BEATS = CUTS.reduce((n, c) => n + c.beats, 0);
export const TOTAL_SECONDS = TOTAL_BEATS * BEAT_SECONDS;

/** Seconds a transition takes: 0.15 s, nine frames at 60. */
export const TRANSITION_SECONDS = 0.15;

export interface SceneFrames extends Cut {
  index: number;
  /** First frame of the scene's nominal span. */
  from: number;
  /** Nominal length in frames (start to the next scene's start). */
  nominal: number;
  /** Frames the Sequence actually runs: nominal + the overlap for the next scene's transition. */
  duration: number;
  /** The transition the *next* scene comes in with (what this scene leaves under). */
  exit: Transition;
  startSeconds: number;
}

export function sceneFrames(fps: number): SceneFrames[] {
  const t = Math.round(TRANSITION_SECONDS * fps);
  let b = 0;
  return CUTS.map((cut, index) => {
    const startSeconds = b * BEAT_SECONDS;
    const from = Math.round(startSeconds * fps);
    const endSeconds = (b + cut.beats) * BEAT_SECONDS;
    const nominal = Math.round(endSeconds * fps) - from;
    const next = CUTS[index + 1];
    const exit: Transition = next ? next.enter : "none";
    b += cut.beats;
    return {
      ...cut,
      index,
      from,
      nominal,
      duration: nominal + (next ? t : 0),
      exit,
      startSeconds,
    };
  });
}

export const totalFrames = (fps: number): number => Math.round(TOTAL_SECONDS * fps);
export const transitionFrames = (fps: number): number => Math.round(TRANSITION_SECONDS * fps);
