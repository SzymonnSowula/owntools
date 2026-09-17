/**
 * The world every scene sits in: the app icon's sky, deep — navy at the top,
 * the icon's blue in the middle, a cyan haze at the horizon — with the sun's
 * bloom, the desktop's dot grid and a soft vignette. It never cuts: the sun
 * jumps to a new place on every scene change, so the cut reads as a new
 * place, and the scene's windows do the rest.
 */
import { useCurrentFrame } from "remotion";
import type { SceneFrames } from "../cut";
import { ease, ramp } from "../lib/anim";

const SUNS: Array<[x: number, y: number]> = [
  [78, 14],
  [22, 18],
  [70, 82],
  [30, 70],
  [82, 30],
  [18, 40],
  [60, 12],
  [40, 88],
  [76, 60],
  [50, 20],
  [78, 16],
];

export function Backdrop({ scenes, bright = 0 }: { scenes: SceneFrames[]; bright?: number }) {
  const frame = useCurrentFrame();
  // Which scene is on, and how far into it.
  let idx = 0;
  let localP = 0;
  for (let i = 0; i < scenes.length; i++) {
    if (frame >= scenes[i].from) {
      idx = i;
      localP = ramp(frame, scenes[i].from, scenes[i].from + 14);
    }
  }
  const prev = SUNS[Math.max(0, idx - 1) % SUNS.length];
  const next = SUNS[idx % SUNS.length];
  const e = ease.outQuint(localP);
  const sx = prev[0] + (next[0] - prev[0]) * e;
  const sy = prev[1] + (next[1] - prev[1]) * e;

  // `bright` (0–1) lifts the whole sky towards the icon's daylight for the end card.
  const top = mixHex("#08192f", "#2f7fce", bright);
  const mid = mixHex("#163f7a", "#62aae7", bright);
  const low = mixHex("#1d6fae", "#d6ebf3", bright);
  const sun = 0.55 + bright * 0.4;

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: mid }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `linear-gradient(to bottom, ${top} 0%, ${mid} 48%, ${low} 100%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: "-20%",
          // A blue-white bloom, not a grey smudge: pale sky colour at the core, wide soft halo.
          backgroundImage: `radial-gradient(30% 36% at ${sx}% ${sy}%, rgba(225,240,255,${sun * 0.75}) 0%, rgba(140,190,240,${sun * 0.32}) 26%, rgba(80,140,220,0) 64%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `radial-gradient(60% 50% at ${100 - sx}% ${100 - sy}%, rgba(94,92,230,${0.35 * (1 - bright)}) 0%, rgba(94,92,230,0) 70%)`,
        }}
      />
      {/* the desktop's dot grid */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "radial-gradient(rgba(255,255,255,0.13) 1.2px, transparent 1.3px)",
          backgroundSize: "26px 26px",
          opacity: 0.9,
        }}
      />
      {/* horizon haze */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "linear-gradient(to bottom, transparent 58%, rgba(255,255,255,0.14) 74%, transparent 90%)",
        }}
      />
      {/* vignette */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "radial-gradient(90% 90% at 50% 50%, rgba(0,0,0,0) 55%, rgba(4,10,24,0.55) 100%)",
        }}
      />
    </div>
  );
}

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => {
    const x = (pa >> shift) & 255;
    const y = (pb >> shift) & 255;
    return Math.round(x + (y - x) * t);
  };
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}
