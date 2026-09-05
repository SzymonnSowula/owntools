import { AbsoluteFill } from "remotion";
import { alpha } from "../brand";
import { budgetFor, fit } from "../layout";
import { Rail, Reveal, useBeat } from "../motion";
import { GridLines } from "../primitives";
import { DisplayText, Stage } from "../scenes";
import { BASE_MOTION, FONT_BODY, FONT_DISPLAY, FONT_MONO, cased, type LaunchStyleDef, type SceneComponent } from "../style";

/**
 * editorial — a magazine spread: warm paper, a visible column grid, hairlines,
 * wide-tracked small caps and copy that sits left on the page. Slow, confident,
 * nothing bounces.
 */

const EditorialFeature: SceneComponent = ({ input, brand, tokens, layout, beat, frames }) => {
  const text = cased(beat.text ?? "", tokens);
  const index = beat.index ?? 0;
  const count = beat.count ?? 1;
  const head = useBeat(frames, 0, tokens, layout, { travel: 22 });
  const size = fit(text, layout.headline * 1.05, layout.headline * 0.42, budgetFor(layout, 2));
  return (
    <Stage layout={layout} align="flex-start" gap={layout.gap * 1.6}>
      <div
        style={{
          ...head.style,
          display: "flex",
          alignItems: "baseline",
          gap: layout.px(28),
          width: layout.contentW,
          borderTop: `${Math.max(1, layout.px(2))}px solid ${brand.ink}`,
          paddingTop: layout.px(24),
        }}
      >
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: layout.kicker,
            letterSpacing: "0.28em",
            textTransform: "uppercase",
            color: brand.muted,
          }}
        >
          {String(index + 1).padStart(2, "0")} — {String(count).padStart(2, "0")}
        </div>
        <div style={{ flex: 1 }} />
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: layout.kicker,
            letterSpacing: "0.28em",
            textTransform: "uppercase",
            color: brand.accent,
          }}
        >
          {cased(input.name, tokens)}
        </div>
      </div>
      <Reveal tokens={tokens} frames={frames} delay={6}>
        <DisplayText size={size} tokens={tokens} color={brand.ink} layout={layout}>
          {text}
        </DisplayText>
      </Reveal>
      <Rail
        frames={frames}
        color={brand.accent}
        track={alpha(brand.ink, 0.1)}
        height={layout.px(3)}
        width={layout.contentW}
        radius={0}
      />
    </Stage>
  );
};

export const editorialStyle: LaunchStyleDef = {
  id: "editorial",
  label: "Editorial",
  desc: "Magazine grid, hairlines, small caps — slow and confident",
  brand: (b) => ({
    ...b,
    paper: b.theme === "night" ? "#111110" : "#f7f5f0",
    card: b.theme === "night" ? "#191917" : "#fffefb",
    ink: b.theme === "night" ? "#f5f2ea" : "#17150f",
    muted: b.theme === "night" ? "rgba(245,242,234,0.5)" : "rgba(23,21,15,0.5)",
    line: b.theme === "night" ? "rgba(245,242,234,0.16)" : "rgba(23,21,15,0.16)",
  }),
  tokens: () => ({
    displayFont: FONT_DISPLAY,
    bodyFont: FONT_BODY,
    monoFont: FONT_MONO,
    displayWeight: 500,
    displayTracking: "-0.03em",
    displayLineHeight: 1.1,
    textCase: "none",
    kickerFont: "mono",
    kickerTracking: "0.28em",
    radius: 2,
    chrome: "rule",
    accentShape: "underline",
    accentWeight: 0.4,
    shadow: "0 18px 44px rgba(23,21,15,0.10)",
    motion: { ...BASE_MOTION, enter: "rise", damping: 260, enterFrames: 34, travel: 26, stagger: 4, exitFrames: 16 },
  }),
  Background: ({ brand, layout }) => (
    <AbsoluteFill style={{ backgroundColor: brand.paper }}>
      <GridLines color={alpha(brand.ink, 0.06)} cells={layout.portrait ? 4 : 8} layout={layout} />
      <AbsoluteFill
        style={{
          borderTop: `${Math.max(1, layout.px(1))}px solid ${alpha(brand.ink, 0.1)}`,
          borderBottom: `${Math.max(1, layout.px(1))}px solid ${alpha(brand.ink, 0.1)}`,
          margin: `${layout.pad * 0.42}px 0`,
        }}
      />
    </AbsoluteFill>
  ),
  scenes: { feature: EditorialFeature },
};
