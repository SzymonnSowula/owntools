import { describe, expect, it } from "vitest";
import type { NoiseId } from "../../types";
import { createNoiseLayer } from "./noise";
import { advancePastStall, createMaster, createRecordEngine, RECORDS } from "./records";
import { createDrone, createPad, playVoice, type VoiceId } from "./voices";
import { createVinylChain } from "./vinyl";

/**
 * A stand-in BaseAudioContext that only remembers the wiring. jsdom has no
 * Web Audio, and these tests are about the *graph*, not the sound: which node
 * feeds which. The one invariant that matters is the Chromium 152 one —
 * a looping buffer source must never feed a filter directly (see noise.ts
 * `noiseSource`) — and a fake context is the cheapest way to pin it for every
 * layer, the vinyl chain and every voice at once.
 */

type Kind = "gain" | "biquad" | "iir" | "oscillator" | "buffer" | "delay" | "compressor" | "shaper" | "destination";

interface FakeNode {
  kind: Kind;
  loop?: boolean;
  outputs: FakeNode[];
  connect(to: FakeNode | FakeParam): FakeNode;
  disconnect(): void;
  start(): void;
  stop(): void;
  [key: string]: unknown;
}

interface FakeParam {
  value: number;
  setValueAtTime(): FakeParam;
  linearRampToValueAtTime(): FakeParam;
  exponentialRampToValueAtTime(): FakeParam;
  setTargetAtTime(): FakeParam;
  cancelScheduledValues(): FakeParam;
}

function param(value = 0): FakeParam {
  const p: FakeParam = {
    value,
    setValueAtTime: () => p,
    linearRampToValueAtTime: () => p,
    exponentialRampToValueAtTime: () => p,
    setTargetAtTime: () => p,
    cancelScheduledValues: () => p,
  };
  return p;
}

function fakeContext() {
  const nodes: FakeNode[] = [];
  const node = (kind: Kind, params: Record<string, FakeParam> = {}): FakeNode => {
    const n: FakeNode = {
      kind,
      outputs: [],
      ...params,
      connect(to) {
        if ("kind" in to) n.outputs.push(to);
        return n;
      },
      disconnect() {},
      start() {},
      stop() {},
    };
    nodes.push(n);
    return n;
  };
  const ctx = {
    currentTime: 0,
    sampleRate: 48000,
    destination: node("destination"),
    createGain: () => node("gain", { gain: param(1) }),
    createBiquadFilter: () => node("biquad", { frequency: param(350), Q: param(1), detune: param(0), gain: param(0) }),
    createIIRFilter: () => node("iir"),
    createOscillator: () => node("oscillator", { frequency: param(440), detune: param(0) }),
    createBufferSource: () => node("buffer", { playbackRate: param(1) }),
    createDelay: () => node("delay", { delayTime: param(0) }),
    createDynamicsCompressor: () =>
      node("compressor", {
        threshold: param(-24),
        knee: param(30),
        ratio: param(12),
        attack: param(0.003),
        release: param(0.25),
      }),
    createWaveShaper: () => node("shaper"),
    createBuffer: (channels: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
      numberOfChannels: channels,
      length,
    }),
    nodes,
  };
  return ctx as unknown as BaseAudioContext & { nodes: FakeNode[] };
}

function offendingEdges(ctx: { nodes: FakeNode[] }): string[] {
  const bad: string[] = [];
  for (const n of ctx.nodes) {
    if (n.kind !== "buffer") continue;
    for (const to of n.outputs) {
      if (to.kind === "biquad" || to.kind === "iir") bad.push(`buffer → ${to.kind}`);
    }
  }
  return bad;
}

const NOISE_IDS: NoiseId[] = ["white", "pink", "brown", "rain", "fan", "cafe", "ocean"];
const VOICES: VoiceId[] = ["keys", "bells", "strings", "pluck", "choir"];

describe("audio graph: no buffer source feeds a filter directly (Chromium 152 blow-up)", () => {
  it.each(NOISE_IDS)("noise layer %s", (id) => {
    const ctx = fakeContext();
    createNoiseLayer(ctx, id, ctx.destination, 0.2);
    expect(offendingEdges(ctx)).toEqual([]);
    expect(ctx.nodes.some((n) => n.kind === "buffer")).toBe(true);
  });

  it("vinyl chain (crackle)", () => {
    const ctx = fakeContext();
    const chain = createVinylChain(ctx, ctx.destination, { crackle: 0.5, wow: 0.5, warmth: 0.5 });
    chain.dropNeedle(0.05);
    expect(offendingEdges(ctx)).toEqual([]);
  });

  it.each(VOICES)("voice %s", (voice) => {
    const ctx = fakeContext();
    playVoice(ctx, voice, ctx.destination, 72, 0.1, 0.7, 2);
    expect(offendingEdges(ctx)).toEqual([]);
  });

  it("pad and drone", () => {
    const ctx = fakeContext();
    createPad(ctx, ctx.destination, 0.1).setChord([60, 64, 67, 71], 0);
    createDrone(ctx, ctx.destination, 0.1).setNote(36, 0);
    expect(offendingEdges(ctx)).toEqual([]);
  });

  it.each(RECORDS.map((r) => r.id))("whole record %s, forty beats", (id) => {
    const ctx = fakeContext();
    const def = RECORDS.find((r) => r.id === id)!;
    const master = createMaster(ctx, ctx.destination, 0.5);
    const engine = createRecordEngine(ctx, master.input, def, { rng: () => 0.01 });
    for (let i = 0; i < 40; i++) engine.scheduleBeat(0.6 + i * engine.beatLength);
    engine.stop(60);
    expect(offendingEdges(ctx)).toEqual([]);
  });
});

describe("master chain", () => {
  it("runs the mix through a limiter and a ceiling before the level knob", () => {
    const ctx = fakeContext();
    const master = createMaster(ctx, ctx.destination, 0.5);
    const kinds: Kind[] = [];
    let n = master.input as unknown as FakeNode;
    while (n && n.kind !== "destination") {
      kinds.push(n.kind);
      n = n.outputs[0];
    }
    expect(kinds).toEqual(["compressor", "gain", "shaper", "gain"]);
  });
});

describe("advancePastStall", () => {
  const beat = 60 / 60;

  it("leaves a scheduler that is ahead of the clock alone", () => {
    expect(advancePastStall(10.4, 10, beat)).toEqual({ skip: 0, nextBeat: 10.4 });
  });

  it("tolerates a beat that is only a little late", () => {
    expect(advancePastStall(9.95, 10, beat)).toEqual({ skip: 0, nextBeat: 9.95 });
  });

  it("drops every beat a stall left behind instead of playing them at once", () => {
    const r = advancePastStall(10, 47.3, beat);
    expect(r.skip).toBe(38);
    expect(r.nextBeat).toBeCloseTo(48, 9);
    expect(r.nextBeat).toBeGreaterThanOrEqual(47.3);
  });
});
