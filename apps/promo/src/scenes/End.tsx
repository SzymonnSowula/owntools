/**
 * end — 9 beats. The sky goes to day (the backdrop brightens under this
 * scene), the icon rises, the wordmark, "your work. your device.", the
 * price, the site. Navy ink on the icon's own sky.
 */
import { useCurrentFrame, useVideoConfig } from "remotion";
import { BrandMark } from "@ui/BrandMark";
import { ease, ramp, spr } from "../lib/anim";
import { COLORS, FONT_BODY, FONT_DISPLAY } from "../theme";
import { useLayout } from "../ui/layout";
import { DesignLayer } from "../ui/Stage";
import type { SceneProps } from "./index";

const MARK_AT = 0;
const WORD_AT = 10;
const TAG_AT = 34;
const PRICE_AT = 64;
const SITE_AT = 80;

export function End({ priceLine, site }: SceneProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { portrait } = useLayout();
  const W = portrait ? 1080 : 1920;
  const t = frame / fps;

  const mark = spr({ frame, fps, at: MARK_AT, from: 0, to: 1, kind: "glide", durationInFrames: 26 });
  const word = spr({ frame, fps, at: WORD_AT, from: 0, to: 1, kind: "slam", durationInFrames: 16 });
  const tag = ramp(frame, TAG_AT, TAG_AT + 14);
  const price = spr({ frame, fps, at: PRICE_AT, from: 0, to: 1, kind: "pop", durationInFrames: 18 });
  const siteIn = ramp(frame, SITE_AT, SITE_AT + 12);
  const float = Math.sin(t * 1.4) * 6;

  const ys = portrait ? { mark: 560, word: 860, tag: 960, price: 1090, site: 1200 } : { mark: 385, word: 640, tag: 748, price: 866, site: 970 };
  const markSize = portrait ? 300 : 280;

  return (
    <DesignLayer>
      <div
        style={{
          position: "absolute",
          left: W / 2,
          top: ys.mark + float,
          transform: `translate(-50%, -50%) translateY(${(1 - mark) * 160}px) scale(${0.7 + 0.3 * mark})`,
          opacity: mark,
          filter: "drop-shadow(0 30px 60px rgba(11,42,85,0.35))",
          lineHeight: 0,
        }}
      >
        <BrandMark size={markSize} filled />
      </div>
      <div
        style={{
          position: "absolute",
          left: W / 2,
          top: ys.word,
          transform: `translate(-50%, -50%) scale(${1.3 - 0.3 * word})`,
          opacity: word,
          filter: word < 0.9 ? `blur(${(1 - word) * 8}px)` : undefined,
          fontFamily: FONT_DISPLAY,
          fontSize: portrait ? 150 : 168,
          fontWeight: 700,
          letterSpacing: "-0.05em",
          lineHeight: 1,
          color: COLORS.navy,
          whiteSpace: "nowrap",
        }}
      >
        owntools
      </div>
      <div
        style={{
          position: "absolute",
          left: W / 2,
          top: ys.tag,
          transform: `translate(-50%, -50%) translateY(${(1 - ease.outCubic(tag)) * 14}px)`,
          opacity: tag,
          fontFamily: FONT_DISPLAY,
          fontSize: portrait ? 52 : 58,
          fontWeight: 500,
          letterSpacing: "-0.02em",
          color: "rgba(11,42,85,0.82)",
          whiteSpace: "nowrap",
        }}
      >
        your work. your device.
      </div>
      <div
        style={{
          position: "absolute",
          left: W / 2,
          top: ys.price,
          transform: `translate(-50%, -50%) scale(${0.8 + 0.2 * price})`,
          opacity: price,
          display: "inline-flex",
          alignItems: "center",
          gap: 16,
          padding: "16px 34px",
          borderRadius: 999,
          background: "rgba(255,255,255,0.9)",
          boxShadow: "0 20px 50px rgba(11,42,85,0.18)",
          fontFamily: FONT_BODY,
          fontSize: portrait ? 38 : 40,
          fontWeight: 600,
          color: COLORS.navy,
          whiteSpace: "nowrap",
        }}
      >
        {priceLine}
      </div>
      <div
        style={{
          position: "absolute",
          left: W / 2,
          top: ys.site,
          transform: "translate(-50%, -50%)",
          opacity: siteIn,
          fontFamily: FONT_DISPLAY,
          fontSize: portrait ? 56 : 54,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          color: COLORS.navy,
          whiteSpace: "nowrap",
        }}
      >
        {site}
      </div>
    </DesignLayer>
  );
}
