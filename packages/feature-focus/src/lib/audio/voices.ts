/**
 * Synth voices for the record player. Everything is generated — no samples, no
 * network — and every voice takes its own context and destination, so it can
 * be routed through the vinyl chain instead of straight at the speakers, and
 * rendered offline (tests, the level check) exactly the way it plays live.
 */

export type VoiceId = "keys" | "bells" | "strings" | "pluck" | "choir";

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function noiseBurst(ctx: BaseAudioContext, seconds: number): AudioBufferSourceNode {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  return src;
}

/** Attack/decay envelope that always ends silent, so voices never pile up. */
function envelope(
  ctx: BaseAudioContext,
  when: number,
  attack: number,
  hold: number,
  release: number,
  peak: number,
): GainNode {
  const gain = ctx.createGain();
  const level = Math.max(0.0001, peak);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(level, when + attack);
  gain.gain.setValueAtTime(level, when + attack + hold);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + attack + hold + release);
  return gain;
}

/** One note. Returns the time it stops making sound, so callers can clean up. */
export function playVoice(
  ctx: BaseAudioContext,
  voice: VoiceId,
  dest: AudioNode,
  midi: number,
  when: number,
  level: number,
  length: number,
): number {
  const freq = midiToFreq(midi);
  const stopAt = when + length + 3;

  const finish = (nodes: (OscillatorNode | AudioBufferSourceNode)[], end: number) => {
    nodes.forEach((n) => {
      try {
        n.stop(end);
      } catch {
        /* already scheduled */
      }
    });
  };

  if (voice === "bells") {
    // Two-operator FM: an inharmonic ratio gives the struck-metal shimmer.
    // The index is modest and the top is rolled off — at 1.4 the sidebands
    // reached 6-10 kHz at full level, which reads as a squeal, not a bell.
    const carrier = ctx.createOscillator();
    carrier.type = "sine";
    carrier.frequency.value = freq;
    const mod = ctx.createOscillator();
    mod.type = "sine";
    mod.frequency.value = freq * 2.76;
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(freq * 0.8, when);
    modGain.gain.exponentialRampToValueAtTime(freq * 0.05, when + length * 0.6 + 0.4);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = Math.min(5000, 1200 + freq * 2.2);
    lp.Q.value = 0.5;
    const env = envelope(ctx, when, 0.006, length * 0.15, length + 1.6, level * 0.45);
    mod.connect(modGain);
    modGain.connect(carrier.frequency);
    carrier.connect(lp);
    lp.connect(env);
    env.connect(dest);
    carrier.start(when);
    mod.start(when);
    finish([carrier, mod], stopAt);
    return stopAt;
  }

  if (voice === "strings") {
    const env = envelope(ctx, when, 0.55, Math.max(0.2, length * 0.7), length * 0.9 + 1.2, level * 0.34);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(600, when);
    lp.frequency.linearRampToValueAtTime(1500 + freq, when + length * 0.6);
    lp.Q.value = 0.6;
    const oscs: OscillatorNode[] = [];
    [-7, 0, 6].forEach((cents) => {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = freq;
      o.detune.value = cents;
      o.connect(lp);
      o.start(when);
      oscs.push(o);
    });
    lp.connect(env);
    env.connect(dest);
    finish(oscs, stopAt);
    return stopAt;
  }

  if (voice === "pluck") {
    // A noise burst rung through a very resonant band-pass — a plucked string
    // without the feedback delay loop (which detunes badly at low notes).
    const burst = noiseBurst(ctx, 0.05);
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = freq;
    band.Q.value = 18;
    const body = ctx.createOscillator();
    body.type = "triangle";
    body.frequency.value = freq;
    const bodyGain = ctx.createGain();
    bodyGain.gain.value = 0.5;
    const env = envelope(ctx, when, 0.004, 0.02, length * 0.8 + 0.9, level * 0.5);
    // A buffer source never feeds a filter directly (noise.ts `noiseSource`).
    const burstFeed = ctx.createGain();
    burst.connect(burstFeed);
    burstFeed.connect(band);
    band.connect(env);
    body.connect(bodyGain);
    bodyGain.connect(env);
    env.connect(dest);
    burst.start(when);
    body.start(when);
    finish([burst, body], stopAt);
    return stopAt;
  }

  if (voice === "choir") {
    const env = envelope(ctx, when, 0.7, Math.max(0.3, length * 0.6), length + 1.4, level * 0.3);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900 + freq * 0.8;
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 4.6;
    const vibratoGain = ctx.createGain();
    vibratoGain.gain.value = 4;
    const oscs: OscillatorNode[] = [vibrato];
    [0, -4, 5].forEach((cents) => {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = freq;
      o.detune.value = cents;
      vibratoGain.connect(o.detune);
      o.connect(lp);
      o.start(when);
      oscs.push(o);
    });
    vibrato.connect(vibratoGain);
    vibrato.start(when);
    lp.connect(env);
    env.connect(dest);
    finish(oscs, stopAt);
    return stopAt;
  }

  // keys — felt piano: sine body, a little triangle bite, hammer noise.
  const env = envelope(ctx, when, 0.012, length * 0.25, length + 1.5, level * 0.42);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1300 + Math.min(2000, freq * 0.5);
  lp.Q.value = 0.7;
  const sine = ctx.createOscillator();
  sine.type = "sine";
  sine.frequency.value = freq;
  const tri = ctx.createOscillator();
  tri.type = "triangle";
  tri.frequency.value = freq;
  const triGain = ctx.createGain();
  triGain.gain.value = 0.14;
  const hammer = noiseBurst(ctx, 0.03);
  const hammerGain = ctx.createGain();
  hammerGain.gain.value = 0.05;
  sine.connect(lp);
  tri.connect(triGain);
  triGain.connect(lp);
  hammer.connect(hammerGain);
  hammerGain.connect(lp);
  lp.connect(env);
  env.connect(dest);
  sine.start(when);
  tri.start(when);
  hammer.start(when);
  hammer.stop(when + 0.04);
  finish([sine, tri], stopAt);
  return stopAt;
}

/* ---------------------------------- pad ---------------------------------- */

export interface Pad {
  setChord(midis: number[], when: number): void;
  setLevel(level: number, when: number): void;
  stop(when: number): void;
}

/**
 * A held chord with four gliding slots. Chords change by sliding the slots to
 * their new notes rather than retriggering, which is what keeps the bed from
 * ever sounding like a loop point.
 */
export function createPad(
  ctx: BaseAudioContext,
  dest: AudioNode,
  level: number,
  brightness = 1,
): Pad {
  const out = ctx.createGain();
  out.gain.value = 0.0001;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 700 * brightness;
  lp.Q.value = 0.5;

  // Slow filter drift, so a held chord keeps moving.
  const drift = ctx.createOscillator();
  drift.frequency.value = 0.045;
  const driftGain = ctx.createGain();
  driftGain.gain.value = 240 * brightness;
  drift.connect(driftGain);
  driftGain.connect(lp.frequency);
  drift.start();

  const slots = Array.from({ length: 4 }, () => {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const a = ctx.createOscillator();
    a.type = "sawtooth";
    a.frequency.value = 220;
    const b = ctx.createOscillator();
    b.type = "triangle";
    b.frequency.value = 220;
    b.detune.value = 7;
    a.connect(gain);
    b.connect(gain);
    gain.connect(lp);
    a.start();
    b.start();
    return { gain, oscs: [a, b] };
  });

  lp.connect(out);
  out.connect(dest);
  out.gain.setTargetAtTime(Math.max(0.0001, level), ctx.currentTime, 2.5);

  return {
    setChord(midis, when) {
      slots.forEach((slot, i) => {
        const midi = midis[i % Math.max(1, midis.length)];
        const voiced = midis.length > i ? midi : midi - 12;
        const freq = midiToFreq(voiced);
        slot.oscs.forEach((o, k) => {
          o.frequency.setTargetAtTime(freq, when, 0.9);
          o.detune.setTargetAtTime(k === 1 ? 7 + i * 2 : -3 - i, when, 1.2);
        });
        slot.gain.gain.setTargetAtTime(i < midis.length ? 0.22 / (i + 1.4) : 0.05, when, 1.4);
      });
    },
    setLevel(next, when) {
      out.gain.setTargetAtTime(Math.max(0.0001, next), when, 0.6);
    },
    stop(when) {
      out.gain.setTargetAtTime(0.0001, when, 0.4);
      const end = when + 2.2;
      drift.stop(end);
      slots.forEach((slot) =>
        slot.oscs.forEach((o) => {
          try {
            o.stop(end);
          } catch {
            /* already stopped */
          }
        }),
      );
    },
  };
}

/* ---------------------------------- bass --------------------------------- */

export interface Drone {
  setNote(midi: number, when: number): void;
  stop(when: number): void;
}

/** Sub-bass drone with a slow breath, glued under the pad. */
export function createDrone(ctx: BaseAudioContext, dest: AudioNode, level: number): Drone {
  const out = ctx.createGain();
  out.gain.value = 0.0001;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 260;

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = 55;
  const sub = ctx.createOscillator();
  sub.type = "sine";
  sub.frequency.value = 27.5;
  const subGain = ctx.createGain();
  subGain.gain.value = 0.5;

  const breath = ctx.createOscillator();
  breath.frequency.value = 0.06;
  const breathGain = ctx.createGain();
  breathGain.gain.value = level * 0.35;
  breath.connect(breathGain);
  breathGain.connect(out.gain);

  osc.connect(lp);
  sub.connect(subGain);
  subGain.connect(lp);
  lp.connect(out);
  out.connect(dest);
  osc.start();
  sub.start();
  breath.start();
  out.gain.setTargetAtTime(Math.max(0.0001, level), ctx.currentTime, 3);

  return {
    setNote(midi, when) {
      const freq = midiToFreq(midi);
      osc.frequency.setTargetAtTime(freq, when, 1.2);
      sub.frequency.setTargetAtTime(freq / 2, when, 1.2);
    },
    stop(when) {
      out.gain.setTargetAtTime(0.0001, when, 0.5);
      const end = when + 2.4;
      [osc, sub, breath].forEach((o) => {
        try {
          o.stop(end);
        } catch {
          /* already stopped */
        }
      });
    },
  };
}
