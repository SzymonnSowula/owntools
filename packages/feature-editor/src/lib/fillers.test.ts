import { describe, expect, it } from "vitest";
import type { Caption } from "../types";
import { FIXTURE_CAPTIONS, FIXTURE_CAPTIONS_PLAIN, FIXTURE_DURATION, lineStarting } from "./fixtures/transcript90";
import { fillerSeconds, findFillers, removeFillerRanges } from "./fillers";
import { cutSourceRanges } from "./segments";
import { GUARD, sentencesFromCaptions } from "./transcriptEdit";

const sentences = sentencesFromCaptions(FIXTURE_CAPTIONS);

function cue(text: string, start = 0): Caption {
  return { id: `c${start}`, start, end: start + text.split(" ").length * 0.3, text, style: "subtitle" };
}

describe("findFillers", () => {
  const found = findFillers(sentences);

  it("finds every hesitation sound, the aside phrases and both stutters in the take", () => {
    const sounds = found.filter((c) => c.kind === "sound").map((c) => c.text.toLowerCase());
    expect(sounds).toEqual(["um,", "uh,", "um,", "hmm,", "uh,"]);
    const phrases = found.filter((c) => c.kind === "phrase").map((c) => c.text);
    expect(phrases).toEqual(["like,", "You know,", "I mean,"]);
    const stutters = found.filter((c) => c.kind === "stutter");
    expect(stutters.map((c) => c.text)).toEqual(["the", "that's,"]);
    expect(found.length).toBe(10);
  });

  it("comes back in time order with a reason, context and a stable id each", () => {
    for (let i = 1; i < found.length; i++) expect(found[i].start).toBeGreaterThanOrEqual(found[i - 1].start);
    for (const c of found) {
      expect(c.reason.length).toBeGreaterThan(0);
      expect(c.id).toMatch(/^(sound|phrase|stutter):[0-9a-z]+$/);
    }
    const um = found[0];
    expect(um.before).toBe("Hi everyone,");
    expect(um.after).toBe("today I want");
    expect(findFillers(sentences).map((c) => c.id)).toEqual(found.map((c) => c.id));
  });

  it("pre-ticks only what is never a word", () => {
    expect(found.filter((c) => c.kind === "sound").every((c) => c.confident)).toBe(true);
    expect(found.filter((c) => c.kind === "stutter").every((c) => c.confident)).toBe(true);
    expect(found.filter((c) => c.kind === "phrase").every((c) => !c.confident)).toBe(true);
  });

  it("a stutter proposes removing the first word up to the second, keeping the second", () => {
    const line = lineStarting("Uh, here we have the the");
    const stutter = found.find((c) => c.kind === "stutter" && c.text === "the")!;
    expect(stutter.start).toBeCloseTo(line.words[4].start, 6);
    expect(stutter.end).toBeCloseTo(line.words[5].start - GUARD, 6);
    expect(stutter.wordFrom).toBe(4);
  });

  it("leaves 'like' the verb and the doubles that are emphasis alone", () => {
    const quiet = sentencesFromCaptions([
      cue("I like this feature and it looks like a menu.", 0),
      cue("This is very very fast, no no, really.", 10),
      cue("You know what I mean by that.", 20),
      cue("To znaczy, że działa.", 30),
    ]);
    expect(findFillers(quiet)).toEqual([]);
  });

  it("finds the Polish set: yyy, eee, mmm, no więc, znaczy, jakby between pauses", () => {
    const polish = sentencesFromCaptions([
      cue("No więc, yyy, dzisiaj pokażę wam eee nowy panel.", 0),
      cue("To jest, jakby, najszybsza droga, znaczy, najprostsza.", 10),
      cue("Mmm, i tyle.", 20),
    ]);
    const kinds = findFillers(polish).map((c) => `${c.kind}:${c.text}`);
    expect(kinds).toEqual([
      "phrase:No więc,",
      "sound:yyy,",
      "sound:eee",
      "phrase:jakby,",
      "phrase:znaczy,",
      "sound:Mmm,",
    ]);
  });

  it("skips accepted ids and anything already on the cutting-room floor", () => {
    const [first, second] = found;
    expect(findFillers(sentences, { exclude: [first.id] }).map((c) => c.id)).not.toContain(first.id);
    const whole = [{ id: "a", start: 0, end: FIXTURE_DURATION }];
    const segments = cutSourceRanges(whole, removeFillerRanges([second]));
    const after = findFillers(sentences, { segments });
    expect(after.map((c) => c.id)).not.toContain(second.id);
    expect(after.length).toBe(found.length - 1);
  });

  it("works on estimated word timing too, and says so", () => {
    const plain = findFillers(sentencesFromCaptions(FIXTURE_CAPTIONS_PLAIN));
    expect(plain.filter((c) => c.kind === "sound").length).toBe(5);
    expect(plain.every((c) => !c.timed)).toBe(true);
  });
});

describe("removeFillerRanges", () => {
  const found = findFillers(sentences);

  it("never reaches within the guard of a neighbouring word", () => {
    const ranges = removeFillerRanges(found);
    for (const c of found) {
      const range = ranges.find((r) => r.start <= c.start + 1e-6 && r.end >= c.start)!;
      expect(range).toBeDefined();
      if (c.prevEnd !== null) expect(range.start).toBeGreaterThanOrEqual(c.prevEnd + GUARD - 1e-9);
      if (c.nextStart !== null) expect(range.end).toBeLessThanOrEqual(c.nextStart - GUARD + 1e-9);
      expect(range.end).toBeGreaterThan(range.start);
    }
  });

  it("removes the filler, keeps both neighbours", () => {
    const um = found[0];
    const whole = [{ id: "a", start: 0, end: FIXTURE_DURATION }];
    const segments = cutSourceRanges(whole, removeFillerRanges([um]));
    const line = lineStarting("Hi everyone");
    const inKept = (t: number) => segments.some((s) => t >= s.start && t <= s.end);
    expect(inKept((um.start + um.end) / 2)).toBe(false);
    expect(inKept((line.words[1].start + line.words[1].end) / 2)).toBe(true);
    expect(inKept((line.words[3].start + line.words[3].end) / 2)).toBe(true);
    expect(fillerSeconds([um])).toBeGreaterThan(0.1);
  });

  it("merges consecutive fillers into one range", () => {
    const pair = sentencesFromCaptions([cue("So um uh the point is this.", 0)]);
    const cands = findFillers(pair);
    expect(cands.length).toBe(2);
    expect(removeFillerRanges(cands).length).toBe(1);
  });
});
