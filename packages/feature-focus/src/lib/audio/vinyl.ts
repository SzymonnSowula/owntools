import { getAudioContext } from "./context";

/**
 * The vinyl chain. Everything a record plays goes through it, so a generated
 * ambient bed picks up the things that make a pressing sound like a pressing:
 * rolled-off extremes, a touch of pitch wow, surface hiss and crackle.
 *
 * The crackle is two buffers of deliberately mismatched length playing at once
 * — 7.3 s against 11.9 s — so the pops don't line up again for a minute and a
 * half, and the ear never hears a loop.
 */

export interface VinylCharacter {
  /** surface noise and pops, 0..1 */
  crackle: number;
  /** pitch wobble, 0..1 */
  wow: number;
  /** how far the top end is rolled off, 0..1 (1 = warmest / dullest) */
  warmth: number;
}

export interface VinylChain {
  /** music and beds connect here */
  input: GainNode;
  output: GainNode;
  setCharacter(character: VinylCharacter, when: number): void;
  /** the click and swell of the needle finding the groove */
  dropNeedle(when: number): void;
  stop(when: number): void;
}

function crackleBuffer(ctx: AudioContext, seconds: number, popsPerSecond: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  // Surface: quiet, slightly correlated noise — dust rather than static.
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    last = last * 0.72 + w * 0.28;
    data[i] = last * 0.06;
  }

  // Pops: sharp impulses with a few milliseconds of decay.
  const pops = Math.floor(seconds * popsPerSecond);
  for (let p = 0; p < pops; p++) {
    const at = Math.floor(Math.random() * (len - 400));
    const amp = (0.25 + Math.random() * 0.75) * (Math.random() < 0.12 ? 1 : 0.35);
    const decay = 30 + Math.random() * 220;
    for (let i = 0; i < decay; i++) {
      const fade = 1 - i / decay;
      data[at + i] += (Math.random() * 2 - 1) * amp * fade * fade;
    }
  }
  return buffer;
}

function loop(ctx: AudioContext, buffer: AudioBuffer, rate: number): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.playbackRate.value = rate;
  return src;
}

export function createVinylChain(dest: AudioNode, character: VinylCharacter): VinylChain {
  const ctx = getAudioContext();
  const input = ctx.createGain();
  const output = ctx.createGain();

  // Vinyl has no deep sub and no sparkle at the very top.
  const rumbleCut = ctx.createBiquadFilter();
  rumbleCut.type = "highpass";
  rumbleCut.frequency.value = 55;
  const warmth = ctx.createBiquadFilter();
  warmth.type = "lowpass";
  warmth.frequency.value = 6000;
  warmth.Q.value = 0.6;

  // Wow & flutter: a short delay whose time is modulated = pitch wobble.
  const wobble = ctx.createDelay(0.05);
  wobble.delayTime.value = 0.008;
  const wowLfo = ctx.createOscillator();
  wowLfo.frequency.value = 0.55;
  const wowDepth = ctx.createGain();
  wowDepth.gain.value = 0.0009;
  const flutterLfo = ctx.createOscillator();
  flutterLfo.frequency.value = 6.3;
  const flutterDepth = ctx.createGain();
  flutterDepth.gain.value = 0.00012;
  wowLfo.connect(wowDepth);
  flutterLfo.connect(flutterDepth);
  wowDepth.connect(wobble.delayTime);
  flutterDepth.connect(wobble.delayTime);
  wowLfo.start();
  flutterLfo.start();

  input.connect(rumbleCut);
  rumbleCut.connect(warmth);
  warmth.connect(wobble);
  wobble.connect(output);

  // Crackle sits after the wobble — pops come off the surface, not the music.
  const crackleGain = ctx.createGain();
  crackleGain.gain.value = 0;
  const crackleTone = ctx.createBiquadFilter();
  crackleTone.type = "highpass";
  crackleTone.frequency.value = 1200;
  const sources = [
    loop(ctx, crackleBuffer(ctx, 7.3, 9), 1),
    loop(ctx, crackleBuffer(ctx, 11.9, 6), 0.97),
  ];
  sources.forEach((s) => {
    s.connect(crackleTone);
    s.start();
  });
  crackleTone.connect(crackleGain);
  crackleGain.connect(output);

  output.connect(dest);

  const apply = (c: VinylCharacter, when: number) => {
    warmth.frequency.setTargetAtTime(9500 - c.warmth * 6200, when, 0.3);
    wowDepth.gain.setTargetAtTime(0.0004 + c.wow * 0.0016, when, 0.3);
    flutterDepth.gain.setTargetAtTime(0.00005 + c.wow * 0.0002, when, 0.3);
    crackleGain.gain.setTargetAtTime(c.crackle * 0.55, when, 0.5);
  };
  apply(character, ctx.currentTime);

  return {
    input,
    output,
    setCharacter: apply,
    dropNeedle(when) {
      // A short swell of extra surface noise, the way a needle lands.
      const level = crackleGain.gain.value;
      crackleGain.gain.cancelScheduledValues(when);
      crackleGain.gain.setValueAtTime(Math.max(level, 0.18) * 2.6, when);
      crackleGain.gain.setTargetAtTime(level, when + 0.12, 0.35);
    },
    stop(when) {
      output.gain.setTargetAtTime(0.0001, when, 0.35);
      const end = when + 2;
      [...sources, wowLfo, flutterLfo].forEach((n) => {
        try {
          n.stop(end);
        } catch {
          /* already stopped */
        }
      });
    },
  };
}
