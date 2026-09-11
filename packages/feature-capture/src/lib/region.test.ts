import { describe, expect, it } from "vitest";
import {
  clampRect,
  handleAt,
  isUsable,
  moveRect,
  readoutPosition,
  rectFromPoints,
  resizeRect,
  roundRect,
  toolbarPosition,
} from "./region";

const bounds = { w: 1000, h: 600 };

describe("rectFromPoints", () => {
  it("normalises a drag in any direction", () => {
    expect(rectFromPoints({ x: 100, y: 200 }, { x: 40, y: 50 })).toEqual({ x: 40, y: 50, w: 60, h: 150 });
    expect(rectFromPoints({ x: 40, y: 50 }, { x: 100, y: 200 })).toEqual({ x: 40, y: 50, w: 60, h: 150 });
  });
});

describe("clampRect", () => {
  it("cuts a selection that runs off the screen", () => {
    expect(clampRect({ x: -20, y: 580, w: 100, h: 100 }, bounds)).toEqual({ x: 0, y: 580, w: 80, h: 20 });
  });

  it("is empty when there is no overlap", () => {
    expect(clampRect({ x: 1200, y: 10, w: 50, h: 50 }, bounds).w).toBe(0);
  });
});

describe("roundRect + isUsable", () => {
  it("rounds edges, not sizes, so neighbouring crops tile", () => {
    expect(roundRect({ x: 10.4, y: 10.6, w: 20.2, h: 9.9 })).toEqual({ x: 10, y: 11, w: 21, h: 10 });
  });

  it("treats a slipped click as no selection", () => {
    expect(isUsable({ x: 0, y: 0, w: 3, h: 30 })).toBe(false);
    expect(isUsable({ x: 0, y: 0, w: 4, h: 4 })).toBe(true);
  });
});

describe("handleAt", () => {
  const sel = { x: 100, y: 100, w: 200, h: 100 };

  it("finds corners, edges, the inside and nothing", () => {
    expect(handleAt(sel, { x: 102, y: 98 }, 6)).toBe("nw");
    expect(handleAt(sel, { x: 300, y: 150 }, 6)).toBe("e");
    expect(handleAt(sel, { x: 200, y: 200 }, 6)).toBe("s");
    expect(handleAt(sel, { x: 180, y: 140 }, 6)).toBe("inside");
    expect(handleAt(sel, { x: 20, y: 20 }, 6)).toBeNull();
  });

  it("prefers a corner over the edge it sits on", () => {
    expect(handleAt(sel, { x: 300, y: 200 }, 6)).toBe("se");
  });
});

describe("resizeRect", () => {
  const sel = { x: 100, y: 100, w: 200, h: 100 };

  it("moves the dragged edge only", () => {
    expect(resizeRect(sel, "e", 50, 999, bounds)).toEqual({ x: 100, y: 100, w: 250, h: 100 });
    expect(resizeRect(sel, "nw", -10, -20, bounds)).toEqual({ x: 90, y: 80, w: 210, h: 120 });
  });

  it("never lets an edge cross the opposite one", () => {
    const r = resizeRect(sel, "w", 500, 0, bounds);
    expect(r.w).toBe(4);
    expect(r.x).toBe(296);
  });

  it("stays inside the screen", () => {
    expect(resizeRect(sel, "se", 5000, 5000, bounds)).toEqual({ x: 100, y: 100, w: 900, h: 500 });
  });
});

describe("moveRect", () => {
  it("stops at the edges instead of shrinking", () => {
    const sel = { x: 100, y: 100, w: 200, h: 100 };
    expect(moveRect(sel, -500, 2000, bounds)).toEqual({ x: 0, y: 500, w: 200, h: 100 });
  });
});

describe("toolbarPosition", () => {
  const bar = { w: 400, h: 44 };

  it("sits under the selection when there is room", () => {
    expect(toolbarPosition({ x: 300, y: 100, w: 200, h: 100 }, bounds, bar, 10)).toEqual({ x: 200, y: 210 });
  });

  it("moves above when the selection reaches the bottom", () => {
    expect(toolbarPosition({ x: 300, y: 300, w: 200, h: 280 }, bounds, bar, 10)).toEqual({ x: 200, y: 246 });
  });

  it("goes inside when the selection is the whole screen", () => {
    const p = toolbarPosition({ x: 0, y: 0, w: 1000, h: 600 }, bounds, bar, 10);
    expect(p).toEqual({ x: 300, y: 546 });
  });

  it("is kept inside the viewport horizontally", () => {
    expect(toolbarPosition({ x: 0, y: 100, w: 20, h: 20 }, bounds, bar, 10).x).toBe(10);
    expect(toolbarPosition({ x: 980, y: 100, w: 20, h: 20 }, bounds, bar, 10).x).toBe(590);
  });
});

describe("readoutPosition", () => {
  const tag = { w: 80, h: 22 };

  it("sits inside a big selection and outside a small one", () => {
    expect(readoutPosition({ x: 100, y: 100, w: 400, h: 300 }, bounds, tag, 8)).toEqual({ x: 412, y: 370 });
    expect(readoutPosition({ x: 100, y: 100, w: 40, h: 30 }, bounds, tag, 8)).toEqual({ x: 60, y: 138 });
  });
});
