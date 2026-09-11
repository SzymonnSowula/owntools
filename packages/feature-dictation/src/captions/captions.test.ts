// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  captionsRunning,
  captureStartArgs,
  DEFAULT_CAPTIONS_SETTINGS,
  FADE_MS,
  HOLD_MS,
  isCaptureSegment,
  lineOpacity,
  loadCaptionsSettings,
  normalizeCaptionsSettings,
  overlayHeight,
  pushLine,
  saveCaptionsSettings,
  setCaptionsRunning,
  subscribeCaptionsSettings,
  type CaptionLine,
} from "./captions";

beforeEach(() => localStorage.clear());

describe("captions settings", () => {
  it("folds anything onto valid settings", () => {
    expect(normalizeCaptionsSettings(null)).toEqual(DEFAULT_CAPTIONS_SETTINGS);
    expect(normalizeCaptionsSettings({ sources: ["mic", "mic", "tv"], fontSize: 900, lines: 7, translate: "yes" })).toEqual({
      sources: ["mic"],
      translate: false,
      fontSize: 44,
      clickThrough: false,
      lines: 3,
    });
    expect(normalizeCaptionsSettings({ sources: [], fontSize: 3, lines: 2, clickThrough: true }).sources).toEqual(["system"]);
    expect(normalizeCaptionsSettings({ fontSize: 3 }).fontSize).toBe(18);
  });

  it("saves, reloads and notifies", () => {
    const seen = vi.fn();
    const off = subscribeCaptionsSettings(seen);
    saveCaptionsSettings({ translate: true, fontSize: 30 });
    expect(loadCaptionsSettings()).toMatchObject({ translate: true, fontSize: 30, sources: ["system"] });
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    localStorage.setItem("owntools-captions-settings", "{broken");
    expect(loadCaptionsSettings()).toEqual(DEFAULT_CAPTIONS_SETTINGS);
  });

  it("remembers whether a capture is running", () => {
    expect(captionsRunning()).toBe(false);
    setCaptionsRunning(true);
    expect(captionsRunning()).toBe(true);
    setCaptionsRunning(false);
    expect(captionsRunning()).toBe(false);
  });

  it("starts the capture exactly the way the contract says", () => {
    expect(captureStartArgs({ ...DEFAULT_CAPTIONS_SETTINGS, sources: ["mic", "system"] })).toEqual({
      session: "captions",
      sources: ["mic", "system"],
      dir: "captions",
      archive: false,
      vad: { hangoverMs: 400, maxSegmentMs: 8000 },
    });
  });

  it("recognises a segment event and rejects the rest", () => {
    expect(isCaptureSegment({ session: "captions", source: "system", startMs: 0, endMs: 1200, path: "C:/x.wav" })).toBe(true);
    expect(isCaptureSegment({ session: "captions", source: "tv", startMs: 0, endMs: 1, path: "x" })).toBe(false);
    expect(isCaptureSegment({ session: "captions", mic: 0.2, system: 0.1 })).toBe(false);
    expect(isCaptureSegment(null)).toBe(false);
  });
});

describe("caption lines", () => {
  const line = (id: number): CaptionLine => ({ id, text: `line ${id}`, at: 0, source: "system" });

  it("keeps only the last few lines", () => {
    let lines: CaptionLine[] = [];
    for (let i = 1; i <= 5; i++) lines = pushLine(lines, line(i), 3);
    expect(lines.map((l) => l.id)).toEqual([3, 4, 5]);
  });

  it("fades older lines by rank and stale lines by age", () => {
    expect(lineOpacity(0, 0)).toBe(1);
    expect(lineOpacity(1, 0)).toBeLessThan(lineOpacity(0, 0));
    expect(lineOpacity(2, 0)).toBeLessThan(lineOpacity(1, 0));
    expect(lineOpacity(0, HOLD_MS)).toBe(1);
    expect(lineOpacity(0, HOLD_MS + FADE_MS / 2)).toBeCloseTo(0.5, 1);
    expect(lineOpacity(0, HOLD_MS + FADE_MS + 1)).toBe(0);
  });

  it("sizes the window to the text", () => {
    const small = overlayHeight({ ...DEFAULT_CAPTIONS_SETTINGS, fontSize: 18, lines: 2 });
    const big = overlayHeight({ ...DEFAULT_CAPTIONS_SETTINGS, fontSize: 44, lines: 3 });
    expect(small).toBeLessThan(big);
    expect(overlayHeight(DEFAULT_CAPTIONS_SETTINGS)).toBeLessThanOrEqual(170);
    expect(overlayHeight(DEFAULT_CAPTIONS_SETTINGS, true)).toBeGreaterThan(overlayHeight(DEFAULT_CAPTIONS_SETTINGS));
  });
});
