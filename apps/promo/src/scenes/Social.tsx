/**
 * social — 6 beats. The week: posts land on the calendar, one gets dragged
 * to a better hour, one an agent queued is waiting for a yes — and gets it.
 * Nothing goes out without the person.
 */
import { useCurrentFrame, useVideoConfig } from "remotion";
import { ToolIcons } from "@ui/WinDots";
import { ease, ramp, spr } from "../lib/anim";
import { COLORS, FONT_BODY } from "../theme";
import { Cursor } from "../ui/Cursor";
import { CheckIcon } from "../ui/icons";
import { useLayout } from "../ui/layout";
import { DesignLayer, Place } from "../ui/Stage";
import { Stamp } from "../ui/Stamp";
import { Window } from "../ui/Window";
import type { SceneProps } from "./index";

const DAYS = ["mon 21", "tue 22", "wed 23", "thu 24", "fri 25", "sat 26", "sun 27"];
const HOURS = ["9 am", "10 am", "11 am", "1 pm", "3 pm"];

interface Post {
  id: string;
  c: number;
  r: number;
  tag: string;
  tagColor: string;
  text: string;
  badge: string;
  done?: boolean;
  draft?: boolean;
  review?: boolean;
  at: number;
}

const POSTS: Post[] = [
  { id: "a", c: 0, r: 0, tag: "news", tagColor: "#ff375f", text: "new build: board + social", badge: "#0085ff", done: true, at: 8 },
  { id: "b", c: 1, r: 1, tag: "personal", tagColor: COLORS.indigo, text: "small daily workouts beat big ones", badge: "#000000", at: 13 },
  { id: "c", c: 2, r: 0, tag: "product", tagColor: COLORS.accent, text: "thread: how the auto-zoom works", badge: "#6364ff", at: 18 },
  { id: "d", c: 2, r: 3, tag: "news", tagColor: "#ff375f", text: "the record button lives in the bar now", badge: "#26a5e4", at: 23 },
  { id: "e", c: 3, r: 2, tag: "product", tagColor: COLORS.accent, text: "dictation tip: quiet rooms", badge: "#0a66c2", review: true, at: 28 },
  { id: "f", c: 4, r: 1, tag: "personal", tagColor: COLORS.indigo, text: "the quiet hour", badge: "#0085ff", draft: true, at: 33 },
  { id: "g", c: 5, r: 4, tag: "product", tagColor: COLORS.accent, text: "weekly changelog", badge: "#5865f2", review: true, at: 38 },
];

// Grid geometry in app px.
const PAD = 12;
const HOUR_W = 40;
const HEAD_H = 26;
const CELL_H = 58;
const GRID_W = 876;
const CELL_W = (GRID_W - HOUR_W) / 7;

const DRAG_GRAB = 58;
const DRAG_END = 90;
const APPROVE_CLICK = 112;
const APPROVED_AT = APPROVE_CLICK + 12;

function cellPos(c: number, r: number): [number, number] {
  return [HOUR_W + c * CELL_W + 3, HEAD_H + r * CELL_H + 3];
}

export function Social(_: SceneProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { portrait } = useLayout();
  const W = portrait ? 1080 : 1920;

  // The drag: post "f" from fri 10 am to thu 1 pm.
  const dragP = spr({ frame, fps, at: DRAG_GRAB + 4, from: 0, to: 1, kind: "glide", durationInFrames: 28 });
  const lifted = frame >= DRAG_GRAB && frame < DRAG_END + 4 ? ease.outCubic(ramp(frame, DRAG_GRAB, DRAG_GRAB + 6)) * (1 - ease.outCubic(ramp(frame, DRAG_END, DRAG_END + 6))) : 0;
  const from = cellPos(4, 1);
  const to = cellPos(3, 3);
  const dragged: [number, number] = [from[0] + (to[0] - from[0]) * dragP, from[1] + (to[1] - from[1]) * dragP];

  const approved = frame >= APPROVED_AT;
  const approvePop = spr({ frame, fps, at: APPROVED_AT, from: 0, to: 1, kind: "slam", durationInFrames: 16 });

  // Window origin in design px, for the cursor: the window is centred.
  // Title bar 35 app px, body padding 12, grid 26 + 5 × 58, footer line 8 + 12 + 12.
  const winW = 900;
  const winH = 35 + PAD + HEAD_H + HOURS.length * CELL_H + 8 + 12 + PAD;
  const zoom = 1.72;
  const originX = W / 2 - (winW * zoom) / 2;
  const originY = (portrait ? 900 : 540) - (winH * zoom) / 2;
  const toDesign = (x: number, y: number): [number, number] => [originX + (PAD + x) * zoom, originY + (35 + PAD + y) * zoom];

  const grab = toDesign(from[0] + CELL_W / 2, from[1] + 30);
  const drop = toDesign(to[0] + CELL_W / 2, to[1] + 30);
  const reviewCell = cellPos(3, 2);
  const reviewPt = toDesign(reviewCell[0] + CELL_W / 2, reviewCell[1] + 30);

  return (
    <>
      <Place x={W / 2} y={portrait ? 900 : 540} at={0} from="bottom" kind="glide">
        <Window
          title="social — september 21 – 27"
          icon={ToolIcons.social}
          width={winW}
          right={
            <span style={{ padding: "3px 10px", borderRadius: 999, background: COLORS.accent, color: "#fff", fontSize: 10.5, fontWeight: 700 }}>+ create post</span>
          }
        >
          <div style={{ padding: PAD }}>
            <div style={{ position: "relative", width: GRID_W, height: HEAD_H + HOURS.length * CELL_H, borderRadius: 10, border: `1px solid ${COLORS.line}`, overflow: "hidden", background: COLORS.card, fontFamily: FONT_BODY }}>
              {/* day heads */}
              {DAYS.map((d, i) => (
                <div
                  key={d}
                  style={{
                    position: "absolute",
                    left: HOUR_W + i * CELL_W,
                    top: 0,
                    width: CELL_W,
                    height: HEAD_H,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 9.5,
                    fontWeight: 700,
                    color: i === 2 ? COLORS.accent : COLORS.muted,
                    borderBottom: `1px solid ${COLORS.line}`,
                    borderLeft: `1px solid ${COLORS.line}`,
                    background: i === 2 ? "rgba(10,132,255,0.06)" : undefined,
                  }}
                >
                  {d}
                </div>
              ))}
              {/* hour rows */}
              {HOURS.map((h, r) => (
                <div key={h} style={{ position: "absolute", left: 0, top: HEAD_H + r * CELL_H, width: "100%", height: CELL_H, borderBottom: r < HOURS.length - 1 ? `1px solid ${COLORS.line}` : undefined }}>
                  <span style={{ position: "absolute", left: 0, top: 6, width: HOUR_W - 6, textAlign: "right", fontSize: 8.5, color: COLORS.muted }}>{h}</span>
                  {DAYS.map((_, c) => {
                    const past = c < 2 || (c === 2 && r < 1);
                    return (
                      <div
                        key={c}
                        style={{
                          position: "absolute",
                          left: HOUR_W + c * CELL_W,
                          top: 0,
                          width: CELL_W,
                          height: CELL_H,
                          borderLeft: `1px solid ${COLORS.line}`,
                          background: c === 2 ? "rgba(10,132,255,0.05)" : undefined,
                          backgroundImage: past ? `repeating-linear-gradient(135deg, transparent 0 5px, ${COLORS.line} 5px 6px)` : undefined,
                        }}
                      />
                    );
                  })}
                  {r === 1 ? <span style={{ position: "absolute", left: HOUR_W + 2 * CELL_W, top: 24, width: CELL_W, height: 1, background: COLORS.red }} /> : null}
                </div>
              ))}
              {/* the drop target glows while dragging */}
              {lifted > 0 ? (
                <div style={{ position: "absolute", left: to[0] - 3, top: to[1] - 3, width: CELL_W, height: CELL_H, background: `rgba(10,132,255,${0.12 * lifted})`, boxShadow: `inset 0 0 0 2px rgba(10,132,255,${0.6 * lifted})` }} />
              ) : null}
              {/* posts */}
              {POSTS.map((p) => {
                if (frame < p.at) return null;
                const pop = spr({ frame, fps, at: p.at, from: 0, to: 1, kind: "pop", durationInFrames: 16 });
                const pos = p.id === "f" ? dragged : cellPos(p.c, p.r);
                const isDragged = p.id === "f";
                const isApproved = p.id === "e" && approved;
                const review = p.review && !isApproved;
                return (
                  <div
                    key={p.id}
                    style={{
                      position: "absolute",
                      left: pos[0],
                      top: pos[1],
                      width: CELL_W - 6,
                      borderRadius: 6,
                      overflow: "hidden",
                      background: COLORS.card,
                      border: review ? `1.5px dashed ${COLORS.amber}` : `1px solid ${COLORS.line}`,
                      boxShadow: isDragged && lifted > 0 ? `0 ${10 * lifted}px ${24 * lifted}px rgba(4,10,24,0.28)` : "0 1px 2px rgba(0,0,0,0.06)",
                      transform: `scale(${(0.7 + 0.3 * pop) * (1 + 0.05 * (isDragged ? lifted : 0)) * (isApproved ? 1 + 0.06 * (1 - approvePop) : 1)})`,
                      opacity: p.done ? 0.75 : pop,
                      zIndex: isDragged && lifted > 0 ? 3 : 1,
                    }}
                  >
                    <div style={{ padding: "1px 5px", fontSize: 7.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#fff", background: isApproved ? COLORS.green : p.tagColor }}>
                      {isApproved ? "scheduled" : p.tag}
                    </div>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 4, padding: "4px 5px 5px" }}>
                      <span style={{ marginTop: 2, width: 8, height: 8, flex: "none", borderRadius: 999, background: p.badge }} />
                      <span style={{ fontSize: 8.5, lineHeight: 1.25, color: COLORS.ink, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {p.draft ? <span style={{ color: COLORS.muted }}>Draft: </span> : null}
                        {review ? <span style={{ fontWeight: 700, color: COLORS.amber }}>Review: </span> : null}
                        {p.text}
                      </span>
                      {isApproved ? (
                        <span style={{ marginLeft: "auto", flex: "none", display: "inline-flex", width: 14, height: 14, borderRadius: 999, background: COLORS.green, color: "#fff", alignItems: "center", justifyContent: "center", transform: `scale(${approvePop})` }}>
                          <CheckIcon size={9} stroke={3} />
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 9.5, color: COLORS.muted }}>
              <span>
                {approved ? "4 scheduled · 1 awaiting your review" : "3 scheduled · 2 awaiting your review"} · 1 draft · 1 published
              </span>
              <span>queued by an agent over mcp · approved by you</span>
            </div>
          </div>
        </Window>
      </Place>

      {!portrait ? (
        <DesignLayer>
          <Cursor
            size={26}
            stops={[
              { at: 40, x: grab[0] + 220, y: grab[1] + 200 },
              { at: DRAG_GRAB - 10, x: grab[0], y: grab[1] },
              { at: DRAG_GRAB + 4, x: drop[0], y: drop[1] },
              { at: APPROVE_CLICK - 12, x: reviewPt[0], y: reviewPt[1], click: true },
            ]}
            hideAfter={APPROVED_AT + 20}
          />
        </DesignLayer>
      ) : null}

      <Stamp word="social" tool="social" hold={22} />
    </>
  );
}
