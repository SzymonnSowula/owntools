import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { alpha } from "../brand";
import { budgetFor, fit } from "../layout";
import { Words, useBeat } from "../motion";
import { Kicker } from "../primitives";
import { Stage, hostOf } from "../scenes";
import { BASE_MOTION, FONT_BODY, FONT_DISPLAY, FONT_MONO, cased, type LaunchStyleDef, type SceneComponent } from "../style";

/**
 * poster — kinetic type on flat colour. Hard cuts (no cross-fades), words that
 * slam in, and big accent blocks that slide across the frame between beats.
 * The loudest pack: good for social, wrong for enterprise.
 */

const PosterHook: SceneComponent = ({ input, brand, tokens, layout, frames }) => {
  const frame = useCurrentFrame();
  const name = cased(input.name.trim() || "your product", tokens);
  const size = fit(name, layout.display * 1.3, layout.display * 0.5, budgetFor(layout, 1));
  const block = interpolate(frame, [0, 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const kicker = useBeat(frames, 14, tokens, layout, { travel: 18 });
  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          backgroundColor: brand.accent,
          transform: `translateY(${(1 - block) * 100}%)`,
        }}
      />
      <Stage layout={layout} gap={layout.gap}>
        <Words
          text={name}
          tokens={tokens}
          layout={layout}
          frames={frames}
          delay={12}
          baseColor={brand.onAccent}
          style={{
            fontFamily: tokens.displayFont,
            fontWeight: tokens.displayWeight,
            fontSize: size,
            letterSpacing: tokens.displayTracking,
            lineHeight: 0.95,
            textAlign: "center",
            maxWidth: layout.contentW,
          }}
        />
        <div style={kicker.style}>
          <Kicker brand={brand} tokens={tokens} layout={layout} color={alpha(brand.onAccent, 0.75)}>
            {hostOf(input.url) || "out now"}
          </Kicker>
        </div>
      </Stage>
    </AbsoluteFill>
  );
};

const PosterStatement: SceneComponent = ({ input, brand, tokens, layout, beat, frames }) => {
  const text = cased(beat.text ?? input.tagline, tokens);
  const size = fit(text, layout.headline * 1.3, layout.headline * 0.5, budgetFor(layout, 2));
  return (
    <Stage layout={layout} align="flex-start" gap={layout.gap * 1.2}>
      <Words
        text={text}
        tokens={tokens}
        layout={layout}
        frames={frames}
        delay={2}
        emphasis={2}
        emphasisColor={brand.accent}
        baseColor={brand.ink}
        style={{
          fontFamily: tokens.displayFont,
          fontWeight: tokens.displayWeight,
          fontSize: size,
          letterSpacing: tokens.displayTracking,
          lineHeight: 0.98,
          maxWidth: layout.contentW,
        }}
      />
    </Stage>
  );
};

export const posterStyle: LaunchStyleDef = {
  id: "poster",
  label: "Poster",
  desc: "Flat colour blocks, kinetic caps, hard cuts — built for social",
  brand: (b) => ({
    ...b,
    paper: b.theme === "night" ? "#0d0d10" : "#f2f0ec",
    card: b.theme === "night" ? "#17171c" : "#ffffff",
    line: b.theme === "night" ? "rgba(255,255,255,0.14)" : "rgba(13,13,16,0.14)",
  }),
  tokens: () => ({
    displayFont: FONT_DISPLAY,
    bodyFont: FONT_BODY,
    monoFont: FONT_MONO,
    displayWeight: 800,
    displayTracking: "-0.05em",
    displayLineHeight: 0.98,
    textCase: "upper",
    kickerFont: "body",
    kickerTracking: "0.24em",
    radius: 0,
    chrome: "block",
    accentShape: "block",
    accentWeight: 1,
    shadow: "0 20px 50px rgba(13,13,16,0.24)",
    // Hard cuts: no exit fade, everything slams in on the beat.
    motion: { ...BASE_MOTION, enter: "slam", damping: 140, enterFrames: 18, travel: 30, stagger: 2, exitFrames: 0 },
  }),
  Background: ({ brand, layout, beat, beatProgress }) => {
    const slide = interpolate(beatProgress, [0, 0.35], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const tint =
      beat.kind === "feature" ? brand.tints[(beat.index ?? 0) % brand.tints.length] : brand.accent;
    const corner = beat.variant % 2 === 0;
    return (
      <AbsoluteFill style={{ backgroundColor: brand.paper }}>
        {/* A slab of colour anchored to one edge — never behind the copy. */}
        <div
          style={{
            position: "absolute",
            top: 0,
            right: corner ? 0 : undefined,
            left: corner ? undefined : 0,
            width: layout.w * 0.28,
            height: layout.h,
            backgroundColor: alpha(tint, 0.16),
            transform: `translateX(${(1 - slide) * (corner ? 100 : -100)}%)`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            bottom: 0,
            width: layout.w,
            height: layout.px(22),
            backgroundColor: tint,
            transform: `scaleX(${slide})`,
            transformOrigin: corner ? "left center" : "right center",
          }}
        />
      </AbsoluteFill>
    );
  },
  scenes: { hook: PosterHook, statement: PosterStatement },
};
