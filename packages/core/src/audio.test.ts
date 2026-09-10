import { describe, expect, it } from "vitest";

import { conditionPcm, speechBounds, WHISPER_SAMPLE_RATE as RATE } from "./audio";

/** `seconds` of near-silence, with `speech` of a tone spliced in at `at`. */
function take(seconds: number, at: number, speech: number, level = 0.4): Float32Array {
  const pcm = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < pcm.length; i++) {
    // A real room is never digital silence; this is roughly a quiet mic.
    pcm[i] = (Math.random() - 0.5) * 0.0008;
  }
  const from = Math.round(at * RATE);
  const to = Math.min(pcm.length, from + Math.round(speech * RATE));
  for (let i = from; i < to; i++) {
    pcm[i] = Math.sin((i / RATE) * 2 * Math.PI * 220) * level;
  }
  return pcm;
}

describe("speechBounds", () => {
  it("finds the words inside a take that starts and ends in silence", () => {
    const pcm = take(5, 1.5, 2);
    const { start, end } = speechBounds(pcm, RATE);
    // Within the 0.15 s margin plus one 20 ms window of the true edges.
    expect(start / RATE).toBeGreaterThan(1.5 - 0.2);
    expect(start / RATE).toBeLessThan(1.5);
    expect(end / RATE).toBeGreaterThan(3.5);
    expect(end / RATE).toBeLessThan(3.5 + 0.2);
  });

  it("keeps a margin on both sides so no syllable is clipped", () => {
    const pcm = take(3, 1, 1);
    const tight = speechBounds(pcm, RATE, 0);
    const generous = speechBounds(pcm, RATE, 0.15);
    expect(generous.start).toBeLessThan(tight.start);
    expect(generous.end).toBeGreaterThan(tight.end);
  });

  it("leaves a take with nothing in it alone", () => {
    const pcm = take(2, 0, 0);
    expect(speechBounds(pcm, RATE)).toEqual({ start: 0, end: pcm.length });
  });

  it("leaves a take that is speech from end to end alone", () => {
    const pcm = take(2, 0, 2);
    const { start, end } = speechBounds(pcm, RATE);
    expect(start).toBe(0);
    expect(end).toBe(pcm.length);
  });
});

describe("conditionPcm with trimSilence", () => {
  it("cuts the dead air a dictation take carries at both ends", () => {
    const pcm = take(6, 2, 2);
    const kept = conditionPcm(pcm, RATE, { trimSilence: true });
    const asIs = conditionPcm(pcm, RATE);
    expect(asIs.length).toBeGreaterThan(RATE * 5.9);
    // ~2 s of speech plus margins and pads, not the original 6 s: the
    // recognizer is charged for the words, not for the pause before them.
    expect(kept.length).toBeLessThan(RATE * 3.2);
    expect(kept.length).toBeGreaterThan(RATE * 2.2);
  });

  it("is off by default, so a file keeps its timings", () => {
    const pcm = take(4, 1, 1);
    expect(conditionPcm(pcm, RATE).length).toBeGreaterThanOrEqual(pcm.length);
  });

  it("never trims a take down to nothing", () => {
    const pcm = take(3, 0, 0);
    const out = conditionPcm(pcm, RATE, { trimSilence: true });
    expect(out.length).toBeGreaterThanOrEqual(pcm.length);
  });

  it("still pads a very short take out to the minimum length", () => {
    const pcm = take(0.6, 0.1, 0.3);
    const out = conditionPcm(pcm, RATE, { trimSilence: true });
    expect(out.length).toBe(Math.round(1.2 * RATE));
  });
});
