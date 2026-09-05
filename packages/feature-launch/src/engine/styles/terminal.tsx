import React from "react";
import { AbsoluteFill } from "remotion";
import { alpha } from "../brand";
import { budgetFor, fit } from "../layout";
import { Typed, useBeat, useProgress } from "../motion";
import { Chrome, Glows, Scanlines } from "../primitives";
import { Stage, hostOf } from "../scenes";
import { BASE_MOTION, FONT_MONO, cased, type LaunchStyleDef, type SceneComponent } from "../style";

/**
 * terminal — for developer tools. Everything happens inside one shell window:
 * the name is typed at a prompt, features scroll in as command output. Fixed to
 * the night theme, because a light terminal is a lie.
 */

const Prompt: React.FC<{
  color: string;
  size: number;
  children: React.ReactNode;
}> = ({ color, size, children }) => (
  <div style={{ display: "flex", gap: "0.5em", fontFamily: FONT_MONO, fontSize: size, color }}>
    <span style={{ opacity: 0.6 }}>$</span>
    <span>{children}</span>
  </div>
);

const TerminalHook: SceneComponent = ({ input, brand, tokens, layout, frames }) => {
  const name = input.name.trim() || "your product";
  const card = useBeat(frames, 0, tokens, layout, { travel: 40 });
  const size = fit(name, layout.display * 0.9, layout.display * 0.42, budgetFor(layout, 1));
  return (
    <Stage layout={layout}>
      <div style={{ ...card.style, width: layout.cardW }}>
        <Chrome
          brand={brand}
          tokens={tokens}
          layout={layout}
          title={`~/${name.toLowerCase().replace(/\s+/g, "-")}`}
          style={{ width: "100%" }}
          bodyStyle={{
            padding: `${layout.px(56)}px ${layout.px(52)}px ${layout.px(64)}px`,
            display: "flex",
            flexDirection: "column",
            gap: layout.gap * 1.4,
          }}
        >
          <Prompt color={alpha(brand.ink, 0.7)} size={layout.px(30)}>
            <Typed text={`npx ${name.toLowerCase().replace(/\s+/g, "-")}`} caretColor={brand.accent} cps={22} />
          </Prompt>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: size,
              fontWeight: 700,
              color: brand.accent,
              letterSpacing: "-0.03em",
              lineHeight: 1.05,
            }}
          >
            <Typed text={cased(name, tokens)} delay={26} cps={13} caretColor={brand.accent} />
          </div>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: layout.px(28),
              color: alpha(brand.ink, 0.55),
            }}
          >
            <Typed
              text={`→ ${hostOf(input.url) || "ready when you are"}`}
              delay={52}
              cps={30}
              caret={false}
              caretColor={brand.accent}
            />
          </div>
        </Chrome>
      </div>
    </Stage>
  );
};

const TerminalFeature: SceneComponent = ({ input, brand, tokens, layout, beat, frames }) => {
  const text = beat.text ?? "";
  const index = beat.index ?? 0;
  const count = beat.count ?? 1;
  const card = useBeat(frames, 0, tokens, layout, { travel: 34 });
  const progress = useProgress(frames);
  const size = fit(text, layout.headline * 0.78, layout.headline * 0.34, budgetFor(layout, 2));
  const tint = brand.tints[index % brand.tints.length];
  return (
    <Stage layout={layout}>
      <div style={{ ...card.style, width: layout.cardW }}>
        <Chrome
          brand={brand}
          tokens={tokens}
          layout={layout}
          title={`${input.name.toLowerCase()} --features`}
          tint={tint}
          style={{ width: "100%" }}
          bodyStyle={{
            padding: `${layout.px(52)}px ${layout.px(52)}px ${layout.px(58)}px`,
            display: "flex",
            flexDirection: "column",
            gap: layout.gap * 1.2,
          }}
        >
          <Prompt color={alpha(brand.ink, 0.55)} size={layout.px(26)}>
            feature[{index + 1}/{count}]
          </Prompt>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: size,
              fontWeight: 600,
              color: brand.ink,
              lineHeight: 1.2,
              letterSpacing: "-0.02em",
            }}
          >
            <Typed text={text} delay={8} cps={30} caretColor={tint} />
          </div>
          <div
            style={{
              height: layout.px(4),
              width: "100%",
              backgroundColor: alpha(brand.ink, 0.1),
              overflow: "hidden",
            }}
          >
            <div style={{ width: `${progress * 100}%`, height: "100%", backgroundColor: tint }} />
          </div>
        </Chrome>
      </div>
    </Stage>
  );
};

export const terminalStyle: LaunchStyleDef = {
  id: "terminal",
  label: "Terminal",
  desc: "Typed at a prompt — for dev tools and CLIs",
  forceTheme: "night",
  brand: (b) => ({
    ...b,
    paper: "#06070a",
    card: "#0c0e13",
    ink: "#e6f1e8",
    muted: "rgba(230,241,232,0.5)",
    line: "rgba(230,241,232,0.14)",
    dot: "rgba(230,241,232,0.05)",
  }),
  tokens: () => ({
    displayFont: FONT_MONO,
    bodyFont: FONT_MONO,
    monoFont: FONT_MONO,
    displayWeight: 600,
    displayTracking: "-0.02em",
    displayLineHeight: 1.16,
    textCase: "lower",
    kickerFont: "mono",
    kickerTracking: "0.2em",
    radius: 10,
    chrome: "terminal",
    accentShape: "caret",
    accentWeight: 0.5,
    shadow: "0 30px 80px rgba(0,0,0,0.6)",
    motion: { ...BASE_MOTION, enter: "type", damping: 240, enterFrames: 20, travel: 18, stagger: 2, exitFrames: 8 },
  }),
  Background: ({ brand, layout }) => (
    <AbsoluteFill style={{ backgroundColor: brand.paper }}>
      <Glows glows={[{ color: brand.accent, x: 50, y: 112, r: 70, opacity: 0.16 }]} />
      <Scanlines color={alpha(brand.ink, 0.022)} layout={layout} gap={5} />
    </AbsoluteFill>
  ),
  scenes: { hook: TerminalHook, feature: TerminalFeature },
};
