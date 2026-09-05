import { AbsoluteFill } from "remotion";
import { alpha, mix } from "../brand";
import { useFloat } from "../motion";
import { Glows } from "../primitives";
import { BASE_MOTION, FONT_BODY, FONT_DISPLAY, FONT_MONO, type LaunchStyleDef } from "../style";

/**
 * aurora — soft light: three tinted washes drifting behind glass panels.
 * The friendliest pack, and the one that flatters a screenshot most, because
 * the product shot sits on colour rather than on a grid.
 */
export const auroraStyle: LaunchStyleDef = {
  id: "aurora",
  label: "Aurora",
  desc: "Drifting colour washes and glass panels — soft and friendly",
  brand: (b) => ({
    ...b,
    paper: b.theme === "night" ? "#0b0a12" : "#f4f2fb",
    card: b.theme === "night" ? "#15141f" : "#ffffff",
    line: b.theme === "night" ? "rgba(255,255,255,0.12)" : "rgba(29,29,31,0.09)",
  }),
  tokens: () => ({
    displayFont: FONT_DISPLAY,
    bodyFont: FONT_BODY,
    monoFont: FONT_MONO,
    displayWeight: 600,
    displayTracking: "-0.04em",
    displayLineHeight: 1.1,
    textCase: "lower",
    kickerFont: "body",
    kickerTracking: "0.16em",
    radius: 28,
    chrome: "glass",
    accentShape: "dot",
    accentWeight: 0.5,
    shadow: "0 34px 90px rgba(30,20,80,0.20)",
    motion: { ...BASE_MOTION, enter: "drift", damping: 190, enterFrames: 32, travel: 52, stagger: 4, exitFrames: 16, float: 8 },
  }),
  Background: ({ brand, beat, beatProgress }) => {
    const a = useFloat(9, 260);
    const b = useFloat(7, 340, Math.PI / 2);
    const c = useFloat(6, 420, Math.PI);
    const tint =
      beat.kind === "feature" ? brand.tints[(beat.index ?? 0) % brand.tints.length] : brand.accent;
    return (
      <AbsoluteFill style={{ backgroundColor: brand.paper }}>
        <Glows
          glows={[
            { color: tint, x: 22 + a, y: 26 + b * 0.6, r: 62, opacity: 0.42 },
            { color: brand.tints[1], x: 80 + b, y: 72 + c * 0.4, r: 58, opacity: 0.34 },
            { color: brand.tints[2], x: 52 + c, y: 108 - beatProgress * 6, r: 70, opacity: 0.3 },
          ]}
        />
        <AbsoluteFill
          style={{
            background: `linear-gradient(to bottom, ${alpha(
              mix(brand.paper, brand.accent, 0.06),
              0.55,
            )} 0%, ${alpha(brand.paper, 0)} 55%)`,
          }}
        />
      </AbsoluteFill>
    );
  },
};
