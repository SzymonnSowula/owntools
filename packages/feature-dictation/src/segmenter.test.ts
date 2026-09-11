import { describe, expect, it } from "vitest";
import { concatPcm, resampleLinear, Segmenter, toDb, type Segment } from "./segmenter";

const RATE = 16000;

/** A steady tone — "speech" for the energy detector. */
function tone(ms: number, amp = 0.3, freq = 440): Float32Array {
  const n = Math.round((RATE * ms) / 1000);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / RATE);
  return out;
}

/** Room noise: deterministic pseudo-random at a given amplitude. */
function quiet(ms: number, amp = 0.0005, seed = 1): Float32Array {
  const n = Math.round((RATE * ms) / 1000);
  const out = new Float32Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = amp * ((s / 0xffffffff) * 2 - 1);
  }
  return out;
}

/** Pushes in uneven chunks, the way a ScriptProcessor would, and collects. */
function run(seg: Segmenter, pcm: Float32Array, chunk = 1024): Segment[] {
  const out: Segment[] = [];
  for (let at = 0; at < pcm.length; at += chunk) out.push(...seg.push(pcm.subarray(at, at + chunk)));
  return out;
}

const ms = (samples: number) => (samples / RATE) * 1000;

describe("Segmenter", () => {
  it("closes an utterance on silence, keeps a pad, and pre-rolls the next one", () => {
    const seg = new Segmenter({ sampleRate: RATE });
    const audio = concatPcm([tone(1000), quiet(1000), tone(800), quiet(1000)]);
    const got = run(seg, audio);
    expect(got.map((s) => s.reason)).toEqual(["silence", "silence"]);

    // First utterance: 0–1000 ms of speech, then 600 ms of hangover closes it
    // and only 200 ms of the silence is kept.
    expect(got[0].startMs).toBe(0);
    expect(ms(got[0].pcm.length)).toBeGreaterThanOrEqual(1180);
    expect(ms(got[0].pcm.length)).toBeLessThanOrEqual(1240);
    expect(got[0].speechMs).toBeGreaterThanOrEqual(960);

    // Second: speech at 2000–2800, with 200 ms of pre-roll in front.
    expect(got[1].startMs).toBeGreaterThanOrEqual(1780);
    expect(got[1].startMs).toBeLessThanOrEqual(1820);
    expect(got[1].endMs).toBeGreaterThanOrEqual(2980);
    expect(got[1].endMs).toBeLessThanOrEqual(3040);
    // Nothing left over: the take ended in silence.
    expect(seg.flush()).toBeNull();
  });

  it("drops a click shorter than the minimum speech", () => {
    const seg = new Segmenter({ sampleRate: RATE });
    const got = run(seg, concatPcm([quiet(500), tone(120), quiet(1000)]));
    expect(got).toEqual([]);
    expect(seg.flush()).toBeNull();
  });

  it("cuts hard at the maximum length and flushes the rest as the tail", () => {
    const seg = new Segmenter({ sampleRate: RATE });
    const got = run(seg, tone(16000));
    expect(got).toHaveLength(1);
    expect(got[0].reason).toBe("max");
    expect(ms(got[0].pcm.length)).toBeGreaterThanOrEqual(14980);
    expect(ms(got[0].pcm.length)).toBeLessThanOrEqual(15020);
    const tail = seg.flush();
    expect(tail?.reason).toBe("flush");
    expect(tail && ms(tail.pcm.length)).toBeGreaterThanOrEqual(960);
    expect(tail?.startMs).toBeGreaterThanOrEqual(14980);
  });

  it("takes a short pause once the utterance is long", () => {
    const seg = new Segmenter({ sampleRate: RATE });
    // 11 s of speech, a 300 ms breath, more speech: the breath is under the
    // 600 ms hangover but past softMaxMs it is enough.
    const got = run(seg, concatPcm([tone(11000), quiet(300), tone(2000), quiet(1000)]));
    expect(got.map((s) => s.reason)).toEqual(["silence", "silence"]);
    expect(ms(got[0].pcm.length)).toBeGreaterThanOrEqual(11180);
    expect(ms(got[0].pcm.length)).toBeLessThanOrEqual(11280);
    // After a short pause the next utterance starts where the last one ended:
    // nothing is lost and nothing is decoded twice.
    expect(Math.abs(got[1].startMs - got[0].endMs)).toBeLessThanOrEqual(40);
  });

  it("the tail keeps the words spoken just before the stop", () => {
    const seg = new Segmenter({ sampleRate: RATE });
    const got = run(seg, concatPcm([tone(2000), quiet(1000), tone(1500)]));
    expect(got).toHaveLength(1);
    const tail = seg.flush();
    expect(tail?.reason).toBe("flush");
    expect(tail?.startMs).toBeGreaterThanOrEqual(2780);
    expect(tail && ms(tail.pcm.length)).toBeGreaterThanOrEqual(1680);
  });

  it("lifts the gate over a constant hum instead of shipping it as speech", () => {
    const seg = new Segmenter({ sampleRate: RATE });
    const fan = 0.03; // about -30 dBFS: above the fixed threshold
    const speech = concatPcm([tone(1000, 0.25, 300), quiet(0)]);
    for (let i = 0; i < speech.length; i++) speech[i] += fan * Math.sin((2 * Math.PI * 120 * i) / RATE);
    const hum = (msLen: number) => tone(msLen, fan, 120);
    const got = run(seg, concatPcm([hum(5000), speech, hum(2000)]));
    // The hum may produce one segment while the floor is still learning it,
    // but never after the first couple of seconds.
    const late = got.filter((s) => s.startMs > 2500);
    expect(late).toHaveLength(1);
    expect(late[0].startMs).toBeGreaterThanOrEqual(4700);
    expect(late[0].startMs).toBeLessThanOrEqual(5000);
    expect(seg.gateDb).toBeGreaterThan(toDb(fan / Math.SQRT2) + 2);
  });

  it("handles frame boundaries that do not line up with the chunks", () => {
    const a = new Segmenter({ sampleRate: RATE });
    const b = new Segmenter({ sampleRate: RATE });
    const audio = concatPcm([quiet(300), tone(700), quiet(900), tone(500), quiet(900)]);
    const fromChunks = run(a, audio, 333);
    const fromOne = run(b, audio, audio.length);
    expect(fromChunks.map((s) => [s.startMs, s.pcm.length])).toEqual(
      fromOne.map((s) => [s.startMs, s.pcm.length]),
    );
    expect(fromChunks).toHaveLength(2);
  });

  it("reports level and speaking for a meter", () => {
    const seg = new Segmenter({ sampleRate: RATE });
    seg.push(tone(100));
    expect(seg.speaking).toBe(true);
    expect(seg.lastRms).toBeGreaterThan(0.15);
    seg.push(quiet(1000));
    expect(seg.speaking).toBe(false);
    expect(seg.positionMs).toBe(1100);
  });
});

describe("resampleLinear", () => {
  it("keeps the duration and the waveform when going down to 16 kHz", () => {
    const src = new Float32Array(48000);
    for (let i = 0; i < src.length; i++) src[i] = Math.sin((2 * Math.PI * 440 * i) / 48000);
    const out = resampleLinear(src, 48000, 16000);
    expect(out.length).toBe(16000);
    // Same tone at the new rate: compare a few samples against the ideal.
    for (const i of [100, 4000, 12345]) {
      expect(out[i]).toBeCloseTo(Math.sin((2 * Math.PI * 440 * i) / 16000), 1);
    }
    expect(resampleLinear(src, 16000, 16000)).toBe(src);
  });
});
