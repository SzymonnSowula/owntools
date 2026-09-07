import { clamp } from "../time";
import type { SfxPack, SfxSoundId } from "./packs";
import type { SfxEvent } from "./plan";
import { renderRecipe } from "./synth";

/**
 * Offline mixdown: the planned events, rendered from a pack, laid onto plain
 * sample arrays. Pure and synchronous — the export runs it on the decoded
 * timeline audio (or on silence when the take has none), tests run it on
 * numbers. Web Audio is never involved.
 */

const renderCache = new Map<string, Float32Array>();

export function renderedSound(pack: SfxPack, sound: SfxSoundId, sampleRate: number): Float32Array {
  const key = `${pack.id}:${sound}:${sampleRate}`;
  let hit = renderCache.get(key);
  if (!hit) {
    hit = renderRecipe(pack.sounds[sound], sampleRate);
    renderCache.set(key, hit);
  }
  return hit;
}

/**
 * Per-channel gains for a pan position: unity in the centre, one side silent
 * at the extremes, constant power between. Mono gets 1.
 */
export function panGains(pan: number, channels: number): number[] {
  if (channels < 2) return [1];
  const theta = ((clamp(pan, -1, 1) + 1) / 4) * Math.PI;
  const left = Math.min(1, Math.SQRT2 * Math.cos(theta));
  const right = Math.min(1, Math.SQRT2 * Math.sin(theta));
  const out = [left, right];
  for (let ch = 2; ch < channels; ch++) out.push(1);
  return out;
}

export interface SfxRenderInput {
  events: SfxEvent[];
  pack: SfxPack;
  sampleRate: number;
  channels: number;
  /** Frames per channel. */
  length: number;
}

/** Every event rendered into fresh channel buffers of `length` frames. */
export function renderSfxChannels(input: SfxRenderInput): Float32Array[] {
  const { events, pack, sampleRate, length } = input;
  const channels = Math.max(1, input.channels);
  const out: Float32Array[] = [];
  for (let ch = 0; ch < channels; ch++) out.push(new Float32Array(Math.max(0, length)));
  for (const e of events) {
    if (!(e.gain > 0)) continue;
    const buf = renderedSound(pack, e.sound, sampleRate);
    const rate = clamp(e.rate, 0.25, 4);
    const start = Math.round(e.t * sampleRate);
    const frames = Math.floor((buf.length - 1) / rate);
    const gains = panGains(e.pan, channels);
    for (let ch = 0; ch < channels; ch++) {
      const g = e.gain * gains[ch];
      if (g <= 0) continue;
      const dest = out[ch];
      for (let i = 0; i < frames; i++) {
        const j = start + i;
        if (j < 0) continue;
        if (j >= dest.length) break;
        const pos = i * rate;
        const k = Math.floor(pos);
        const u = pos - k;
        dest[j] += (buf[k] + (buf[k + 1] - buf[k]) * u) * g;
      }
    }
  }
  return out;
}

/** The video's fades, applied to the effects too — a click at full level under a fade-out would give the game away. */
export function applyFadesInPlace(channel: Float32Array, fadeIn: number, fadeOut: number, sampleRate: number): void {
  const total = channel.length;
  const inFrames = Math.max(0, fadeIn) * sampleRate;
  const outFrames = Math.max(0, fadeOut) * sampleRate;
  if (inFrames > 0) {
    const n = Math.min(total, Math.floor(inFrames));
    for (let i = 0; i < n; i++) channel[i] *= i / inFrames;
  }
  if (outFrames > 0) {
    const from = Math.max(0, Math.ceil(total - outFrames));
    for (let i = from; i < total; i++) channel[i] *= Math.max(0, (total - i) / outFrames);
  }
}

const KNEE = 0.85;

/** Transparent below the knee, then a smooth squeeze that never reaches ±1. */
export function softClip(x: number): number {
  const a = Math.abs(x);
  if (a <= KNEE) return x;
  return Math.sign(x) * (KNEE + (1 - KNEE) * Math.tanh((a - KNEE) / (1 - KNEE)));
}

/** `base + sfx`, soft-clipped, into a new array the length of `sfx`. A null base is silence. */
export function mixChannel(base: Float32Array | null, sfx: Float32Array): Float32Array {
  const out = new Float32Array(sfx.length);
  for (let i = 0; i < sfx.length; i++) {
    const b = base && i < base.length ? base[i] : 0;
    out[i] = softClip(b + sfx[i]);
  }
  return out;
}
