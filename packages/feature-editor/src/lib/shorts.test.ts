import { describe, expect, it } from "vitest";
import { proposeChapters } from "./chapters";
import { findFillers } from "./fillers";
import { FIXTURE_CAPTIONS, FIXTURE_DURATION } from "./fixtures/transcript90";
import { cutSourceRanges, sourceToTimeline } from "./segments";
import { findShorts } from "./shorts";
import { sentencesFromCaptions } from "./transcriptEdit";

const sentences = sentencesFromCaptions(FIXTURE_CAPTIONS);
const whole = [{ id: "a", start: 0, end: FIXTURE_DURATION }];

describe("findShorts", () => {
  it("returns up to five clips of 20–60 s that start on a sentence, best first", () => {
    const shorts = findShorts(sentences, whole, proposeChapters(sentences, FIXTURE_DURATION));
    expect(shorts.length).toBeGreaterThanOrEqual(2);
    expect(shorts.length).toBeLessThanOrEqual(5);
    const starts = new Set(sentences.map((s) => s.start));
    for (const c of shorts) {
      expect(c.duration).toBeGreaterThanOrEqual(20);
      expect(c.duration).toBeLessThanOrEqual(60);
      expect(starts.has(c.start)).toBe(true);
      expect(c.reason.length).toBeGreaterThan(0);
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.tlEnd - c.tlStart).toBeCloseTo(c.duration, 6);
    }
    for (let i = 1; i < shorts.length; i++) expect(shorts[i].score).toBeLessThanOrEqual(shorts[i - 1].score);
  });

  it("prefers chapter starts and says so", () => {
    const chapters = proposeChapters(sentences, FIXTURE_DURATION);
    const shorts = findShorts(sentences, whole, chapters);
    const opener = shorts.find((c) => c.chapterStart);
    expect(opener).toBeDefined();
    expect(opener!.reason).toContain("opens a chapter");
  });

  it("does not hand back two clips that are mostly the same stretch", () => {
    const shorts = findShorts(sentences, whole);
    for (let i = 0; i < shorts.length; i++) {
      for (let j = i + 1; j < shorts.length; j++) {
        const a = shorts[i];
        const b = shorts[j];
        const overlap = Math.min(a.tlEnd, b.tlEnd) - Math.max(a.tlStart, b.tlStart);
        expect(overlap).toBeLessThanOrEqual(0.4 * Math.min(a.duration, b.duration) + 1e-6);
      }
    }
  });

  it("measures length on the cut timeline and skips sentences that are gone", () => {
    const gone = sentences[3];
    const segments = cutSourceRanges(whole, [{ start: gone.start - 0.02, end: gone.end + 0.02 }]);
    const shorts = findShorts(sentences, segments);
    expect(shorts.some((c) => c.start === gone.start)).toBe(false);
    for (const c of shorts) {
      expect(c.tlStart).toBeCloseTo(sourceToTimeline(c.start, segments), 6);
      expect(c.duration).toBeLessThanOrEqual(c.end - c.start + 1e-6);
    }
  });

  it("counts fillers inside a clip against it", () => {
    const fillers = findFillers(sentences);
    const withPenalty = findShorts(sentences, whole, [], { fillers });
    const without = findShorts(sentences, whole, []);
    const pick = (list: typeof without, start: number) => list.find((c) => c.start === start);
    const shared = without.find((c) => pick(withPenalty, c.start) && fillers.some((f) => f.start >= c.start && f.end <= c.end));
    expect(shared).toBeDefined();
    expect(pick(withPenalty, shared!.start)!.score).toBeLessThan(shared!.score);
    expect(pick(withPenalty, shared!.start)!.reason).toMatch(/filler/);
  });
});
