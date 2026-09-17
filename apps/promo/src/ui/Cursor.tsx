/**
 * A pointer that moves between stops with a spring and clicks with a ring,
 * drawn the way screeni's cursor layer draws its arrow. Coordinates are in
 * whatever space the parent is (usually app pixels inside a zoomed stage).
 */
import { useCurrentFrame, useVideoConfig } from "remotion";
import { ease, ramp, spr } from "../lib/anim";

export interface Stop {
  /** Frame the pointer starts moving towards this point. */
  at: number;
  x: number;
  y: number;
  /** Click when it arrives (a ring + a press). */
  click?: boolean;
}

export function Cursor({ stops, size = 22, hideAfter }: { stops: Stop[]; size?: number; hideAfter?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (stops.length === 0) return null;
  if (frame < stops[0].at) return null;
  if (hideAfter !== undefined && frame > hideAfter) return null;

  // Position: the spring from the previous stop to the current one.
  let x = stops[0].x;
  let y = stops[0].y;
  for (let i = 1; i < stops.length; i++) {
    const s = stops[i];
    if (frame < s.at) break;
    const p = spr({ frame, fps, at: s.at, from: 0, to: 1, kind: "glide", durationInFrames: 16 });
    const prev = stops[i - 1];
    x = prev.x + (s.x - prev.x) * p;
    y = prev.y + (s.y - prev.y) * p;
  }

  // Click ring: on any stop with click, 10 frames after its `at` (arrival).
  let ring = 0;
  let press = 0;
  for (const s of stops) {
    if (!s.click) continue;
    const t = frame - (s.at + 10);
    if (t >= 0 && t < 18) ring = Math.max(ring, t / 18);
    if (t >= 0 && t < 6) press = 1;
  }

  return (
    <div style={{ position: "absolute", left: x, top: y, width: 0, height: 0, pointerEvents: "none", zIndex: 30 }}>
      {ring > 0 ? (
        <div
          style={{
            position: "absolute",
            left: -size * 1.4 * ease.outCubic(ring),
            top: -size * 1.4 * ease.outCubic(ring),
            width: size * 2.8 * ease.outCubic(ring),
            height: size * 2.8 * ease.outCubic(ring),
            borderRadius: 999,
            border: `${Math.max(1, 3 * (1 - ring))}px solid rgba(10,132,255,${0.9 * (1 - ring)})`,
            background: `rgba(10,132,255,${0.25 * (1 - ring)})`,
          }}
        />
      ) : null}
      <svg
        width={size}
        height={size * 1.5}
        viewBox="0 0 20 30"
        style={{ position: "absolute", left: 0, top: 0, transform: `scale(${press ? 0.9 : 1})`, transformOrigin: "0 0", filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.45))" }}
      >
        <path d="M2 2 L2 23 L7.5 18 L11 27 L15 25.3 L11.5 16.6 L18.5 16.4 Z" fill="#fff" stroke="#111" strokeWidth={1.6} strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/** A soft highlight that follows a click target: the button “pressing”. */
export function pressAmount(frame: number, at: number): number {
  const t = frame - at;
  if (t < 0) return 0;
  return 1 - ramp(t, 4, 12);
}
