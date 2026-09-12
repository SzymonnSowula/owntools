import type { NoiseId } from "../../types";
import { getAudioContext, unlockAudio } from "./context";
import { createNoiseLayer, stopNoiseLayer, type Layer } from "./noise";
import { createDrone, createPad, playVoice, type Drone, type Pad, type VoiceId } from "./voices";
import { createVinylChain, type VinylChain, type VinylCharacter } from "./vinyl";

/**
 * The crate. A record is a *recipe*, not a file: a chord cycle, a voice, a
 * noise bed and a vinyl character. The player generates from it forever — put
 * one on and it plays until you lift the needle, never repeating a bar.
 *
 * Everything is synthesised on device. No samples ship with the app, so a
 * record costs a few hundred bytes of parameters instead of forty megabytes of
 * audio, and licensing never enters the picture.
 *
 * Two halves: `createRecordEngine` builds the graph and plays beats on demand
 * against *any* context (an OfflineAudioContext renders a record for a test or
 * a level check exactly the way it plays), and the player below runs that
 * engine on the live clock.
 */

export type RecordId =
  | "night-shift"
  | "morning-rain"
  | "deep-water"
  | "cafe-etranger"
  | "paper-and-ink"
  | "blue-hour"
  | "static-bloom"
  | "long-drive";

export type SleevePattern = "rings" | "waves" | "sun" | "grid" | "bars" | "dust";

export interface SleeveArt {
  /** sleeve stock */
  base: string;
  /** print colour */
  ink: string;
  /** the one bright colour on the jacket */
  accent: string;
  pattern: SleevePattern;
}

export interface RecordMusic {
  /** midi root the chord table is written against */
  root: number;
  /** chords as semitone offsets from the root */
  chords: number[][];
  /** the notes a melody may use, semitones from the root */
  scale: number[];
  /** pulse the generator thinks in */
  bpm: number;
  /** beats a chord is held for */
  chordBeats: number;
  /** chance of a note on any given beat, 0..1 */
  density: number;
  /** midi range the melody stays inside */
  register: [number, number];
  voice: VoiceId;
  pad: number;
  bass: number;
  /** pad filter brightness multiplier */
  brightness?: number;
  /** how far the melody sits above the bed, 0..1 (default 1 = `MELODY_LEVEL`) */
  melody?: number;
}

export interface RecordDef {
  id: RecordId;
  title: string;
  /** the "band" — always us, but it reads like a label sleeve */
  artist: string;
  side: string;
  blurb: string;
  art: SleeveArt;
  bed: Partial<Record<NoiseId, number>>;
  music: RecordMusic;
  vinyl: VinylCharacter;
}

const MINOR_PENT = [0, 3, 5, 7, 10];
const MAJOR_PENT = [0, 2, 4, 7, 9];
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];
const MIXO = [0, 2, 4, 5, 7, 9, 10];

export const RECORDS: RecordDef[] = [
  {
    id: "night-shift",
    title: "Night Shift",
    artist: "owntools studio",
    side: "A1",
    blurb: "Low keys, a worn pressing, the office empty",
    art: { base: "#12141c", ink: "#e8e6df", accent: "#5e5ce6", pattern: "rings" },
    bed: { brown: 0.16, fan: 0.1 },
    music: {
      root: 57, // A
      chords: [
        [0, 3, 7, 14],
        [-4, 0, 5, 12],
        [-2, 3, 7, 10],
        [-5, 2, 7, 11],
      ],
      scale: AEOLIAN,
      bpm: 52,
      chordBeats: 16,
      density: 0.3,
      register: [60, 81],
      voice: "keys",
      pad: 0.16,
      bass: 0.14,
      brightness: 0.85,
    },
    vinyl: { crackle: 0.55, wow: 0.5, warmth: 0.72 },
  },
  {
    id: "morning-rain",
    title: "Morning Rain",
    artist: "owntools studio",
    side: "A2",
    blurb: "Bells through the window, weather on the glass",
    art: { base: "#e8eef4", ink: "#1d2733", accent: "#32ade6", pattern: "waves" },
    bed: { rain: 0.3, pink: 0.06 },
    music: {
      root: 60, // C
      chords: [
        [0, 4, 7, 11],
        [2, 5, 9, 14],
        [-3, 4, 7, 12],
        [0, 5, 9, 12],
      ],
      scale: MAJOR_PENT,
      bpm: 58,
      chordBeats: 12,
      density: 0.26,
      register: [67, 86],
      voice: "bells",
      pad: 0.12,
      melody: 0.8,
      bass: 0.08,
      brightness: 1.25,
    },
    vinyl: { crackle: 0.3, wow: 0.3, warmth: 0.45 },
  },
  {
    id: "deep-water",
    title: "Deep Water",
    artist: "owntools studio",
    side: "B1",
    blurb: "Almost no melody. For the hours that need none",
    art: { base: "#0b1f24", ink: "#dcefe9", accent: "#2fb3a3", pattern: "sun" },
    bed: { ocean: 0.34, brown: 0.1 },
    music: {
      root: 50, // D
      chords: [
        [0, 7, 12, 19],
        [-3, 4, 9, 16],
        [-5, 7, 14, 19],
      ],
      scale: MINOR_PENT,
      bpm: 40,
      chordBeats: 24,
      density: 0.12,
      register: [60, 79],
      voice: "choir",
      pad: 0.2,
      bass: 0.18,
      brightness: 0.7,
    },
    vinyl: { crackle: 0.38, wow: 0.62, warmth: 0.8 },
  },
  {
    id: "cafe-etranger",
    title: "Café Étranger",
    artist: "owntools studio",
    side: "A3",
    blurb: "Nylon strings and a room that never empties",
    art: { base: "#f2e6d2", ink: "#2a1f14", accent: "#d1743a", pattern: "grid" },
    bed: { cafe: 0.24, pink: 0.05 },
    music: {
      root: 55, // G
      chords: [
        [0, 3, 7, 10],
        [5, 8, 12, 15],
        [-2, 5, 9, 12],
        [3, 7, 10, 14],
      ],
      scale: DORIAN,
      bpm: 68,
      chordBeats: 8,
      density: 0.42,
      register: [60, 81],
      voice: "pluck",
      pad: 0.1,
      bass: 0.1,
      brightness: 1.1,
    },
    vinyl: { crackle: 0.46, wow: 0.35, warmth: 0.6 },
  },
  {
    id: "paper-and-ink",
    title: "Paper & Ink",
    artist: "owntools studio",
    side: "B2",
    blurb: "One note at a time, plenty of room between",
    art: { base: "#f7f4ec", ink: "#17150f", accent: "#8a8577", pattern: "bars" },
    bed: { pink: 0.07 },
    music: {
      root: 53, // F
      chords: [
        [0, 4, 9, 16],
        [-5, 2, 7, 14],
        [-3, 4, 11, 16],
      ],
      scale: LYDIAN,
      bpm: 46,
      chordBeats: 20,
      density: 0.18,
      register: [62, 84],
      voice: "keys",
      pad: 0.08,
      bass: 0.06,
      brightness: 1,
    },
    vinyl: { crackle: 0.26, wow: 0.22, warmth: 0.5 },
  },
  {
    id: "blue-hour",
    title: "Blue Hour",
    artist: "owntools studio",
    side: "B3",
    blurb: "Strings holding the light just before it goes",
    art: { base: "#1a1b33", ink: "#e6e6f5", accent: "#7b7bff", pattern: "sun" },
    bed: { fan: 0.12, pink: 0.08 },
    music: {
      root: 52, // E
      chords: [
        [0, 3, 7, 12],
        [-4, 3, 8, 15],
        [-1, 4, 8, 11],
        [-5, 2, 7, 10],
      ],
      scale: AEOLIAN,
      bpm: 44,
      chordBeats: 20,
      density: 0.2,
      register: [62, 81],
      voice: "strings",
      pad: 0.18,
      bass: 0.14,
      brightness: 0.8,
    },
    vinyl: { crackle: 0.42, wow: 0.55, warmth: 0.75 },
  },
  {
    id: "static-bloom",
    title: "Static Bloom",
    artist: "owntools studio",
    side: "A4",
    blurb: "Bright figures opening out of the noise floor",
    art: { base: "#1c1024", ink: "#f4e8ff", accent: "#e0559b", pattern: "dust" },
    bed: { white: 0.05, pink: 0.12 },
    music: {
      root: 58, // Bb
      chords: [
        [0, 4, 7, 14],
        [2, 7, 11, 16],
        [-3, 5, 9, 12],
      ],
      scale: MAJOR_PENT,
      bpm: 74,
      chordBeats: 10,
      density: 0.4,
      register: [65, 86],
      voice: "bells",
      pad: 0.13,
      melody: 0.8,
      bass: 0.1,
      brightness: 1.3,
    },
    vinyl: { crackle: 0.5, wow: 0.3, warmth: 0.4 },
  },
  {
    id: "long-drive",
    title: "Long Drive",
    artist: "owntools studio",
    side: "B4",
    blurb: "A steady pulse and a road that keeps going",
    art: { base: "#241608", ink: "#ffeedd", accent: "#ff9f3a", pattern: "rings" },
    bed: { brown: 0.12, fan: 0.14 },
    music: {
      root: 50, // D
      chords: [
        [0, 4, 7, 10],
        [5, 9, 12, 16],
        [-2, 5, 9, 14],
        [3, 7, 10, 15],
      ],
      scale: MIXO,
      bpm: 72,
      chordBeats: 8,
      density: 0.38,
      register: [60, 81],
      voice: "pluck",
      pad: 0.12,
      bass: 0.16,
      brightness: 1,
    },
    vinyl: { crackle: 0.34, wow: 0.4, warmth: 0.66 },
  },
];

export function recordById(id: string | null | undefined): RecordDef | null {
  return RECORDS.find((r) => r.id === id) ?? null;
}

/* --------------------------------- master --------------------------------- */

export interface Master {
  /** the record's mix connects here */
  input: AudioNode;
  /** the level knob */
  setVolume(volume: number, when: number, timeConstant: number): void;
  /** the knob's current position */
  volume(): number;
  stop(when: number): void;
  disconnect(): void;
}

/**
 * The Web Audio compressor adds make-up gain of its own — (1 / gain at 0 dBFS)
 * ^ 0.6 in the WebKit-derived implementation every engine ships — so a quiet
 * record would come out 8.7 dB louder than it went in. Measured in Chromium
 * 152 for exactly the limiter settings below: +8.73 dB across the linear
 * region, -0.12 dB at a -6 dBFS peak. `LIMITER_TRIM` takes it back out, so the
 * level knob means what it always meant.
 */
const LIMITER_MAKEUP_DB = 8.73;
const LIMITER_TRIM = Math.pow(10, -LIMITER_MAKEUP_DB / 20);

/** tanh: unity below about -12 dBFS, nothing above 0 dBFS, no corner in between. */
function softCeiling(): Float32Array {
  const n = 2049;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x);
  }
  return curve;
}

/**
 * The last thing before the speakers. A record is a background: nothing on it
 * may ever jump out, so the mix meets a limiter and a soft ceiling *before*
 * the level knob — the knob scales a signal that already has a lid on it. With
 * the mix designed to peak around -14 dBFS the limiter only shaves the odd
 * two-note overlap; the ceiling is there for whatever nobody planned.
 */
export function createMaster(ctx: BaseAudioContext, dest: AudioNode, volume: number): Master {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -18;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  const trim = ctx.createGain();
  trim.gain.value = LIMITER_TRIM;
  const ceiling = ctx.createWaveShaper();
  ceiling.curve = softCeiling();
  ceiling.oversample = "2x";
  const level = ctx.createGain();
  level.gain.value = 0.0001;
  limiter.connect(trim);
  trim.connect(ceiling);
  ceiling.connect(level);
  level.connect(dest);
  level.gain.setTargetAtTime(Math.max(0.0001, volume), ctx.currentTime, 0.8);
  return {
    input: limiter,
    setVolume(next, when, timeConstant) {
      level.gain.setTargetAtTime(Math.max(0.0001, next), when, timeConstant);
    },
    volume: () => level.gain.value,
    stop(when) {
      level.gain.cancelScheduledValues(when);
      level.gain.setValueAtTime(Math.max(0.0001, level.gain.value), when);
      level.gain.setTargetAtTime(0.0001, when, 0.3);
    },
    disconnect() {
      level.disconnect();
      limiter.disconnect();
    },
  };
}

/* --------------------------------- engine --------------------------------- */

export interface RecordEngine {
  /** seconds per beat */
  readonly beatLength: number;
  /** Plays the next beat at `when` (audio-clock seconds). Call once per beat, in order. */
  scheduleBeat(when: number): void;
  /** Beats that went by unplayed — a stall is a hole in the music, never a pile-up. */
  skip(beats: number): void;
  stop(when: number): void;
}

export interface RecordEngineOptions {
  /** the dice — injectable so an offline render is repeatable */
  rng?: () => number;
}

/**
 * Where the melody sits. The voices are written to peak around -8 dBFS on
 * their own (the piano tab plays them dry); on a record they are ornaments on
 * the bed, not the reason it is on, so every note is scaled down here before
 * a record's own `melody` knob. Tuned against the offline level check: the
 * loudest tenth of a second of a record should sit within about 8 dB of its
 * median, where it used to be 15-20 dB above it.
 */
const MELODY_LEVEL = 0.4;

/**
 * Builds a record's whole signal chain into `dest` and hands back the beat
 * generator. Nothing in here reads a clock: the caller says when each beat
 * lands, so the same code plays live and renders offline.
 */
export function createRecordEngine(
  ctx: BaseAudioContext,
  dest: AudioNode,
  def: RecordDef,
  opts: RecordEngineOptions = {},
): RecordEngine {
  const rng = opts.rng ?? Math.random;
  const { music } = def;
  const beatLength = 60 / music.bpm;
  const now = ctx.currentTime;

  const vinyl: VinylChain = createVinylChain(ctx, dest, def.vinyl);
  vinyl.dropNeedle(now + 0.05);
  const bed: Layer[] = (Object.keys(def.bed) as NoiseId[]).map((layerId) =>
    createNoiseLayer(ctx, layerId, vinyl.input, def.bed[layerId] ?? 0),
  );
  const pad: Pad = createPad(ctx, vinyl.input, music.pad, music.brightness ?? 1);
  const drone: Drone = createDrone(ctx, vinyl.input, music.bass);

  let beat = 0;
  let lastMidi = music.register[0] + 7;
  let chordIndex = -1;

  const pickNote = (chord: number[]): number => {
    const { root, scale, register } = music;
    // Chord tones most of the time, scale tones for the passing notes.
    const pool = rng() < 0.7 ? chord : scale;
    const candidates: number[] = [];
    for (const offset of pool) {
      for (let octave = -2; octave <= 3; octave++) {
        const midi = root + offset + octave * 12;
        if (midi >= register[0] && midi <= register[1]) candidates.push(midi);
      }
    }
    if (!candidates.length) return register[0];
    // Prefer a step away from the last note; a melody that leaps every time
    // reads as random, which is exactly what the old generator sounded like.
    const near = candidates.filter((m) => Math.abs(m - lastMidi) <= 7 && m !== lastMidi);
    const from = near.length && rng() < 0.72 ? near : candidates;
    return from[Math.floor(rng() * from.length)];
  };

  return {
    beatLength,
    scheduleBeat(when) {
      const index = Math.floor(beat / music.chordBeats) % music.chords.length;
      const chord = music.chords[index];
      const beatInChord = beat % music.chordBeats;
      beat += 1;

      // Compared by index, not by `beatInChord === 0`, so a change that fell
      // into a skipped stretch still happens on the first beat that plays.
      if (index !== chordIndex) {
        chordIndex = index;
        pad.setChord(
          chord.map((offset) => music.root + offset),
          when,
        );
        drone.setNote(music.root + chord[0] - 12, when);
      }

      // Downbeats are likelier, so the melody has some shape to it.
      const accent = beatInChord === 0 ? 1.5 : beatInChord % 4 === 0 ? 1.15 : 1;
      if (rng() >= music.density * accent) return;

      const midi = pickNote(chord);
      lastMidi = midi;
      const length = beatLength * (1.5 + rng() * 3);
      const level = MELODY_LEVEL * (music.melody ?? 1) * (0.5 + rng() * 0.4);
      const humanize = (rng() - 0.5) * 0.05;
      playVoice(ctx, music.voice, vinyl.input, midi, when + humanize, level, length);

      // Now and then a second note a chord tone above — a two-note phrase.
      if (rng() < 0.22) {
        const second = pickNote(chord);
        playVoice(
          ctx,
          music.voice,
          vinyl.input,
          second,
          when + humanize + beatLength * (0.5 + rng()),
          level * 0.75,
          length * 0.7,
        );
      }
    },
    skip(beats) {
      beat += Math.max(0, beats);
    },
    stop(when) {
      bed.forEach((layer) => stopNoiseLayer(layer, when));
      pad.stop(when);
      drone.stop(when);
      vinyl.stop(when);
    },
  };
}

/* -------------------------------- playback -------------------------------- */

interface Session {
  def: RecordDef;
  master: Master;
  engine: RecordEngine;
  timer: number;
  /** audio-clock time of the next beat */
  nextBeat: number;
}

let session: Session | null = null;

const TICK_MS = 100;
/**
 * How far ahead beats are booked. A hidden window (tray, minimised, another
 * app in front) gets its timers once a second, so this has to cover that with
 * room to spare — 0.45 s used to leave every beat late the moment the window
 * went away.
 */
const SCHEDULE_AHEAD = 1.5;
/** a beat this little late is still played; anything later is a stall */
const STALL_TOLERANCE = 0.1;

/**
 * A stall — the machine asleep, a heavy export on the main thread, a window
 * hidden longer than the lookahead — leaves beats behind the clock. They are
 * dropped, never played all at once: a bar that has passed has passed, and a
 * pile of catch-up notes is exactly the burst a background must never make.
 */
export function advancePastStall(
  nextBeat: number,
  now: number,
  beatLength: number,
): { skip: number; nextBeat: number } {
  if (nextBeat >= now - STALL_TOLERANCE) return { skip: 0, nextBeat };
  const skip = Math.ceil((now - nextBeat) / beatLength);
  return { skip, nextBeat: nextBeat + skip * beatLength };
}

function tick(): void {
  const s = session;
  if (!s) return;
  const now = getAudioContext().currentTime;
  const { beatLength } = s.engine;
  const stall = advancePastStall(s.nextBeat, now, beatLength);
  if (stall.skip) {
    s.engine.skip(stall.skip);
    s.nextBeat = stall.nextBeat;
  }
  while (s.nextBeat < now + SCHEDULE_AHEAD) {
    s.engine.scheduleBeat(s.nextBeat);
    s.nextBeat += beatLength;
  }
}

/** Drops the needle on a record. Any record already playing is lifted first. */
export async function playRecord(id: string, volume: number): Promise<void> {
  const def = recordById(id);
  if (!def) return;
  stopRecord();
  await unlockAudio();
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  const master = createMaster(ctx, ctx.destination, volume);
  const engine = createRecordEngine(ctx, master.input, def);

  session = {
    def,
    master,
    engine,
    timer: window.setInterval(tick, TICK_MS),
    // A beat of run-up, so the first note lands after the needle settles.
    nextBeat: now + 0.6,
  };
  tick();
}

/** Lifts the needle: everything fades over about a second, then releases. */
export function stopRecord(): void {
  const s = session;
  if (!s) return;
  session = null;
  window.clearInterval(s.timer);
  const now = getAudioContext().currentTime;
  s.master.stop(now);
  s.engine.stop(now);
  window.setTimeout(() => {
    try {
      s.master.disconnect();
    } catch {
      /* already gone */
    }
  }, 2600);
}

export function setRecordVolume(volume: number): void {
  if (!session) return;
  session.master.setVolume(volume, getAudioContext().currentTime, 0.15);
}

export function playingRecordId(): RecordId | null {
  return session?.def.id ?? null;
}
