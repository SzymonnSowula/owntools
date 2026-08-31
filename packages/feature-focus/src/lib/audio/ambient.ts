import { noteToMidi, playPianoNote } from "./piano";

const SCALE = ["C3", "Eb3", "F3", "G3", "Bb3", "C4", "Eb4", "F4", "G4", "Bb4", "C5", "Eb5"];

let handle: number | null = null;
let lastMidi = -1;

export function startAmbient(tempo: number, volume: number): void {
  stopAmbient();
  const beat = Math.max(400, 60000 / Math.max(12, tempo));
  const tick = () => {
    if (Math.random() > 0.42) {
      let note = SCALE[Math.floor(Math.random() * SCALE.length)];
      let midi = noteToMidi(note);
      if (midi === lastMidi) {
        note = SCALE[(SCALE.indexOf(note) + 3) % SCALE.length];
        midi = noteToMidi(note);
      }
      lastMidi = midi;
      const dur = 1.4 + Math.random() * 2.2;
      void playPianoNote(midi, volume * (0.45 + Math.random() * 0.25), dur);
    }
    handle = window.setTimeout(tick, beat * (0.8 + Math.random() * 0.7));
  };
  tick();
}

export function stopAmbient(): void {
  if (handle != null) {
    window.clearTimeout(handle);
    handle = null;
  }
}

export function isAmbientRunning(): boolean {
  return handle != null;
}

export function setAmbientParams(tempo: number, volume: number, on: boolean): void {
  if (!on) {
    stopAmbient();
    return;
  }
  startAmbient(tempo, volume);
}
