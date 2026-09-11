import { afterEach, describe, expect, it, vi } from "vitest";
import { concatPcm } from "./segmenter";
import { createStreamingSession, StreamingFailed, type PartialState } from "./streaming";

const RATE = 16000;

function tone(ms: number, amp = 0.3): Float32Array {
  const n = Math.round((RATE * ms) / 1000);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * 440 * i) / RATE);
  return out;
}

function quiet(ms: number): Float32Array {
  return new Float32Array(Math.round((RATE * ms) / 1000));
}

function feed(session: { push(s: Float32Array): void }, pcm: Float32Array, chunk = 1024) {
  for (let at = 0; at < pcm.length; at += chunk) session.push(pcm.subarray(at, at + chunk));
}

describe("streaming session", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("decodes segments in order while audio keeps arriving and only the tail at the stop", async () => {
    vi.useFakeTimers();
    let clock = 0;
    const now = () => clock;
    const decoded: string[] = [];
    const partials: PartialState[] = [];
    // A fake recognizer: 50 ms per second of audio, answers with the segment's length.
    const transcribe = vi.fn(async (pcm: Float32Array) => {
      const audioMs = (pcm.length / RATE) * 1000;
      const cost = Math.round(audioMs * 0.05);
      await new Promise<void>((resolve) => setTimeout(resolve, cost));
      clock += cost;
      const text = `seg${decoded.length + 1}(${Math.round(audioMs / 100) * 100}ms)`;
      decoded.push(text);
      return { text, ms: cost };
    });
    const session = createStreamingSession({ sampleRate: RATE, transcribe, now, onPartial: (p) => partials.push(p) });

    // Two utterances with a pause, then a third that is still open at the stop.
    // Fed the way a live take arrives: the first is decoded while the second
    // is still being spoken.
    feed(session, concatPcm([tone(1500), quiet(1000)]));
    // The FIFO starts on the next microtask; nothing waits for the stop.
    await vi.advanceTimersByTimeAsync(0);
    expect(transcribe).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    feed(session, concatPcm([tone(1200), quiet(1000)]));
    await vi.runAllTimersAsync();
    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(session.partial()).toBe("seg1(1700ms) seg2(1600ms)");

    feed(session, tone(900));
    const finishing = session.finish();
    await vi.runAllTimersAsync();
    const result = await finishing;

    expect(transcribe).toHaveBeenCalledTimes(3);
    expect(result.segments).toEqual(["seg1(1700ms)", "seg2(1600ms)", "seg3(1100ms)"]);
    expect(result.raw).toBe("seg1(1700ms) seg2(1600ms) seg3(1100ms)");
    // Only the tail (~1.1 s incl. pre-roll) was decoded after the stop.
    expect(result.tailAudioMs).toBeGreaterThanOrEqual(1050);
    expect(result.tailAudioMs).toBeLessThanOrEqual(1150);
    expect(result.tailMs).toBe(Math.round(result.tailAudioMs * 0.05));
    expect(result.decodeMs).toBeGreaterThan(result.tailMs);
    expect(result.audioMs).toBe(5600);
    expect(result.maxQueue).toBe(1);
    expect(partials[partials.length - 1]?.pending).toBe(0);
    expect(session.audio().length).toBe(5600 * 16);
    vi.useRealTimers();
  });

  it("keeps the order and counts the queue when the decoder falls behind", async () => {
    vi.useFakeTimers();
    let clock = 0;
    const order: number[] = [];
    let calls = 0;
    const transcribe = vi.fn(async () => {
      const id = ++calls;
      await new Promise<void>((resolve) => setTimeout(resolve, 5000));
      clock += 5000;
      order.push(id);
      return { text: `s${id}`, ms: 5000 };
    });
    const session = createStreamingSession({ sampleRate: RATE, transcribe, now: () => clock });
    feed(session, concatPcm([tone(1000), quiet(1000), tone(1000), quiet(1000), tone(1000), quiet(1000)]));
    await vi.advanceTimersByTimeAsync(0);
    expect(transcribe).toHaveBeenCalledTimes(1); // the rest wait in the FIFO
    expect(session.partial()).toBe("");
    const finishing = session.finish();
    await vi.runAllTimersAsync();
    const result = await finishing;
    expect(order).toEqual([1, 2, 3]);
    expect(result.raw).toBe("s1 s2 s3");
    expect(result.maxQueue).toBe(3);
    // Everything was still queued at the stop, so the whole take counts as tail.
    expect(result.tailAudioMs).toBeGreaterThan(3000);
    expect(result.tailMs).toBe(15000);
    vi.useRealTimers();
  });

  it("a silent take finishes with nothing and no decoder call", async () => {
    const transcribe = vi.fn(async () => ({ text: "", ms: 0 }));
    const session = createStreamingSession({ sampleRate: RATE, transcribe });
    feed(session, quiet(2000));
    const result = await session.finish();
    expect(transcribe).not.toHaveBeenCalled();
    expect(result.raw).toBe("");
    expect(result.tailMs).toBeGreaterThanOrEqual(0);
  });

  it("surfaces a decoder failure as StreamingFailed so the caller can fall back", async () => {
    const transcribe = vi.fn(async () => {
      throw new Error("the recognizer closed the connection");
    });
    const session = createStreamingSession({ sampleRate: RATE, transcribe });
    feed(session, concatPcm([tone(1000), quiet(1000)]));
    await expect(session.finish()).rejects.toBeInstanceOf(StreamingFailed);
    // The audio is still there for a whole-take retry.
    expect(session.audio().length).toBe(2000 * 16);
  });

  it("ignores results after cancel", async () => {
    const seen: PartialState[] = [];
    const transcribe = vi.fn(async () => ({ text: "late", ms: 1 }));
    const session = createStreamingSession({ sampleRate: RATE, transcribe, onPartial: (p) => seen.push(p) });
    feed(session, concatPcm([tone(1000), quiet(1000)]));
    session.cancel();
    session.push(tone(500));
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual([]);
    expect(session.partial()).toBe("");
  });
});
