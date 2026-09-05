import type { Segment, Transition, TransitionKind } from "../types";

/**
 * A transition belongs to the segment it leads into and blends the last frame
 * of the previous segment over the first moments of the new one. The
 * compositor only ever sees "kind, progress, and a snapshot of what was on
 * screen", so the same code serves the live preview and the frame-exact
 * export: whoever drives the frames keeps the snapshot.
 */

export const TRANSITION_KINDS: { id: TransitionKind; name: string; hint: string }[] = [
  { id: "none", name: "Cut", hint: "Hard cut, no blend." },
  { id: "crossfade", name: "Crossfade", hint: "The new shot fades in over the old one." },
  { id: "dip-black", name: "Dip to black", hint: "Fade out, then in through black." },
  { id: "dip-white", name: "Dip to white", hint: "Fade out, then in through white." },
  { id: "slide-left", name: "Push left", hint: "The new shot pushes the old one off to the left." },
  { id: "slide-up", name: "Push up", hint: "The new shot pushes the old one upward." },
  { id: "zoom", name: "Zoom through", hint: "The old shot grows and dissolves." },
];

export const MIN_TRANSITION = 0.2;
export const MAX_TRANSITION = 1.5;
export const DEFAULT_TRANSITION: Transition = { kind: "crossfade", duration: 0.5 };

export function clampTransitionDuration(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TRANSITION.duration;
  return Math.min(MAX_TRANSITION, Math.max(MIN_TRANSITION, value));
}

/** Zero velocity and acceleration at both ends — the same curve the zoom uses. */
export function easeInOut(p: number): number {
  const t = Math.min(1, Math.max(0, p));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Index of the segment covering a timeline time; the last one past the end, -1 with no segments. */
export function segmentIndexAtTimeline(segments: Segment[], t: number): number {
  if (!segments.length) return -1;
  let acc = 0;
  for (let i = 0; i < segments.length; i++) {
    const len = Math.max(0, segments[i].end - segments[i].start);
    if (t < acc + len) return i;
    acc += len;
  }
  return segments.length - 1;
}

/** Timeline time at which segment `index` starts. */
export function segmentTimelineStart(segments: Segment[], index: number): number {
  let acc = 0;
  for (let i = 0; i < index && i < segments.length; i++) {
    acc += Math.max(0, segments[i].end - segments[i].start);
  }
  return acc;
}

export interface TransitionWindow {
  index: number;
  transition: Transition;
  /** Seconds since the segment started, on the timeline. */
  elapsed: number;
  progress: number;
}

/**
 * The transition that is live at `t`, if any: the segment at `t` must not be
 * the first, must carry a transition, and `t` must still be inside its
 * duration (capped at the segment's own length so a short clip never blends
 * past its end).
 */
export function transitionAt(segments: Segment[], t: number): TransitionWindow | null {
  const index = segmentIndexAtTimeline(segments, t);
  if (index <= 0) return null;
  const seg = segments[index];
  const transition = seg.transition;
  if (!transition || transition.kind === "none" || transition.duration <= 0) return null;
  const elapsed = t - segmentTimelineStart(segments, index);
  const duration = Math.min(transition.duration, Math.max(0.05, seg.end - seg.start));
  if (elapsed < 0 || elapsed >= duration) return null;
  return { index, transition, elapsed, progress: elapsed / duration };
}

/** Time left in the current segment; the frame driver uses it to decide when to keep a snapshot. */
export function timeToNextCut(segments: Segment[], t: number): number {
  const index = segmentIndexAtTimeline(segments, t);
  if (index < 0) return Infinity;
  const end = segmentTimelineStart(segments, index) + (segments[index].end - segments[index].start);
  return end - t;
}

export function nextSegmentHasTransition(segments: Segment[], t: number): boolean {
  const index = segmentIndexAtTimeline(segments, t);
  const next = index >= 0 ? segments[index + 1] : undefined;
  return Boolean(next?.transition && next.transition.kind !== "none");
}

export interface ActiveTransition {
  kind: TransitionKind;
  progress: number;
  /** What was on screen when the previous segment ended. */
  outgoing: CanvasImageSource;
}

/**
 * How far before a cut the outgoing frame is kept. Every frame inside this
 * window costs a full-frame copy, so it stays a handful of frames: long enough
 * that playback always catches one, short enough to be free.
 */
const SNAPSHOT_WINDOW = 0.1;
/** A snapshot older than this belongs to a different pass over the timeline. */
const SNAPSHOT_STALE = 0.4;

/**
 * One scratch canvas, reused. A push transition needs a copy of the incoming
 * frame to slide it in; allocating that canvas per frame — 60 full-frame GPU
 * surfaces a second — is what made playback stutter at every cut.
 */
let scratch: HTMLCanvasElement | null = null;

function scratchCanvas(width: number, height: number): HTMLCanvasElement {
  if (!scratch) scratch = document.createElement("canvas");
  if (scratch.width !== width) scratch.width = width;
  if (scratch.height !== height) scratch.height = height;
  return scratch;
}

interface Snapshot {
  canvas: HTMLCanvasElement;
  /** Segment the frame was captured in. */
  segment: number;
  /** Timeline time it was captured at, to spot a stale one after a scrub. */
  at: number;
}

/**
 * Keeps the last frame before a cut so the compositor can blend it in.
 * Drive it per frame: `begin()` before drawing, `end()` while drawing (the
 * compositor calls it through `onFrameReady`, before it blends anything, so a
 * snapshot never contains a previous blend or the watermark).
 *
 * Two slots, not one. With clips shorter than a second the frame before the
 * *next* cut has to be captured while the *current* transition is still
 * playing; a single slot meant that capture overwrote the frame being blended,
 * the blend dropped out for a few frames, and the picture strobed at every cut.
 */
export class TransitionTracker {
  /** At most two: the one being blended, and the one for the cut ahead. */
  private buffers: HTMLCanvasElement[] = [];
  private pending: Snapshot | null = null;
  private current: Snapshot | null = null;

  begin(segments: Segment[], timelineTime: number): ActiveTransition | null {
    const win = transitionAt(segments, timelineTime);
    if (!win) return null;
    // Crossing into the segment it leads into promotes the pending frame.
    if (this.pending && this.pending.segment === win.index - 1) {
      this.current = { ...this.pending, segment: win.index };
      this.pending = null;
    }
    if (!this.current || this.current.segment !== win.index) return null;
    // It must belong to *this* cut, not to an earlier pass over the timeline.
    const cut = segmentTimelineStart(segments, win.index);
    if (Math.abs(cut - this.current.at) > SNAPSHOT_STALE) return null;
    return { kind: win.transition.kind, progress: win.progress, outgoing: this.current.canvas };
  }

  end(
    canvas: HTMLCanvasElement,
    segments: Segment[],
    timelineTime: number,
    lookahead = SNAPSHOT_WINDOW,
  ): void {
    if (!nextSegmentHasTransition(segments, timelineTime)) return;
    const left = timeToNextCut(segments, timelineTime);
    if (left < 0 || left > lookahead) return;
    const target = this.acquire(canvas.width, canvas.height);
    const ctx = target.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(canvas, 0, 0);
    this.pending = {
      canvas: target,
      segment: segmentIndexAtTimeline(segments, timelineTime),
      at: timelineTime,
    };
  }

  /** A buffer to write into — anything except the frame being blended right now. */
  private acquire(width: number, height: number): HTMLCanvasElement {
    let target =
      this.pending?.canvas ?? this.buffers.find((b) => b !== this.current?.canvas) ?? null;
    if (!target) {
      target = document.createElement("canvas");
      this.buffers.push(target);
    }
    if (target.width !== width) target.width = width;
    if (target.height !== height) target.height = height;
    return target;
  }

  reset(): void {
    this.pending = null;
    this.current = null;
  }
}

/**
 * Blends the outgoing snapshot over a fully drawn frame. Called by the
 * compositor after everything but the watermark is on the canvas.
 */
export function drawTransition(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  active: ActiveTransition,
): void {
  const p = easeInOut(active.progress);
  ctx.save();
  switch (active.kind) {
    case "crossfade":
      ctx.globalAlpha = 1 - p;
      ctx.drawImage(active.outgoing, 0, 0, width, height);
      break;
    case "dip-black":
    case "dip-white": {
      // First half: the old frame fades to the colour; second half: the new frame fades in.
      const color = active.kind === "dip-black" ? "#000000" : "#ffffff";
      const raw = active.progress;
      if (raw < 0.5) {
        ctx.drawImage(active.outgoing, 0, 0, width, height);
        ctx.globalAlpha = easeInOut(raw * 2);
      } else {
        ctx.globalAlpha = 1 - easeInOut((raw - 0.5) * 2);
      }
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, width, height);
      break;
    }
    case "slide-left":
    case "slide-up": {
      // Push: the new frame (already drawn) is copied and shifted in from the edge.
      const incoming = scratchCanvas(width, height);
      const icx = incoming.getContext("2d");
      if (!icx) break;
      icx.clearRect(0, 0, width, height);
      icx.drawImage(ctx.canvas, 0, 0);
      const dx = active.kind === "slide-left" ? width : 0;
      const dy = active.kind === "slide-up" ? height : 0;
      ctx.drawImage(active.outgoing, -dx * p, -dy * p, width, height);
      ctx.drawImage(incoming, dx * (1 - p), dy * (1 - p), width, height);
      break;
    }
    case "zoom": {
      const scale = 1 + 0.18 * p;
      ctx.globalAlpha = 1 - p;
      ctx.translate(width / 2, height / 2);
      ctx.scale(scale, scale);
      ctx.drawImage(active.outgoing, -width / 2, -height / 2, width, height);
      break;
    }
    case "none":
      break;
  }
  ctx.restore();
}

/** Alpha of the black veil for fade-in / fade-out at the timeline ends. */
export function fadeVeilAlpha(timelineTime: number, duration: number, fadeIn: number, fadeOut: number): number {
  let alpha = 0;
  if (fadeIn > 0 && timelineTime < fadeIn) alpha = Math.max(alpha, 1 - timelineTime / fadeIn);
  if (fadeOut > 0 && duration > 0 && timelineTime > duration - fadeOut) {
    alpha = Math.max(alpha, (timelineTime - (duration - fadeOut)) / fadeOut);
  }
  return Math.min(1, Math.max(0, alpha));
}
