/**
 * The dictation pill as the app draws it (DictationPill.tsx, embedded in the
 * bar): the dark surface, the red dot pulsing at 1.1 s, "Listening", the
 * level bar, the language badge and the Done button. App pixels.
 */
import { useCurrentFrame, useVideoConfig } from "remotion";
import { smoothNoise } from "../lib/anim";
import { COLORS, FONT_BODY } from "../theme";
import { RecDot } from "./Window";

export function ListeningPill({
  state = "listening",
  since = 0,
  partial,
  label = "en · live · esc cancels",
}: {
  state?: "listening" | "transcribing" | "done" | "sending";
  since?: number;
  partial?: string;
  label?: string;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = (frame - since) / fps;
  const pulse = 0.5 + 0.5 * Math.sin((t / 1.1) * Math.PI * 2);
  const level = state === "listening" ? 0.25 + 0.7 * smoothNoise(t * 9, 3) * (0.6 + 0.4 * smoothNoise(t * 2.2, 7)) : 0;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: partial ? "10px 18px 11px" : "5px 5px 5px 16px",
        borderRadius: partial ? 18 : 999,
        background: COLORS.surface,
        border: `1px solid ${COLORS.surfaceLine}`,
        color: "#fffdfb",
        fontFamily: FONT_BODY,
        fontSize: 13,
        fontWeight: 600,
        lineHeight: 1.3,
        whiteSpace: "nowrap",
        boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
        width: partial ? 420 : undefined,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <RecDot on={state === "listening"} pulse={state === "listening" ? pulse : 1} />
        {state === "listening" ? (
          <>
            <span>Listening</span>
            <span style={{ width: 54, height: 4, borderRadius: 999, background: "rgba(255,255,255,0.18)", overflow: "hidden" }}>
              <span
                style={{
                  display: "block",
                  height: "100%",
                  width: `${Math.round(level * 100)}%`,
                  background: level > 0.06 ? COLORS.green : COLORS.yellow,
                }}
              />
            </span>
            <span style={{ opacity: 0.55, fontWeight: 500 }}>{label}</span>
            {!partial ? (
              <span
                style={{
                  marginLeft: 6,
                  padding: "0 10px",
                  height: 24,
                  display: "inline-flex",
                  alignItems: "center",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.12)",
                  fontSize: 12,
                }}
              >
                Done
              </span>
            ) : null}
          </>
        ) : state === "transcribing" ? (
          <span style={{ flex: 1, padding: "5px 0" }}>{partial ? "Finishing…" : "Transcribing…"}</span>
        ) : state === "sending" ? (
          <span style={{ flex: 1, padding: "5px 0" }}>“send it” → Enter</span>
        ) : (
          <span style={{ flex: 1, padding: "5px 0" }}>Typed · 0.7 s</span>
        )}
      </div>
      {partial ? (
        <div style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.35, color: "rgba(255,253,251,0.88)", whiteSpace: "normal" }}>
          {partial}
          <span style={{ opacity: 0.5 }}> …</span>
        </div>
      ) : null}
    </div>
  );
}
