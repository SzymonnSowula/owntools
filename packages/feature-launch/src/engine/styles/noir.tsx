import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { alpha, mix } from "../brand";
import { budgetFor, fit } from "../layout";
import { Reveal, useBeat, useProgress } from "../motion";
import { Glows, Kicker } from "../primitives";
import { DisplayText, Stage } from "../scenes";
import { BASE_MOTION, FONT_BODY, FONT_DISPLAY, FONT_MONO, cased, type LaunchStyleDef, type SceneComponent } from "../style";

/**
 * keynote noir — a black stage, one idea at a time, type doing all the work.
 * Everything reveals from behind its own baseline; the only color is a light
 * bar that sweeps the frame on the name.
 */

const NoirHook: SceneComponent = ({ input, brand, tokens, layout, frames }) => {
  const frame = useCurrentFrame();
  const name = cased(input.name.trim() || "your product", tokens);
  const size = fit(name, layout.display * 1.28, layout.display * 0.55, budgetFor(layout, 1));
  const kicker = useBeat(frames, 0, tokens, layout, { travel: 18 });
  const sweep = interpolate(frame, [10, 34], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const hold = useProgress(frames);
  return (
    <Stage layout={layout} gap={layout.gap * 1.4}>
      <div style={kicker.style}>
        <Kicker brand={brand} tokens={tokens} layout={layout} color={alpha(brand.ink, 0.5)}>
          introducing
        </Kicker>
      </div>
      <div style={{ position: "relative" }}>
        <Reveal tokens={tokens} frames={frames} delay={6} style={{ textAlign: "center" }}>
          <DisplayText
            size={size}
            tokens={tokens}
            color={brand.ink}
            layout={layout}
            style={{ textAlign: "center" }}
          >
            {name}
          </DisplayText>
        </Reveal>
        <div
          style={{
            position: "absolute",
            left: 0,
            bottom: layout.px(-22),
            width: `${sweep * 100}%`,
            height: layout.px(6),
            backgroundColor: brand.accent,
          }}
        />
      </div>
      <div
        style={{
          marginTop: layout.px(34),
          fontFamily: FONT_MONO,
          fontSize: layout.kicker,
          letterSpacing: "0.3em",
          textTransform: "uppercase",
          color: alpha(brand.ink, 0.28 + 0.3 * hold),
        }}
      >
        {new Date().getFullYear()}
      </div>
    </Stage>
  );
};

export const noirStyle: LaunchStyleDef = {
  id: "noir",
  label: "Keynote noir",
  desc: "Black stage, oversized type, one idea per cut",
  forceTheme: "night",
  brand: (b) => ({
    ...b,
    paper: "#07070a",
    card: "#101014",
    ink: "#fbfbfd",
    muted: "rgba(251,251,253,0.52)",
    line: "rgba(255,255,255,0.14)",
    dot: "rgba(255,255,255,0.05)",
    accent: mix(b.accent, "#ffffff", 0.12),
  }),
  tokens: () => ({
    displayFont: FONT_DISPLAY,
    bodyFont: FONT_BODY,
    monoFont: FONT_MONO,
    displayWeight: 700,
    displayTracking: "-0.055em",
    displayLineHeight: 1.02,
    textCase: "lower",
    kickerFont: "mono",
    kickerTracking: "0.3em",
    radius: 14,
    chrome: "none",
    accentShape: "underline",
    accentWeight: 0.35,
    shadow: "0 40px 90px rgba(0,0,0,0.55)",
    motion: { ...BASE_MOTION, enter: "wipe", damping: 220, enterFrames: 30, travel: 26, stagger: 4, exitFrames: 10 },
  }),
  Background: ({ brand, beat, beatProgress }) => (
    <AbsoluteFill style={{ backgroundColor: brand.paper }}>
      <Glows
        glows={[
          {
            color: brand.accent,
            x: 50,
            y: beat.kind === "outro" ? 60 : 118 - beatProgress * 10,
            r: 78,
            opacity: 0.2,
          },
        ]}
      />
      <AbsoluteFill
        style={{
          background: `linear-gradient(to bottom, ${alpha("#000000", 0.55)} 0%, ${alpha("#000000", 0)} 40%)`,
        }}
      />
    </AbsoluteFill>
  ),
  scenes: { hook: NoirHook },
};
