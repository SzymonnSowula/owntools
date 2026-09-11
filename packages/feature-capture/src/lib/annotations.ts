import type { Rect } from "../api/types";
import type { Point } from "./region";
import { MIN_SIZE, rectFromPoints } from "./region";

/**
 * The mark-up model. Everything is in *screenshot pixels* — the overlay draws
 * at device resolution and the composed PNG is cut from the same frame, so
 * one coordinate space serves the preview and the export, and a stroke drawn
 * on a 200 % monitor is as many pixels wide as it looked.
 *
 * Widths and sizes are therefore stored scaled: the toolbar picks a width in
 * CSS pixels and `Style.scale` (screenshot px per CSS px) turns it into what
 * gets drawn. `serialize` / `parse` are the wire format — kept so a future
 * "edit again" can reopen a capture's mark-up, and tested as such.
 */

export type AnnotationKind = "arrow" | "line" | "rect" | "ellipse" | "highlight" | "text" | "badge" | "blur";

/** What the toolbar can have active: a shape tool, or the selection itself (move / resize = crop). */
export type ToolId = "select" | AnnotationKind;

interface Base {
  id: string;
}

export interface StrokeAnnotation extends Base {
  kind: "arrow" | "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
}

export interface ShapeAnnotation extends Base {
  kind: "rect" | "ellipse";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  width: number;
}

export interface HighlightAnnotation extends Base {
  kind: "highlight";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface TextAnnotation extends Base {
  kind: "text";
  x: number;
  y: number;
  text: string;
  color: string;
  /** Font size in screenshot px. */
  size: number;
}

export interface BadgeAnnotation extends Base {
  kind: "badge";
  x: number;
  y: number;
  n: number;
  color: string;
  /** Radius in screenshot px. */
  size: number;
}

export interface BlurAnnotation extends Base {
  kind: "blur";
  x: number;
  y: number;
  w: number;
  h: number;
  /** Pixelation cell in screenshot px. */
  cell: number;
}

export type Annotation =
  | StrokeAnnotation
  | ShapeAnnotation
  | HighlightAnnotation
  | TextAnnotation
  | BadgeAnnotation
  | BlurAnnotation;

export interface Style {
  color: string;
  /** Stroke width in CSS px. */
  width: number;
  /** Screenshot px per CSS px. */
  scale: number;
}

/* Sizes in CSS px, before `scale`. */
export const TEXT_SIZE = 18;
export const BADGE_RADIUS = 13;
export const BLUR_CELL = 10;
export const HIGHLIGHT_ALPHA = 0.55;

export const KINDS: readonly AnnotationKind[] = ["arrow", "line", "rect", "ellipse", "highlight", "text", "badge", "blur"];

let seq = 0;
export function newId(): string {
  seq += 1;
  return `${Date.now().toString(36)}-${seq.toString(36)}`;
}

/** Drag-made annotations. Null when the drag was too small to mean anything. */
export function annotationFromDrag(tool: ToolId, from: Point, to: Point, style: Style): Annotation | null {
  const width = style.width * style.scale;
  switch (tool) {
    case "arrow":
    case "line": {
      if (Math.hypot(to.x - from.x, to.y - from.y) < MIN_SIZE) return null;
      return { id: newId(), kind: tool, x1: from.x, y1: from.y, x2: to.x, y2: to.y, color: style.color, width };
    }
    case "rect":
    case "ellipse": {
      const r = rectFromPoints(from, to);
      if (r.w < MIN_SIZE || r.h < MIN_SIZE) return null;
      return { id: newId(), kind: tool, ...r, color: style.color, width };
    }
    case "highlight": {
      const r = rectFromPoints(from, to);
      if (r.w < MIN_SIZE || r.h < MIN_SIZE) return null;
      return { id: newId(), kind: "highlight", ...r, color: style.color };
    }
    case "blur": {
      const r = rectFromPoints(from, to);
      if (r.w < MIN_SIZE || r.h < MIN_SIZE) return null;
      return { id: newId(), kind: "blur", ...r, cell: BLUR_CELL * style.scale };
    }
    default:
      return null;
  }
}

export function textAnnotation(at: Point, text: string, style: Style): TextAnnotation {
  return { id: newId(), kind: "text", x: at.x, y: at.y, text, color: style.color, size: TEXT_SIZE * style.scale };
}

export function badgeAnnotation(at: Point, n: number, style: Style): BadgeAnnotation {
  return { id: newId(), kind: "badge", x: at.x, y: at.y, n, color: style.color, size: BADGE_RADIUS * style.scale };
}

/** The next step number: one past the highest badge so far (1 for the first). */
export function nextBadgeNumber(list: readonly Annotation[]): number {
  let max = 0;
  for (const a of list) if (a.kind === "badge" && a.n > max) max = a.n;
  return max + 1;
}

/** A box around any annotation, for hit tests and for the toolbar's placement. */
export function annotationBounds(a: Annotation): Rect {
  switch (a.kind) {
    case "arrow":
    case "line":
      return rectFromPoints({ x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 });
    case "badge":
      return { x: a.x - a.size, y: a.y - a.size, w: a.size * 2, h: a.size * 2 };
    case "text":
      return { x: a.x, y: a.y - a.size, w: Math.max(a.size, a.text.length * a.size * 0.55), h: a.size * 1.3 };
    default:
      return { x: a.x, y: a.y, w: a.w, h: a.h };
  }
}

/* ------------------------------------------------------------------ */
/* Wire format                                                         */
/* ------------------------------------------------------------------ */

export const ANNOTATIONS_VERSION = 1;

export function serializeAnnotations(list: readonly Annotation[]): string {
  return JSON.stringify({ v: ANNOTATIONS_VERSION, items: list });
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === "string";

function isAnnotation(v: unknown): v is Annotation {
  if (typeof v !== "object" || v === null) return false;
  const a = v as Record<string, unknown>;
  if (!str(a.id) || !str(a.kind)) return false;
  switch (a.kind) {
    case "arrow":
    case "line":
      return num(a.x1) && num(a.y1) && num(a.x2) && num(a.y2) && str(a.color) && num(a.width);
    case "rect":
    case "ellipse":
      return num(a.x) && num(a.y) && num(a.w) && num(a.h) && str(a.color) && num(a.width);
    case "highlight":
      return num(a.x) && num(a.y) && num(a.w) && num(a.h) && str(a.color);
    case "text":
      return num(a.x) && num(a.y) && str(a.text) && str(a.color) && num(a.size);
    case "badge":
      return num(a.x) && num(a.y) && num(a.n) && str(a.color) && num(a.size);
    case "blur":
      return num(a.x) && num(a.y) && num(a.w) && num(a.h) && num(a.cell);
    default:
      return false;
  }
}

/** The annotations in a serialised set; anything malformed or unknown is dropped, never thrown on. */
export function parseAnnotations(raw: string | null | undefined): Annotation[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return [];
    const items = (data as { items?: unknown }).items;
    if (!Array.isArray(items)) return [];
    return items.filter(isAnnotation);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

export interface History {
  past: readonly (readonly Annotation[])[];
  present: readonly Annotation[];
  future: readonly (readonly Annotation[])[];
}

const HISTORY_CAP = 100;

export function emptyHistory(): History {
  return { past: [], present: [], future: [] };
}

/** A new state: the old one becomes undoable, anything redoable is gone. */
export function commit(h: History, next: readonly Annotation[]): History {
  const past = [...h.past, h.present].slice(-HISTORY_CAP);
  return { past, present: next, future: [] };
}

export function undo(h: History): History {
  if (h.past.length === 0) return h;
  const past = h.past.slice(0, -1);
  const present = h.past[h.past.length - 1];
  return { past, present, future: [h.present, ...h.future] };
}

export function redo(h: History): History {
  if (h.future.length === 0) return h;
  const [present, ...future] = h.future;
  return { past: [...h.past, h.present], present, future };
}

export const canUndo = (h: History): boolean => h.past.length > 0;
export const canRedo = (h: History): boolean => h.future.length > 0;
