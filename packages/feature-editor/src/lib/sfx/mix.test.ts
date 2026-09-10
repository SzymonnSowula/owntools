import { describe, expect, it } from "vitest";
import { applyFadesInPlace, mixChannel, panGains, renderSfxChannels, renderedSound, softClip } from "./mix";
import { sfxPack } from "./packs";
import type { SfxEvent } from "./plan";

const SR = 48000;
const pack = sfxPack("soft");

function energyAround(buf: Float32Array, t: number, window = 0.02): number {
  const from = Math.max(0, Math.round((t - window) * SR));
  const to = Math.min(buf.length, Math.round((t + window) * SR));
  let e = 0;
  for (let i = from; i < to; i++) e += buf[i] * buf[i];
  return e;
}

const click = (t: number, more: Partial<SfxEvent> = {}): SfxEvent => ({
  id: `c${t}`,
  t,
  sound: "click",
  kind: "click",
  gain: 0.5,
  pan: 0,
  rate: 1,
  ...more,
});

describe("panGains", () => {
  it("is unity in the centre, one-sided at the extremes, and mono stays 1", () => {
    expect(panGains(0, 2).map((g) => Number(g.toFixed(6)))).toEqual([1, 1]);
    expect(panGains(-1, 2)[0]).toBeCloseTo(1, 6);
    expect(panGains(-1, 2)[1]).toBeCloseTo(0, 6);
    expect(panGains(1, 2)[0]).toBeCloseTo(0, 6);
    expect(panGains(1, 2)[1]).toBeCloseTo(1, 6);
    expect(panGains(0.7, 1)).toEqual([1]);
  });
});

describe("renderSfxChannels", () => {
  it("lands a sound at its time and nowhere else", () => {
    const [ch] = renderSfxChannels({ events: [click(1)], pack, sampleRate: SR, channels: 1, length: 2 * SR });
    expect(energyAround(ch, 1.02)).toBeGreaterThan(0);
    expect(energyAround(ch, 0.5)).toBe(0);
    expect(energyAround(ch, 1.5)).toBe(0);
    expect(ch[Math.round(1 * SR) + 200]).not.toBe(0);
  });

  it("pans a click to the side it came from", () => {
    const [l, r] = renderSfxChannels({
      events: [click(0.1, { pan: -0.55 })],
      pack,
      sampleRate: SR,
      channels: 2,
      length: SR,
    });
    expect(energyAround(l, 0.12)).toBeGreaterThan(energyAround(r, 0.12) * 2);
  });

  it("plays faster at a higher rate", () => {
    const one = renderSfxChannels({ events: [click(0)], pack, sampleRate: SR, channels: 1, length: SR })[0];
    const fast = renderSfxChannels({ events: [click(0, { rate: 2 })], pack, sampleRate: SR, channels: 1, length: SR })[0];
    const lastNonZero = (buf: Float32Array) => {
      for (let i = buf.length - 1; i >= 0; i--) if (buf[i] !== 0) return i;
      return -1;
    };
    expect(lastNonZero(fast)).toBeLessThan(lastNonZero(one) * 0.6);
  });

  it("clips an event at the end of the buffer instead of overrunning", () => {
    const [ch] = renderSfxChannels({ events: [click(0.99)], pack, sampleRate: SR, channels: 1, length: SR });
    expect(ch.length).toBe(SR);
    expect(energyAround(ch, 0.995, 0.005)).toBeGreaterThan(0);
  });

  it("caches a rendered sound per pack and rate", () => {
    expect(renderedSound(pack, "click", SR)).toBe(renderedSound(pack, "click", SR));
    expect(renderedSound(pack, "click", SR)).not.toBe(renderedSound(pack, "click", 44100));
  });
});

describe("applyFadesInPlace", () => {
  it("fades the head and the tail", () => {
    const ch = new Float32Array(SR).fill(1);
    applyFadesInPlace(ch, 0.5, 0.25, SR);
    expect(ch[0]).toBe(0);
    expect(ch[Math.round(0.25 * SR)]).toBeCloseTo(0.5, 3);
    expect(ch[Math.round(0.6 * SR)]).toBe(1);
    expect(ch[SR - 1]).toBeCloseTo(0, 3);
  });
});

describe("softClip + mixChannel", () => {
  it("is transparent below the knee and never reaches ±1", () => {
    expect(softClip(0.5)).toBe(0.5);
    expect(softClip(-0.8)).toBe(-0.8);
    expect(softClip(3)).toBeLessThan(1);
    expect(softClip(3)).toBeGreaterThan(0.85);
    expect(softClip(-3)).toBeGreaterThan(-1);
  });

  it("sums the base and the effects, and treats a null base as silence", () => {
    const base = new Float32Array([0.1, 0.2, 0.3]);
    const sfx = new Float32Array([0.1, 0.1, 0.1]);
    expect(Array.from(mixChannel(base, sfx)).map((v) => Number(v.toFixed(6)))).toEqual([0.2, 0.3, 0.4]);
    expect(Array.from(mixChannel(null, sfx)).map((v) => Number(v.toFixed(6)))).toEqual([0.1, 0.1, 0.1]);
  });
});

describe("a removed sound is silence, not a quieter sound", () => {
  it("leaves nothing where the event was", () => {
    const events = [click(0.2), click(0.6), click(1.0)];
    const length = Math.round(1.4 * SR);
    const full = renderSfxChannels({ events, pack, sampleRate: SR, channels: 1, length })[0];
    // What the planner hands the mixer once `sfx.removed` has taken the middle one.
    const trimmed = renderSfxChannels({
      events: events.filter((e) => e.id !== events[1].id),
      pack,
      sampleRate: SR,
      channels: 1,
      length,
    })[0];
    expect(energyAround(full, 0.6)).toBeGreaterThan(0);
    expect(energyAround(trimmed, 0.6)).toBe(0);
    // …and does not touch its neighbours.
    expect(energyAround(trimmed, 0.2)).toBeCloseTo(energyAround(full, 0.2), 10);
    expect(energyAround(trimmed, 1.0)).toBeCloseTo(energyAround(full, 1.0), 10);
  });
});
