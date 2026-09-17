/**
 * Keycaps for the hotkeys, and a row that presses them: each cap drops in
 * with a stagger, all press together on `pressAt`, then the row leaves.
 * Drawn in design pixels (not app pixels) — they float over the world.
 */
import { useCurrentFrame, useVideoConfig } from "remotion";
import { ease, ramp, spr } from "../lib/anim";
import { FONT_BODY } from "../theme";

export function Keycap({ label, wide = false, pressed = 0, size = 92 }: { label: string; wide?: boolean; pressed?: number; size?: number }) {
  const h = size;
  const w = wide ? size * 2.4 : label.length > 3 ? size * 1.45 : size * 1.2;
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: size * 0.2,
        background: `linear-gradient(to bottom, #3a3a3e, #222225)`,
        border: "1px solid rgba(255,255,255,0.16)",
        boxShadow: `0 ${8 - pressed * 6}px 0 #0f0f11, 0 ${18 - pressed * 10}px ${30 - pressed * 14}px rgba(4,10,24,0.55), inset 0 1px 0 rgba(255,255,255,0.18)`,
        transform: `translateY(${pressed * 7}px)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: pressed > 0.5 ? "#ffffff" : "rgba(255,255,255,0.88)",
        fontFamily: FONT_BODY,
        fontWeight: 600,
        fontSize: size * 0.29,
        letterSpacing: "-0.01em",
        filter: pressed > 0.5 ? "brightness(1.25)" : undefined,
      }}
    >
      {label}
    </div>
  );
}

/**
 * The combo: caps drop in from `at`, press at `pressAt`, gone by `leaveAt`.
 * Positioned by the caller.
 */
export function KeyCombo({
  keys,
  at,
  pressAt,
  leaveAt,
  size = 92,
  scale = 1,
}: {
  keys: string[];
  at: number;
  pressAt: number;
  leaveAt: number;
  size?: number;
  scale?: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < at || frame > leaveAt + 10) return null;
  const pressed = frame >= pressAt ? 1 - ramp(frame, pressAt + 5, pressAt + 9) : 0;
  const leave = ease.inCubic(ramp(frame, leaveAt, leaveAt + 8));
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: size * 0.22,
        transform: `scale(${scale * (1 - leave * 0.3)})`,
        opacity: 1 - leave,
      }}
    >
      {keys.map((k, i) => {
        const y = spr({ frame, fps, at: at + i * 3, from: 60, to: 0, kind: "slam", durationInFrames: 14 });
        const o = ramp(frame, at + i * 3, at + i * 3 + 4);
        return (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: size * 0.22, transform: `translateY(${y}px)`, opacity: o }}>
            <Keycap label={k} wide={k === "space"} pressed={pressed} size={size} />
            {i < keys.length - 1 ? (
              <span style={{ color: "rgba(255,255,255,0.6)", fontFamily: FONT_BODY, fontWeight: 600, fontSize: size * 0.3 }}>+</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
