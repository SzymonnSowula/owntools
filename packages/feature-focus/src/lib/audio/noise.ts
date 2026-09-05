import type { NoiseId, SoundMix } from "../../types";
import { getAudioContext, unlockAudio } from "./context";

export type Layer = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  extras: AudioNode[];
  lfos: OscillatorNode[];
};

let master: GainNode | null = null;
let layers = new Map<NoiseId, Layer>();
let running = false;

function makeBuffer(
  ctx: AudioContext,
  seconds: number,
  fill: (data: Float32Array) => void,
): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  fill(buffer.getChannelData(0));
  return buffer;
}

function fillWhite(data: Float32Array) {
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

function fillPink(data: Float32Array) {
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    b3 = 0,
    b4 = 0,
    b5 = 0,
    b6 = 0;
  for (let i = 0; i < data.length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
}

function fillBrown(data: Float32Array) {
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    data[i] = Math.max(-1, Math.min(1, last * 3.5));
  }
}

function loopSource(ctx: AudioContext, buffer: AudioBuffer): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  return src;
}

function buildLayer(ctx: AudioContext, id: NoiseId, dest: AudioNode): Layer {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const extras: AudioNode[] = [];
  const lfos: OscillatorNode[] = [];
  let source: AudioBufferSourceNode;

  const connectLfo = (freq: number, depth: number, param: AudioParam, base: number) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = freq;
    g.gain.value = depth;
    osc.connect(g);
    g.connect(param);
    osc.start();
    lfos.push(osc);
    extras.push(g);
    param.value = base;
  };

  if (id === "white" || id === "pink" || id === "brown") {
    const fill = id === "white" ? fillWhite : id === "pink" ? fillPink : fillBrown;
    source = loopSource(ctx, makeBuffer(ctx, 2.2, fill));
    const filter = ctx.createBiquadFilter();
    filter.type = id === "white" ? "highshelf" : "lowpass";
    filter.frequency.value = id === "white" ? 8000 : id === "pink" ? 4000 : 800;
    source.connect(filter);
    filter.connect(gain);
    extras.push(filter);
  } else if (id === "rain") {
    source = loopSource(ctx, makeBuffer(ctx, 2.5, fillWhite));
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 700;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1800;
    bp.Q.value = 0.7;
    source.connect(hp);
    hp.connect(bp);
    bp.connect(gain);
    connectLfo(0.15, 0.12, gain.gain, 0);
    extras.push(hp, bp);
  } else if (id === "fan") {
    source = loopSource(ctx, makeBuffer(ctx, 2.8, fillBrown));
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    source.connect(lp);
    lp.connect(gain);
    connectLfo(0.08, 0.06, gain.gain, 0);
    extras.push(lp);
  } else if (id === "ocean") {
    source = loopSource(ctx, makeBuffer(ctx, 3, fillBrown));
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 500;
    lp.Q.value = 0.4;
    source.connect(lp);
    lp.connect(gain);
    connectLfo(0.05, 280, lp.frequency, 500);
    connectLfo(0.04, 0.08, gain.gain, 0);
    extras.push(lp);
  } else {
    source = loopSource(ctx, makeBuffer(ctx, 2.4, fillPink));
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900;
    bp.Q.value = 0.8;
    source.connect(bp);
    bp.connect(gain);
    connectLfo(0.07, 0.05, gain.gain, 0);
    connectLfo(0.21, 180, bp.frequency, 900);
    extras.push(bp);
  }

  gain.connect(dest);
  source.start();
  return { source, gain, extras, lfos };
}

function ensureMaster(): GainNode {
  const ctx = getAudioContext();
  if (!master) {
    master = ctx.createGain();
    master.gain.value = 0.45;
    master.connect(ctx.destination);
  }
  return master;
}

export async function startMixer(mix: SoundMix): Promise<void> {
  await unlockAudio();
  const ctx = getAudioContext();
  const m = ensureMaster();
  m.gain.setTargetAtTime(mix.master, ctx.currentTime, 0.05);
  if (!running) {
    (Object.keys(mix.layers) as NoiseId[]).forEach((id) => {
      const layer = buildLayer(ctx, id, m);
      layer.gain.gain.value = mix.layers[id];
      layers.set(id, layer);
    });
    running = true;
  } else {
    applyMix(mix);
  }
}

export function stopMixer(): void {
  const ctx = ctxOrNull();
  const t = ctx ? ctx.currentTime : 0;
  layers.forEach((layer) => {
    try {
      layer.gain.gain.setTargetAtTime(0, t, 0.04);
      layer.source.stop(t + 0.2);
    } catch {
      /* already stopped */
    }
    layer.lfos.forEach((o) => {
      try {
        o.stop();
      } catch {
        /* */
      }
    });
  });
  layers.clear();
  running = false;
}

export function applyMix(mix: SoundMix): void {
  if (!running) return;
  const ctx = getAudioContext();
  if (master) master.gain.setTargetAtTime(mix.master, ctx.currentTime, 0.05);
  (Object.keys(mix.layers) as NoiseId[]).forEach((id) => {
    const layer = layers.get(id);
    if (layer) layer.gain.gain.setTargetAtTime(mix.layers[id], ctx.currentTime, 0.08);
  });
}

export function isMixerRunning(): boolean {
  return running;
}

/**
 * One noise layer routed wherever the caller wants — the record player uses
 * this to put a bed inside the vinyl chain instead of the mixer's bus.
 */
export function createNoiseLayer(id: NoiseId, dest: AudioNode, level: number): Layer {
  const ctx = getAudioContext();
  const layer = buildLayer(ctx, id, dest);
  layer.gain.gain.setTargetAtTime(level, ctx.currentTime, 1.2);
  return layer;
}

/** Fades a standalone layer out and releases its nodes. */
export function stopNoiseLayer(layer: Layer, when: number): void {
  try {
    layer.gain.gain.setTargetAtTime(0, when, 0.4);
    layer.source.stop(when + 1.6);
  } catch {
    /* already stopped */
  }
  layer.lfos.forEach((o) => {
    try {
      o.stop(when + 1.6);
    } catch {
      /* already stopped */
    }
  });
}

function ctxOrNull(): AudioContext | null {
  try {
    return getAudioContext();
  } catch {
    return null;
  }
}
