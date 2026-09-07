import { describe, expect, it } from "vitest";
import { CAT_DOCUMENT, CAT_VIDEO } from "../api/types";
import {
  AGE_STOPS,
  ageColor,
  colorFor,
  folderColor,
  hexToRgb,
  hslToHex,
  inkOn,
  LIGHT_THEME,
  luminance,
  mix,
  rgbToHsl,
  shade,
} from "./colors";

describe("colour math", () => {
  it("round-trips hex through hsl", () => {
    for (const hex of ["#0a84ff", "#f0d98a", "#1d1d1f", "#ffffff"]) {
      const [r, g, b] = hexToRgb(hex);
      const [h, s, l] = rgbToHsl(r, g, b);
      const back = hexToRgb(hslToHex(h, s, l));
      expect(Math.abs(back[0] - r)).toBeLessThanOrEqual(1);
      expect(Math.abs(back[1] - g)).toBeLessThanOrEqual(1);
      expect(Math.abs(back[2] - b)).toBeLessThanOrEqual(1);
    }
  });
  it("mixes and measures", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(luminance("#ffffff")).toBeCloseTo(1, 5);
    expect(luminance("#000000")).toBe(0);
    expect(inkOn("#ffffff")).toBe("#1d1d1f");
    expect(inkOn("#1d1d1f")).toBe("#f5f5f7");
  });
  it("shades deeper levels darker in light themes and lighter in dark ones", () => {
    const base = "#f0d98a";
    expect(luminance(shade(base, 3, false))).toBeLessThan(luminance(shade(base, 0, false)));
    expect(luminance(shade(base, 3, true))).toBeGreaterThan(luminance(shade(base, 0, true)));
  });
});

describe("modes", () => {
  const now = 1_800_000_000;
  it("age buckets", () => {
    expect(ageColor(now - 86400, now)).toBe(AGE_STOPS[0].color);
    expect(ageColor(now - 20 * 86400, now)).toBe(AGE_STOPS[1].color);
    expect(ageColor(now - 1000 * 86400, now)).toBe(AGE_STOPS[5].color);
    expect(ageColor(-9e18, now)).toBe(AGE_STOPS[5].color);
  });
  it("type colours differ per category and folders are lighter", () => {
    const video = colorFor({ mode: "type", isDir: false, cat: CAT_VIDEO, mtime: 0, depth: 0, branchIndex: 0 }, LIGHT_THEME, now);
    const doc = colorFor({ mode: "type", isDir: false, cat: CAT_DOCUMENT, mtime: 0, depth: 0, branchIndex: 0 }, LIGHT_THEME, now);
    const videoDir = colorFor({ mode: "type", isDir: true, cat: CAT_VIDEO, mtime: 0, depth: 0, branchIndex: 0 }, LIGHT_THEME, now);
    expect(video).not.toBe(doc);
    expect(luminance(videoDir)).toBeGreaterThan(luminance(video));
  });
  it("folder colours cycle the palette and the rest block is neutral", () => {
    expect(folderColor(0, 0, false)).not.toBe(folderColor(1, 0, false));
    expect(folderColor(12, 0, false)).toBe(folderColor(0, 0, false));
    expect(colorFor({ mode: "folder", isDir: false, cat: 0, mtime: 0, depth: 0, branchIndex: 0, isRest: true }, LIGHT_THEME, now)).toBe("#e4e4e9");
  });
});
