import { clamp } from "../time";
import { sample, type SampleId } from "./samples";

/**
 * Sound effects are recipes, not samples — the same idea as the records in
 * focus. A recipe is a handful of layers, each a filtered noise burst or a
 * decaying tone with its own envelope; rendering one is a pure function of
 * (recipe, sample rate) over a seeded noise source, so an export is
 * bit-identical every time and a test can look at the numbers. Nothing here
 * touches the Web Audio graph: the export mixes the rendered samples straight
 * into the timeline's audio, the preview wraps them in AudioBuffers.
 *
 * A layer can also be a slice of a recorded sample (`samples.ts`) — the
 * mouse click is one — resampled to the target rate and mixed like any
 * other layer, so a pack can colour it with a filter or lay a tone under it.
 */

export type FilterType = "lowpass" | "highpass" | "bandpass";
export type Wave = "sine" | "triangle";

interface LayerBase {
  gain: number;
  /** Seconds to full level. */
  attack: number;
  /** Seconds held at full level before the decay starts. */
  hold?: number;
  /** Time constant of the exponential decay, seconds. */
  decay: number;
  /** Seconds into the sound the layer starts. */
  delay?: number;
}

export interface NoiseLayer extends LayerBase {
  type: "noise";
  filter?: {
    type: FilterType;
    freq: number;
    q?: number;
    /** Where the cutoff ends up by the end of the sound — a sweep is a whoosh. */
    to?: number;
  };
}

export interface ToneLayer extends LayerBase {
  type: "tone";
  freq: number;
  /** Frequency at the end of the sound, for a glide. */
  to?: number;
  wave?: Wave;
}

export interface SampleLayer {
  type: "sample";
  sample: SampleId;
  gain: number;
  /** Seconds into the sound the slice starts playing. */
  delay?: number;
  /** Slice of the sample to play, seconds; defaults to the whole of it. */
  from?: number;
  to?: number;
  /** Playback rate: 1.1 is a touch higher and shorter. */
  rate?: number;
  filter?: { type: FilterType; freq: number; q?: number };
}

export type Layer = NoiseLayer | ToneLayer | SampleLayer;

export interface Recipe {
  /** Seconds. */
  duration: number;
  seed?: number;
  /** Peak the finished sound is normalised to (0–1). */
  peak?: number;
  /** False keeps the layers' own levels — for a sample sliced in two, so the halves keep their balance. */
  normalize?: boolean;
  layers: Layer[];
}

/** Small, fast, seedable PRNG — every render of a recipe hears the same noise. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smoothstep attack, optional hold, exponential decay. */
export function envelopeAt(layer: LayerBase, t: number): number {
  const local = t - (layer.delay ?? 0);
  if (local < 0) return 0;
  const attack = Math.max(0, layer.attack);
  if (attack > 0 && local < attack) {
    const p = local / attack;
    return p * p * (3 - 2 * p);
  }
  const past = local - attack - Math.max(0, layer.hold ?? 0);
  if (past <= 0) return 1;
  return Math.exp(-past / Math.max(0.0005, layer.decay));
}

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** RBJ cookbook coefficients, normalised by a0. The bandpass has 0 dB peak gain. */
export function biquad(type: FilterType, freq: number, q: number, sampleRate: number): Biquad {
  const f = clamp(freq, 20, sampleRate * 0.45);
  const w0 = (2 * Math.PI * f) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * Math.max(0.1, q));
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  let b0: number;
  let b1: number;
  let b2: number;
  switch (type) {
    case "lowpass":
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
      break;
    case "highpass":
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
      break;
    default:
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Coefficients are recomputed every this many samples while a filter sweeps. */
const SWEEP_BLOCK = 32;

function renderNoise(
  layer: NoiseLayer,
  sampleRate: number,
  out: Float32Array,
  rand: () => number,
): void {
  const filter = layer.filter;
  const n = out.length;
  const start = Math.min(n, Math.max(0, Math.floor((layer.delay ?? 0) * sampleRate)));
  const span = Math.max(1, n - start);
  const q = filter?.q ?? 0.707;
  const sweep = Boolean(filter && filter.to !== undefined && filter.to !== filter.freq);
  let coef = filter ? biquad(filter.type, filter.freq, q, sampleRate) : null;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = start; i < n; i++) {
    if (sweep && filter && (i - start) % SWEEP_BLOCK === 0) {
      const p = (i - start) / span;
      coef = biquad(filter.type, filter.freq * Math.pow((filter.to as number) / filter.freq, p), q, sampleRate);
    }
    let x = rand() * 2 - 1;
    if (coef) {
      const y = coef.b0 * x + coef.b1 * x1 + coef.b2 * x2 - coef.a1 * y1 - coef.a2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      x = y;
    }
    out[i] += x * layer.gain * envelopeAt(layer, i / sampleRate);
  }
}

function renderTone(layer: ToneLayer, sampleRate: number, out: Float32Array): void {
  const n = out.length;
  const start = Math.min(n, Math.max(0, Math.floor((layer.delay ?? 0) * sampleRate)));
  const span = Math.max(1, n - start);
  const glide = layer.to !== undefined && layer.to > 0 && layer.to !== layer.freq;
  const ratio = glide ? (layer.to as number) / layer.freq : 1;
  const triangle = layer.wave === "triangle";
  let phase = 0;
  for (let i = start; i < n; i++) {
    const f = glide ? layer.freq * Math.pow(ratio, (i - start) / span) : layer.freq;
    phase += (2 * Math.PI * f) / sampleRate;
    if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
    const v = triangle ? (2 / Math.PI) * Math.asin(Math.sin(phase)) : Math.sin(phase);
    out[i] += v * layer.gain * envelopeAt(layer, i / sampleRate);
  }
}

function renderSample(layer: SampleLayer, sampleRate: number, out: Float32Array): void {
  const src = sample(layer.sample);
  const from = Math.max(0, Math.round((layer.from ?? 0) * src.sampleRate));
  const to = Math.min(src.data.length, Math.round((layer.to ?? src.data.length / src.sampleRate) * src.sampleRate));
  if (to - from < 2) return;
  const rate = clamp(layer.rate ?? 1, 0.25, 4);
  // Source samples advanced per output sample: the rate ratio times the pitch/speed.
  const step = (src.sampleRate / sampleRate) * rate;
  const start = Math.min(out.length, Math.max(0, Math.floor((layer.delay ?? 0) * sampleRate)));
  const filter = layer.filter;
  const coef = filter ? biquad(filter.type, filter.freq, filter.q ?? 0.707, sampleRate) : null;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = start; i < out.length; i++) {
    const pos = from + (i - start) * step;
    const k = Math.floor(pos);
    if (k + 1 >= to) break;
    const u = pos - k;
    let x = src.data[k] + (src.data[k + 1] - src.data[k]) * u;
    if (coef) {
      const y = coef.b0 * x + coef.b1 * x1 + coef.b2 * x2 - coef.a1 * y1 - coef.a2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      x = y;
    }
    out[i] += x * layer.gain;
  }
}

/** Renders a recipe to mono samples, normalised to its peak, with a 2 ms tail fade so a truncated decay never clicks. */
export function renderRecipe(recipe: Recipe, sampleRate: number): Float32Array {
  const n = Math.max(1, Math.round(recipe.duration * sampleRate));
  const out = new Float32Array(n);
  const rand = mulberry32(recipe.seed ?? 1);
  for (const layer of recipe.layers) {
    if (layer.type === "noise") renderNoise(layer, sampleRate, out, rand);
    else if (layer.type === "tone") renderTone(layer, sampleRate, out);
    else renderSample(layer, sampleRate, out);
  }
  const tail = Math.min(n, Math.max(1, Math.round(sampleRate * 0.002)));
  for (let i = 0; i < tail; i++) out[n - 1 - i] *= i / tail;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(out[i]);
    if (a > max) max = a;
  }
  if (max > 0 && recipe.normalize !== false) {
    const scale = clamp(recipe.peak ?? 0.9, 0, 1) / max;
    for (let i = 0; i < n; i++) out[i] *= scale;
  } else if (max > 1) {
    for (let i = 0; i < n; i++) out[i] /= max;
  }
  return out;
}
