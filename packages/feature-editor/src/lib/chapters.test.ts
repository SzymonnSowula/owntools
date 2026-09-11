import { describe, expect, it } from "vitest";
import {
  chapterExcerpts,
  chapterTitleFromWords,
  chaptersToYouTube,
  improveChapterTitles,
  isChapterAnswer,
  proposeChapters,
  targetChapterCount,
} from "./chapters";
import { FIXTURE_CAPTIONS, FIXTURE_DURATION, lineStarting } from "./fixtures/transcript90";
import { cutSourceRanges } from "./segments";
import { sentencesFromCaptions } from "./transcriptEdit";

const sentences = sentencesFromCaptions(FIXTURE_CAPTIONS);

describe("targetChapterCount", () => {
  it("wants 4–8 for a ten-minute take and scales with length", () => {
    expect(targetChapterCount(90)).toBe(3);
    expect(targetChapterCount(600)).toBeGreaterThanOrEqual(4);
    expect(targetChapterCount(600)).toBeLessThanOrEqual(8);
    expect(targetChapterCount(3600)).toBe(12);
  });
});

describe("proposeChapters", () => {
  it("starts at 0 and puts the next chapters on the longest pauses, in order", () => {
    const chapters = proposeChapters(sentences, FIXTURE_DURATION);
    expect(chapters.length).toBe(3);
    expect(chapters[0].start).toBe(0);
    // The 2.3 s and 1.9 s pauses win; the 1.6 s one is left for a higher target.
    expect(chapters[1].start).toBeCloseTo(lineStarting("Uh, here we have").start, 6);
    expect(chapters[2].start).toBeCloseTo(lineStarting("Now the interesting part").start, 6);
    const four = proposeChapters(sentences, FIXTURE_DURATION, { target: 4 });
    expect(four.map((c) => c.start)).toContainEqual(lineStarting("Finally, export.").start);
    for (let i = 1; i < four.length; i++) expect(four[i].start).toBeGreaterThan(four[i - 1].start);
  });

  it("titles chapters with their opening words, fillers and lead-ins dropped", () => {
    const chapters = proposeChapters(sentences, FIXTURE_DURATION);
    expect(chapters[0].title).toBe("Hi everyone, today I want to show");
    expect(chapters[2].title).toBe("The interesting part: the cursor");
    for (const c of chapters) {
      expect(c.title.split(" ").length).toBeLessThanOrEqual(7);
      expect(c.title).not.toMatch(/\bum\b|\buh\b/i);
    }
  });

  it("gives a short take no chapters", () => {
    expect(proposeChapters(sentences, 30)).toEqual([]);
    expect(proposeChapters(sentences.slice(0, 2), FIXTURE_DURATION)).toEqual([]);
  });
});

describe("chapterTitleFromWords", () => {
  it("stops at a clause break inside the window and capitalises", () => {
    const words = "so, okay here is the plan, and then more".split(" ").map((text, i) => ({ text, start: i, end: i + 1, timed: true }));
    expect(chapterTitleFromWords(words)).toBe("Here is the plan");
    expect(chapterTitleFromWords([])).toBe("");
  });
});

describe("chaptersToYouTube", () => {
  it("writes one line per chapter in timeline time, the first at 00:00", () => {
    const chapters = proposeChapters(sentences, FIXTURE_DURATION);
    const whole = [{ id: "a", start: 0, end: FIXTURE_DURATION }];
    const text = chaptersToYouTube(chapters, whole);
    const lines = text.split("\n");
    expect(lines.length).toBe(3);
    expect(lines[0]).toMatch(/^00:00 Hi everyone/);
    expect(lines[1]).toMatch(/^00:\d\d /);
    // Cutting the first ten seconds moves every later chapter earlier by ten.
    const cut = cutSourceRanges(whole, [{ start: 0, end: 10 }]);
    const moved = chaptersToYouTube(chapters, cut).split("\n");
    const secs = (line: string) => Number(line.slice(3, 5)) + 60 * Number(line.slice(0, 2));
    expect(secs(moved[1])).toBe(secs(lines[1]) - 10);
  });

  it("collapses chapters that fell into one cut and formats hours", () => {
    const chapters = [
      { start: 0, title: "Intro" },
      { start: 20, title: "Gone" },
      { start: 25, title: "Also gone" },
      { start: 4000, title: "Late" },
    ];
    const segments = [
      { id: "a", start: 0, end: 15 },
      { id: "b", start: 30, end: 5000 },
    ];
    expect(chaptersToYouTube(chapters, segments)).toBe("00:00 Intro\n00:15 Gone\n1:06:25 Late");
  });
});

describe("the model path", () => {
  it("guards the model's answer and hands the heuristic titles back when no model is set up", async () => {
    expect(isChapterAnswer({ chapters: [{ start: 0, title: "a" }] })).toBe(true);
    expect(isChapterAnswer({ chapters: [{ start: "0", title: "a" }] })).toBe(false);
    expect(isChapterAnswer({ chapters: "nope" })).toBe(false);
    expect(isChapterAnswer(null)).toBe(false);
    const chapters = proposeChapters(sentences, FIXTURE_DURATION);
    // `@core/llm` is the placeholder that reports unavailable — the path every fresh install takes.
    const result = await improveChapterTitles(chapters, sentences);
    expect(result.used).toBe("heuristic");
    expect(result.chapters).toEqual(chapters);
  });

  it("excerpts give the model the opening words of each chapter and nothing from the next", () => {
    const chapters = proposeChapters(sentences, FIXTURE_DURATION);
    const excerpts = chapterExcerpts(chapters, sentences, 12);
    expect(excerpts.length).toBe(3);
    expect(excerpts[0].startsWith("Hi everyone, um, today")).toBe(true);
    expect(excerpts[1].startsWith("Uh, here we have")).toBe(true);
    expect(excerpts[0].split(" ").length).toBeLessThanOrEqual(12);
  });
});
