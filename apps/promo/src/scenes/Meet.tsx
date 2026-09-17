/**
 * meet — 6 beats. A call being written down as it happens — the mic is you,
 * the speakers are them — and, the moment it ends, the summary, the
 * decisions and the to-dos (into focus).
 */
import { useCurrentFrame, useVideoConfig } from "remotion";
import { ToolIcons } from "@ui/WinDots";
import { ToolGlyph } from "@ui/ToolMark";
import { clock2, ease, ramp, smoothNoise, spr } from "../lib/anim";
import { COLORS, FONT_BODY } from "../theme";
import { CheckIcon } from "../ui/icons";
import { useLayout } from "../ui/layout";
import { Place } from "../ui/Stage";
import { Stamp } from "../ui/Stamp";
import { RecDot, Window } from "../ui/Window";
import type { SceneProps } from "./index";

const LINES: Array<{ at: number; who: "you" | "them"; text: string; tail?: string }> = [
  { at: 12, who: "them", text: "can we lock the pricing this week?" },
  { at: 40, who: "you", text: "yes — one price, paid once. I'll send the page tonight." },
  { at: 72, who: "them", text: "and the mac build? half the team is", tail: "on macs" },
  { at: 98, who: "you", text: "next month. windows launches first." },
];

const CARD_AT = 110;
const ROWS_AT = [118, 126, 134];

export function Meet(_: SceneProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { portrait } = useLayout();
  const W = portrait ? 1080 : 1920;
  const t = frame / fps;
  const shift = ease.inOutQuint(ramp(frame, CARD_AT, CARD_AT + 14));

  const youLevel = (i: number) => 4 + 9 * smoothNoise(t * 7 + i * 0.7, 21) * (frame >= 40 && frame < 72 ? 1 : 0.35);
  const themLevel = (i: number) => 4 + 9 * smoothNoise(t * 8 + i * 0.9, 33) * ((frame >= 12 && frame < 40) || (frame >= 72 && frame < 98) ? 1 : 0.35);

  return (
    <>
      <Place x={portrait ? W / 2 : 960 - shift * 340} y={portrait ? 700 : 520} at={2} from="bottom" kind="glide">
        <Window title="meet — zoom call" icon={ToolIcons.meet} width={700}>
          <div style={{ padding: "12px 16px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 12px",
                  borderRadius: 999,
                  background: COLORS.surface,
                  color: "#fff",
                  fontSize: 12.5,
                  fontWeight: 600,
                }}
              >
                <RecDot size={8} pulse={0.5 + 0.5 * Math.sin((t / 1.6) * Math.PI * 2)} />
                <span className="tnum">{clock2(32 * 60 + 8 + t)}</span> · recording
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.muted }}>live transcript · on this device</span>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <Source label="you" sub="mic" color={COLORS.accent} levels={[0, 1, 2, 3, 4].map(youLevel)} />
              <Source label="them" sub="speakers" color={COLORS.cyan} levels={[0, 1, 2, 3, 4].map(themLevel)} />
            </div>

            <div style={{ marginTop: 14, minHeight: 190, display: "flex", flexDirection: "column", gap: 9 }}>
              {LINES.map((l) => {
                if (frame < l.at) return null;
                const p = spr({ frame, fps, at: l.at, from: 0, to: 1, kind: "pop", durationInFrames: 16 });
                // Fast enough that a line is whole before the next speaker starts.
                const typedChars = Math.floor(((frame - l.at) / fps) * 125);
                const text = l.text.slice(0, typedChars);
                const showTail = l.tail && typedChars >= l.text.length;
                return (
                  <div
                    key={l.at}
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "flex-start",
                      transform: `translateY(${(1 - p) * 14}px)`,
                      opacity: p,
                    }}
                  >
                    <span
                      style={{
                        flex: "none",
                        width: 48,
                        marginTop: 3,
                        fontSize: 10.5,
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: l.who === "you" ? COLORS.accent : COLORS.cyan,
                      }}
                    >
                      {l.who}
                    </span>
                    <span style={{ fontSize: 15, lineHeight: 1.45, color: COLORS.ink }}>
                      {text}
                      {showTail ? <span style={{ color: "rgba(29,29,31,0.38)" }}> {l.tail}</span> : null}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </Window>
      </Place>

      {/* after the call */}
      <Place x={portrait ? W / 2 : 1560} y={portrait ? 1130 : 560} at={CARD_AT} from={portrait ? "bottom" : "right"} kind="glide" zIndex={4}>
        <div
          style={{
            width: 340,
            padding: "16px 18px 18px",
            borderRadius: 18,
            background: COLORS.card,
            border: `1px solid ${COLORS.line}`,
            boxShadow: "0 24px 60px rgba(4,10,24,0.45)",
            fontFamily: FONT_BODY,
            color: COLORS.ink,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700 }}>
            <span style={{ color: COLORS.accent, display: "inline-flex" }}>
              <ToolGlyph tool="meet" size={18} />
            </span>
            after the call
            <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: COLORS.muted }}>written here, not uploaded</span>
          </div>
          {[
            { k: "summary", v: "Pricing locked: one price, paid once. The Mac build follows next month." },
            { k: "decision", v: "one price, paid once", check: true },
            { k: "to-do → focus", v: "send the pricing page tonight", chip: "added to today" },
          ].map((row, i) => {
            const p = spr({ frame, fps, at: ROWS_AT[i], from: 0, to: 1, kind: "pop", durationInFrames: 16 });
            if (frame < ROWS_AT[i]) return null;
            return (
              <div key={row.k} style={{ marginTop: 12, transform: `translateY(${(1 - p) * 10}px)`, opacity: p }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: COLORS.muted }}>{row.k}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, fontSize: 13.5, lineHeight: 1.4 }}>
                  {row.check ? (
                    <span style={{ display: "inline-flex", width: 18, height: 18, borderRadius: 6, background: COLORS.accent, color: "#fff", alignItems: "center", justifyContent: "center", flex: "none" }}>
                      <CheckIcon size={12} stroke={2.6} />
                    </span>
                  ) : null}
                  <span>{row.v}</span>
                  {row.chip ? (
                    <span style={{ marginLeft: "auto", flex: "none", fontSize: 11, fontWeight: 600, color: COLORS.accent, background: "rgba(10,132,255,0.1)", padding: "2px 8px", borderRadius: 999 }}>
                      {row.chip}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </Place>

      <Stamp word="meet" tool="meet" hold={22} />
    </>
  );
}

function Source({ label, sub, color, levels }: { label: string; sub: string; color: string; levels: number[] }) {
  return (
    <span
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 999,
        border: `1px solid ${COLORS.line}`,
        background: COLORS.paper,
        fontSize: 12,
        fontWeight: 600,
        color: COLORS.ink,
        whiteSpace: "nowrap",
      }}
    >
      {label} <span style={{ fontWeight: 400, color: COLORS.muted }}>· {sub}</span>
      <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "flex-end", gap: 2, height: 14, color }} aria-hidden>
        {levels.map((h, i) => (
          <span key={i} style={{ width: 3, height: h, borderRadius: 999, background: "currentColor" }} />
        ))}
      </span>
    </span>
  );
}
