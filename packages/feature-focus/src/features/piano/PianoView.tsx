import { useEffect, useRef, useState } from "react";
import { noteToMidi, playPianoNote, stopPianoNote } from "../../lib/audio/engine";
import { useAppStore } from "../../store/useAppStore";

const WHITES = [
  { note: "C3", key: "Z" },
  { note: "D3", key: "X" },
  { note: "E3", key: "C" },
  { note: "F3", key: "V" },
  { note: "G3", key: "B" },
  { note: "A3", key: "N" },
  { note: "B3", key: "M" },
  { note: "C4", key: "A" },
  { note: "D4", key: "S" },
  { note: "E4", key: "D" },
  { note: "F4", key: "F" },
  { note: "G4", key: "G" },
  { note: "A4", key: "H" },
  { note: "B4", key: "J" },
  { note: "C5", key: "K" },
];

const BLACKS: { note: string; key: string; after: number }[] = [
  { note: "C#3", key: "", after: 0 },
  { note: "D#3", key: "", after: 1 },
  { note: "F#3", key: "", after: 3 },
  { note: "G#3", key: "", after: 4 },
  { note: "A#3", key: "", after: 5 },
  { note: "C#4", key: "W", after: 7 },
  { note: "D#4", key: "E", after: 8 },
  { note: "F#4", key: "T", after: 10 },
  { note: "G#4", key: "Y", after: 11 },
  { note: "A#4", key: "U", after: 12 },
];

const KEY_MAP: Record<string, string> = {
  z: "C3",
  x: "D3",
  c: "E3",
  v: "F3",
  b: "G3",
  n: "A3",
  m: "B3",
  a: "C4",
  s: "D4",
  d: "E4",
  f: "F4",
  g: "G4",
  h: "A4",
  j: "B4",
  k: "C5",
  w: "C#4",
  e: "D#4",
  t: "F#4",
  y: "G#4",
  u: "A#4",
};

export function PianoView() {
  const piano = useAppStore((s) => s.piano);
  const setPiano = useAppStore((s) => s.setPiano);
  const [held, setHeld] = useState<Record<string, boolean>>({});
  const heldRef = useRef(held);
  heldRef.current = held;
  const volumeRef = useRef(piano.volume);
  volumeRef.current = piano.volume;

  const down = (note: string) => {
    if (heldRef.current[note]) return;
    setHeld((h) => ({ ...h, [note]: true }));
    void playPianoNote(noteToMidi(note), volumeRef.current);
  };
  const up = (note: string) => {
    setHeld((h) => ({ ...h, [note]: false }));
    stopPianoNote(noteToMidi(note));
  };

  useEffect(() => {
    const isForm = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat || isForm(e.target)) return;
      const note = KEY_MAP[e.key.toLowerCase()];
      if (!note) return;
      e.preventDefault();
      down(note);
    };
    const onUp = (e: KeyboardEvent) => {
      if (isForm(e.target)) return;
      const note = KEY_MAP[e.key.toLowerCase()];
      if (!note) return;
      up(note);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
    // down/up read from refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const whiteCount = WHITES.length;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="kicker">Quiet sounds</p>
          <h1 className="page-title">Piano</h1>
        </div>
        <div className="page-actions">
          <button
            className={`btn${piano.ambient ? " primary" : ""}`}
            onClick={() => setPiano({ ambient: !piano.ambient })}
          >
            {piano.ambient ? "Ambient on" : "Ambient piano"}
          </button>
        </div>
      </header>

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="mixer-row">
          <span>Volume</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={piano.volume}
            onChange={(e) => setPiano({ volume: Number(e.target.value) })}
          />
          <span className="faint">{Math.round(piano.volume * 100)}</span>
        </div>
        <div className="mixer-row">
          <span>Ambient tempo</span>
          <input
            type="range"
            min={18}
            max={72}
            step={1}
            value={piano.tempo}
            onChange={(e) => setPiano({ tempo: Number(e.target.value) })}
          />
          <span className="faint">{piano.tempo}</span>
        </div>
        <p className="muted" style={{ margin: "8px 0 0" }}>
          Keys A–K (C4 octave) and Z–M (C3). Black keys: W E T Y U. Ambient plays sparse notes in C minor pentatonic.
        </p>
      </section>

      <div
        className="piano"
        onMouseLeave={() => Object.keys(held).forEach((n) => held[n] && up(n))}
      >
        {WHITES.map((w) => (
          <button
            key={w.note}
            className={`white-key${held[w.note] ? " on" : ""}`}
            onPointerDown={(e) => {
              e.preventDefault();
              down(w.note);
            }}
            onPointerUp={() => up(w.note)}
            onPointerCancel={() => up(w.note)}
          >
            <span>{w.key}</span>
          </button>
        ))}
        {BLACKS.map((b) => {
          const left = ((b.after + 1) / whiteCount) * 100 - 2.1;
          return (
            <button
              key={b.note}
              className={`black-key${held[b.note] ? " on" : ""}`}
              style={{ left: `${left}%` }}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                down(b.note);
              }}
              onPointerUp={(e) => {
                e.stopPropagation();
                up(b.note);
              }}
            >
              <span>{b.key.length === 1 && "WETYU".includes(b.key) ? b.key : ""}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
