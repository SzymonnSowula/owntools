/**
 * the promise — 3 beats, one line per beat: what the app protects, never
 * who it is for. "no account. no cloud. nothing to cancel." — the hub's
 * footer and the film's beat nine.
 */
import { useCurrentFrame, useVideoConfig } from "remotion";
import { spr } from "../lib/anim";
import { FONT_DISPLAY } from "../theme";
import { useLayout } from "../ui/layout";
import { DesignLayer } from "../ui/Stage";
import type { SceneProps } from "./index";

const LINES: Array<{ text: string; at: number; color: string }> = [
  { text: "no account.", at: 0, color: "#fff" },
  { text: "no cloud.", at: 28, color: "#fff" },
  { text: "nothing to cancel.", at: 56, color: "#9fdcff" },
];

export function Promise(_: SceneProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { portrait } = useLayout();
  const W = portrait ? 1080 : 1920;
  const H = portrait ? 1920 : 1080;
  const size = portrait ? 118 : 168;
  const step = size * 1.12;

  return (
    <DesignLayer>
      {LINES.map((l, i) => {
        if (frame < l.at) return null;
        const p = spr({ frame, fps, at: l.at, from: 0, to: 1, kind: "slam", durationInFrames: 14 });
        const y = H / 2 + (i - 1) * step;
        return (
          <div
            key={l.text}
            style={{
              position: "absolute",
              left: W / 2,
              top: y,
              transform: `translate(-50%, -50%) scale(${1.4 - 0.4 * p})`,
              opacity: p,
              filter: p < 0.9 ? `blur(${(1 - p) * 10}px)` : undefined,
              fontFamily: FONT_DISPLAY,
              fontSize: size,
              fontWeight: 700,
              letterSpacing: "-0.045em",
              lineHeight: 1,
              color: l.color,
              whiteSpace: "nowrap",
              textShadow: "0 10px 50px rgba(4,10,24,0.55)",
            }}
          >
            {l.text}
          </div>
        );
      })}
    </DesignLayer>
  );
}
