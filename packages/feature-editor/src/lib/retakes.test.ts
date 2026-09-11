import { describe, expect, it } from "vitest";
import type { Caption } from "../types";
import { FIXTURE_CAPTIONS, FIXTURE_DURATION, lineStarting } from "./fixtures/transcript90";
import { findRetakes, retakeRanges } from "./retakes";
import { cutSourceRanges } from "./segments";
import { GUARD, sentenceCutState, sentencesFromCaptions } from "./transcriptEdit";

const sentences = sentencesFromCaptions(FIXTURE_CAPTIONS);

function cue(text: string, start: number): Caption {
  return { id: `c${start}`, start, end: start + text.split(" ").length * 0.3, text, style: "subtitle" };
}

describe("findRetakes", () => {
  it("finds the aborted sentence and proposes cutting it up to the restart", () => {
    const found = findRetakes(sentences);
    expect(found.length).toBe(1);
    const [r] = found;
    const first = lineStarting("So the first thing you need to do is...");
    const second = lineStarting("So the first thing you need to do is open");
    expect(r.phrase).toBe("So the first thing you need to do is...");
    expect(r.words).toBe(9);
    expect(r.firstStart).toBeCloseTo(first.start, 6);
    expect(r.secondStart).toBeCloseTo(second.start, 6);
    expect(r.cutStart).toBeCloseTo(first.start - GUARD, 6);
    expect(r.cutEnd).toBeCloseTo(second.start - GUARD, 6);
    expect(r.between).toBe(0);
    expect(r.confident).toBe(true);
    expect(r.reason).toMatch(/9 words said again/);
    expect(r.id).toMatch(/^retake:/);
  });

  it("cutting it leaves the second attempt intact", () => {
    const [r] = findRetakes(sentences);
    const segments = cutSourceRanges([{ id: "a", start: 0, end: FIXTURE_DURATION }], retakeRanges([r]));
    const aborted = sentences.find((s) => s.text.endsWith("is..."))!;
    const kept = sentences.find((s) => s.text.startsWith("So the first thing you need to do is open"))!;
    expect(sentenceCutState(aborted, segments)).toBe("cut");
    expect(sentenceCutState(kept, segments)).toBe("kept");
    expect(sentenceCutState(sentences[1], segments)).toBe("kept");
    // Once cut, it is no longer proposed.
    expect(findRetakes(sentences, { segments })).toEqual([]);
    expect(findRetakes(sentences, { exclude: [r.id] })).toEqual([]);
  });

  it("ignores a phrase repeated on purpose later on, and short overlapping repeats", () => {
    const later = sentencesFromCaptions([
      cue("Click the button on the left to save.", 0),
      cue("Then wait for it.", 5),
      cue("Click the button on the left to save again.", 30),
    ]);
    expect(findRetakes(later)).toEqual([]);
    const stutter = sentencesFromCaptions([cue("the the the the the the the the end.", 0)]);
    expect(findRetakes(stutter)).toEqual([]);
  });

  it("keeps the longest match and flags a repeat with a lot in between as unsure", () => {
    const messy = sentencesFromCaptions([
      cue("Open the settings panel on the right side.", 0),
      cue("Actually wait, the other panel, no, this one.", 3),
      cue("Sorry about that, where was I, right, yes.", 6),
      cue("Open the settings panel on the right side now.", 9),
    ]);
    const found = findRetakes(messy);
    expect(found.length).toBe(1);
    expect(found[0].words).toBe(8);
    expect(found[0].between).toBeGreaterThan(12);
    expect(found[0].confident).toBe(false);
  });
});
