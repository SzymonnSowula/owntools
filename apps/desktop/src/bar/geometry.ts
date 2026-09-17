/**
 * Where the bar's window goes. Pure, so it can be tested without a screen.
 *
 * The window is always exactly as big as what it shows — a transparent margin
 * around the bar would still catch clicks meant for the app underneath — so
 * every change of content (capsule → bar → a widget above it → the dictation
 * pill) moves and resizes the window. What stays put is the bar row's bottom
 * edge and its centre: widgets grow away from it, upwards, or downwards when
 * the bar was dragged into the top half of the screen.
 *
 * Monitors come in physical pixels, content in logical ones, so the monitor's
 * scale factor converts once and the result is physical.
 */
import type { BarAnchor } from "@core/bar";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Placement extends Box {
  /** Widgets open below the bar instead of above it. */
  openDown: boolean;
}

/** Logical pixels between the bar and the bottom of the work area until someone moves it. */
export const DEFAULT_GAP = 10;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), Math.max(lo, hi));
}

/** Physical y of the bar row's bottom edge, kept inside the work area. */
function barBottom(area: Box, scale: number, anchor: BarAnchor | null): number {
  const gap = Math.round((anchor ? anchor.gap : DEFAULT_GAP) * scale);
  return clamp(area.y + area.height - gap, area.y, area.y + area.height);
}

/** The bar sits in the top half of its work area, so its widgets open downwards. */
export function opensDown(area: Box, scale: number, anchor: BarAnchor | null): boolean {
  const s = scale > 0 ? scale : 1;
  return barBottom(area, s, anchor) < area.y + area.height / 2;
}

/**
 * The window's physical rectangle.
 *
 * @param area   the monitor's work area (physical pixels)
 * @param scale  that monitor's scale factor
 * @param anchor where the bar was put; null for bottom centre
 * @param size   what the window shows, in logical pixels
 * @param rowHeight the bar row alone (or the pill), in logical pixels
 */
export function placeWindow(
  area: Box,
  scale: number,
  anchor: BarAnchor | null,
  size: { width: number; height: number },
  rowHeight: number,
): Placement {
  const s = scale > 0 ? scale : 1;
  const width = Math.max(1, Math.ceil(size.width * s));
  const height = Math.max(1, Math.ceil(size.height * s));
  const row = Math.min(height, Math.max(1, Math.ceil(rowHeight * s)));
  const bottom = barBottom(area, s, anchor);
  const openDown = opensDown(area, s, anchor);
  const centre = area.x + (anchor ? clamp(anchor.x, 0, 1) : 0.5) * area.width;
  const x = clamp(Math.round(centre - width / 2), area.x, area.x + area.width - width);
  const wanted = openDown ? bottom - row : bottom - height;
  const y = clamp(Math.round(wanted), area.y, area.y + area.height - height);
  return { x, y, width, height, openDown };
}

/**
 * The anchor for a bar that has just been dragged: `window` is the bar row's
 * physical rectangle on the monitor whose work area is `area`.
 */
export function anchorFrom(area: Box, scale: number, window: Box, monitor: string | null): BarAnchor {
  const s = scale > 0 ? scale : 1;
  const centre = window.x + window.width / 2;
  const x = area.width > 0 ? clamp((centre - area.x) / area.width, 0, 1) : 0.5;
  const gap = Math.max(0, Math.round((area.y + area.height - (window.y + window.height)) / s));
  return { monitor, x: Math.round(x * 10_000) / 10_000, gap };
}

export interface MonitorLike {
  name: string | null;
  scaleFactor: number;
  position: { x: number; y: number };
  size: { width: number; height: number };
  workArea?: { position: { x: number; y: number }; size: { width: number; height: number } };
}

/** The monitor the anchor names, else the primary one, else the first. */
export function pickMonitor<M extends MonitorLike>(
  monitors: readonly M[],
  primary: M | null,
  name: string | null,
): M | null {
  if (name) {
    const named = monitors.find((m) => m.name === name);
    if (named) return named;
  }
  return primary ?? monitors[0] ?? null;
}

export function workAreaOf(monitor: MonitorLike): Box {
  const area = monitor.workArea ?? { position: monitor.position, size: monitor.size };
  return { x: area.position.x, y: area.position.y, width: area.size.width, height: area.size.height };
}

/** The monitor whose rectangle holds the point, e.g. a dragged window's centre. */
export function monitorAt<M extends MonitorLike>(monitors: readonly M[], x: number, y: number): M | null {
  return (
    monitors.find(
      (m) => x >= m.position.x && x < m.position.x + m.size.width && y >= m.position.y && y < m.position.y + m.size.height,
    ) ?? null
  );
}
