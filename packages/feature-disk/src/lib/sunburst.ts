import type { TreeNode } from "../api/types";

/** Ring layout: depth = ring, angle = share of the parent. Pure. */
export interface SunburstArc {
  id: number;
  node: TreeNode | null;
  rest?: { n: number; s: number };
  depth: number;
  /** Radians, clockwise from 12 o'clock. */
  a0: number;
  a1: number;
  parent: number | null;
  branch: number;
  bytes: number;
}

const TAU = Math.PI * 2;

export function layoutSunburst(root: TreeNode, maxDepth: number, minAngle = 0.0025): SunburstArc[] {
  const out: SunburstArc[] = [];
  const walk = (node: TreeNode, a0: number, a1: number, depth: number, parent: number | null, branch: number | null) => {
    if (depth >= maxDepth) return;
    const kids = node.ch ?? [];
    const total = node.s > 0 ? node.s : kids.reduce((a, k) => a + k.s, 0) + (node.r?.s ?? 0);
    if (total <= 0) return;
    const span = a1 - a0;
    let cursor = a0;
    for (const k of kids) {
      const w = (k.s / total) * span;
      if (w >= minAngle) {
        const arc: SunburstArc = {
          id: k.id,
          node: k,
          depth,
          a0: cursor,
          a1: cursor + w,
          parent,
          branch: branch ?? k.id,
          bytes: k.s,
        };
        out.push(arc);
        if (k.k === 1 && k.ch?.length) walk(k, cursor, cursor + w, depth + 1, k.id, arc.branch);
      }
      cursor += w;
    }
    if (node.r && node.r.s > 0) {
      const w = (node.r.s / total) * span;
      if (w >= minAngle) {
        out.push({ id: -1, node: null, rest: node.r, depth, a0: cursor, a1: cursor + w, parent, branch: branch ?? -1, bytes: node.r.s });
      }
    }
  };
  walk(root, 0, TAU, 0, null, null);
  return out;
}

/** Arc under a point given in polar form (angle from 12 o'clock, ring index). */
export function hitTestArc(arcs: SunburstArc[], angle: number, depth: number): SunburstArc | null {
  const a = ((angle % TAU) + TAU) % TAU;
  for (let i = arcs.length - 1; i >= 0; i--) {
    const arc = arcs[i];
    if (arc.depth === depth && a >= arc.a0 && a < arc.a1) return arc;
  }
  return null;
}
