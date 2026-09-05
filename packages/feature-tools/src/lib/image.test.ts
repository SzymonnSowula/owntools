import { describe, expect, it } from "vitest";
import { fitWithin, isImageFile } from "./image";

describe("fitWithin", () => {
  it("shrinks the longest side to the cap and keeps the aspect", () => {
    expect(fitWithin(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(1080, 1920, 800)).toEqual({ width: 450, height: 800 });
  });

  it("never scales up and ignores an empty cap", () => {
    expect(fitWithin(640, 480, 2000)).toEqual({ width: 640, height: 480 });
    expect(fitWithin(640, 480, null)).toEqual({ width: 640, height: 480 });
    expect(fitWithin(640, 480, 0)).toEqual({ width: 640, height: 480 });
  });
});

describe("isImageFile", () => {
  it("accepts by type or by extension", () => {
    expect(isImageFile(new File([""], "a.png", { type: "image/png" }))).toBe(true);
    expect(isImageFile(new File([""], "photo.HEIC", { type: "" }))).toBe(false);
    expect(isImageFile(new File([""], "shot.webp", { type: "" }))).toBe(true);
    expect(isImageFile(new File([""], "doc.pdf", { type: "application/pdf" }))).toBe(false);
  });
});
