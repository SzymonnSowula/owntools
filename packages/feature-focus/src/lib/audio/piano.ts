import { getAudioContext, registerAudioActivity, unlockAudio } from "./context";

const active = new Map<number, { osc: OscillatorNode[]; gain: GainNode }>();
registerAudioActivity(() => active.size > 0);

export function noteToMidi(note: string): number {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const m = note.match(/^([A-G]#?)(\d)$/);
  if (!m) return 60;
  const semitone = names.indexOf(m[1]);
  const oct = Number(m[2]);
  return (oct + 1) * 12 + semitone;
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export async function playPianoNote(
  midi: number,
  volume: number,
  duration?: number,
): Promise<void> {
  await unlockAudio();
  stopPianoNote(midi, 0.04);
  const ctx = getAudioContext();
  const t = ctx.currentTime;
  const freq = midiToFreq(midi);
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 1400 + Math.min(1800, freq * 0.4);
  filter.Q.value = 0.7;

  const sine = ctx.createOscillator();
  sine.type = "sine";
  sine.frequency.value = freq;

  const tri = ctx.createOscillator();
  tri.type = "triangle";
  tri.frequency.value = freq;
  const triGain = ctx.createGain();
  triGain.gain.value = 0.12;

  const noise = ctx.createBufferSource();
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.04), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  noise.buffer = buf;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.035 * volume;

  const v = Math.max(0.0001, volume * 0.28);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(v, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(v * 0.38, t + 0.22);
  if (duration) {
    gain.gain.setValueAtTime(v * 0.38, t + duration);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration + 1.4);
  } else {
    gain.gain.setTargetAtTime(v * 0.22, t + 0.22, 0.6);
  }

  sine.connect(filter);
  tri.connect(triGain);
  triGain.connect(filter);
  noise.connect(noiseGain);
  noiseGain.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  sine.start(t);
  tri.start(t);
  noise.start(t);
  noise.stop(t + 0.05);

  const osc = [sine, tri];
  active.set(midi, { osc, gain });

  if (duration) {
    window.setTimeout(() => stopPianoNote(midi, 0.9), duration * 1000);
  }
}

export function stopPianoNote(midi: number, release = 1.05): void {
  const voice = active.get(midi);
  if (!voice) return;
  active.delete(midi);
  const ctx = getAudioContext();
  const t = ctx.currentTime;
  try {
    voice.gain.gain.cancelScheduledValues(t);
    voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), t);
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, t + release);
    voice.osc.forEach((o) => {
      o.stop(t + release + 0.05);
    });
  } catch {
    /* already gone */
  }
}

export function stopAllPianoNotes(): void {
  [...active.keys()].forEach((m) => stopPianoNote(m, 0.4));
}
