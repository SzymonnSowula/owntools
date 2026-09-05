import type {
  CaptureRect,
  CaptureSource,
  CursorAlign,
  CursorSample,
  MonitorInfo,
  Project,
  SurfaceSample,
} from "../types";

/**
 * Where a cursor sample lands inside the video frame.
 *
 * The recorder samples the pointer in virtual-desktop coordinates: on a
 * two-monitor desk with a screen to the left of the primary, that space runs
 * from x = -1920 to x = 2560. The video, meanwhile, shows exactly one
 * rectangle of that desktop — one monitor, or one window. Dividing the
 * pointer's x by the whole desktop's width (which is what this used to do)
 * puts the drawn cursor a whole screen away from the real one.
 *
 * So everything here maps through `captureRect`: the rectangle, in those same
 * desktop pixels, that the video actually shows. Recordings made from now on
 * carry theirs; older ones get an estimate (see `estimateCaptureRect`) and a
 * manual nudge.
 */

export const IDENTITY_ALIGN: CursorAlign = { dx: 0, dy: 0, scale: 1 };

/** How far outside the frame a sample may sit before the pointer is hidden. */
const OUTSIDE_MARGIN = 0.015;

export function rectIsUsable(rect: CaptureRect | undefined | null): rect is CaptureRect {
  return Boolean(rect && rect.width > 0 && rect.height > 0);
}

/** Relative difference of two shapes (aspect ratios); 0 is identical. */
export function shapeDiff(aw: number, ah: number, bw: number, bh: number): number {
  const a = aw / Math.max(1, ah);
  const b = bw / Math.max(1, bh);
  return Math.abs(a - b) / Math.max(a, b);
}

/**
 * How far two shapes may differ and still be one surface. A screen the browser
 * scales down keeps its shape to well under 1%; a screen against the window
 * filling its work area (the taskbar is the difference) is ~3% off.
 */
export const SHAPE_TOLERANCE = 0.012;

export function sameShape(aw: number, ah: number, bw: number, bh: number): boolean {
  return shapeDiff(aw, ah, bw, bh) <= SHAPE_TOLERANCE;
}

/**
 * The video's shape anchored at a screen's top-left and no larger than the
 * screen — what a maximized window shows: the work area above the taskbar.
 * The screen itself when the shapes already agree.
 */
export function fitVideoOnMonitor(monitor: CaptureRect, videoWidth: number, videoHeight: number): CaptureRect {
  const whole = { x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height };
  const videoAspect = videoWidth / Math.max(1, videoHeight);
  if (!(videoAspect > 0) || sameShape(monitor.width, monitor.height, videoWidth, videoHeight)) return whole;
  let width = monitor.width;
  let height = width / videoAspect;
  if (height > monitor.height) {
    height = monitor.height;
    width = height * videoAspect;
  }
  return { x: monitor.x, y: monitor.y, width: Math.round(width), height: Math.round(height) };
}

/**
 * The recorded rectangle at source time `t`. A window that was moved or
 * resized mid-take leaves a `surfaceTrack`; a still one leaves none.
 */
export function captureRectAt(
  project: Pick<Project, "captureRect" | "surfaceTrack">,
  t: number,
): CaptureRect | null {
  const base = project.captureRect;
  if (!rectIsUsable(base)) return null;
  const track = project.surfaceTrack;
  if (!track || track.length === 0) return base;
  let hit: SurfaceSample | null = null;
  for (const s of track) {
    if (s.t <= t) hit = s;
    else break;
  }
  const chosen = hit ?? track[0];
  return rectIsUsable(chosen)
    ? { x: chosen.x, y: chosen.y, width: chosen.width, height: chosen.height }
    : base;
}

/**
 * When the recorded surface's shape stops matching the video's, the capture
 * letterboxes it — the content shrinks into a centred box. These are the
 * factors that box occupies, 1 when the shapes agree.
 */
function letterbox(rectAspect: number, videoAspect: number): { sx: number; sy: number } {
  if (!(rectAspect > 0) || !(videoAspect > 0)) return { sx: 1, sy: 1 };
  if (Math.abs(rectAspect - videoAspect) / videoAspect < 0.005) return { sx: 1, sy: 1 };
  return rectAspect > videoAspect
    ? { sx: 1, sy: videoAspect / rectAspect }
    : { sx: rectAspect / videoAspect, sy: 1 };
}

export interface NormalizedPoint {
  /** Position across the video frame, 0–1. */
  nx: number;
  ny: number;
  /** False when the pointer was off the recorded surface — on another screen, say. */
  inside: boolean;
}

/**
 * Screen pixels → frame fractions. `align` is the user's manual nudge and is
 * applied in frame space, so it means the same thing whatever the rectangle.
 */
export function normalizeCursor(
  x: number,
  y: number,
  rect: CaptureRect,
  videoAspect: number,
  align: CursorAlign = IDENTITY_ALIGN,
): NormalizedPoint {
  const rx = (x - rect.x) / rect.width;
  const ry = (y - rect.y) / rect.height;
  const inside =
    rx >= -OUTSIDE_MARGIN && rx <= 1 + OUTSIDE_MARGIN && ry >= -OUTSIDE_MARGIN && ry <= 1 + OUTSIDE_MARGIN;
  const { sx, sy } = letterbox(rect.width / rect.height, videoAspect);
  const scale = align.scale > 0 ? align.scale : 1;
  return {
    nx: 0.5 + (rx - 0.5) * sx * scale + align.dx,
    ny: 0.5 + (ry - 0.5) * sy * scale + align.dy,
    inside,
  };
}

/** Everything the compositor needs to place cursor effects for one frame. */
export interface CursorFrame {
  rect: CaptureRect;
  align: CursorAlign;
  videoAspect: number;
}

export function cursorFrameAt(project: Project, t: number): CursorFrame | null {
  const rect = captureRectAt(project, t);
  if (!rect) return null;
  const vw = project.videoWidth || 1920;
  const vh = project.videoHeight || 1080;
  return {
    rect,
    align: project.cursorAlign ?? IDENTITY_ALIGN,
    videoAspect: vw / Math.max(1, vh),
  };
}

/**
 * The rectangle auto-zoom should reason in. Zoom anchors are cursor positions
 * too, so they were wrong in exactly the same way.
 */
export function zoomRect(project: Project): CaptureRect {
  const rect = captureRectAt(project, 0);
  if (rect) return rect;
  return {
    x: 0,
    y: 0,
    width: project.screenWidth || project.videoWidth || 1920,
    height: project.screenHeight || project.videoHeight || 1080,
  };
}

function samplesInside(samples: CursorSample[], rect: CaptureRect): number {
  let n = 0;
  for (const s of samples) {
    if (s.x >= rect.x && s.x < rect.x + rect.width && s.y >= rect.y && s.y < rect.y + rect.height) n++;
  }
  return n;
}

export interface EstimatedCapture {
  rect: CaptureRect;
  source: CaptureSource;
  label: string;
}

/**
 * Best guess at what an older recording showed. Those projects stored only
 * the whole virtual desktop's size, but their cursor samples give them away:
 * the pointer spends the take on the recorded screen. Match that screen, then
 * either take it whole (a full-screen take) or fit the video's shape inside it
 * anchored top-left (a maximized window — the taskbar is why the shapes differ).
 *
 * Deliberately conservative: a take that wandered across screens returns null
 * rather than a rectangle that would be confidently wrong.
 */
export function estimateCaptureRect(
  project: Pick<Project, "cursor" | "videoWidth" | "videoHeight">,
  monitors: MonitorInfo[],
): EstimatedCapture | null {
  const samples = project.cursor;
  if (!samples?.length || !monitors.length) return null;
  const videoAspect = (project.videoWidth || 0) / Math.max(1, project.videoHeight || 0);
  if (!(videoAspect > 0)) return null;

  let best: MonitorInfo | null = null;
  let bestCount = -1;
  for (const m of monitors) {
    const count = samplesInside(samples, m);
    if (count > bestCount) {
      best = m;
      bestCount = count;
    }
  }
  if (!best || bestCount / samples.length < 0.6) return null;

  const rect = fitVideoOnMonitor(best, project.videoWidth || 0, project.videoHeight || 0);
  if (rect.width === best.width && rect.height === best.height) {
    return {
      rect,
      source: "monitor",
      label: `${best.name} · ${Math.round(best.width)}×${Math.round(best.height)}`,
    };
  }
  return {
    rect,
    source: "estimated",
    label: `a window on ${best.name} · ${Math.round(rect.width)}×${Math.round(rect.height)}`,
  };
}
