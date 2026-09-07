import { uid } from "./id";
import { clamp } from "./time";
import type { CaptureRect, CursorSample, ZoomClip } from "../types";

/**
 * Zoom timing model:
 * - clips are generated sparsely (clicks + long dwells), then merged so the
 *   camera never "pumps" in/out across short gaps,
 * - the in/out transitions live inside the clip and use smootherstep, which has
 *   zero velocity AND zero acceleration at both ends — no visible jerk,
 * - a clip's `x`/`y` is the point of interest, in frame fractions; the view is
 *   centred on it as far as the frame's edges allow (see `anchorFor`), so a
 *   click in a corner is framed with the corner rather than pushed out of shot,
 * - following is a camera, not a filter: a dead zone the cursor roams in, a
 *   critically damped spring that carries the view when it leaves, a leash
 *   that never lets the pointer out of shot, and a little look-ahead. The
 *   whole path is solved once from the cursor track (`cameraPath`), so any
 *   frame can be rendered on its own and the export can seek anywhere.
 */
const ZOOM_IN_TIME = 0.85;
const ZOOM_OUT_TIME = 1.05;
/** Camera path resolution; fine enough that a 60 fps export never sees a step between samples. */
const PATH_HZ = 120;
/** Seconds the camera reads ahead in the cursor track — the take is on disk, so it may know where the pointer is going. */
const LOOK_AHEAD = 0.12;
/** Half-width of the dead zone, as a fraction of the view: the cursor roams this far from the aim before the camera moves. */
const DEAD_ZONE = 0.26;
/** The most, as a fraction of the view, the cursor is ever allowed from the centre. */
const LEASH = 0.44;
/** Critically damped spring, rad/s: no overshoot, about 0.4 s to settle. */
const OMEGA = 11;
/** Cursor speed (frame widths per second) past which the shot widens — a sweep across the screen is not something to chase at full zoom. */
const SWEEP_SPEED = 0.9;
const SWEEP_GAIN = 0.6;
/** How much of the zoom-in survives the fastest sweep. */
const SWEEP_MIN = 0.55;

function smootherstep(p: number): number {
  const t = clamp(p, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** The two samples around `t` and how far between them it falls. */
function bracket(cursor: CursorSample[], t: number): { a: CursorSample; b: CursorSample; u: number } | null {
  if (!cursor.length) return null;
  if (t <= cursor[0].t) return { a: cursor[0], b: cursor[0], u: 0 };
  const last = cursor[cursor.length - 1];
  if (t >= last.t) return { a: last, b: last, u: 0 };
  let lo = 0;
  let hi = cursor.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cursor[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = cursor[lo];
  const b = cursor[hi];
  return { a, b, u: (t - a.t) / Math.max(0.0001, b.t - a.t) };
}

function sampleCursor(cursor: CursorSample[], t: number): CursorSample | null {
  const br = bracket(cursor, t);
  if (!br) return null;
  const { a, b, u } = br;
  return {
    t,
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    down: u < 0.5 ? a.down : b.down,
  };
}

interface Interest {
  t: number;
  x: number;
  y: number;
  click: boolean;
  /** How long past `t` the zoom is held for this point alone. */
  hold: number;
}

/**
 * `rect` is the piece of desktop the video shows — cursor samples are in
 * desktop pixels, so every distance and every anchor is measured against it,
 * not against the whole (possibly multi-monitor) virtual screen.
 */
export function generateZoomKeyframes(samples: CursorSample[], rect: CaptureRect): ZoomClip[] {
  const width = rect.width;
  const height = rect.height;
  if (samples.length < 3 || width <= 0 || height <= 0) return [];

  const onSurface = (s: { x: number; y: number }) =>
    s.x >= rect.x && s.x <= rect.x + width && s.y >= rect.y && s.y <= rect.y + height;

  const stillSpeed = Math.max(80, Math.min(width, height) * 0.07);
  const dwellMin = 0.65;
  /** A pointer at rest keeps the zoom in this long after it came to rest; a screen nobody touches for longer is a still, not a moment. */
  const dwellHold = 6;
  const dwellTail = 1.2;
  const minDur = 2.4;
  const maxDur = 10;
  const mergeGap = 2.5;
  const moveDist = Math.min(width, height) * 0.22;

  // A gap in the samples (a failed read, a busy machine) divides a short
  // distance by a long time and reads as a dwell that never happened. Anything
  // past a few poll intervals is "unknown", not "still".
  const MAX_GAP = 0.25;
  const speeds = samples.map((s, i) => {
    if (i === 0) return 0;
    const dt = s.t - samples[i - 1].t;
    if (dt > MAX_GAP) return Infinity;
    return Math.hypot(s.x - samples[i - 1].x, s.y - samples[i - 1].y) / Math.max(0.001, dt);
  });

  // 1. Collect interest points: clicks + sustained dwells.
  const interests: Interest[] = [];
  let dwellStart = -1;
  let dwellPushed = false;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    // A click or dwell on another screen says nothing about this take's framing.
    if (!onSurface(s)) {
      dwellStart = -1;
      continue;
    }
    if (s.down && (i === 0 || !samples[i - 1].down)) {
      interests.push({ t: s.t, x: s.x, y: s.y, click: true, hold: minDur });
      dwellStart = -1;
      continue;
    }
    if (speeds[i] < stillSpeed) {
      if (dwellStart < 0) {
        dwellStart = i;
        dwellPushed = false;
      }
      const origin = samples[dwellStart];
      const still = s.t - origin.t;
      // The first interest opens the zoom at the moment the pointer came to
      // rest; the ones after keep it held while the pointer stays there.
      if (
        still >= dwellMin &&
        still <= dwellHold &&
        (interests.length === 0 || s.t - interests[interests.length - 1].t > 0.4)
      ) {
        interests.push(
          dwellPushed
            ? { t: s.t, x: origin.x, y: origin.y, click: false, hold: dwellTail }
            : { t: origin.t, x: origin.x, y: origin.y, click: false, hold: minDur },
        );
        dwellPushed = true;
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
      prev.end = Math.max(prev.end, point.t + point.hold);
      prev.click = prev.click || point.click;
      continue;
    }
    let end = point.t + Math.max(minDur, point.hold);
    let cursorAway = 0;
    for (let t = point.t; t < point.t + maxDur; t += 0.1) {
      const c = sampleCursor(samples, t);
      if (!c) break;
      const dist = Math.hypot(c.x - point.x, c.y - point.y);
      cursorAway = dist > moveDist ? cursorAway + 0.1 : 0;
      if (cursorAway >= 0.9) {
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
      x: clamp((r.x - rect.x) / width, 0, 1),
      y: clamp((r.y - rect.y) / height, 0, 1),
      easing: "ease-in-out" as const,
      followCursor: true,
      source: "auto" as const,
    }));
}

/**
 * The anchor the compositor has to scale about so that the view — the
 * 1/scale-wide window it shows — is centred on `point`, or as near to centred
 * as the frame's edges allow. The point itself used to *be* the anchor, which
 * keeps it at its own relative position in the view: a click at 0.98 stayed at
 * 0.98 of the view, on the very edge, and once the anchor was clamped to 0.9
 * the bottom 5% of the frame — the click included — was outside the shot.
 * Centring instead frames a click in a corner with the corner, edge to edge.
 */
export function anchorFor(point: number, scale: number): number {
  if (!(scale > 1.0001)) return 0.5;
  const half = 0.5 / scale;
  const centre = clamp(point, half, 1 - half);
  return clamp((centre * scale - 0.5) / (scale - 1), 0, 1);
}

/** The slice of the frame (0–1) the compositor shows for an anchor and a scale. */
export function viewWindow(anchor: number, scale: number): { start: number; end: number } {
  const start = anchor * (1 - 1 / scale);
  return { start, end: start + 1 / scale };
}

/** How long a clip eases in and out; between them they never eat more than ~85% of it. */
export function zoomEase(clip: ZoomClip): { inT: number; outT: number } {
  const dur = Math.max(0.001, clip.end - clip.start);
  return { inT: Math.min(ZOOM_IN_TIME, dur * 0.45), outT: Math.min(ZOOM_OUT_TIME, dur * 0.45) };
}

/** The active clip at `t` and the eased scale it asks for. */
function envelopeAt(zooms: ZoomClip[], t: number): { clip: ZoomClip | null; scale: number } {
  const z = zooms.find((clip) => t >= clip.start && t <= clip.end);
  if (!z) return { clip: null, scale: 1 };
  const { inT, outT } = zoomEase(z);
  let k = 1;
  const sinceStart = t - z.start;
  const untilEnd = z.end - t;
  if (sinceStart < inT) k = smootherstep(sinceStart / inT);
  if (untilEnd < outT) k = Math.min(k, smootherstep(untilEnd / outT));
  return { clip: z, scale: 1 + (z.scale - 1) * k };
}

/**
 * The transform for one moment: `scale`, and the anchor (`x`, `y`, in frame
 * fractions) to scale about. The centre comes from the solved camera path;
 * `anchorFor` turns a centre into the anchor.
 */
export function getZoomTransform(
  zooms: ZoomClip[],
  t: number,
  cursor: CursorSample[],
  rect: CaptureRect,
): { scale: number; x: number; y: number } {
  if (!envelopeAt(zooms, t).clip) return { scale: 1, x: 0.5, y: 0.5 };
  const at = samplePath(cameraPath(zooms, cursor, rect), t);
  return { scale: at.s, x: anchorFor(at.x, at.s), y: anchorFor(at.y, at.s) };
}

export function sampleCursorAt(cursor: CursorSample[], t: number): CursorSample | null {
  return sampleCursor(cursor, t);
}

export interface CameraPath {
  hz: number;
  x: Float64Array;
  y: Float64Array;
  /** The scale actually shown: the clip's envelope, eased wider while the cursor sweeps. */
  s: Float64Array;
}

const pathCache = new WeakMap<ZoomClip[], { key: string; cursor: CursorSample[]; path: CameraPath }>();

/**
 * The camera's centre over the whole take, solved once and read back at any
 * `t`: the export seeks anywhere, so the motion cannot depend on the frames
 * drawn before it. Cached on the clip list, which every edit replaces.
 */
export function cameraPath(zooms: ZoomClip[], cursor: CursorSample[], rect: CaptureRect): CameraPath {
  const key = `${rect.x},${rect.y},${rect.width},${rect.height}`;
  const hit = pathCache.get(zooms);
  if (hit && hit.key === key && hit.cursor === cursor) return hit.path;
  const path = solveCamera(zooms, cursor, rect);
  pathCache.set(zooms, { key, cursor, path });
  return path;
}

function samplePath(path: CameraPath, t: number): { x: number; y: number; s: number } {
  const n = path.x.length;
  if (n === 0) return { x: 0.5, y: 0.5, s: 1 };
  const f = Math.max(0, t * path.hz);
  const i = Math.min(n - 1, Math.floor(f));
  const j = Math.min(n - 1, i + 1);
  const u = Math.min(1, f - i);
  const mix = (a: Float64Array) => a[i] + (a[j] - a[i]) * u;
  return { x: mix(path.x), y: mix(path.y), s: mix(path.s) };
}

/**
 * How the camera moves, in the order the rules apply on every step:
 *
 * 1. A clip opens with its point of interest as the aim, and the spring
 *    already at rest on it: the zoom-in is a straight zoom into the click,
 *    flush with the frame's edge when the click is near one.
 * 2. While following, the cursor roams inside a dead zone around the aim
 *    without moving anything; once it leaves, the aim is pushed just far
 *    enough to take it back in. The cursor is read a little ahead of time.
 * 3. A critically damped spring carries the camera to the aim — no overshoot,
 *    no visible jerk.
 * 4. The leash: whatever the spring is doing, the cursor is never further from
 *    the centre than LEASH of the view. A flick across the screen pulls the
 *    camera along instead of leaving the pointer out of shot.
 * 5. The centre is clamped so the view stays inside the frame. It acts on the
 *    output, not the spring, so a zoom into a corner tracks the edge exactly.
 */
function solveCamera(zooms: ZoomClip[], cursor: CursorSample[], rect: CaptureRect): CameraPath {
  const lastCursor = cursor.length ? cursor[cursor.length - 1].t : 0;
  const lastClip = zooms.reduce((m, z) => Math.max(m, z.end), 0);
  const n = Math.min(2_000_000, Math.ceil(Math.max(lastCursor, lastClip) * PATH_HZ) + 2);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const ss = new Float64Array(n);
  const dt = 1 / PATH_HZ;
  const w = rect.width;
  const h = rect.height;
  const norm = (c: { x: number; y: number }) => ({ x: clamp((c.x - rect.x) / w, 0, 1), y: clamp((c.y - rect.y) / h, 0, 1) });
  // A pointer off the recorded surface (another screen) is not in the video;
  // chasing it would drag the camera to an edge for nothing. A moment between
  // an on-screen sample and an off-screen one counts as off too: that is the
  // pointer leaving, not something to frame.
  const onSurface = (c: CursorSample) =>
    c.x >= rect.x - w * 0.02 && c.x <= rect.x + w * 1.02 && c.y >= rect.y - h * 0.02 && c.y <= rect.y + h * 1.02;
  const read = (t: number): { x: number; y: number } | null => {
    const br = bracket(cursor, t);
    if (!br || !onSurface(br.a) || !onSurface(br.b)) return null;
    return { x: br.a.x + (br.b.x - br.a.x) * br.u, y: br.a.y + (br.b.y - br.a.y) * br.u };
  };

  let aimX = 0.5;
  let aimY = 0.5;
  let sx = 0.5;
  let sy = 0.5;
  let vx = 0;
  let vy = 0;
  let active: ZoomClip | null = null;
  /** Dolly multiplier on the zoom-in amount: 1 at rest, down to SWEEP_MIN across a fast sweep. */
  let dolly = 1;
  for (let i = 0; i < n; i++) {
    const t = i * dt;
    const { clip, scale: envelope } = envelopeAt(zooms, t);
    const follow = Boolean(clip?.followCursor) && cursor.length > 0 && w > 0 && h > 0;
    let wanted = 1;
    if (follow) {
      const a = read(t - 0.05);
      const b = read(t + 0.05);
      if (a && b) {
        const speed = Math.hypot((b.x - a.x) / w, (b.y - a.y) / h) / 0.1;
        wanted = clamp(1 - (speed - SWEEP_SPEED) * SWEEP_GAIN, SWEEP_MIN, 1);
      }
    }
    // Quick to widen, unhurried to come back in.
    dolly += (wanted - dolly) * Math.min(1, dt / (wanted < dolly ? 0.2 : 0.7));
    const scale = 1 + (envelope - 1) * dolly;
    const half = 0.5 / scale;
    if (clip !== active) {
      active = clip;
      aimX = clip ? clip.x : 0.5;
      aimY = clip ? clip.y : 0.5;
      sx = aimX;
      sy = aimY;
      vx = 0;
      vy = 0;
    }
    if (follow) {
      const ahead = read(t + LOOK_AHEAD);
      if (ahead) {
        const p = norm(ahead);
        const dz = DEAD_ZONE / scale;
        if (p.x > aimX + dz) aimX = p.x - dz;
        else if (p.x < aimX - dz) aimX = p.x + dz;
        if (p.y > aimY + dz) aimY = p.y - dz;
        else if (p.y < aimY - dz) aimY = p.y + dz;
      }
    }
    vx += (OMEGA * OMEGA * (aimX - sx) - 2 * OMEGA * vx) * dt;
    vy += (OMEGA * OMEGA * (aimY - sy) - 2 * OMEGA * vy) * dt;
    sx += vx * dt;
    sy += vy * dt;
    let x = clamp(sx, half, 1 - half);
    let y = clamp(sy, half, 1 - half);
    if (follow) {
      const now = read(t);
      if (now) {
        const p = norm(now);
        const leash = LEASH / scale;
        if (p.x > x + leash) {
          sx = p.x - leash;
          vx = 0;
        } else if (p.x < x - leash) {
          sx = p.x + leash;
          vx = 0;
        }
        if (p.y > y + leash) {
          sy = p.y - leash;
          vy = 0;
        } else if (p.y < y - leash) {
          sy = p.y + leash;
          vy = 0;
        }
        x = clamp(sx, half, 1 - half);
        y = clamp(sy, half, 1 - half);
      }
    }
    xs[i] = x;
    ys[i] = y;
    ss[i] = scale;
  }
  return { hz: PATH_HZ, x: xs, y: ys, s: ss };
}
