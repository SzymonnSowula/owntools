/**
 * The brand, always on screen and never in the way: the sky icon and the
 * wordmark, small, bottom-left — a creator handle, not a title card. It
 * hides on the end card, where the brand is the picture.
 */
import { BrandMark } from "@ui/BrandMark";
import { FONT_DISPLAY } from "../theme";
import { useLayout } from "./layout";

export function BrandChip({ opacity = 1 }: { opacity?: number }) {
  const { s, h } = useLayout();
  if (opacity <= 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 60 * s,
        top: h - 60 * s - 44 * s,
        display: "flex",
        alignItems: "center",
        gap: 12 * s,
        opacity,
        zIndex: 20,
        transform: `scale(${s})`,
        transformOrigin: "0 100%",
        filter: "drop-shadow(0 6px 16px rgba(4,10,24,0.5))",
      }}
    >
      <BrandMark size={44} filled />
      <span
        style={{
          fontFamily: FONT_DISPLAY,
          fontWeight: 600,
          fontSize: 30,
          letterSpacing: "-0.03em",
          color: "#fff",
          lineHeight: 1,
        }}
      >
        owntools
      </span>
    </div>
  );
}
