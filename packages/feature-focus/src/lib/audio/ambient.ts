import { getAudioContext, unlockAudio } from "./context";
import { createPad, playVoice, type Pad } from "./voices";

/**
 * The piano tab's "play by itself" mode. Same generator ideas as the records
 * (a chord cycle, stepwise melody, held pad) but dry — no bed, no vinyl — so it
 * sits under the keyboard you're playing on top of rather than replacing it.
 *
 * For a background you just put on and leave, see `records.ts`.
 */

const ROOT = 57; // A
const CHORDS = [
  [0, 3, 7, 14],
  [-4, 0, 5, 12],
  [-2, 3, 7, 10],
  [-5, 2, 7, 11],
];
const SCALE = [0, 2, 3, 5, 7, 8, 10];
const REGISTER: [number, number] = [64, 86];
const CHORD_BEATS = 12;

interface Session {
  timer: number;
  pad: Pad;
  bus: GainNode;
  bpm: number;
  volume: number;
  nextBeat: number;
  beat: number;
  lastMidi: number;
}

let session: Session | null = null;

function pickNote(chord: number[], lastMidi: number): number {
  const pool = Math.random() < 0.65 ? chord : SCALE;
  const candidates: number[] = [];
  for (const offset of pool) {
    for (let octave = -1; octave <= 3; octave++) {
      const midi = ROOT + offset + octave * 12;
      if (midi >= REGISTER[0] && midi <= REGISTER[1]) candidates.push(midi);
    }
  }
  if (!candidates.length) return REGISTER[0];
  const near = candidates.filter((m) => Math.abs(m - lastMidi) <= 7 && m !== lastMidi);
  const from = near.length && Math.random() < 0.7 ? near : candidates;
  return from[Math.floor(Math.random() * from.length)];
}

function tick(): void {
  const s = session;
  if (!s) return;
  const ctx = getAudioContext();
  const beatLength = 60 / s.bpm;
  while (s.nextBeat < ctx.currentTime + 0.4) {
    const chord = CHORDS[Math.floor(s.beat / CHORD_BEATS) % CHORDS.length];
    if (s.beat % CHORD_BEATS === 0) {
      s.pad.setChord(chord.map((o) => ROOT + o), s.nextBeat);
    }
    const accent = s.beat % CHORD_BEATS === 0 ? 1.5 : 1;
    if (Math.random() < 0.32 * accent) {
      const midi = pickNote(chord, s.lastMidi);
      s.lastMidi = midi;
      playVoice(
        ctx,
        "keys",
        s.bus,
        midi,
        s.nextBeat + (Math.random() - 0.5) * 0.05,
        0.5 + Math.random() * 0.4,
        beatLength * (1.5 + Math.random() * 2.5),
      );
    }
    s.nextBeat += beatLength;
    s.beat += 1;
  }
}

export function startAmbient(tempo: number, volume: number): void {
  stopAmbient();
  void unlockAudio().then(() => {
    if (session) return;
    const ctx = getAudioContext();
    const bus = ctx.createGain();
    bus.gain.value = Math.max(0.0001, volume);
    bus.connect(ctx.destination);
    session = {
      timer: window.setInterval(tick, 40),
      pad: createPad(ctx, bus, volume * 0.22, 0.9),
      bus,
      bpm: Math.max(24, Math.min(120, tempo)),
      volume,
      nextBeat: ctx.currentTime + 0.4,
      beat: 0,
      lastMidi: REGISTER[0] + 5,
    };
    tick();
  });
}

export function stopAmbient(): void {
  const s = session;
  if (!s) return;
  session = null;
  window.clearInterval(s.timer);
  const ctx = getAudioContext();
  const now = ctx.currentTime;
  s.pad.stop(now);
  s.bus.gain.setTargetAtTime(0.0001, now, 0.35);
  window.setTimeout(() => {
    try {
      s.bus.disconnect();
    } catch {
      /* already gone */
    }
  }, 2600);
}

export function isAmbientRunning(): boolean {
  return session != null;
}

export function setAmbientParams(tempo: number, volume: number, on: boolean): void {
  if (!on) {
    stopAmbient();
    return;
  }
  startAmbient(tempo, volume);
}
