import type { TreeNode } from "../api/types";

/**
 * Squarified treemap (Bruls, Huizing & van Wijk) with nesting: a folder
 * becomes a rectangle with a title strip, its children are squarified into
 * what is left. Pure functions — the canvas component only draws the list.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TreemapItem {
  /** Node id; `-1` for a "rest" block (children folded by the backend). */
  id: number;
  node: TreeNode | null;
  rest?: { n: number; s: number };
  rect: Rect;
  depth: number;
  /** Id of the parent node whose rectangle this sits in (`null` at the top). */
  parent: number | null;
  /** Id of the depth-0 ancestor — the branch that decides the folder colour. */
  branch: number;
  /** Title-strip height when the folder's children are laid out inside it. */
  header: number;
  /** True when this rectangle has children drawn inside it. */
  nested: boolean;
  /** Bytes represented (the node's size, or the rest block's bytes). */
  bytes: number;
}

export interface TreemapOptions {
  maxDepth: number;
  padding: number;
  headerHeight: number;
  /** A folder needs at least this much room (w and h) to lay children out inside. */
  minNested: number;
  /** Rectangles thinner than this are still laid out but skipped as parents. */
  minSide: number;
}

export const DEFAULT_TREEMAP: TreemapOptions = {
  maxDepth: 7,
  padding: 3,
  headerHeight: 18,
  minNested: 26,
  minSide: 3,
};

/**
 * Lays `weights` (already sorted descending) into `rect`. Returns one
 * rectangle per weight, same order; zero weights get zero-sized rectangles.
 */
export function squarify(weights: number[], rect: Rect): Rect[] {
  const out: Rect[] = weights.map(() => ({ x: rect.x, y: rect.y, w: 0, h: 0 }));
  const total = weights.reduce((a, b) => a + (b > 0 ? b : 0), 0);
  if (total <= 0 || rect.w <= 0 || rect.h <= 0) return out;
  const scale = (rect.w * rect.h) / total;
  const areas = weights.map((w) => (w > 0 ? w * scale : 0));
  let x = rect.x;
  let y = rect.y;
  let w = rect.w;
  let h = rect.h;

  const worst = (row: number[], sum: number, side: number): number => {
    if (row.length === 0 || sum <= 0) return Number.POSITIVE_INFINITY;
    const s2 = sum * sum;
    const side2 = side * side;
    let max = 0;
    let min = Number.POSITIVE_INFINITY;
    for (const a of row) {
      if (a > max) max = a;
      if (a < min) min = a;
    }
    return Math.max((side2 * max) / s2, s2 / (side2 * min));
  };

  const place = (indices: number[], sum: number) => {
    if (sum <= 0) return;
    if (w >= h) {
      // Column on the left.
      const colW = sum / h;
      let cy = y;
      for (const i of indices) {
        const ih = areas[i] / colW;
        out[i] = { x, y: cy, w: colW, h: ih };
        cy += ih;
      }
      x += colW;
      w -= colW;
    } else {
      // Strip on top.
      const rowH = sum / w;
      let cx = x;
      for (const i of indices) {
        const iw = areas[i] / rowH;
        out[i] = { x: cx, y, w: iw, h: rowH };
        cx += iw;
      }
      y += rowH;
      h -= rowH;
    }
  };

  let row: number[] = [];
  let rowAreas: number[] = [];
  let rowSum = 0;
  for (let i = 0; i < areas.length; i++) {
    const a = areas[i];
    if (a <= 0) continue;
    const side = Math.max(1e-6, Math.min(w, h));
    if (row.length === 0) {
      row = [i];
      rowAreas = [a];
      rowSum = a;
      continue;
    }
    const current = worst(rowAreas, rowSum, side);
    const withNext = worst([...rowAreas, a], rowSum + a, side);
    if (withNext <= current) {
      row.push(i);
      rowAreas.push(a);
      rowSum += a;
    } else {
      place(row, rowSum);
      row = [i];
      rowAreas = [a];
      rowSum = a;
    }
  }
  if (row.length) place(row, rowSum);
  return out;
}

function childrenOf(node: TreeNode): { weights: number[]; nodes: (TreeNode | null)[]; rest: { n: number; s: number } | null } {
  const kids = node.ch ?? [];
  const nodes: (TreeNode | null)[] = kids.slice();
  const weights = kids.map((k) => k.s);
  let rest: { n: number; s: number } | null = null;
  if (node.r && node.r.s > 0) {
    rest = node.r;
    nodes.push(null);
    weights.push(node.r.s);
  }
  return { weights, nodes, rest };
}

/**
 * The full nested layout for `root` inside `rect`. The root itself is not an
 * item — the canvas is its rectangle. Items come parents-first, so drawing
 * in order paints children over their folders and hit-testing from the end
 * finds the deepest rectangle.
 */
export function layoutTreemap(root: TreeNode, rect: Rect, options: Partial<TreemapOptions> = {}): TreemapItem[] {
  const opts = { ...DEFAULT_TREEMAP, ...options };
  const out: TreemapItem[] = [];

  const layout = (node: TreeNode, area: Rect, depth: number, parent: number | null, branch: number | null) => {
    const { weights, nodes, rest } = childrenOf(node);
    if (!weights.length) return;
    const rects = squarify(weights, area);
    for (let i = 0; i < nodes.length; i++) {
      const r = rects[i];
      const child = nodes[i];
      if (r.w <= 0 || r.h <= 0) continue;
      const item: TreemapItem = {
        id: child ? child.id : -1,
        node: child,
        rest: child ? undefined : (rest ?? undefined),
        rect: r,
        depth,
        parent,
        branch: branch ?? (child ? child.id : -1),
        header: 0,
        nested: false,
        bytes: child ? child.s : (rest?.s ?? 0),
      };
      out.push(item);
      if (!child || child.k !== 1 || !child.ch?.length || depth + 1 >= opts.maxDepth) continue;
      if (r.w < opts.minNested || r.h < opts.minNested) continue;
      const header = r.h >= opts.headerHeight * 2 + 6 && r.w >= 34 ? opts.headerHeight : 0;
      const pad = opts.padding;
      const inner: Rect = {
        x: r.x + pad,
        y: r.y + header + pad,
        w: r.w - pad * 2,
        h: r.h - header - pad * 2,
      };
      if (inner.w < opts.minSide || inner.h < opts.minSide) continue;
      item.header = header;
      item.nested = true;
      layout(child, inner, depth + 1, child.id, item.branch);
    }
  };

  layout(root, rect, 0, null, null);
  return out;
}

/** Deepest item under a point, or null. */
export function hitTest(items: TreemapItem[], x: number, y: number): TreemapItem | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const r = items[i].rect;
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return items[i];
  }
  return null;
}

/** Sum of |aspect - 1| over leaves — the lower, the squarer. Used by tests. */
export function meanAspect(items: TreemapItem[]): number {
  const leaves = items.filter((i) => !i.nested && i.rect.w > 0 && i.rect.h > 0);
  if (!leaves.length) return 0;
  const total = leaves.reduce((acc, i) => acc + Math.max(i.rect.w / i.rect.h, i.rect.h / i.rect.w), 0);
  return total / leaves.length;
}
