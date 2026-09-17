/**
 * capture — 3 beats. Ctrl+Shift+4, drag a region over a page, the shutter,
 * and the words inside it are text on the clipboard.
 */
import { useCurrentFrame, useVideoConfig } from "remotion";
import { ToolIcons } from "@ui/WinDots";
import { ease, ramp, spr } from "../lib/anim";
import { COLORS, FONT_BODY, FONT_DISPLAY } from "../theme";
import { ClipboardIcon } from "../ui/icons";
import { KeyCombo } from "../ui/Keycap";
import { useLayout } from "../ui/layout";
import { DesignLayer, Place } from "../ui/Stage";
import { Stamp } from "../ui/Stamp";
import { Window } from "../ui/Window";
import type { SceneProps } from "./index";

const KEYS_AT = 2;
const PRESS_AT = 12;
const KEYS_LEAVE = 18;
const DRAG = [18, 40] as const;
const SHUTTER_AT = 42;
const OCR = [52, 66] as const;
const COPIED_AT = 66;

const PARAGRAPH =
  "Every recording, transcript and note stays on this machine. There is no account to create, no cloud to trust, and nothing that stops working when a subscription ends.";

// The page is 760 app px wide; the paragraph sits at (40, 150), 680 × 92.
const REGION = { x: 28, y: 142, w: 706, h: 74 };

export function Capture(_: SceneProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { portrait } = useLayout();
  const W = portrait ? 1080 : 1920;

  const dragP = ease.outCubic(ramp(frame, DRAG[0], DRAG[1]));
  const selected = frame >= DRAG[0];
  const w = REGION.w * dragP;
  const h = REGION.h * dragP;
  const shutter = frame >= SHUTTER_AT ? 1 - ramp(frame, SHUTTER_AT, SHUTTER_AT + 6) : 0;
  const lifted = spr({ frame, fps, at: SHUTTER_AT, from: 0, to: 1, kind: "pop", durationInFrames: 16 });
  const sweep = ramp(frame, OCR[0], OCR[1]);
  const copiedPop = spr({ frame, fps, at: COPIED_AT, from: 0, to: 1, kind: "slam", durationInFrames: 14 });

  return (
    <>
      <Place x={W / 2} y={portrait ? 900 : 560} at={0}>
        <Window title="notes — why local-first" icon={ToolIcons.capture} width={760}>
          <div style={{ position: "relative", padding: "26px 40px 30px", fontFamily: FONT_BODY, color: COLORS.ink, minHeight: 420 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 600, letterSpacing: "-0.02em" }}>why local-first</div>
            <div style={{ marginTop: 6, fontSize: 12, color: COLORS.muted }}>draft · 3 min read</div>
            <Lines top={86} widths={[92, 88, 40]} />
            <p style={{ position: "absolute", left: 40, top: 150, width: 680, margin: 0, fontSize: 16.5, lineHeight: 1.55 }}>{PARAGRAPH}</p>
            <Lines top={262} widths={[86, 94, 90, 58]} />
            <Lines top={352} widths={[90, 80]} />

            {/* the selection */}
            {selected ? (
              <>
                <div
                  style={{
                    position: "absolute",
                    left: REGION.x,
                    top: REGION.y,
                    width: w,
                    height: h,
                    boxShadow: `0 0 0 9999px rgba(10,20,40,${0.45 * (1 - lifted * 0.4)})`,
                    border: `1.5px solid ${COLORS.accent}`,
                    borderRadius: 4,
                    transform: `scale(${1 + lifted * 0.02})`,
                    zIndex: 2,
                  }}
                >
                  {[0, 1, 2, 3].map((k) => (
                    <i
                      key={k}
                      style={{
                        position: "absolute",
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        background: "#fff",
                        border: `1.5px solid ${COLORS.accent}`,
                        left: k % 2 === 0 ? -5 : undefined,
                        right: k % 2 === 1 ? -5 : undefined,
                        top: k < 2 ? -5 : undefined,
                        bottom: k >= 2 ? -5 : undefined,
                      }}
                    />
                  ))}
                  {frame < SHUTTER_AT ? (
                    <span style={{ position: "absolute", right: 0, bottom: -24, fontSize: 11, fontWeight: 600, color: "#fff", fontFamily: FONT_BODY }}>
                      {Math.round(w * 2)} × {Math.round(h * 2)}
                    </span>
                  ) : null}
                  {/* OCR sweep */}
                  {sweep > 0 && sweep < 1 ? (
                    <div style={{ position: "absolute", left: 0, top: `${sweep * 100}%`, width: "100%", height: 3, background: COLORS.accent, boxShadow: `0 0 18px ${COLORS.accent}` }} />
                  ) : null}
                  {sweep > 0 ? <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: `${sweep * 100}%`, background: "rgba(10,132,255,0.16)" }} /> : null}
                </div>
                {/* the shutter */}
                <div style={{ position: "absolute", inset: 0, background: "#fff", opacity: shutter * 0.9, zIndex: 3, pointerEvents: "none" }} />
              </>
            ) : null}

            {/* capture toolbar under the region */}
            {frame >= SHUTTER_AT + 4 ? (
              <div
                style={{
                  position: "absolute",
                  left: REGION.x,
                  top: REGION.y + REGION.h + 12,
                  display: "flex",
                  gap: 4,
                  padding: 4,
                  borderRadius: 10,
                  background: COLORS.surface,
                  border: `1px solid ${COLORS.surfaceLine}`,
                  color: COLORS.paper,
                  fontSize: 12,
                  fontWeight: 600,
                  zIndex: 4,
                  opacity: spr({ frame, fps, at: SHUTTER_AT + 4, from: 0, to: 1, kind: "pop", durationInFrames: 14 }),
                }}
              >
                {["Mark up", "Copy text", "Save", "Board", "Social"].map((t, i) => (
                  <span key={t} style={{ padding: "5px 10px", borderRadius: 7, background: i === 1 && frame >= OCR[0] - 4 ? COLORS.accent : "transparent" }}>
                    {t}
                  </span>
                ))}
              </div>
            ) : null}

            {frame >= COPIED_AT ? (
              <div
                style={{
                  position: "absolute",
                  left: REGION.x + REGION.w - 200,
                  top: REGION.y + REGION.h + 16,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 12px",
                  borderRadius: 999,
                  background: COLORS.ink,
                  color: "#fff",
                  fontSize: 12.5,
                  fontWeight: 600,
                  transform: `scale(${0.8 + 0.2 * copiedPop})`,
                  opacity: copiedPop,
                  zIndex: 5,
                  whiteSpace: "nowrap",
                }}
              >
                <ClipboardIcon size={14} />
                Text copied · 28 words
              </div>
            ) : null}
          </div>
        </Window>
      </Place>

      <DesignLayer>
        <div style={{ position: "absolute", left: W / 2, top: portrait ? 1560 : 990, transform: "translate(-50%, -50%)" }}>
          <KeyCombo keys={["ctrl", "shift", "4"]} at={KEYS_AT} pressAt={PRESS_AT} leaveAt={KEYS_LEAVE} size={72} />
        </div>
      </DesignLayer>

      <Stamp word="capture" tool="capture" hold={10} big={180} />
    </>
  );
}

function Lines({ top, widths }: { top: number; widths: number[] }) {
  return (
    <div style={{ position: "absolute", left: 40, top, width: 680 }}>
      {widths.map((w, i) => (
        <div key={i} style={{ width: `${w}%`, height: 11, marginBottom: 11, borderRadius: 6, background: "rgba(29,29,31,0.09)" }} />
      ))}
    </div>
  );
}
