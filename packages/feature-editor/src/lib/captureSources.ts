import type {
  CaptureRect,
  CaptureSource,
  CaptureSurface,
  CursorSample,
  DisplaySources,
  MonitorInfo,
  Project,
  WindowInfo,
} from "../types";
import {
  fitVideoOnMonitor,
  rectIsUsable,
  sameShape,
  shapeDiff,
  SHAPE_TOLERANCE,
  type EstimatedCapture,
} from "./cursorMap";
import { invokeSafe, isTauri } from "./tauri";

/**
 * Working out which rectangle of the desktop a capture shows.
 *
 * The browser tells us the surface *kind* (`displaySurface`) and the track's
 * pixel size, never which screen or window. The OS tells us every candidate's
 * rectangle. What survives the browser's own downscaling — a 2560×1440 monitor
 * handed back as 1920×1080 — is the shape, so the match is on aspect ratio,
 * with exact pixel equality as a tie-break.
 */

/** A capture and its candidate rectangle. */
export interface CaptureMatch {
  rect: CaptureRect;
  source: CaptureSource;
  label: string;
  /** Set for a window, so the take can follow it if it moves. */
  windowId?: string;
  /** `exact` = the sizes agree to the pixel; `likely` = same shape, scaled. */
  confidence: "exact" | "likely";
}

export async function listDisplaySources(): Promise<DisplaySources | null> {
  if (!isTauri()) return null;
  const sources = await invokeSafe<DisplaySources>("list_display_sources");
  if (!sources) return null;
  return {
    monitors: sources.monitors ?? [],
    windows: sources.windows ?? [],
    virtualScreen: sources.virtualScreen,
  };
}

export async function captureWindowRect(id: string): Promise<CaptureRect | null> {
  if (!isTauri()) return null;
  return (await invokeSafe<CaptureRect | null>("capture_window_rect", { id })) ?? null;
}

function contains(rect: CaptureRect, point: { x: number; y: number } | null | undefined): boolean {
  if (!point) return false;
  return (
    point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height
  );
}

/** Two candidates of the same shape are separated by where the pointer is. */
interface Candidate {
  rect: CaptureRect;
  label: string;
  source: CaptureSource;
  windowId?: string;
  exact: boolean;
  diff: number;
  /** Higher wins a tie: the pointer is on it, or it is in front. */
  bonus: number;
}

function monitorCandidate(
  m: MonitorInfo,
  width: number,
  height: number,
  pointer: { x: number; y: number } | null,
): Candidate | null {
  const diff = shapeDiff(m.width, m.height, width, height);
  if (diff > SHAPE_TOLERANCE) return null;
  const rect = { x: m.x, y: m.y, width: m.width, height: m.height };
  return {
    rect,
    label: `${m.name} · ${Math.round(m.width)}×${Math.round(m.height)}`,
    source: "monitor",
    exact: m.width === width && m.height === height,
    diff,
    bonus: (contains(rect, pointer) ? 2 : 0) + (m.primary ? 1 : 0),
  };
}

function windowCandidate(
  w: WindowInfo,
  width: number,
  height: number,
  pointer: { x: number; y: number } | null,
): Candidate | null {
  const diff = shapeDiff(w.width, w.height, width, height);
  if (diff > SHAPE_TOLERANCE) return null;
  const rect = { x: w.x, y: w.y, width: w.width, height: w.height };
  const title = w.title.length > 42 ? `${w.title.slice(0, 41)}…` : w.title;
  return {
    rect,
    label: `${title} · ${Math.round(w.width)}×${Math.round(w.height)}`,
    source: "window",
    windowId: w.id,
    exact: w.width === width && w.height === height,
    diff,
    bonus: (contains(rect, pointer) ? 2 : 0) + (w.foreground ? 1 : 0),
  };
}

function best(candidates: Candidate[]): Candidate | null {
  let winner: Candidate | null = null;
  for (const c of candidates) {
    if (!winner) {
      winner = c;
      continue;
    }
    if (c.exact !== winner.exact) {
      if (c.exact) winner = c;
      continue;
    }
    if (c.bonus !== winner.bonus) {
      if (c.bonus > winner.bonus) winner = c;
      continue;
    }
    if (c.diff < winner.diff) winner = c;
  }
  return winner;
}

/**
 * Picks the recorded rectangle. Returns null when nothing matches or when the
 * surface is a browser tab, whose viewport has no place on the desktop —
 * better no pointer than one drawn in the wrong spot.
 */
export function matchCaptureSource(
  capture: { surface: CaptureSurface; width: number; height: number },
  sources: DisplaySources | null,
  pointer: { x: number; y: number } | null = null,
): CaptureMatch | null {
  if (!sources || capture.width <= 0 || capture.height <= 0) return null;
  if (capture.surface === "browser") return null;

  const monitors = sources.monitors
    .map((m) => monitorCandidate(m, capture.width, capture.height, pointer))
    .filter((c): c is Candidate => c !== null);
  const windows = sources.windows
    .map((w) => windowCandidate(w, capture.width, capture.height, pointer))
    .filter((c): c is Candidate => c !== null);

  // The surface kind decides which list is authoritative; "unknown" (an older
  // WebView2) tries screens first, since a full-screen take is the common one.
  const ordered =
    capture.surface === "window" ? [windows, monitors] : [monitors, windows];
  for (const list of ordered) {
    const pick = best(list);
    if (pick) {
      return {
        rect: pick.rect,
        source: pick.source,
        label: pick.label,
        windowId: pick.windowId,
        confidence: pick.exact ? "exact" : "likely",
      };
    }
  }
  return null;
}

/** Why cursor effects are unavailable, in words the recorder can show. */
export function describeUnmatched(surface: CaptureSurface): string {
  if (surface === "browser") {
    return "This take records a browser tab, and a tab has no fixed place on the desktop — cursor effects need a screen or a window.";
  }
  return "The recorded screen couldn't be identified, so cursor effects stay off. You can line them up by hand in the editor.";
}

/**
 * Second opinion once the file is on disk. The rectangle was matched to the
 * frame size the track reported as the take began — and until the first frame
 * arrives a track reports its *source's* format, which for a window is the
 * screen it sits on. When the recording's real size has a different shape,
 * that size was wrong, and the match is made again with the real one against
 * the same screens and windows.
 */
export function confirmCaptureMatch(
  match: CaptureMatch | null,
  surface: CaptureSurface,
  real: { width: number; height: number },
  sources: DisplaySources | null,
  pointer: { x: number; y: number } | null,
): CaptureMatch | null {
  if (!(real.width > 0) || !(real.height > 0)) return match;
  if (match && sameShape(match.rect.width, match.rect.height, real.width, real.height)) return match;
  return matchCaptureSource({ surface, width: real.width, height: real.height }, sources, pointer);
}

/**
 * Whether a stored rectangle can be trusted. One the recorder matched
 * ("monitor" / "window") whose shape disagrees with the video's was matched
 * against the wrong frame size: a 2560×1392 window came back labelled as its
 * 2560×1440 screen. The user's own pick and an estimate are left alone.
 */
export function captureRectSuspect(
  project: Pick<Project, "captureRect" | "captureSource" | "videoWidth" | "videoHeight">,
): boolean {
  const rect = project.captureRect;
  if (!rectIsUsable(rect)) return false;
  if (project.captureSource !== "monitor" && project.captureSource !== "window") return false;
  const vw = project.videoWidth || 0;
  const vh = project.videoHeight || 0;
  if (!(vw > 0 && vh > 0)) return false;
  return !sameShape(rect.width, rect.height, vw, vh);
}

/** A pointer position that stands for the take: the sample halfway through. */
function pointerHint(samples: CursorSample[]): { x: number; y: number } | null {
  if (!samples.length) return null;
  const mid = samples[Math.floor(samples.length / 2)];
  return { x: mid.x, y: mid.y };
}

/**
 * Repairs a suspect rectangle (see `captureRectSuspect`). First choice: the
 * window or screen of exactly the video's size that is on the desktop now —
 * right after a take it still is. Failing that, a video as wide (or as tall)
 * as the stored screen is a maximized window on it. Anything else is null:
 * no pointer beats one drawn in the wrong place, and the Cursor tab can still
 * line the take up by hand.
 */
export function reconcileCaptureRect(
  project: Pick<
    Project,
    "captureRect" | "captureSource" | "captureLabel" | "captureSurface" | "cursor" | "videoWidth" | "videoHeight"
  >,
  sources: DisplaySources | null,
): EstimatedCapture | null {
  const rect = project.captureRect;
  if (!rectIsUsable(rect)) return null;
  const vw = project.videoWidth || 0;
  const vh = project.videoHeight || 0;
  if (!(vw > 0 && vh > 0)) return null;

  const again = matchCaptureSource(
    { surface: project.captureSurface ?? "unknown", width: vw, height: vh },
    sources,
    pointerHint(project.cursor),
  );
  // A screen matched by shape alone is trusted for a screen take; a window take
  // needs the exact size — its window may be gone and a same-shaped screen is
  // not it.
  const trusted =
    again && (again.confidence === "exact" || (again.source === "monitor" && project.captureSurface !== "window"));
  if (again && trusted) return { rect: again.rect, source: again.source, label: again.label };

  const fullWidth = Math.abs(vw - rect.width) <= 2 && vh <= rect.height;
  const fullHeight = Math.abs(vh - rect.height) <= 2 && vw <= rect.width;
  if (project.captureSource === "monitor" && (fullWidth || fullHeight)) {
    const monitor = sources?.monitors.find(
      (m) => m.x === rect.x && m.y === rect.y && m.width === rect.width && m.height === rect.height,
    );
    const name = monitor?.name ?? (project.captureLabel ?? "the recorded screen").replace(/\s·\s.*$/, "");
    const fitted = fitVideoOnMonitor(rect, vw, vh);
    return {
      rect: fitted,
      source: "estimated",
      label: `a window on ${name} · ${Math.round(fitted.width)}×${Math.round(fitted.height)}`,
    };
  }
  return null;
}
