import { describe, expect, it } from "vitest";
import {
  annotationBounds,
  annotationFromDrag,
  badgeAnnotation,
  canRedo,
  canUndo,
  commit,
  emptyHistory,
  nextBadgeNumber,
  parseAnnotations,
  redo,
  serializeAnnotations,
  textAnnotation,
  undo,
  type Annotation,
} from "./annotations";

const style = { color: "#0a84ff", width: 4, scale: 2 };

describe("annotationFromDrag", () => {
  it("scales the stroke width by the screen scale", () => {
    const a = annotationFromDrag("arrow", { x: 0, y: 0 }, { x: 100, y: 50 }, style);
    expect(a).toMatchObject({ kind: "arrow", x1: 0, y1: 0, x2: 100, y2: 50, width: 8 });
  });

  it("normalises a rectangle dragged upwards and left", () => {
    const a = annotationFromDrag("rect", { x: 100, y: 100 }, { x: 20, y: 40 }, style);
    expect(a).toMatchObject({ kind: "rect", x: 20, y: 40, w: 80, h: 60 });
  });

  it("gives a blur its pixel cell and no colour", () => {
    const a = annotationFromDrag("blur", { x: 0, y: 0 }, { x: 50, y: 50 }, style);
    expect(a).toMatchObject({ kind: "blur", cell: 20 });
    expect(a && "color" in a).toBe(false);
  });

  it("drops a drag too small to be a shape", () => {
    expect(annotationFromDrag("ellipse", { x: 0, y: 0 }, { x: 2, y: 30 }, style)).toBeNull();
    expect(annotationFromDrag("line", { x: 0, y: 0 }, { x: 1, y: 1 }, style)).toBeNull();
    expect(annotationFromDrag("select", { x: 0, y: 0 }, { x: 90, y: 90 }, style)).toBeNull();
  });
});

describe("badges", () => {
  it("numbers steps from one and past the highest so far", () => {
    const list: Annotation[] = [];
    expect(nextBadgeNumber(list)).toBe(1);
    list.push(badgeAnnotation({ x: 10, y: 10 }, 1, style), badgeAnnotation({ x: 40, y: 10 }, 7, style));
    expect(nextBadgeNumber(list)).toBe(8);
    expect(list[0]).toMatchObject({ size: 26 });
  });
});

describe("serialize / parse", () => {
  it("round-trips every kind", () => {
    const list: Annotation[] = [
      annotationFromDrag("arrow", { x: 0, y: 0 }, { x: 10, y: 10 }, style)!,
      annotationFromDrag("line", { x: 0, y: 0 }, { x: 10, y: 10 }, style)!,
      annotationFromDrag("rect", { x: 0, y: 0 }, { x: 10, y: 10 }, style)!,
      annotationFromDrag("ellipse", { x: 0, y: 0 }, { x: 10, y: 10 }, style)!,
      annotationFromDrag("highlight", { x: 0, y: 0 }, { x: 10, y: 10 }, style)!,
      annotationFromDrag("blur", { x: 0, y: 0 }, { x: 10, y: 10 }, style)!,
      textAnnotation({ x: 5, y: 5 }, "hello", style),
      badgeAnnotation({ x: 5, y: 5 }, 3, style),
    ];
    expect(parseAnnotations(serializeAnnotations(list))).toEqual(list);
  });

  it("drops malformed items and survives garbage", () => {
    const good = textAnnotation({ x: 1, y: 2 }, "ok", style);
    const raw = JSON.stringify({
      v: 1,
      items: [good, { id: "x", kind: "rect", x: 1 }, { id: "y", kind: "sparkle", x: 1, y: 1 }, 42, null],
    });
    expect(parseAnnotations(raw)).toEqual([good]);
    expect(parseAnnotations("not json")).toEqual([]);
    expect(parseAnnotations(null)).toEqual([]);
    expect(parseAnnotations(JSON.stringify({ items: "nope" }))).toEqual([]);
  });
});

describe("annotationBounds", () => {
  it("boxes a stroke by its ends and a badge by its radius", () => {
    expect(annotationBounds(annotationFromDrag("line", { x: 50, y: 10 }, { x: 10, y: 40 }, style)!)).toEqual({
      x: 10,
      y: 10,
      w: 40,
      h: 30,
    });
    expect(annotationBounds(badgeAnnotation({ x: 100, y: 100 }, 1, style))).toEqual({ x: 74, y: 74, w: 52, h: 52 });
  });
});

describe("history", () => {
  const a = textAnnotation({ x: 0, y: 0 }, "a", style);
  const b = textAnnotation({ x: 0, y: 0 }, "b", style);

  it("undoes and redoes in order", () => {
    let h = emptyHistory();
    expect(canUndo(h)).toBe(false);
    h = commit(h, [a]);
    h = commit(h, [a, b]);
    expect(h.present).toEqual([a, b]);
    h = undo(h);
    expect(h.present).toEqual([a]);
    expect(canRedo(h)).toBe(true);
    h = undo(h);
    expect(h.present).toEqual([]);
    expect(undo(h)).toBe(h);
    h = redo(h);
    h = redo(h);
    expect(h.present).toEqual([a, b]);
    expect(redo(h)).toBe(h);
  });

  it("forgets the redo branch after a new change", () => {
    let h = commit(commit(emptyHistory(), [a]), [a, b]);
    h = undo(h);
    h = commit(h, [b]);
    expect(canRedo(h)).toBe(false);
    expect(undo(h).present).toEqual([a]);
  });
});
