/**
 * quick tools — 4 beats. The twelve small jobs, as the hub shows them:
 * window cards cascading in, one per job, none of them a website.
 * Mirrors packages/feature-tools/src/catalogue.tsx.
 */
import type { ReactElement } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { ToolIcons, WinDots } from "@ui/WinDots";
import { ease, ramp, spr } from "../lib/anim";
import { COLORS, FONT_BODY, FONT_DISPLAY } from "../theme";
import { useLayout } from "../ui/layout";
import { DesignLayer, Place } from "../ui/Stage";
import type { SceneProps } from "./index";

const g = (d: string) => (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d={d} />
  </svg>
);

const TOOLS: Array<{ window: string; name: string; desc: string; dots: ReactElement }> = [
  { window: "transcribe.tool", name: "Transcribe a file", desc: "audio or video → text & .srt", dots: g("M2 3h8M2 6h8M2 9h5") },
  { window: "translate.tool", name: "Translate to English", desc: "any speech → English text", dots: g("M2 6h8M6 2c-2 2.5-2 5.5 0 8M6 2c2 2.5 2 5.5 0 8M6 1.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9") },
  { window: "youtube.tool", name: "YouTube → transcript", desc: "paste a link, get the words", dots: g("M1.5 3.2h9v5.6h-9zM5 4.6v2.8L7.6 6z") },
  { window: "subtitles.tool", name: "Convert subtitles", desc: ".srt ↔ .vtt ↔ text, shift timing", dots: g("M1.5 2.5h9v7h-9zM3 7.2h3M7.2 7.2h1.8M3 5h1.4M5.6 5h3.4") },
  { window: "voicenote.tool", name: "Voice note", desc: "speak, get a note in focus", dots: ToolIcons.dictate },
  { window: "pdf.tool", name: "PDF → text / Word", desc: "out as .txt, .md, .docx or images", dots: g("M3 1.6h4l2.4 2.4v6.4H3zM4.4 6h3.2M4.4 8h3.2") },
  { window: "makepdf.tool", name: "Images → PDF", desc: "photos and scans into one file", dots: g("M1.5 2.5h6v7h-6zM4.5 2.5V1h6v7H9M3 7.5l1.4-1.6 1.2 1.2 1.4-1.8") },
  { window: "images.tool", name: "Convert images", desc: "PNG / JPG / WebP, resize & shrink", dots: g("M1.5 2.5h9v7h-9zM3 8l2-2.4 1.6 1.6 1.4-1.8L10.5 8M8 4.4h.01") },
  { window: "extract.tool", name: "Video → audio", desc: "keep the track, leave the video", dots: g("M1.5 3h6v6h-6zM7.5 5l3-1.6v5.2L7.5 7") },
  { window: "audio.tool", name: "Convert audio", desc: "MP3, M4A, WAV, OGG or FLAC", dots: g("M1.8 5v2M4 3.4v5.2M6.2 1.8v8.4M8.4 3.4v5.2M10.6 5v2") },
  { window: "video.tool", name: "Convert video", desc: "MP4 / WebM / MOV, resize, trim", dots: ToolIcons.video },
  { window: "gif.tool", name: "Video → GIF", desc: "a looping clip for a README", dots: g("M2 6a4 4 0 0 1 7.2-2.4M10 6a4 4 0 0 1-7.2 2.4M9.2 1.6v2h-2M2.8 10.4v-2h2") },
];

export function Quick(_: SceneProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { portrait } = useLayout();
  const W = portrait ? 1080 : 1920;
  const cols = portrait ? 3 : 4;
  const cardW = 250;
  const gap = 14;
  const headPop = spr({ frame, fps, at: 0, from: 0, to: 1, kind: "slam", durationInFrames: 14 });
  const subIn = ramp(frame, 6, 14);

  return (
    <>
      <DesignLayer>
        <div style={{ position: "absolute", left: W / 2, top: portrait ? 300 : 150, transform: `translate(-50%, -50%) scale(${1.25 - 0.25 * headPop})`, opacity: headPop, textAlign: "center", color: "#fff", whiteSpace: "nowrap" }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: portrait ? 84 : 104, fontWeight: 700, letterSpacing: "-0.045em", lineHeight: 1, textShadow: "0 8px 40px rgba(4,10,24,0.5)" }}>+ twelve quick tools</div>
          <div style={{ marginTop: 14, fontFamily: FONT_BODY, fontSize: 30, fontWeight: 500, color: "rgba(255,255,255,0.75)", opacity: subIn, transform: `translateY(${(1 - ease.outCubic(subIn)) * 10}px)` }}>
            convert and transcribe on your device · nothing uploaded
          </div>
        </div>
      </DesignLayer>

      <Place x={W / 2} y={portrait ? 1090 : 640} at={0}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, ${cardW}px)`, gap, fontFamily: FONT_BODY }}>
          {TOOLS.map((t, i) => {
            const at = 8 + i * 4;
            const p = spr({ frame, fps, at, from: 0, to: 1, kind: "pop", durationInFrames: 18 });
            const tilt = ((i * 7) % 5) - 2;
            return (
              <div
                key={t.window}
                style={{
                  width: cardW,
                  borderRadius: 14,
                  background: COLORS.card,
                  border: "1px solid #e5e5e5",
                  boxShadow: "0 18px 44px rgba(4,10,24,0.35)",
                  overflow: "hidden",
                  transform: `translateY(${(1 - p) * 40}px) scale(${0.8 + 0.2 * p}) rotate(${tilt * 0.35}deg)`,
                  opacity: frame < at ? 0 : Math.min(1, p * 1.5),
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderBottom: "1px solid #e5e5e5", background: "#fbfbfc" }}>
                  <WinDots icon={t.dots} />
                  <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 600, color: COLORS.muted }}>{t.window}</span>
                </div>
                <div style={{ padding: "10px 12px 12px" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: COLORS.ink, letterSpacing: "-0.01em" }}>{t.name}</div>
                  <div style={{ marginTop: 3, fontSize: 11, color: COLORS.muted, lineHeight: 1.35 }}>{t.desc}</div>
                </div>
              </div>
            );
          })}
        </div>
      </Place>
    </>
  );
}
