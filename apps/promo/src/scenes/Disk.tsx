/**
 * disk — 6 beats. The treemap builds itself, biggest first; the quick wins
 * list on the side gets ticked; one click and 15.5 GB is in the Recycle
 * Bin (never deleted for good), the blocks fold away.
 */
import { useCurrentFrame, useVideoConfig } from "remotion";
import { ToolIcons } from "@ui/WinDots";
import { ease, ramp, spr } from "../lib/anim";
import { COLORS, FONT_BODY, FONT_MONO } from "../theme";
import { Cursor } from "../ui/Cursor";
import { CheckIcon } from "../ui/icons";
import { useLayout } from "../ui/layout";
import { DesignLayer, Place } from "../ui/Stage";
import { Stamp } from "../ui/Stamp";
import { Window } from "../ui/Window";
import type { SceneProps } from "./index";

interface Block {
  label: string;
  size: string;
  gb: number;
  x: number;
  y: number;
  w: number;
  h: number;
  tint: string;
  win?: boolean;
}

const SYSTEM = "#3b4d76";
const PROGRAMS = "#5b5fd6";
const MEDIA = "#0a84ff";
const DOCS = "#2a89bb";
const CACHE = "#32ade6";

const BLOCKS: Block[] = [
  { label: "Windows", size: "21.4 GB", gb: 21.4, x: 0, y: 0, w: 34, h: 38, tint: SYSTEM },
  { label: "Program Files", size: "14.2 GB", gb: 14.2, x: 34, y: 0, w: 24, h: 38, tint: PROGRAMS },
  { label: "Steam", size: "12.3 GB", gb: 12.3, x: 58, y: 0, w: 22, h: 38, tint: PROGRAMS },
  { label: "Videos", size: "9.4 GB", gb: 9.4, x: 80, y: 0, w: 20, h: 38, tint: MEDIA },
  { label: "Photos", size: "7.7 GB", gb: 7.7, x: 0, y: 38, w: 26, h: 34, tint: MEDIA },
  { label: "node_modules", size: "6.2 GB", gb: 6.2, x: 26, y: 38, w: 22, h: 34, tint: CACHE, win: true },
  { label: "AppData", size: "5.6 GB", gb: 5.6, x: 48, y: 38, w: 20, h: 34, tint: SYSTEM },
  { label: "Downloads", size: "4.8 GB", gb: 4.8, x: 68, y: 38, w: 18, h: 34, tint: DOCS, win: true },
  { label: "caches & logs", size: "3.1 GB", gb: 3.1, x: 86, y: 38, w: 14, h: 34, tint: CACHE, win: true },
  { label: "VMs", size: "3.6 GB", gb: 3.6, x: 38, y: 72, w: 18, h: 28, tint: PROGRAMS },
  { label: "Documents", size: "2.1 GB", gb: 2.1, x: 0, y: 72, w: 14, h: 28, tint: DOCS },
  { label: "Music", size: "1.9 GB", gb: 1.9, x: 14, y: 72, w: 13, h: 28, tint: MEDIA },
  { label: "installers", size: "1.4 GB", gb: 1.4, x: 27, y: 72, w: 11, h: 28, tint: CACHE, win: true },
  { label: "Desktop", size: "1.1 GB", gb: 1.1, x: 56, y: 72, w: 10, h: 28, tint: DOCS },
  { label: "everything else", size: "5.8 GB", gb: 5.8, x: 66, y: 72, w: 34, h: 28, tint: "#2c3a5c" },
];

const ORDER = [...BLOCKS].sort((a, b) => b.gb - a.gb);

const WINS = [
  { label: "node_modules", note: "3 projects, untouched for 60 days", gb: 6.2 },
  { label: "Downloads", note: "older than 30 days", gb: 4.8 },
  { label: "caches & logs", note: "npm, pip, browser caches", gb: 3.1 },
  { label: "installers", note: ".exe and .msi already installed", gb: 1.4 },
];

const ROWS_AT = 34;
const TICKS = [66, 78, 90, 102];
const BUTTON_CLICK = 116;
const GONE_AT = 128;

export function Disk(_: SceneProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { portrait } = useLayout();
  const W = portrait ? 1080 : 1920;

  const ticked = TICKS.filter((t) => frame >= t).length;
  const freed = WINS.slice(0, ticked).reduce((n, w) => n + w.gb, 0);
  const gone = ease.inCubic(ramp(frame, GONE_AT, GONE_AT + 14));
  const pressed = frame >= BUTTON_CLICK + 10 && frame < BUTTON_CLICK + 16;
  const freedShown = 15.5 * ramp(frame, GONE_AT + 4, GONE_AT + 24);

  // Geometry for the cursor, in design px: the window is centred, 940 app px wide.
  const zoom = 1.72;
  const winW = 940;
  const winH = 35 + 12 + 24 + 8 + 360 + 12;
  const ox = W / 2 - (winW * zoom) / 2;
  const oy = (portrait ? 900 : 540) - (winH * zoom) / 2;
  const rowY = (i: number) => oy + (35 + 12 + 24 + 8 + 30 + i * 56 + 22) * zoom;
  const tickX = ox + (12 + 620 + 12 + 14 + 10) * zoom;
  const buttonPt: [number, number] = [ox + (12 + 620 + 12 + 150) * zoom, oy + (35 + 12 + 24 + 8 + 30 + 4 * 56 + 30) * zoom];

  return (
    <>
      <Place x={W / 2} y={portrait ? 900 : 540} at={0} from="scale" kind="glide">
        <Window title="disk — C:" icon={ToolIcons.disk} width={winW}>
          <div style={{ padding: 12, width: winW - 24 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 24, fontSize: 12.5, fontWeight: 600, color: COLORS.ink }}>
              <span>
                C: · 476 GB <span style={{ color: COLORS.muted, fontWeight: 500 }}>· 101 GB used · scanned in 3.1 s</span>
              </span>
              <span style={{ color: frame >= GONE_AT ? COLORS.green : COLORS.accent }}>
                {frame >= GONE_AT ? `${freedShown.toFixed(1)} GB freed · in the Recycle Bin, not gone` : "15.5 GB in quick wins"}
              </span>
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
              {/* treemap */}
              <div style={{ position: "relative", width: 620, height: 360, borderRadius: 10, background: "#0b1220", overflow: "hidden" }}>
                {BLOCKS.map((b) => {
                  const i = ORDER.indexOf(b);
                  const pop = spr({ frame, fps, at: 4 + i * 3, from: 0, to: 1, kind: "pop", durationInFrames: 18 });
                  const off = b.win ? gone : 0;
                  const ticksIndex = WINS.findIndex((w) => w.label === b.label);
                  const lit = b.win && ticksIndex >= 0 && frame >= TICKS[ticksIndex] ? 1 : 0;
                  return (
                    <div
                      key={b.label}
                      style={{
                        position: "absolute",
                        left: `${b.x}%`,
                        top: `${b.y}%`,
                        width: `${b.w}%`,
                        height: `${b.h}%`,
                        padding: "6px 7px",
                        boxSizing: "border-box",
                        border: "1.5px solid #0b1220",
                        background: b.tint,
                        opacity: (b.win ? 1 : 0.72) * (1 - off),
                        transform: `scale(${pop * (1 - off * 0.4)})`,
                        transformOrigin: "50% 50%",
                        boxShadow: lit ? "inset 0 0 0 2px rgba(255,255,255,0.9)" : b.win ? "inset 0 0 0 1.5px rgba(255,255,255,0.35)" : undefined,
                        overflow: "hidden",
                        color: "#fff",
                        fontFamily: FONT_BODY,
                      }}
                    >
                      <div style={{ fontSize: 10.5, fontWeight: 700, lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.label}</div>
                      <div style={{ fontSize: 9.5, fontWeight: 500, opacity: 0.75, marginTop: 2, fontFamily: FONT_MONO }}>{b.size}</div>
                    </div>
                  );
                })}
              </div>

              {/* quick wins */}
              <div style={{ width: 296, fontFamily: FONT_BODY }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", height: 30 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>quick wins</span>
                  <span style={{ fontSize: 11, color: COLORS.muted }}>never touches installed programs</span>
                </div>
                {WINS.map((w, i) => {
                  if (frame < ROWS_AT + i * 5) return null;
                  const p = spr({ frame, fps, at: ROWS_AT + i * 5, from: 0, to: 1, kind: "pop", durationInFrames: 16 });
                  const on = frame >= TICKS[i];
                  const tickPop = spr({ frame, fps, at: TICKS[i], from: 0, to: 1, kind: "slam", durationInFrames: 14 });
                  return (
                    <div
                      key={w.label}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        height: 50,
                        marginBottom: 6,
                        padding: "0 10px 0 12px",
                        borderRadius: 10,
                        border: `1px solid ${on ? "rgba(10,132,255,0.5)" : COLORS.line}`,
                        background: on ? "rgba(10,132,255,0.06)" : COLORS.paper,
                        transform: `translateX(${(1 - p) * 20}px)`,
                        opacity: p * (frame >= GONE_AT ? 0.45 : 1),
                      }}
                    >
                      <span
                        style={{
                          width: 20,
                          height: 20,
                          flex: "none",
                          borderRadius: 6,
                          border: `2px solid ${on ? COLORS.accent : "rgba(29,29,31,0.25)"}`,
                          background: on ? COLORS.accent : "#fff",
                          color: "#fff",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          transform: `scale(${on ? 0.85 + 0.15 * tickPop : 1})`,
                        }}
                      >
                        {on ? <CheckIcon size={13} stroke={2.8} /> : null}
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: COLORS.ink }}>{w.label}</span>
                        <span style={{ display: "block", fontSize: 10.5, color: COLORS.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.note}</span>
                      </span>
                      <span className="tnum" style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: COLORS.ink, fontFamily: FONT_MONO }}>
                        {w.gb.toFixed(1)} GB
                      </span>
                    </div>
                  );
                })}
                {frame >= ROWS_AT + 24 ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      height: 36,
                      marginTop: 4,
                      borderRadius: 10,
                      background: frame >= GONE_AT ? COLORS.green : pressed ? COLORS.accent2 : ticked > 0 ? COLORS.accent : "rgba(29,29,31,0.08)",
                      color: ticked > 0 || frame >= GONE_AT ? "#fff" : COLORS.muted,
                      fontSize: 13,
                      fontWeight: 600,
                      transform: pressed ? "scale(0.97)" : undefined,
                      opacity: spr({ frame, fps, at: ROWS_AT + 24, from: 0, to: 1, kind: "pop", durationInFrames: 14 }),
                    }}
                  >
                    {frame >= GONE_AT ? (
                      <>
                        <CheckIcon size={16} /> moved to the Recycle Bin
                      </>
                    ) : (
                      `Move to Recycle Bin${ticked > 0 ? ` · ${freed.toFixed(1)} GB` : ""}`
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </Window>
      </Place>

      {!portrait ? (
        <DesignLayer>
          <Cursor
            size={26}
            stops={[
              { at: 50, x: tickX + 300, y: rowY(0) + 220 },
              { at: TICKS[0] - 10, x: tickX, y: rowY(0), click: true },
              { at: TICKS[1] - 10, x: tickX, y: rowY(1), click: true },
              { at: TICKS[2] - 10, x: tickX, y: rowY(2), click: true },
              { at: TICKS[3] - 10, x: tickX, y: rowY(3), click: true },
              { at: BUTTON_CLICK - 10, x: buttonPt[0], y: buttonPt[1], click: true },
            ]}
            hideAfter={GONE_AT + 10}
          />
        </DesignLayer>
      ) : null}

      <Stamp word="disk" tool="disk" hold={22} />
    </>
  );
}
