import { uid } from "./id";
import { clamp } from "./time";
import type { CursorSample, ZoomClip } from "../types";

/**
 * Zoom timing model:
 * - clips are generated sparsely (clicks + long dwells), then merged so the
 *   camera never "pumps" in/out across short gaps,
 * - the in/out transitions live inside the clip and use smootherstep, which has
 *   zero velocity AND zero acceleration at both ends — no visible jerk,
 * - cursor following uses a gaussian-weighted average over a trailing window,
 *   so it is deterministic for any t (export can seek anywhere) yet smooth.
 */
const ZOOM_IN_TIME = 0.85;
const ZOOM_OUT_TIME = 1.05;
const FOLLOW_WINDOW = 0.5;
const FOLLOW_SIGMA = 0.16;
const FOLLOW_GAIN = 0.55;

function smootherstep(p: number): number {
  const t = clamp(p, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function sampleCursor(cursor: CursorSample[], t: number): CursorSample | null {
  if (!cursor.length) return null;
  if (t <= cursor[0].t) return cursor[0];
  if (t >= cursor[cursor.length - 1].t) return cursor[cursor.length - 1];
  let lo = 0;
  let hi = cursor.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cursor[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = cursor[lo];
  const b = cursor[hi];
  const u = (t - a.t) / Math.max(0.0001, b.t - a.t);
  return {
    t,
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    down: u < 0.5 ? a.down : b.down,
  };
}

/** Gaussian-weighted cursor position over [t - FOLLOW_WINDOW, t]. Deterministic per t. */
function smoothedCursor(
  cursor: CursorSample[],
  t: number,
): { x: number; y: number } | null {
  if (!cursor.length) return null;
  const steps = 9;
  let wSum = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < steps; i++) {
    const dt = (i / (steps - 1)) * FOLLOW_WINDOW;
    const s = sampleCursor(cursor, t - dt);
    if (!s) continue;
    const w = Math.exp(-(dt * dt) / (2 * FOLLOW_SIGMA * FOLLOW_SIGMA));
    x += s.x * w;
    y += s.y * w;
    wSum += w;
  }
  if (wSum <= 0) return null;
  return { x: x / wSum, y: y / wSum };
}

interface Interest {
  t: number;
  x: number;
  y: number;
  click: boolean;
}

export function generateZoomKeyframes(
  samples: CursorSample[],
  width: number,
  height: number,
): ZoomClip[] {
  if (samples.length < 3 || width <= 0 || height <= 0) return [];

  const stillSpeed = Math.max(80, Math.min(width, height) * 0.07);
  const dwellMin = 0.65;
  const minDur = 2.4;
  const maxDur = 7;
  const mergeGap = 1.3;
  const moveDist = Math.min(width, height) * 0.22;

  const speeds = samples.map((s, i) => {
    if (i === 0) return 0;
    const dt = Math.max(0.001, s.t - samples[i - 1].t);
    return Math.hypot(s.x - samples[i - 1].x, s.y - samples[i - 1].y) / dt;
  });

  // 1. Collect interest points: clicks + sustained dwells.
  const interests: Interest[] = [];
  let dwellStart = -1;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.down && (i === 0 || !samples[i - 1].down)) {
      interests.push({ t: s.t, x: s.x, y: s.y, click: true });
      dwellStart = -1;
      continue;
    }
    if (speeds[i] < stillSpeed) {
      if (dwellStart < 0) dwellStart = i;
      const origin = samples[dwellStart];
      if (
        s.t - origin.t >= dwellMin &&
        (interests.length === 0 || s.t - interests[interests.length - 1].t > 0.4)
      ) {
        interests.push({ t: origin.t, x: origin.x, y: origin.y, click: false });
      }
    } else {
      dwellStart = -1;
    }
  }
  if (!interests.length) return [];

  // 2. Turn interest points into raw intervals: hold until the cursor leaves
  //    the neighbourhood for good (not just a quick flick).
  interface Raw {
    start: number;
    end: number;
    x: number;
    y: number;
    click: boolean;
  }
  const raw: Raw[] = [];
  for (const point of interests) {
    const prev = raw[raw.length - 1];
    if (prev && point.t < prev.end + 0.3) {
      // Interest inside/near an existing interval: extend it instead.
      prev.end = Math.max(prev.end, Math.min(point.t + minDur, point.t + maxDur));
      prev.click = prev.click || point.click;
      continue;
    }
    let end = point.t + minDur;
    let cursorAway = 0;
    for (let t = point.t; t < point.t + maxDur; t += 0.1) {
      const c = sampleCursor(samples, t);
      if (!c) break;
      const dist = Math.hypot(c.x - point.x, c.y - point.y);
      cursorAway = dist > moveDist ? cursorAway + 0.1 : 0;
      if (cursorAway >= 0.45) {
        end = Math.max(end, t - cursorAway);
        break;
      }
      end = Math.max(end, t);
    }
    raw.push({ start: point.t, end: Math.min(point.t + maxDur, end), x: point.x, y: point.y, click: point.click });
  }

  // 3. Merge intervals separated by short gaps — the camera should stay in
  //    rather than pump out and back in within a second.
  const merged: Raw[] = [];
  for (const r of raw) {
    const prev = merged[merged.length - 1];
    if (prev && r.start - prev.end < mergeGap) {
      prev.end = Math.max(prev.end, r.end);
      prev.click = prev.click || r.click;
    } else {
      merged.push({ ...r });
    }
  }

  // 4. Emit clips; drop anything that ended up too short to play a full
  //    in+out transition comfortably.
  return merged
    .filter((r) => r.end - r.start >= ZOOM_IN_TIME + ZOOM_OUT_TIME + 0.4)
    .map((r) => ({
      id: uid("zoom"),
      start: r.start,
      end: r.end,
      scale: r.click ? 1.85 : 1.65,
      x: clamp(r.x / width, 0.1, 0.9),
      y: clamp(r.y / height, 0.1, 0.9),
      easing: "ease-in-out" as const,
      followCursor: true,
      source: "auto" as const,
    }));
}

export function getZoomTransform(
  zooms: ZoomClip[],
  t: number,
  cursor: CursorSample[],
  width: number,
  height: number,
): { scale: number; x: number; y: number } {
  const z = zooms.find((clip) => t >= clip.start && t <= clip.end);
  if (!z) return { scale: 1, x: 0.5, y: 0.5 };

  const dur = Math.max(0.001, z.end - z.start);
  // Never let in+out eat more than ~85% of the clip.
  const inT = Math.min(ZOOM_IN_TIME, dur * 0.45);
  const outT = Math.min(ZOOM_OUT_TIME, dur * 0.45);

  let k = 1;
  const sinceStart = t - z.start;
  const untilEnd = z.end - t;
  if (sinceStart < inT) k = smootherstep(sinceStart / inT);
  if (untilEnd < outT) k = Math.min(k, smootherstep(untilEnd / outT));

  let x = z.x;
  let y = z.y;
  if (z.followCursor && width > 0 && height > 0) {
    const c = smoothedCursor(cursor, t);
    if (c) {
      const cx = clamp(c.x / width, 0.05, 0.95);
      const cy = clamp(c.y / height, 0.05, 0.95);
      const follow = FOLLOW_GAIN * k;
      x = z.x + (cx - z.x) * follow;
      y = z.y + (cy - z.y) * follow;
    }
  }

  // The anchor-point transform keeps all edges inside the frame for any
  // anchor in [0, 1], so a gentle clamp is all we need.
  return {
    scale: 1 + (z.scale - 1) * k,
    x: clamp(x, 0.03, 0.97),
    y: clamp(y, 0.03, 0.97),
  };
}

export function sampleCursorAt(cursor: CursorSample[], t: number): CursorSample | null {
  return sampleCursor(cursor, t);
}
