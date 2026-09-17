/**
 * The soundtrack, generated — the way the editor's sound effects and the
 * focus records are: recipes, not samples, so there is no licence to clear.
 *
 * One 30-second stereo WAV, 48 kHz: a 128 BPM bed (kick, hats, a shaker, a
 * ducked sub, a soft pad on a four-chord loop) that reads the cut table so a
 * whoosh lands on every cut, a riser leads into the end card and the beat
 * drops out under the brand; plus the UI's own sounds where the picture has
 * them — keys pressing, a click, the words of a take landing, a shutter.
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/make-audio.ts
 *
 * Writes public/audio/soundtrack.wav.
 */
import fs from "node:fs";
import path from "node:path";
import { sceneFrames, TOTAL_SECONDS, type SceneId } from "../src/cut.ts";
import { BEAT_SECONDS, FPS } from "../src/theme.ts";

const SR = 48000;
const N = Math.round(TOTAL_SECONDS * SR);
const L = new Float32Array(N);
const R = new Float32Array(N);

const scenes = sceneFrames(FPS);
const at = (id: SceneId) => scenes.find((s) => s.id === id)!.startSeconds;
const f2s = (id: SceneId, frame: number) => at(id) + frame / FPS;

/* ------------------------------ tiny DSP ------------------------------ */

let seed = 1234567;
function rnd(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296 - 0.5;
}

/** RBJ biquad, coefficients recomputed on demand (for sweeps). */
class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  b0 = 1;
  b1 = 0;
  b2 = 0;
  a1 = 0;
  a2 = 0;
  set(type: "lp" | "hp" | "bp", freq: number, q: number) {
    const w = (2 * Math.PI * Math.min(freq, SR * 0.45)) / SR;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    const alpha = sw / (2 * q);
    let b0: number;
    let b1: number;
    let b2: number;
    if (type === "lp") {
      b0 = (1 - cw) / 2;
      b1 = 1 - cw;
      b2 = (1 - cw) / 2;
    } else if (type === "hp") {
      b0 = (1 + cw) / 2;
      b1 = -(1 + cw);
      b2 = (1 + cw) / 2;
    } else {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    }
    const a0 = 1 + alpha;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cw) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Add a sound into the mix from t0, calling gen(i, t) per sample until it returns null. */
function add(t0: number, dur: number, gen: (t: number, i: number) => [number, number] | number) {
  const start = Math.round(t0 * SR);
  const len = Math.round(dur * SR);
  for (let i = 0; i < len; i++) {
    const n = start + i;
    if (n < 0 || n >= N) continue;
    const v = gen(i / SR, i);
    if (typeof v === "number") {
      L[n] += v;
      R[n] += v;
    } else {
      L[n] += v[0];
      R[n] += v[1];
    }
  }
}

const expEnv = (t: number, tau: number) => Math.exp(-t / tau);
const pan = (v: number, p: number): [number, number] => [v * Math.cos(((p + 1) / 4) * Math.PI), v * Math.sin(((p + 1) / 4) * Math.PI)];

/* ------------------------------ the sounds ------------------------------ */

function kick(t0: number, vel = 1) {
  let phase = 0;
  add(t0, 0.45, (t) => {
    const f = 42 + 150 * Math.exp(-t / 0.045);
    phase += (2 * Math.PI * f) / SR;
    const body = Math.sin(phase) * expEnv(t, 0.16);
    const click = t < 0.004 ? rnd() * 1.6 * (1 - t / 0.004) : 0;
    return (body * 0.9 + click * 0.35) * vel;
  });
}

function hat(t0: number, open = false, vel = 1) {
  const hp = new Biquad();
  hp.set("hp", 8200, 0.9);
  const tau = open ? 0.22 : 0.035;
  add(t0, open ? 0.5 : 0.09, (t) => {
    const v = hp.run(rnd() * 2) * expEnv(t, tau) * 0.13 * vel;
    return pan(v, 0.25);
  });
}

function shaker(t0: number, vel = 1) {
  const bp = new Biquad();
  bp.set("bp", 5200, 1.4);
  add(t0, 0.06, (t) => pan(bp.run(rnd() * 2) * expEnv(t, 0.018) * 0.11 * vel, -0.3));
}

function sub(t0: number, dur: number, freq: number, kicks: number[]) {
  let phase = 0;
  add(t0, dur, (t) => {
    phase += (2 * Math.PI * freq) / SR;
    const attack = Math.min(1, t / 0.01);
    const release = Math.min(1, (dur - t) / 0.03);
    // Sidechain: duck after every kick.
    let duck = 1;
    const abs = t0 + t;
    for (let k = kicks.length - 1; k >= 0; k--) {
      const d = abs - kicks[k];
      if (d < 0) continue;
      duck = 1 - 0.85 * Math.exp(-d / 0.13);
      break;
    }
    return Math.sin(phase) * 0.34 * attack * release * duck;
  });
}

/** A soft pad: four detuned saws per note through a slow-moving low-pass. */
function pad(t0: number, dur: number, notes: number[], gain: number, openness: (t: number) => number) {
  const lpL = new Biquad();
  const lpR = new Biquad();
  const phases = notes.flatMap(() => [0, 0, 0, 0]);
  add(t0, dur, (t, i) => {
    let l = 0;
    let r = 0;
    notes.forEach((f, ni) => {
      const dets = [0.997, 1.003, 0.9945, 1.0055];
      dets.forEach((d, di) => {
        const idx = ni * 4 + di;
        phases[idx] = (phases[idx] + (f * d) / SR) % 1;
        const saw = phases[idx] * 2 - 1;
        if (di < 2) l += saw;
        else r += saw;
      });
    });
    if (i % 32 === 0) {
      const cut = 420 + openness(t) * 2600 + Math.sin(t * 0.7) * 120;
      lpL.set("lp", cut, 0.8);
      lpR.set("lp", cut * 1.02, 0.8);
    }
    const attack = Math.min(1, t / 0.6);
    const release = Math.min(1, (dur - t) / 0.4);
    const g = (gain * attack * release) / (notes.length * 2);
    return [lpL.run(l) * g, lpR.run(r) * g];
  });
}

function whoosh(t0: number, dir: 1 | -1 = -1, amount = 1, dur = 0.26) {
  const bp = new Biquad();
  add(t0 - 0.06, dur + 0.06, (t, i) => {
    const p = Math.min(1, t / dur);
    if (i % 16 === 0) bp.set("bp", 2600 * Math.pow(0.12, p) + 180, 1.1);
    const env = Math.pow(Math.sin(p * Math.PI), 1.4);
    const v = bp.run(rnd() * 2) * env * 0.5 * amount;
    return pan(v, dir * (1 - 2 * p));
  });
}

function boom(t0: number, amount = 1) {
  let phase = 0;
  const lp = new Biquad();
  lp.set("lp", 260, 0.7);
  add(t0, 0.7, (t) => {
    phase += (2 * Math.PI * (52 + 30 * Math.exp(-t / 0.05))) / SR;
    const body = Math.sin(phase) * expEnv(t, 0.22);
    const air = lp.run(rnd() * 2) * expEnv(t, 0.08);
    return (body * 0.7 + air * 0.5) * amount;
  });
}

function riser(t0: number, dur: number) {
  const bp = new Biquad();
  add(t0, dur, (t, i) => {
    const p = t / dur;
    if (i % 16 === 0) bp.set("bp", 260 + 3800 * p * p, 2.2);
    const v = bp.run(rnd() * 2) * (0.05 + 0.4 * p * p);
    return pan(v, Math.sin(t * 9) * 0.6);
  });
}

/** A mouse click: press and release, 65 ms apart, like the editor's own sample. */
function click(t0: number, amount = 1) {
  for (const [dt, a] of [
    [0, 1],
    [0.065, 0.6],
  ] as const) {
    const hp = new Biquad();
    hp.set("hp", 1800, 0.8);
    add(t0 + dt, 0.03, (t) => hp.run(rnd() * 2) * expEnv(t, 0.004) * 0.55 * a * amount);
  }
}

/** A keycap: a mechanical thock, three at once for a combo. */
function key(t0: number, amount = 1) {
  const bp = new Biquad();
  bp.set("bp", 1400, 0.9);
  let phase = 0;
  add(t0, 0.06, (t) => {
    phase += (2 * Math.PI * 190) / SR;
    return (bp.run(rnd() * 2) * expEnv(t, 0.006) * 0.7 + Math.sin(phase) * expEnv(t, 0.02) * 0.25) * amount;
  });
}

/** Words landing: a soft high tick. */
function tick(t0: number, amount = 1, freq = 2300) {
  let phase = 0;
  add(t0, 0.03, (t) => {
    phase += (2 * Math.PI * freq) / SR;
    return Math.sin(phase) * expEnv(t, 0.006) * 0.18 * amount;
  });
}

/** A checkbox / approval: a two-note pop. */
function pop(t0: number, amount = 1) {
  let phase = 0;
  add(t0, 0.12, (t) => {
    const f = t < 0.045 ? 640 : 960;
    phase += (2 * Math.PI * f) / SR;
    return Math.sin(phase) * expEnv(t % 0.045, 0.02) * 0.22 * amount;
  });
}

function shutter(t0: number) {
  click(t0, 1.2);
  click(t0 + 0.09, 0.9);
  const lp = new Biquad();
  lp.set("lp", 1800, 0.7);
  add(t0, 0.12, (t) => lp.run(rnd() * 2) * expEnv(t, 0.03) * 0.3);
}

/** Pencil on paper while a stroke is drawn. */
function scribble(t0: number, dur: number) {
  const bp = new Biquad();
  add(t0, dur, (t, i) => {
    if (i % 24 === 0) bp.set("bp", 1900 + Math.sin(t * 37) * 600, 1.6);
    const env = Math.sin(Math.min(1, t / dur) * Math.PI);
    const grain = 0.6 + 0.4 * Math.sin(t * 61);
    return pan(bp.run(rnd() * 2) * env * grain * 0.09, 0.2);
  });
}

/* ------------------------------ arrangement ------------------------------ */

const beatT = (b: number) => b * BEAT_SECONDS;
const TOTAL_BEATS = Math.round(TOTAL_SECONDS / BEAT_SECONDS);
const endBeat = Math.round(at("end") / BEAT_SECONDS); // 55
const kickFrom = 7; // the first cut: the beat starts with "record"

// Kicks.
const kicks: number[] = [];
for (let b = kickFrom; b < endBeat; b++) {
  const vel = b % 4 === 0 ? 1 : 0.82;
  kicks.push(beatT(b));
  kick(beatT(b), vel);
}
// The end card: one last kick on its downbeat, then nothing.
kick(beatT(endBeat), 1);
kicks.push(beatT(endBeat));

// Hats on eighths from the top, open on the off-beat of 2 and 4; shaker sixteenths under the beat.
for (let b = 0; b < endBeat; b++) {
  hat(beatT(b), false, b < kickFrom ? 0.55 : 0.9);
  const off = beatT(b + 0.5);
  hat(off, b % 2 === 1 && b >= kickFrom, b < kickFrom ? 0.45 : 0.75);
  if (b >= kickFrom + 4) {
    shaker(beatT(b + 0.25), 0.7);
    shaker(beatT(b + 0.75), 0.9);
  }
}

// Harmony: a four-chord loop, two bars each — D minor / B-flat / F / C.
const D2 = 73.42;
const Bb1 = 58.27;
const F2 = 87.31;
const C2 = 65.41;
const CHORDS: Array<{ root: number; pad: number[] }> = [
  { root: D2, pad: [146.83, 174.61, 220.0, 293.66] },
  { root: Bb1, pad: [116.54, 146.83, 174.61, 233.08] },
  { root: F2, pad: [174.61, 220.0, 261.63, 349.23] },
  { root: C2, pad: [130.81, 164.81, 196.0, 261.63] },
];
for (let seg = 0; seg * 8 < TOTAL_BEATS; seg++) {
  const chord = CHORDS[seg % CHORDS.length];
  const b0 = seg * 8;
  const t0 = beatT(b0);
  const t1 = Math.min(TOTAL_SECONDS, beatT(b0 + 8));
  const inEnd = t0 >= at("end") - 0.01;
  // The pad is closed and quiet under the tools, opens on the end card.
  pad(t0, t1 - t0, chord.pad, inEnd ? 0.75 : 0.42, (t) => (inEnd ? Math.min(1, 0.35 + t / 2.2) : 0.12 + 0.08 * Math.sin(t)));
  if (b0 + 8 > kickFrom && !inEnd) {
    const s0 = Math.max(t0, beatT(kickFrom));
    sub(s0, t1 - s0, chord.root, kicks);
  }
}
// The end card holds the tonic, unducked after the last kick.
sub(at("end"), TOTAL_SECONDS - at("end") - 0.6, D2, [beatT(endBeat)]);

// Cuts.
for (const s of scenes) {
  if (s.index === 0) continue;
  switch (s.enter) {
    case "whip":
      whoosh(s.startSeconds, -1, 1);
      break;
    case "zoom":
      whoosh(s.startSeconds, 1, 0.8, 0.3);
      boom(s.startSeconds, s.id === "end" ? 1.2 : 0.55);
      break;
    case "slam":
      whoosh(s.startSeconds - 0.08, -1, 0.7, 0.18);
      boom(s.startSeconds + 0.05, 0.7);
      break;
    case "flash":
      whoosh(s.startSeconds, 1, 0.9, 0.16);
      boom(s.startSeconds, 0.45);
      break;
    default:
      break;
  }
}
boom(0, 0.6);
riser(at("promise"), at("end") - at("promise"));

// The UI's own sounds, where the picture has them.
key(f2s("dictate", 26), 1); // ctrl+shift+space
key(f2s("dictate", 26) + 0.012, 0.7);
key(f2s("dictate", 26) + 0.02, 0.5);
for (let i = 0; i < 10; i++) tick(f2s("dictate", 44 + i * 9), 0.9, 2100 + (i % 3) * 180); // words landing
key(f2s("dictate", 150), 0.8); // "send it" → Enter
click(f2s("screeni", 158)); // Stop
click(f2s("screeni", 208)); // Export
pop(f2s("screeni", 236), 0.8); // done
click(f2s("focus", 32)); // Focus
click(f2s("focus", 58)); // Start
for (const f of [126, 138, 150]) pop(f2s("focus", f)); // tasks ticked
for (const f of [118, 126, 134]) tick(f2s("meet", f), 0.7, 1500); // summary rows
key(f2s("board", 20), 0.8); // ctrl+v
key(f2s("board", 20) + 0.015, 0.5);
scribble(f2s("board", 36), 28 / FPS);
scribble(f2s("board", 62), 18 / FPS);
scribble(f2s("board", 100), 26 / FPS);
click(f2s("social", 58), 0.7); // grab
click(f2s("social", 90), 0.5); // drop
click(f2s("social", 122)); // approve
pop(f2s("social", 124), 1);
for (const f of [66, 78, 90, 102]) {
  click(f2s("disk", f - 0 + 10), 0.6);
  pop(f2s("disk", f), 0.8);
}
click(f2s("disk", 126)); // Move to Recycle Bin
whoosh(f2s("disk", 130), -1, 0.5, 0.35); // the blocks fold away
key(f2s("capture", 12), 1); // ctrl+shift+4
key(f2s("capture", 12) + 0.012, 0.7);
key(f2s("capture", 12) + 0.02, 0.5);
shutter(f2s("capture", 42));
pop(f2s("capture", 66), 0.9); // copied
for (let i = 0; i < 12; i++) tick(f2s("quick", 8 + i * 4), 0.5, 1700 + i * 40); // cards landing
for (const f of [0, 28, 56]) boom(f2s("promise", f), 0.35); // each line
tick(f2s("end", 10), 0.6, 1200);
pop(f2s("end", 64), 0.6); // the price

/* ------------------------------ master ------------------------------ */

// Fade in 30 ms, fade out over the last 1.4 s.
for (let n = 0; n < N; n++) {
  const t = n / SR;
  const g = Math.min(1, t / 0.03) * Math.min(1, Math.max(0, (TOTAL_SECONDS - t) / 1.4));
  L[n] *= g;
  R[n] *= g;
}
// Soft clip, then normalise to -1 dBFS.
let peak = 0;
for (let n = 0; n < N; n++) {
  L[n] = Math.tanh(L[n] * 1.15);
  R[n] = Math.tanh(R[n] * 1.15);
  peak = Math.max(peak, Math.abs(L[n]), Math.abs(R[n]));
}
const norm = peak > 0 ? 0.89 / peak : 1;

const bytes = Buffer.alloc(44 + N * 4);
bytes.write("RIFF", 0);
bytes.writeUInt32LE(36 + N * 4, 4);
bytes.write("WAVE", 8);
bytes.write("fmt ", 12);
bytes.writeUInt32LE(16, 16);
bytes.writeUInt16LE(1, 20);
bytes.writeUInt16LE(2, 22);
bytes.writeUInt32LE(SR, 24);
bytes.writeUInt32LE(SR * 4, 28);
bytes.writeUInt16LE(4, 32);
bytes.writeUInt16LE(16, 34);
bytes.write("data", 36);
bytes.writeUInt32LE(N * 4, 40);
for (let n = 0; n < N; n++) {
  bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[n] * norm)) * 32767), 44 + n * 4);
  bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[n] * norm)) * 32767), 46 + n * 4);
}
const out = path.join(process.cwd(), "public", "audio", "soundtrack.wav");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, bytes);

// A few numbers to sanity-check without ears: loudness per section.
const rms = (a: number, b: number) => {
  let s = 0;
  const i0 = Math.round(a * SR);
  const i1 = Math.min(N, Math.round(b * SR));
  for (let n = i0; n < i1; n++) s += (L[n] * norm) ** 2;
  return (20 * Math.log10(Math.sqrt(s / Math.max(1, i1 - i0)) + 1e-9)).toFixed(1);
};
console.log(`wrote ${path.relative(process.cwd(), out)} (${(bytes.length / 1e6).toFixed(1)} MB, ${TOTAL_SECONDS.toFixed(2)} s, peak before norm ${peak.toFixed(2)})`);
for (const s of scenes) console.log(`${s.id.padEnd(8)} ${s.startSeconds.toFixed(2).padStart(6)} s  rms ${rms(s.startSeconds, s.startSeconds + s.nominal / FPS)} dBFS`);
