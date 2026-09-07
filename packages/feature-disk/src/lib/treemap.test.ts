import { describe, expect, it } from "vitest";
import type { TreeNode } from "../api/types";
import { hitTest, layoutTreemap, meanAspect, squarify } from "./treemap";

const file = (id: number, n: string, s: number): TreeNode => ({ id, n, s, a: s, k: 0, c: 0, m: 0, f: 0, d: 0, e: false });
const dir = (id: number, n: string, ch: TreeNode[], r?: { n: number; s: number }): TreeNode => {
  const s = ch.reduce((a, c) => a + c.s, 0) + (r?.s ?? 0);
  return { id, n, s, a: s, k: 1, c: 0, m: 0, f: 0, d: 0, e: false, ch, r };
};

describe("squarify", () => {
  it("fills the rectangle exactly and keeps the input order", () => {
    const rect = { x: 10, y: 20, w: 400, h: 300 };
    const weights = [6, 6, 4, 3, 2, 2, 1];
    const rects = squarify(weights, rect);
    const area = rects.reduce((a, r) => a + r.w * r.h, 0);
    expect(area).toBeCloseTo(rect.w * rect.h, 3);
    expect(rects).toHaveLength(weights.length);
    for (let i = 0; i < weights.length; i++) {
      expect((rects[i].w * rects[i].h) / area).toBeCloseTo(weights[i] / 24, 6);
      expect(rects[i].x).toBeGreaterThanOrEqual(rect.x - 1e-6);
      expect(rects[i].y).toBeGreaterThanOrEqual(rect.y - 1e-6);
      expect(rects[i].x + rects[i].w).toBeLessThanOrEqual(rect.x + rect.w + 1e-6);
      expect(rects[i].y + rects[i].h).toBeLessThanOrEqual(rect.y + rect.h + 1e-6);
    }
  });

  it("produces the textbook 6-6-4-3-2-2-1 layout", () => {
    // Bruls et al.: in a 6×4 box the first row is the two 6s in a column of width 3.
    const rects = squarify([6, 6, 4, 3, 2, 2, 1], { x: 0, y: 0, w: 6, h: 4 });
    expect(rects[0]).toEqual({ x: 0, y: 0, w: 3, h: 2 });
    expect(rects[1]).toEqual({ x: 0, y: 2, w: 3, h: 2 });
    expect(rects[2].w).toBeCloseTo(3 * (4 / 7), 6);
  });

  it("handles zero and empty weights", () => {
    expect(squarify([], { x: 0, y: 0, w: 10, h: 10 })).toEqual([]);
    const rects = squarify([0, 5, 0], { x: 0, y: 0, w: 10, h: 10 });
    expect(rects[0].w * rects[0].h).toBe(0);
    expect(rects[1].w * rects[1].h).toBeCloseTo(100, 6);
    expect(squarify([1, 2], { x: 0, y: 0, w: 0, h: 10 }).every((r) => r.w === 0)).toBe(true);
  });

  it("keeps rectangles squarer than a slice-and-dice would", () => {
    const rects = squarify([9, 8, 7, 6, 5, 4, 3, 2, 1], { x: 0, y: 0, w: 300, h: 200 });
    const aspects = rects.map((r) => Math.max(r.w / r.h, r.h / r.w));
    expect(Math.max(...aspects)).toBeLessThan(4);
  });
});

describe("layoutTreemap", () => {
  const tree = dir(0, "root", [
    dir(1, "Downloads", [file(11, "movie.mkv", 4000), file(12, "setup.exe", 1000)]),
    dir(2, "Projects", [dir(21, "app", [file(211, "bundle.js", 900), file(212, "index.html", 100)]), file(22, "notes.md", 500)]),
    file(3, "readme.txt", 500),
  ], { n: 3, s: 500 });

  it("nests folders with a header and keeps parents before children", () => {
    const items = layoutTreemap(tree, { x: 0, y: 0, w: 800, h: 600 });
    const ids = items.map((i) => i.id);
    expect(ids.indexOf(1)).toBeLessThan(ids.indexOf(11));
    expect(ids.indexOf(2)).toBeLessThan(ids.indexOf(21));
    expect(ids.indexOf(21)).toBeLessThan(ids.indexOf(211));
    const downloads = items.find((i) => i.id === 1)!;
    expect(downloads.nested).toBe(true);
    expect(downloads.header).toBeGreaterThan(0);
    const movie = items.find((i) => i.id === 11)!;
    expect(movie.rect.x).toBeGreaterThanOrEqual(downloads.rect.x + 3);
    expect(movie.rect.y).toBeGreaterThanOrEqual(downloads.rect.y + downloads.header);
    expect(movie.rect.x + movie.rect.w).toBeLessThanOrEqual(downloads.rect.x + downloads.rect.w - 3 + 1e-6);
    expect(movie.branch).toBe(1);
    expect(items.find((i) => i.id === 211)!.branch).toBe(2);
  });

  it("draws the folded rest as its own block", () => {
    const items = layoutTreemap(tree, { x: 0, y: 0, w: 800, h: 600 });
    const rest = items.find((i) => i.id === -1)!;
    expect(rest.rest).toEqual({ n: 3, s: 500 });
    expect(rest.bytes).toBe(500);
    expect(rest.depth).toBe(0);
  });

  it("respects maxDepth and stops nesting in tiny rectangles", () => {
    const shallow = layoutTreemap(tree, { x: 0, y: 0, w: 800, h: 600 }, { maxDepth: 1 });
    expect(shallow.every((i) => i.depth === 0)).toBe(true);
    expect(shallow.find((i) => i.id === 1)!.nested).toBe(false);
    const tiny = layoutTreemap(tree, { x: 0, y: 0, w: 30, h: 20 });
    expect(tiny.every((i) => i.depth === 0)).toBe(true);
  });

  it("hit-tests the deepest rectangle", () => {
    const items = layoutTreemap(tree, { x: 0, y: 0, w: 800, h: 600 });
    const movie = items.find((i) => i.id === 11)!;
    const hit = hitTest(items, movie.rect.x + movie.rect.w / 2, movie.rect.y + movie.rect.h / 2);
    expect(hit?.id).toBe(11);
    const downloads = items.find((i) => i.id === 1)!;
    const headerHit = hitTest(items, downloads.rect.x + 5, downloads.rect.y + 5);
    expect(headerHit?.id).toBe(1);
    expect(hitTest(items, -5, -5)).toBeNull();
  });

  it("stays reasonably square on a wide tree", () => {
    const wide = dir(0, "root", Array.from({ length: 40 }, (_, i) => file(100 + i, `f${i}`, 1000 - i * 20)));
    const items = layoutTreemap(wide, { x: 0, y: 0, w: 1000, h: 700 });
    expect(items).toHaveLength(40);
    expect(meanAspect(items)).toBeLessThan(2.2);
  });
});
