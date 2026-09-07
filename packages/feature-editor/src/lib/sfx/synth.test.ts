import { describe, expect, it } from "vitest";
import { SFX_PACKS, sfxPack } from "./packs";
import { MOUSE_CLICK_SPLIT, sample } from "./samples";
import { biquad, envelopeAt, mulberry32, renderRecipe, type Recipe } from "./synth";

const SR = 48000;

describe("envelopeAt", () => {
  const layer = { gain: 1, attack: 0.01, hold: 0.02, decay: 0.05 };

  it("rises through the attack, sits on the hold, then decays", () => {
    expect(envelopeAt(layer, 0)).toBe(0);
    expect(envelopeAt(layer, 0.005)).toBeCloseTo(0.5, 5);
    expect(envelopeAt(layer, 0.01)).toBe(1);
    expect(envelopeAt(layer, 0.025)).toBe(1);
    expect(envelopeAt(layer, 0.03 + 0.05)).toBeCloseTo(Math.exp(-1), 5);
  });

  it("is silent before a delayed layer starts", () => {
    expect(envelopeAt({ ...layer, delay: 0.1 }, 0.05)).toBe(0);
    expect(envelopeAt({ ...layer, delay: 0.1 }, 0.11)).toBe(1);
  });
});

describe("biquad", () => {
  it("lowpass passes DC and highpass blocks it", () => {
    const dc = (c: ReturnType<typeof biquad>) => (c.b0 + c.b1 + c.b2) / (1 + c.a1 + c.a2);
    expect(dc(biquad("lowpass", 1000, 0.707, SR))).toBeCloseTo(1, 6);
    expect(Math.abs(dc(biquad("highpass", 1000, 0.707, SR)))).toBeLessThan(1e-9);
    expect(Math.abs(dc(biquad("bandpass", 1000, 1, SR)))).toBeLessThan(1e-9);
  });

  it("clamps the cutoff below Nyquist", () => {
    expect(() => biquad("lowpass", 1e9, 1, SR)).not.toThrow();
    expect(Number.isFinite(biquad("lowpass", 1e9, 1, SR).b0)).toBe(true);
  });
});

describe("mulberry32", () => {
  it("is deterministic and uniform-ish", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seq = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(seq);
    const r = mulberry32(7);
    let sum = 0;
    for (let i = 0; i < 10000; i++) sum += r();
    expect(sum / 10000).toBeGreaterThan(0.45);
    expect(sum / 10000).toBeLessThan(0.55);
  });
});

describe("renderRecipe", () => {
  const click: Recipe = {
    duration: 0.05,
    seed: 3,
    peak: 0.8,
    layers: [
      { type: "noise", gain: 1, attack: 0.001, decay: 0.01, filter: { type: "bandpass", freq: 2000, q: 1 } },
      { type: "tone", gain: 0.5, freq: 200, attack: 0.001, decay: 0.02 },
    ],
  };

  it("has the recipe's length, its peak, and starts and ends silent", () => {
    const out = renderRecipe(click, SR);
    expect(out.length).toBe(Math.round(0.05 * SR));
    let max = 0;
    for (const v of out) max = Math.max(max, Math.abs(v));
    expect(max).toBeCloseTo(0.8, 5);
    expect(Math.abs(out[0])).toBeLessThan(0.01);
    expect(out[out.length - 1]).toBe(0);
  });

  it("renders the same samples every time", () => {
    expect(renderRecipe(click, SR)).toEqual(renderRecipe(click, SR));
  });

  it("puts a sweep's energy where the filter points", () => {
    const low: Recipe = {
      duration: 0.2,
      seed: 1,
      layers: [{ type: "noise", gain: 1, attack: 0.01, decay: 0.2, filter: { type: "lowpass", freq: 300 } }],
    };
    const high: Recipe = {
      duration: 0.2,
      seed: 1,
      layers: [{ type: "noise", gain: 1, attack: 0.01, decay: 0.2, filter: { type: "highpass", freq: 6000 } }],
    };
    // Zero crossings per second: a low-passed noise wanders, a high-passed one buzzes.
    const crossings = (buf: Float32Array) => {
      let n = 0;
      for (let i = 1; i < buf.length; i++) if (buf[i] >= 0 !== buf[i - 1] >= 0) n++;
      return n / 0.2;
    };
    expect(crossings(renderRecipe(low, SR))).toBeLessThan(2000);
    expect(crossings(renderRecipe(high, SR))).toBeGreaterThan(8000);
  });

  it("glides a tone from freq to `to`", () => {
    const glide: Recipe = {
      duration: 0.2,
      layers: [{ type: "tone", gain: 1, freq: 400, to: 100, attack: 0.001, decay: 10 }],
    };
    const out = renderRecipe(glide, SR);
    const crossingsIn = (from: number, to: number) => {
      let n = 0;
      for (let i = Math.max(1, from); i < to; i++) if (out[i] >= 0 !== out[i - 1] >= 0) n++;
      return n;
    };
    const first = crossingsIn(0, Math.round(0.05 * SR));
    const last = crossingsIn(Math.round(0.15 * SR), out.length);
    expect(first).toBeGreaterThan(last * 2);
  });

  it("plays a slice of a recorded sample, resampled to the target rate", () => {
    const src = sample("mouseClick");
    expect(src.sampleRate).toBe(48000);
    expect(src.data.length).toBeGreaterThan(1000);
    const whole: Recipe = {
      duration: src.data.length / src.sampleRate + 0.01,
      normalize: false,
      layers: [{ type: "sample", sample: "mouseClick", gain: 1 }],
    };
    const out = renderRecipe(whole, 48000);
    // Same rate: the samples come through untouched until the tail fade.
    expect(out[100]).toBeCloseTo(src.data[100], 6);
    expect(out[2000]).toBeCloseTo(src.data[2000], 6);
    // Half the rate: half as many samples for the same slice.
    const half = renderRecipe(whole, 24000);
    const last = (buf: Float32Array) => {
      for (let i = buf.length - 1; i >= 0; i--) if (buf[i] !== 0) return i;
      return -1;
    };
    expect(last(half)).toBeGreaterThan(last(out) * 0.45);
    expect(last(half)).toBeLessThan(last(out) * 0.55);
    // A slice starts where asked.
    const release: Recipe = {
      duration: 0.1,
      normalize: false,
      layers: [{ type: "sample", sample: "mouseClick", gain: 1, from: MOUSE_CLICK_SPLIT }],
    };
    const rel = renderRecipe(release, 48000);
    expect(rel[10]).toBeCloseTo(src.data[Math.round(MOUSE_CLICK_SPLIT * 48000) + 10], 6);
  });

  it("splits the recorded click into a press and a release that add up to the whole", () => {
    const soft = sfxPack("soft").sounds;
    const press = renderRecipe(soft.click, 48000);
    const release = renderRecipe(soft.clickUp, 48000);
    const full = renderRecipe(soft.clickFull, 48000);
    const split = Math.round(MOUSE_CLICK_SPLIT * 48000);
    // The full click at the split point is exactly where the release starts.
    // (8 ms in, past the lowpass's memory of the press.)
    expect(full[split + 400]).toBeCloseTo(release[400], 3);
    expect(full[50]).toBeCloseTo(press[50], 5);
    // Both halves carry real signal.
    const peak = (buf: Float32Array) => Math.max(...Array.from(buf).map(Math.abs));
    expect(peak(press)).toBeGreaterThan(0.2);
    expect(peak(release)).toBeGreaterThan(0.2);
  });

  it("every pack renders every sound within bounds", () => {
    for (const pack of SFX_PACKS) {
      for (const [id, recipe] of Object.entries(pack.sounds)) {
        const out = renderRecipe(recipe, SR);
        expect(out.length, `${pack.id}/${id}`).toBeGreaterThan(100);
        let max = 0;
        let finite = true;
        for (const v of out) {
          if (!Number.isFinite(v)) finite = false;
          max = Math.max(max, Math.abs(v));
        }
        expect(finite, `${pack.id}/${id}`).toBe(true);
        expect(max, `${pack.id}/${id}`).toBeLessThanOrEqual(1);
        expect(max, `${pack.id}/${id}`).toBeGreaterThan(0.3);
      }
    }
  });
});
