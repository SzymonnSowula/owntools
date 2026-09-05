import { AbsoluteFill } from "remotion";
import { alpha } from "../brand";
import { useFloat } from "../motion";
import { DotField, Glows } from "../primitives";
import { BASE_MOTION, FONT_BODY, FONT_DISPLAY, FONT_MONO, type LaunchStyleDef } from "../style";

/**
 * open desk — the shipshape house style: paper, a dotted desk, mac windows and
 * lowercase Outfit. Calm springs, nothing shouts.
 */
export const deskStyle: LaunchStyleDef = {
  id: "desk",
  label: "Open desk",
  desc: "Paper, dot grid, mac windows — the shipshape house style",
  tokens: () => ({
    displayFont: FONT_DISPLAY,
    bodyFont: FONT_BODY,
    monoFont: FONT_MONO,
    displayWeight: 700,
    displayTracking: "-0.045em",
    displayLineHeight: 1.06,
    textCase: "lower",
    kickerFont: "mono",
    kickerTracking: "0.22em",
    radius: 18,
    chrome: "window",
    accentShape: "bar",
    accentWeight: 0.6,
    shadow: "0 24px 60px rgba(10,10,14,0.18)",
    motion: { ...BASE_MOTION, enter: "rise", damping: 200, enterFrames: 26, travel: 44, exitFrames: 12 },
  }),
  Background: ({ brand, layout, beat }) => {
    const drift = useFloat(6, 320);
    const tint =
      beat.kind === "feature" ? brand.tints[(beat.index ?? 0) % brand.tints.length] : brand.accent;
    return (
      <AbsoluteFill style={{ backgroundColor: brand.paper }}>
        <DotField color={brand.dot} layout={layout} />
        <Glows
          glows={[
            { color: tint, x: 50 + drift, y: 108, r: 85, opacity: 0.22 },
            { color: brand.accent, x: 12, y: -8, r: 55, opacity: 0.1 },
          ]}
        />
        <AbsoluteFill
          style={{
            background: `linear-gradient(to bottom, ${alpha(brand.paper, 0.6)} 0%, ${alpha(brand.paper, 0)} 26%)`,
          }}
        />
      </AbsoluteFill>
    );
  },
};
