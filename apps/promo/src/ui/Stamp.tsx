/**
 * The one word a scene is allowed: the tool's tile and its name, lowercase
 * Outfit, huge, on a frosted dark plate (the bar's surface, so it reads over
 * a white window as well as over the sky), slammed in on the cut, held for a
 * third of a second, then flown into the top-left corner where it stays as
 * a chip — the way the hub names a tool. One element, one transform, so the
 * move is continuous and the tile shrinks with the word.
 */
import { useCurrentFrame, useVideoConfig } from "remotion";
import { ToolMark, type ToolMarkName } from "@ui/ToolMark";
import { ease, ramp, spr } from "../lib/anim";
import { FONT_DISPLAY } from "../theme";
import { useLayout } from "./layout";

export function Stamp({
  word,
  tool,
  hold = 20,
  at = 0,
  big: bigProp,
  center,
}: {
  word: string;
  tool?: ToolMarkName;
  /** Frames the word stays big before it flies to the corner. */
  hold?: number;
  at?: number;
  big?: number;
  /** Where the big word sits, in design px (1920 × 1080 space). Default: centre. */
  center?: [number, number];
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { s, portrait, w, h } = useLayout();
  const big = bigProp ?? (portrait ? 150 : 200);
  const f = frame - at;
  if (f < 0) return null;

  const designW = portrait ? 1080 : 1920;
  const designH = portrait ? 1920 : 1080;
  const pop = spr({ frame: f, fps, at: 0, from: 0, to: 1, kind: "slam", durationInFrames: 14 });
  const moveP = ease.inOutQuint(ramp(f, hold, hold + 12));

  const small = 44;
  const k = 1 - moveP * (1 - small / big);
  const cx = center ? center[0] : designW / 2;
  const cy = center ? center[1] : designH / 2;
  const tagX = 48;
  const tagY = 40;

  // Centre-anchored while big, top-left-anchored as the tag: the origin
  // slides with the move so the same transform chain serves both.
  const x = (cx - designW / 2) * (1 - moveP) + moveP * (tagX - designW / 2);
  const y = (cy - designH / 2) * (1 - moveP) + moveP * (tagY - designH / 2);
  const scaleIn = 1.3 - 0.3 * pop;
  const blur = Math.max(0, (1 - pop) * 10);

  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, pointerEvents: "none", zIndex: 20 }}>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: `translate(${x * s}px, ${y * s}px) translate(${moveP * 50}%, ${moveP * 50}%) translate(-50%, -50%) scale(${k * scaleIn * s})`,
          transformOrigin: `${50 * (1 - moveP)}% ${50 * (1 - moveP)}%`,
          display: "inline-flex",
          alignItems: "center",
          gap: big * 0.12,
          padding: `${big * 0.1}px ${big * 0.2}px ${big * 0.1}px ${big * 0.11}px`,
          borderRadius: big * 0.3,
          // Dark enough to stay dark over a white window (0.58 read as a grey box).
          background: `rgba(8,14,28,${0.8 + 0.1 * moveP})`,
          border: "1px solid rgba(255,255,255,0.16)",
          boxShadow: `0 ${20 * (1 - moveP) + 6}px ${60 * (1 - moveP) + 16}px rgba(4,10,24,0.5)`,
          backdropFilter: "blur(22px)",
          WebkitBackdropFilter: "blur(22px)",
          fontFamily: FONT_DISPLAY,
          fontWeight: 700,
          fontSize: big,
          lineHeight: 1,
          letterSpacing: "-0.045em",
          color: "#fff",
          whiteSpace: "nowrap",
          filter: blur > 0.3 ? `blur(${blur}px)` : undefined,
          opacity: pop,
        }}
      >
        {tool ? (
          <span style={{ display: "inline-flex", lineHeight: 0, flex: "none" }}>
            <ToolMark tool={tool} size={big * 0.82} />
          </span>
        ) : null}
        <span style={{ paddingBottom: big * 0.04 }}>{word}</span>
      </div>
    </div>
  );
}
