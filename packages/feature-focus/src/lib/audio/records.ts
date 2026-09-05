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
    artist: "shipshape studio",
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
      register: [64, 84],
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
    artist: "shipshape studio",
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
      register: [72, 93],
      voice: "bells",
      pad: 0.12,
      bass: 0.08,
      brightness: 1.25,
    },
    vinyl: { crackle: 0.3, wow: 0.3, warmth: 0.45 },
  },
  {
    id: "deep-water",
    title: "Deep Water",
    artist: "shipshape studio",
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
    artist: "shipshape studio",
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
      register: [62, 84],
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
    artist: "shipshape studio",
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
      register: [65, 88],
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
    artist: "shipshape studio",
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
      register: [64, 83],
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
    artist: "shipshape studio",
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
      register: [70, 94],
      voice: "bells",
      pad: 0.13,
      bass: 0.1,
      brightness: 1.3,
    },
    vinyl: { crackle: 0.5, wow: 0.3, warmth: 0.4 },
  },
  {
    id: "long-drive",
    title: "Long Drive",
    artist: "shipshape studio",
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

/* -------------------------------- playback -------------------------------- */

interface Session {
  def: RecordDef;
  master: GainNode;
  vinyl: VinylChain;
  bed: Layer[];
  pad: Pad;
  drone: Drone;
  timer: number;
  /** audio-clock time of the next beat */
  nextBeat: number;
  beat: number;
  lastMidi: number;
}

let session: Session | null = null;

const LOOKAHEAD_MS = 40;
const SCHEDULE_AHEAD = 0.45;

function pickNote(def: RecordDef, chord: number[], lastMidi: number): number {
  const { root, scale, register } = def.music;
  // Chord tones most of the time, scale tones for the passing notes.
  const pool = Math.random() < 0.7 ? chord : scale;
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
  const from = near.length && Math.random() < 0.72 ? near : candidates;
  return from[Math.floor(Math.random() * from.length)];
}

function scheduleBeat(s: Session, when: number): void {
  const { music } = s.def;
  const chordIndex = Math.floor(s.beat / music.chordBeats) % music.chords.length;
  const chord = music.chords[chordIndex];
  const beatInChord = s.beat % music.chordBeats;

  if (beatInChord === 0) {
    s.pad.setChord(
      chord.map((offset) => music.root + offset),
      when,
    );
    s.drone.setNote(music.root + chord[0] - 12, when);
  }

  // Downbeats are likelier, so the melody has some shape to it.
  const accent = beatInChord === 0 ? 1.5 : beatInChord % 4 === 0 ? 1.15 : 1;
  if (Math.random() < music.density * accent) {
    const midi = pickNote(s.def, chord, s.lastMidi);
    s.lastMidi = midi;
    const beatLength = 60 / music.bpm;
    const length = beatLength * (1.5 + Math.random() * 3);
    const level = 0.5 + Math.random() * 0.4;
    const humanize = (Math.random() - 0.5) * 0.05;
    playVoice(music.voice, s.vinyl.input, midi, when + humanize, level, length);

    // Now and then a second note a chord tone above — a two-note phrase.
    if (Math.random() < 0.22) {
      const second = pickNote(s.def, chord, midi);
      playVoice(
        music.voice,
        s.vinyl.input,
        second,
        when + humanize + beatLength * (0.5 + Math.random()),
        level * 0.75,
        length * 0.7,
      );
    }
  }
}

function tick(): void {
  const s = session;
  if (!s) return;
  const ctx = getAudioContext();
  const beatLength = 60 / s.def.music.bpm;
  while (s.nextBeat < ctx.currentTime + SCHEDULE_AHEAD) {
    scheduleBeat(s, s.nextBeat);
    s.nextBeat += beatLength;
    s.beat += 1;
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

  const master = ctx.createGain();
  master.gain.value = 0.0001;
  master.connect(ctx.destination);
  master.gain.setTargetAtTime(Math.max(0.0001, volume), now, 0.8);

  const vinyl = createVinylChain(master, def.vinyl);
  vinyl.dropNeedle(now + 0.05);

  const bed = (Object.keys(def.bed) as NoiseId[]).map((layerId) =>
    createNoiseLayer(layerId, vinyl.input, def.bed[layerId] ?? 0),
  );
  const pad = createPad(vinyl.input, def.music.pad, def.music.brightness ?? 1);
  const drone = createDrone(vinyl.input, def.music.bass);

  session = {
    def,
    master,
    vinyl,
    bed,
    pad,
    drone,
    timer: window.setInterval(tick, LOOKAHEAD_MS),
    // A beat of run-up, so the first note lands after the needle settles.
    nextBeat: now + 0.6,
    beat: 0,
    lastMidi: def.music.register[0] + 7,
  };
  tick();
}

/** Lifts the needle: everything fades over about a second, then releases. */
export function stopRecord(): void {
  const s = session;
  if (!s) return;
  session = null;
  window.clearInterval(s.timer);
  const ctx = getAudioContext();
  const now = ctx.currentTime;
  s.master.gain.cancelScheduledValues(now);
  s.master.gain.setValueAtTime(Math.max(0.0001, s.master.gain.value), now);
  s.master.gain.setTargetAtTime(0.0001, now, 0.3);
  s.bed.forEach((layer) => stopNoiseLayer(layer, now));
  s.pad.stop(now);
  s.drone.stop(now);
  s.vinyl.stop(now);
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
  const ctx = getAudioContext();
  session.master.gain.setTargetAtTime(Math.max(0.0001, volume), ctx.currentTime, 0.15);
}

export function playingRecordId(): RecordId | null {
  return session?.def.id ?? null;
}
