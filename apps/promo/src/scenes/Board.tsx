/**
 * board — 5 beats. Ctrl+V a screenshot onto the endless canvas, draw a box
 * and an arrow around it by hand, write two words, ring the number. The
 * strokes are polylines drawn point by point with a little wobble, so the
 * pen tip is a real position the pointer can follow.
 */
import { useCurrentFrame, useVideoConfig } from "remotion";
import { ToolIcons } from "@ui/WinDots";
import { ease, noise, ramp, spr, typed } from "../lib/anim";
import { COLORS, FONT_BODY, FONT_DISPLAY } from "../theme";
import { Cursor } from "../ui/Cursor";
import { useLayout } from "../ui/layout";
import { Place } from "../ui/Stage";
import { Stamp } from "../ui/Stamp";
import { Window } from "../ui/Window";
import type { SceneProps } from "./index";

type Pt = [number, number];

/** Subdivide a polyline and wobble it like a hand, deterministically. */
function handPath(points: Pt[], wobble = 1.4, salt = 0): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(2, Math.round(len / 10));
    for (let k = 0; k < n; k++) {
      const u = k / n;
      const j = out.length + salt * 97;
      out.push([x0 + (x1 - x0) * u + (noise(j, 1) - 0.5) * wobble * 2, y0 + (y1 - y0) * u + (noise(j, 2) - 0.5) * wobble * 2]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/** The drawn part of a wobbled polyline at progress p, and the pen tip. */
function drawn(path: Pt[], p: number): { d: string; tip: Pt } {
  // Nothing drawn yet: an empty path, not a zero-length stroke (round caps make that a dot).
  if (p <= 0) return { d: "", tip: path[0] };
  const total = path.length - 1;
  const upto = p * total;
  const full = Math.floor(upto);
  const pts = path.slice(0, full + 1);
  let tip: Pt = path[Math.min(full, path.length - 1)];
  if (full < total) {
    const a = path[full];
    const b = path[full + 1];
    const u = upto - full;
    tip = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
    pts.push(tip);
  }
  return { d: pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" "), tip };
}

// The window comes in once the stamp has left the middle of the frame: a
// white word on a white canvas is no word at all.
const WINDOW_AT = 14;
const PASTE_AT = 20;
const BOX = [36, 64] as const;
const ARROW = [62, 80] as const;
const TEXT_AT = 82;
const RING = [100, 126] as const;

// Canvas is 880 × 470 app px.
const boxPath = handPath([[430, 70], [770, 70], [770, 210], [430, 210], [430, 70]], 1.6, 1);
const arrowPath = handPath([[368, 175], [420, 150]], 1.2, 2);
const headPath = handPath([[406, 140], [422, 149], [410, 164]], 1, 3);
const ringPath = (() => {
  const pts: Pt[] = [];
  const cx = 300;
  const cy = 380;
  for (let i = 0; i <= 40; i++) {
    const a = -Math.PI / 2 + (i / 40) * Math.PI * 2.08;
    pts.push([cx + Math.cos(a) * (98 + Math.sin(i) * 2), cy + Math.sin(a) * (34 + Math.cos(i * 0.7) * 1.5)]);
  }
  return handPath(pts, 1, 4);
})();

export function Board(_: SceneProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { portrait } = useLayout();
  const W = portrait ? 1080 : 1920;

  const pasted = spr({ frame, fps, at: PASTE_AT, from: 0, to: 1, kind: "slam", durationInFrames: 16 });
  const boxP = ease.inOutCubic(ramp(frame, BOX[0], BOX[1]));
  const arrowP = ramp(frame, ARROW[0], ARROW[1] - 6);
  const headP = ramp(frame, ARROW[1] - 6, ARROW[1]);
  const ringP = ease.inOutCubic(ramp(frame, RING[0], RING[1]));
  const label = typed("why this?", frame, fps, TEXT_AT, 22);

  const box = drawn(boxPath, boxP);
  const arrow = drawn(arrowPath, arrowP);
  const head = drawn(headPath, headP);
  const ring = drawn(ringPath, ringP);

  // The pointer rides the pen tip while a stroke is being drawn.
  let tip: Pt | null = null;
  if (frame >= BOX[0] && frame < BOX[1]) tip = box.tip;
  else if (frame >= ARROW[0] && frame < ARROW[1] - 6) tip = arrow.tip;
  else if (frame >= ARROW[1] - 6 && frame < ARROW[1]) tip = head.tip;
  else if (frame >= RING[0] && frame < RING[1]) tip = ring.tip;

  const activeTool = frame < BOX[0] ? 0 : frame < ARROW[0] ? 2 : frame < TEXT_AT ? 3 : frame < RING[0] ? 4 : 5;

  return (
    <>
      <Place x={W / 2} y={portrait ? 900 : 540} at={WINDOW_AT} from="scale" kind="pop">
        <Window title="board — launch notes" icon={ToolIcons.board} width={900}>
          <div
            style={{
              position: "relative",
              height: 470,
              overflow: "hidden",
              backgroundColor: "#fff",
              backgroundImage: "radial-gradient(rgba(29,29,31,0.16) 1px, transparent 1.2px)",
              backgroundSize: "18px 18px",
              width: 898,
            }}
          >
            {/* Excalidraw's toolbar island */}
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: 10,
                transform: "translateX(-50%)",
                display: "flex",
                gap: 4,
                padding: 4,
                borderRadius: 10,
                background: "#fff",
                border: `1px solid ${COLORS.line}`,
                boxShadow: "0 4px 14px rgba(0,0,0,0.08)",
                zIndex: 2,
              }}
            >
              {["sel", "hand", "rect", "arrow", "text", "pen", "img"].map((tool, i) => (
                <span
                  key={tool}
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 7,
                    background: i === activeTool ? "rgba(10,132,255,0.16)" : "transparent",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: i === activeTool ? COLORS.accent : COLORS.muted,
                  }}
                >
                  <ToolIcon name={tool} />
                </span>
              ))}
            </div>

            {/* the pasted screenshot */}
            {frame >= PASTE_AT ? (
              <div
                style={{
                  position: "absolute",
                  left: 60,
                  top: 90,
                  width: 300,
                  height: 190,
                  borderRadius: 8,
                  overflow: "hidden",
                  boxShadow: "0 10px 30px rgba(4,10,24,0.28)",
                  transform: `scale(${0.7 + 0.3 * pasted})`,
                  opacity: Math.min(1, pasted * 2),
                  background: "#141416",
                  border: "1px solid rgba(0,0,0,0.2)",
                }}
              >
                <Screenshot />
              </div>
            ) : null}

            {/* the number the ring goes around */}
            <div style={{ position: "absolute", left: 210, top: 352, fontFamily: FONT_DISPLAY, fontSize: 34, fontWeight: 600, color: COLORS.ink, opacity: ramp(frame, 20, 26) }}>
              4.2k <span style={{ fontSize: 20, fontWeight: 500, color: COLORS.muted }}>signups · day 1</span>
            </div>

            {/* strokes */}
            <svg viewBox="0 0 880 470" width={880} height={470} style={{ position: "absolute", inset: 0 }} fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d={box.d} stroke={COLORS.ink} strokeWidth={2.4} />
              <path d={arrow.d} stroke={COLORS.ink} strokeWidth={2.4} />
              <path d={head.d} stroke={COLORS.ink} strokeWidth={2.4} />
              <path d={ring.d} stroke={COLORS.amber} strokeWidth={3} />
            </svg>

            {/* the text */}
            <div style={{ position: "absolute", left: 470, top: 108, fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 600, color: COLORS.ink, letterSpacing: "-0.01em" }}>
              {label}
              {frame >= TEXT_AT && frame < TEXT_AT + 36 ? <span style={{ borderLeft: `2px solid ${COLORS.ink}`, marginLeft: 2, opacity: frame % 20 < 12 ? 1 : 0 }} /> : null}
            </div>
            <div style={{ position: "absolute", left: 470, top: 152, fontFamily: FONT_BODY, fontSize: 14, color: COLORS.muted, opacity: ramp(frame, TEXT_AT + 20, TEXT_AT + 28) }}>
              pasted · marked up · saved on disk
            </div>

            {/* the pen */}
            {tip ? <Cursor size={22} stops={[{ at: 0, x: tip[0], y: tip[1] }]} /> : null}
            {frame >= WINDOW_AT && frame < PASTE_AT + 14 ? (
              <div style={{ position: "absolute", left: 70, top: 300, display: "flex", gap: 6, opacity: 1 - ramp(frame, PASTE_AT + 8, PASTE_AT + 14) }}>
                <Key label="ctrl" />
                <Key label="v" />
              </div>
            ) : null}
          </div>
        </Window>
      </Place>
      <Stamp word="board" tool="board" hold={10} />
    </>
  );
}

function Key({ label }: { label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 34,
        height: 30,
        padding: "0 9px",
        borderRadius: 7,
        background: "#2c2c2e",
        color: "#fff",
        fontFamily: FONT_BODY,
        fontSize: 13,
        fontWeight: 600,
        boxShadow: "0 3px 0 #0f0f11",
      }}
    >
      {label}
    </span>
  );
}

/** What was pasted: a dark dashboard with a chart. */
function Screenshot() {
  const bars = [38, 52, 44, 70, 64, 86, 78, 96];
  return (
    <div style={{ padding: 12, color: "#fff", fontFamily: FONT_BODY }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, color: "rgba(255,255,255,0.6)" }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: COLORS.green }} />
        launch day · live
      </div>
      <div style={{ marginTop: 6, fontSize: 22, fontWeight: 700 }}>4,213</div>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)" }}>signups today</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 74, marginTop: 14 }}>
        {bars.map((h, i) => (
          <span key={i} style={{ flex: 1, height: `${h}%`, borderRadius: 3, background: i === bars.length - 1 ? COLORS.accent : "rgba(10,132,255,0.45)" }} />
        ))}
      </div>
    </div>
  );
}

function ToolIcon({ name }: { name: string }) {
  const common = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "sel":
      return (
        <svg {...common}>
          <path d="M3 2l9 5.5-4 1-2 4z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "hand":
      return (
        <svg {...common}>
          <path d="M5 8V4a1 1 0 0 1 2 0v3M7 7V3a1 1 0 0 1 2 0v4M9 7V4a1 1 0 0 1 2 0v5M11 9V6a1 1 0 0 1 2 0v4a4 4 0 0 1-8 0V8a1 1 0 0 1 2 0" />
        </svg>
      );
    case "rect":
      return (
        <svg {...common}>
          <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
        </svg>
      );
    case "arrow":
      return (
        <svg {...common}>
          <path d="M3 13 13 3M7 3h6v6" />
        </svg>
      );
    case "text":
      return (
        <svg {...common}>
          <path d="M3 4h10M8 4v9" />
        </svg>
      );
    case "pen":
      return (
        <svg {...common}>
          <path d="M3 13c1-4 3-6 7-9l2 2c-3 4-5 6-9 7z" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
          <path d="M4 11l3-3 2 2 2-2 2 2" />
        </svg>
      );
  }
}
