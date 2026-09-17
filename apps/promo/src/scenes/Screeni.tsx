/**
 * record — 9 beats. The real take (web/public/shots/screeni.mp4, the
 * auto-zoom into a search box) under the recorder's live bar, Stop, and the
 * take is in the editor: the timeline with its zoom clips and the sound
 * ticks, Export, an MP4 in a second. The clip is the one thing in this cut
 * that is footage, not a drawing.
 */
import { OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { clock2, ease, noise, ramp, spr } from "../lib/anim";
import { COLORS, FONT_BODY, FONT_MONO } from "../theme";
import { Cursor } from "../ui/Cursor";
import { CheckIcon, DotsIcon, ExportIcon, PauseIcon, RestartIcon, StopIcon, TrashIcon } from "../ui/icons";
import { useLayout } from "../ui/layout";
import { DesignLayer, Place } from "../ui/Stage";
import { Stamp } from "../ui/Stamp";
import { RecDot } from "../ui/Window";
import type { SceneProps } from "./index";

/** Where the take starts in the clip: half a second before the zoom-in at 5.9 s. */
const CLIP_START_SECONDS = 5.4;

const STOP_CLICK = 148;
const EDITOR_AT = 158;
const EXPORT_CLICK = 198;
const EXPORT_START = 204;
const EXPORT_DONE = 236;

export function Screeni(_: SceneProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { portrait } = useLayout();

  // The recording view → the editor: the frame shrinks into the preview slot.
  const e = ease.inOutQuint(ramp(frame, EDITOR_AT, EDITOR_AT + 14));
  const W = portrait ? 1080 : 1920;
  const H = portrait ? 1920 : 1080;

  // Full-bleed frame while recording.
  const full = portrait ? { x: 40, y: 560, w: 1000, h: 562 } : { x: 180, y: 100, w: 1560, h: 878 };
  // The editor window and the preview slot inside it.
  const editor = portrait ? { x: 40, y: 380, w: 1000, h: 850 } : { x: 180, y: 100, w: 1560, h: 880 };
  const preview = portrait ? { x: 60, y: 430, w: 960, h: 540 } : { x: 200, y: 156, w: 980, h: 551 };
  const rect = {
    x: full.x + (preview.x - full.x) * e,
    y: full.y + (preview.y - full.y) * e,
    w: full.w + (preview.w - full.w) * e,
    h: full.h + (preview.h - full.h) * e,
  };

  const editorIn = spr({ frame, fps, at: EDITOR_AT, from: 0, to: 1, kind: "glide", durationInFrames: 20 });
  const exportP = ramp(frame, EXPORT_START, EXPORT_DONE);
  const donePop = spr({ frame, fps, at: EXPORT_DONE, from: 0, to: 1, kind: "pop", durationInFrames: 16 });
  const barPressed = frame >= STOP_CLICK + 10 && frame < STOP_CLICK + 16;

  const takeSeconds = 3 + frame / fps;

  return (
    <>
      <DesignLayer>
        {/* the editor window, behind the frame */}
        {frame >= EDITOR_AT ? (
          <div
            style={{
              position: "absolute",
              left: editor.x,
              top: editor.y,
              width: editor.w,
              height: editor.h,
              borderRadius: 22,
              background: "#141416",
              border: "1px solid rgba(255,255,255,0.12)",
              boxShadow: "0 30px 80px rgba(4,10,24,0.55)",
              opacity: editorIn,
              transform: `scale(${0.96 + 0.04 * editorIn})`,
              fontFamily: FONT_BODY,
              color: COLORS.paper,
              overflow: "hidden",
            }}
          >
            <EditorChrome frame={frame} editorAt={EDITOR_AT} portrait={portrait} w={editor.w} h={editor.h} previewH={preview.h + (preview.y - editor.y) - 40} exportP={exportP} exportStarted={frame >= EXPORT_START} exportClick={EXPORT_CLICK} />
          </div>
        ) : null}

        {/* the take */}
        <div
          style={{
            position: "absolute",
            left: rect.x,
            top: rect.y,
            width: rect.w,
            height: rect.h,
            borderRadius: 18 - e * 8,
            overflow: "hidden",
            boxShadow: e < 1 ? "0 30px 80px rgba(4,10,24,0.55)" : "0 10px 30px rgba(0,0,0,0.4)",
            background: "#1b1b3a",
          }}
        >
          <OffthreadVideo
            src={staticFile("shots/screeni.mp4")}
            trimBefore={Math.round(CLIP_START_SECONDS * fps)}
            muted
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
          {/* the take's own cursor is in the footage; a soft vignette keeps the edges quiet */}
          <div style={{ position: "absolute", inset: 0, boxShadow: "inset 0 0 120px rgba(0,0,0,0.18)" }} />
        </div>

        {/* export progress + done, over the editor */}
        {frame >= EXPORT_START ? (
          <div
            style={{
              position: "absolute",
              left: W / 2,
              top: portrait ? 1000 : 560,
              transform: `translate(-50%, -50%) scale(${0.9 + 0.1 * spr({ frame, fps, at: EXPORT_START, from: 0, to: 1, kind: "pop", durationInFrames: 14 })})`,
              width: 520,
              padding: "22px 24px",
              borderRadius: 20,
              background: "rgba(20,20,22,0.96)",
              border: "1px solid rgba(255,255,255,0.14)",
              boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
              fontFamily: FONT_BODY,
              color: COLORS.paper,
            }}
          >
            {frame < EXPORT_DONE ? (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22, fontWeight: 600 }}>
                  <span>Exporting take-01.mp4</span>
                  <span className="tnum" style={{ color: "rgba(245,245,247,0.6)" }}>{Math.round(exportP * 100)}%</span>
                </div>
                <div style={{ marginTop: 8, fontSize: 16, color: "rgba(245,245,247,0.55)" }}>1080p60 · sound effects on · rendered here, never uploaded</div>
                <div style={{ marginTop: 16, height: 8, borderRadius: 999, background: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
                  <div style={{ width: `${exportP * 100}%`, height: "100%", background: COLORS.accent }} />
                </div>
              </>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 24, fontWeight: 600, transform: `scale(${0.85 + 0.15 * donePop})` }}>
                <span style={{ display: "inline-flex", width: 36, height: 36, borderRadius: 999, background: COLORS.green, color: "#fff", alignItems: "center", justifyContent: "center" }}>
                  <CheckIcon size={22} />
                </span>
                take-01.mp4 · 12 s · done in 1.4 s
              </div>
            )}
          </div>
        ) : null}
      </DesignLayer>

      {/* the recorder's live bar */}
      <Place x={W / 2} y={portrait ? 500 : 66} at={4} from="top" kind="glide" leaveAt={EDITOR_AT - 4}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            height: 44,
            padding: "0 6px 0 16px",
            borderRadius: 999,
            background: "rgba(17,17,17,0.94)",
            border: `1px solid ${COLORS.surfaceLine}`,
            color: COLORS.paper,
            fontFamily: FONT_BODY,
            boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
          }}
        >
          <RecDot pulse={0.5 + 0.5 * Math.sin((frame / fps / 1.6) * Math.PI * 2)} />
          <span className="tnum" style={{ width: 54, marginLeft: 8, fontFamily: FONT_MONO, fontSize: 14, fontWeight: 600, color: COLORS.red }}>
            {clock2(takeSeconds)}
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(245,245,247,0.5)", marginRight: 8, letterSpacing: "0.04em" }}>AUTO-ZOOM</span>
          {[<PauseIcon key="p" />, <RestartIcon key="r" />, <TrashIcon key="t" />, <DotsIcon key="d" />].map((icon, i) => (
            <span key={i} style={{ display: "inline-flex", width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 999, color: "rgba(245,245,247,0.85)" }}>
              {icon}
            </span>
          ))}
          <span
            style={{
              marginLeft: 4,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 32,
              padding: "0 12px",
              borderRadius: 999,
              background: barPressed ? "#e63a30" : COLORS.red,
              color: "#fff",
              fontSize: 12.5,
              fontWeight: 600,
              transform: barPressed ? "scale(0.95)" : undefined,
            }}
          >
            <StopIcon />
            Stop
          </span>
        </div>
      </Place>

      <DesignLayer>
        <Cursor
          size={26}
          stops={
            portrait
              ? [
                  { at: 120, x: 700, y: 900 },
                  { at: STOP_CLICK - 10, x: 806, y: 502, click: true },
                  { at: EDITOR_AT + 20, x: 700, y: 1200 },
                  { at: EXPORT_CLICK - 10, x: 860, y: 1520, click: true },
                ]
              : [
                  { at: 118, x: 1200, y: 520 },
                  { at: STOP_CLICK - 10, x: 1248, y: 68, click: true },
                  { at: EDITOR_AT + 20, x: 1400, y: 500 },
                  { at: EXPORT_CLICK - 10, x: 1610, y: 895, click: true },
                ]
          }
          hideAfter={EXPORT_START + 6}
        />
      </DesignLayer>

      <Stamp word="record" tool="screeni" hold={22} />
    </>
  );
}

/** The editor around the preview: tabs, a Sound button, tracks, an Export button. Design px. */
function EditorChrome({
  frame,
  editorAt,
  portrait,
  w,
  h,
  previewH,
  exportP,
  exportStarted,
  exportClick,
}: {
  frame: number;
  editorAt: number;
  portrait: boolean;
  w: number;
  h: number;
  previewH: number;
  exportP: number;
  exportStarted: boolean;
  exportClick: number;
}) {
  const f = frame - editorAt;
  const tlTop = previewH + 60;
  const trackH = 34;
  const tracks: Array<{ name: string; color: string; blocks: Array<[number, number]>; ticks?: boolean; hatched?: boolean }> = [
    { name: "Zoom", color: COLORS.accent, blocks: [[0.06, 0.2], [0.34, 0.24], [0.68, 0.18]] },
    { name: "Cuts", color: "rgba(255,255,255,0.3)", blocks: [[0, 0.41], [0.47, 0.53]], hatched: true },
    { name: "Captions", color: COLORS.amber, blocks: [[0.03, 0.12], [0.18, 0.15], [0.36, 0.1], [0.5, 0.14], [0.67, 0.12], [0.82, 0.13]] },
    { name: "Sounds", color: COLORS.cyan, blocks: [], ticks: true },
  ];
  const exportPressed = frame >= exportClick + 10 && frame < exportClick + 16;
  const playhead = 0.32 + ramp(f, 0, 90) * 0.4;
  const rulerW = w - 140 - 24;
  const inspectorX = portrait ? 0 : w - 400;

  return (
    <>
      {/* title bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, height: 44, padding: "0 20px", borderBottom: "1px solid rgba(255,255,255,0.1)", fontSize: 14, fontWeight: 600, color: "rgba(245,245,247,0.8)" }}>
        <span style={{ display: "inline-flex", gap: 7 }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <i key={c} style={{ width: 12, height: 12, borderRadius: 999, background: c }} />
          ))}
        </span>
        <span style={{ marginLeft: 8 }}>screeni — take-01</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8 }}>
          {["Look", "Camera", "Cursor", "Zoom", "Text", "Cuts", "Audio"].map((t, i) => (
            <span key={t} style={{ padding: "5px 10px", borderRadius: 999, background: i === 3 ? "rgba(255,255,255,0.14)" : "transparent", fontSize: 12.5, color: i === 3 ? "#fff" : "rgba(245,245,247,0.6)" }}>
              {t}
            </span>
          ))}
        </span>
      </div>

      {/* inspector column (landscape only) */}
      {!portrait ? (
        <div style={{ position: "absolute", left: inspectorX, top: 56, width: 380, display: "flex", flexDirection: "column", gap: 10, fontSize: 14 }}>
          <Row label="Auto-zoom" value="follows the cursor" on />
          <Row label="Sound effects" value="clicks · keys · zooms" on />
          <Row label="Background" value="aurora · blur 12" />
          <Row label="Camera" value="bubble · bottom right" />
          <Row label="Captions" value="from your voice" on />
          <div
            style={{
              marginTop: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              height: 48,
              borderRadius: 14,
              background: exportPressed ? COLORS.accent2 : COLORS.accent,
              color: "#fff",
              fontSize: 17,
              fontWeight: 600,
              transform: exportPressed ? "scale(0.97)" : undefined,
              opacity: exportStarted ? 0.6 : 1,
            }}
          >
            <ExportIcon size={20} />
            Export MP4
          </div>
        </div>
      ) : null}

      {/* timeline */}
      <div style={{ position: "absolute", left: 20, top: tlTop, width: w - 40, height: h - tlTop - 16, borderRadius: 14, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
        {/* ruler */}
        <div style={{ position: "absolute", left: 120, top: 8, width: rulerW, height: 18, display: "flex", justifyContent: "space-between", fontSize: 11, color: "rgba(245,245,247,0.45)", fontFamily: FONT_MONO }}>
          {["0:00", "0:03", "0:06", "0:09", "0:12"].map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
        {tracks.map((tr, i) => {
          const rowIn = ramp(f, 6 + i * 4, 12 + i * 4);
          return (
            <div key={tr.name} style={{ position: "absolute", left: 0, top: 34 + i * (trackH + 8), width: "100%", height: trackH, opacity: rowIn }}>
              <span style={{ position: "absolute", left: 16, top: 8, fontSize: 12.5, fontWeight: 600, color: "rgba(245,245,247,0.7)" }}>{tr.name}</span>
              <div style={{ position: "absolute", left: 120, top: 2, width: rulerW, height: trackH - 4, borderRadius: 8, background: "rgba(255,255,255,0.05)" }}>
                {tr.ticks
                  ? Array.from({ length: 46 }, (_, k) => {
                      // Clicks and keys land where the take put them, not on a grid.
                      const x = (k + 0.5) / 46 + (noise(k, 11) - 0.5) * 0.018;
                      const tall = noise(k, 5) > 0.72;
                      return <i key={k} style={{ position: "absolute", left: `${x * 100}%`, top: tall ? 5 : 9, width: 2, height: tall ? trackH - 14 : trackH - 22, background: tr.color, opacity: 0.85, borderRadius: 1 }} />;
                    })
                  : tr.blocks.map(([x, ww], k) => {
                      const grow = spr({ frame: f, fps: 60, at: 10 + i * 4 + k * 3, from: 0, to: 1, kind: "pop", durationInFrames: 16 });
                      return (
                        <i
                          key={k}
                          style={{
                            position: "absolute",
                            left: `${x * 100}%`,
                            top: 3,
                            width: `${ww * 100 * grow}%`,
                            height: trackH - 10,
                            borderRadius: 6,
                            background: tr.hatched ? "repeating-linear-gradient(135deg, rgba(255,255,255,0.22) 0 6px, rgba(255,255,255,0.08) 6px 12px)" : tr.color,
                            opacity: 0.95,
                          }}
                        />
                      );
                    })}
              </div>
            </div>
          );
        })}
        {/* playhead */}
        <div style={{ position: "absolute", left: 120 + rulerW * playhead, top: 6, width: 2, height: "100%", background: "#fff", boxShadow: "0 0 8px rgba(255,255,255,0.6)" }} />
      </div>
      {/* export progress hint on the button */}
      {exportP > 0 && exportP < 1 && !portrait ? (
        <div style={{ position: "absolute", left: inspectorX, top: 56 + 5 * 52 + 8 + 48 - 4, width: 380 * exportP, height: 4, background: "#fff", opacity: 0.8, borderRadius: 2 }} />
      ) : null}
    </>
  );
}

function Row({ label, value, on = false }: { label: string; value: string; on?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, height: 42, padding: "0 14px", borderRadius: 12, background: "rgba(255,255,255,0.06)" }}>
      <span style={{ fontWeight: 600, color: "rgba(245,245,247,0.9)" }}>{label}</span>
      <span style={{ marginLeft: "auto", fontSize: 12.5, color: "rgba(245,245,247,0.5)" }}>{value}</span>
      <span style={{ width: 30, height: 18, borderRadius: 999, background: on ? COLORS.accent : "rgba(255,255,255,0.18)", position: "relative", flex: "none" }}>
        <i style={{ position: "absolute", top: 2, left: on ? 14 : 2, width: 14, height: 14, borderRadius: 999, background: "#fff" }} />
      </span>
    </div>
  );
}
