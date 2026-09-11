import type { Rect } from "../api/types";

/**
 * Region selection math, in screenshot pixels. Pure, so the overlay's drag
 * handling is a thin layer over functions that are tested here.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

/** The smallest selection worth keeping — anything under it is a slipped click. */
export const MIN_SIZE = 4;

export const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type Handle = (typeof HANDLES)[number];

/** A rectangle from two corners, whichever order they were dragged in. */
export function rectFromPoints(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/** Integer edges: a crop happens on whole pixels. */
export function roundRect(r: Rect): Rect {
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  return { x, y, w: Math.round(r.x + r.w) - x, h: Math.round(r.y + r.h) - y };
}

/** The part of `r` inside `bounds` (origin 0,0); an empty rect when there is none. */
export function clampRect(r: Rect, bounds: Size): Rect {
  const x1 = Math.max(0, Math.min(bounds.w, r.x));
  const y1 = Math.max(0, Math.min(bounds.h, r.y));
  const x2 = Math.max(0, Math.min(bounds.w, r.x + r.w));
  const y2 = Math.max(0, Math.min(bounds.h, r.y + r.h));
  return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
}

export function clampPoint(p: Point, bounds: Size): Point {
  return { x: Math.max(0, Math.min(bounds.w, p.x)), y: Math.max(0, Math.min(bounds.h, p.y)) };
}

export function isUsable(r: Rect, min: number = MIN_SIZE): boolean {
  return r.w >= min && r.h >= min;
}

export function wholeRect(bounds: Size): Rect {
  return { x: 0, y: 0, w: bounds.w, h: bounds.h };
}

export function contains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h;
}

/** Centre of a handle on the selection's edge. */
export function handlePoint(r: Rect, handle: Handle): Point {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  switch (handle) {
    case "nw":
      return { x: r.x, y: r.y };
    case "n":
      return { x: cx, y: r.y };
    case "ne":
      return { x: r.x + r.w, y: r.y };
    case "e":
      return { x: r.x + r.w, y: cy };
    case "se":
      return { x: r.x + r.w, y: r.y + r.h };
    case "s":
      return { x: cx, y: r.y + r.h };
    case "sw":
      return { x: r.x, y: r.y + r.h };
    case "w":
      return { x: r.x, y: cy };
  }
}

/**
 * What a press at `p` grabs: a handle (within `tolerance`), the inside (to
 * move the whole selection), or nothing. Corners are tested first so a small
 * selection still offers its corners.
 */
export function handleAt(r: Rect, p: Point, tolerance: number): Handle | "inside" | null {
  const order: Handle[] = ["nw", "ne", "se", "sw", "n", "e", "s", "w"];
  for (const h of order) {
    const c = handlePoint(r, h);
    if (Math.abs(c.x - p.x) <= tolerance && Math.abs(c.y - p.y) <= tolerance) return h;
  }
  return contains(r, p) ? "inside" : null;
}

/**
 * The selection after dragging `handle` by (dx, dy). Edges never cross (a
 * dragged-past edge stops at `MIN_SIZE`) and the result stays inside `bounds`.
 */
export function resizeRect(r: Rect, handle: Handle, dx: number, dy: number, bounds: Size): Rect {
  let x1 = r.x;
  let y1 = r.y;
  let x2 = r.x + r.w;
  let y2 = r.y + r.h;
  if (handle.includes("w")) x1 = Math.min(x2 - MIN_SIZE, x1 + dx);
  if (handle.includes("e")) x2 = Math.max(x1 + MIN_SIZE, x2 + dx);
  if (handle.includes("n")) y1 = Math.min(y2 - MIN_SIZE, y1 + dy);
  if (handle.includes("s")) y2 = Math.max(y1 + MIN_SIZE, y2 + dy);
  return clampRect({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, bounds);
}

/** The selection moved by (dx, dy), stopped at the edges rather than clipped. */
export function moveRect(r: Rect, dx: number, dy: number, bounds: Size): Rect {
  const x = Math.max(0, Math.min(bounds.w - r.w, r.x + dx));
  const y = Math.max(0, Math.min(bounds.h - r.h, r.y + dy));
  return { ...r, x, y };
}

/**
 * Where a floating bar of `size` goes for a selection: under it when there is
 * room, above it otherwise, inside along its bottom edge as the last resort;
 * always kept inside the viewport horizontally.
 */
export function toolbarPosition(sel: Rect, viewport: Size, size: Size, gap: number): Point {
  const x = Math.max(gap, Math.min(viewport.w - size.w - gap, sel.x + sel.w / 2 - size.w / 2));
  const below = sel.y + sel.h + gap;
  if (below + size.h + gap <= viewport.h) return { x, y: below };
  const above = sel.y - gap - size.h;
  if (above >= gap) return { x, y: above };
  return { x, y: Math.max(gap, sel.y + sel.h - size.h - gap) };
}

/**
 * Where the size readout goes: just inside the selection's bottom-right
 * corner, or just outside when the selection is too small to hold it.
 */
export function readoutPosition(sel: Rect, viewport: Size, size: Size, gap: number): Point {
  const fits = sel.w >= size.w + gap * 2 && sel.h >= size.h + gap * 2;
  if (fits) return { x: sel.x + sel.w - size.w - gap, y: sel.y + sel.h - size.h - gap };
  const y = sel.y + sel.h + gap + size.h <= viewport.h ? sel.y + sel.h + gap : Math.max(gap, sel.y - gap - size.h);
  return { x: Math.max(gap, Math.min(viewport.w - size.w - gap, sel.x + sel.w - size.w)), y };
}

export function formatSize(w: number, h: number): string {
  return `${Math.round(w)} × ${Math.round(h)}`;
}
