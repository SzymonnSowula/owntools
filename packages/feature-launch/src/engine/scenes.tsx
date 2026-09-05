import React from "react";
import { AbsoluteFill, Img } from "remotion";
import { alpha } from "./brand";
import { budgetFor, fit, type Layout } from "./layout";
import { Rail, Reveal, Words, useBeat, useFloat, useKenBurns, useProgress } from "./motion";
import { AccentMark, Chrome, DeviceFrame, Kicker, Sticker, type DeviceKind } from "./primitives";
import {
  FONT_BODY,
  FONT_DISPLAY,
  FONT_MONO,
  cased,
  chromeAccent,
  chromeInk,
  chromeMuted,
  type SceneComponent,
  type SceneProps,
} from "./style";
import type { BeatKind } from "./types";

/**
 * The scene layer: one implementation per beat, written against style tokens
 * and the layout box rather than against pixels. Each beat carries a `variant`
 * from the take, which picks between genuinely different compositions — that,
 * plus the pack's chrome and motion, is where the "not the same video twice"
 * comes from. Style packs override a beat only when it is their signature.
 */

/* -------------------------------- helpers -------------------------------- */

function hostOf(url: string): string {
  return url.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

function fileTitle(name: string, ext: string): string {
  const slug = (name || "launch").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug || "launch"}.${ext}`;
}

/** Centered stack with the layout's safe padding. */
const Stage: React.FC<{
  layout: Layout;
  align?: "center" | "flex-start";
  justify?: "center" | "flex-end" | "space-between";
  gap?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ layout, align = "center", justify = "center", gap, children, style }) => (
  <AbsoluteFill
    style={{
      justifyContent: justify,
      alignItems: align,
      flexDirection: "column",
      padding: `${layout.pad * 0.7}px ${layout.pad}px`,
      gap: gap ?? layout.gap * 1.6,
      textAlign: align === "center" ? "center" : "left",
      ...style,
    }}
  >
    {children}
  </AbsoluteFill>
);

const DisplayText: React.FC<{
  children: React.ReactNode;
  size: number;
  tokens: SceneProps["tokens"];
  color: string;
  layout: Layout;
  style?: React.CSSProperties;
}> = ({ children, size, tokens, color, layout, style }) => (
  <div
    style={{
      fontFamily: tokens.displayFont,
      fontWeight: tokens.displayWeight,
      fontSize: size,
      letterSpacing: tokens.displayTracking,
      lineHeight: tokens.displayLineHeight,
      color,
      maxWidth: layout.contentW,
      ...style,
    }}
  >
    {children}
  </div>
);

const LogoBadge: React.FC<SceneProps & { size?: number }> = ({ input, brand, tokens, layout, size = 108 }) => {
  if (!input.logoDataUrl) return null;
  const box = layout.px(size);
  return (
    <div
      style={{
        width: box,
        height: box,
        borderRadius: layout.px(tokens.radius * 1.5),
        backgroundColor: brand.card,
        border: `${Math.max(1, layout.px(1.5))}px solid ${brand.line}`,
        boxShadow: tokens.shadow,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <Img
        src={input.logoDataUrl}
        style={{ width: box * 0.62, height: box * 0.62, objectFit: "contain" }}
      />
    </div>
  );
};

/* --------------------------------- hook ---------------------------------- */

const HookScene: SceneComponent = (props) => {
  const { input, brand, tokens, layout, beat, frames } = props;
  const name = cased(input.name.trim() || "your product", tokens);
  const size = fit(name, layout.display * 1.16, layout.display * 0.5, budgetFor(layout, 1));
  const kicker = useBeat(frames, 2, tokens, layout);
  const mark = useBeat(frames, 22, tokens, layout, { travel: 12 });
  const badge = useBeat(frames, 0, tokens, layout);
  const card = useBeat(frames, 0, tokens, layout, { travel: 60 });

  if (beat.variant === 1) {
    // Left-aligned title card — the "poster" reading of a name reveal.
    return (
      <Stage layout={layout} align="flex-start" justify="center" gap={layout.gap * 1.2}>
        <div style={{ ...badge.style }}>
          <LogoBadge {...props} size={92} />
        </div>
        <div style={kicker.style}>
          <Kicker brand={brand} tokens={tokens} layout={layout} color={brand.accent}>
            introducing
          </Kicker>
        </div>
        <Reveal tokens={tokens} frames={frames} delay={6}>
          <DisplayText size={size} tokens={tokens} color={brand.ink} layout={layout}>
            {name}
          </DisplayText>
        </Reveal>
        <div style={{ opacity: mark.opacity }}>
          <AccentMark brand={brand} tokens={tokens} layout={layout} progress={mark.p} width={260} />
        </div>
      </Stage>
    );
  }

  if (beat.variant === 2) {
    // The name arrives inside the pack's chrome, like a document being opened.
    return (
      <Stage layout={layout}>
        <div style={{ ...card.style, width: layout.cardW }}>
          <Chrome
            brand={brand}
            tokens={tokens}
            layout={layout}
            title={fileTitle(input.name, "txt")}
            style={{ width: "100%" }}
            bodyStyle={{
              padding: `${layout.px(76)}px ${layout.px(70)}px`,
              display: "flex",
              flexDirection: "column",
              gap: layout.gap * 1.4,
              alignItems: layout.portrait ? "flex-start" : "center",
            }}
          >
            <Kicker brand={brand} tokens={tokens} layout={layout} color={chromeMuted(brand, tokens)}>
              introducing
            </Kicker>
            <Reveal tokens={tokens} frames={frames} delay={8}>
              <DisplayText
                size={size * 0.82}
                tokens={tokens}
                color={chromeInk(brand, tokens)}
                layout={layout}
                style={{ textAlign: layout.portrait ? "left" : "center" }}
              >
                {name}
              </DisplayText>
            </Reveal>
            <div style={{ opacity: mark.opacity }}>
              <AccentMark
                brand={brand}
                tokens={tokens}
                layout={layout}
                progress={mark.p}
                width={180}
                color={chromeAccent(brand, tokens, brand.accent)}
              />
            </div>
          </Chrome>
        </div>
      </Stage>
    );
  }

  return (
    <Stage layout={layout} gap={layout.gap * 1.9}>
      <div style={badge.style}>
        <LogoBadge {...props} />
      </div>
      <div style={kicker.style}>
        <Kicker brand={brand} tokens={tokens} layout={layout}>
          introducing
        </Kicker>
      </div>
      <Reveal tokens={tokens} frames={frames} delay={8} style={{ textAlign: "center" }}>
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
      <div style={{ opacity: mark.opacity }}>
        <AccentMark brand={brand} tokens={tokens} layout={layout} progress={mark.p} />
      </div>
    </Stage>
  );
};

/* -------------------------------- tagline -------------------------------- */

const TaglineScene: SceneComponent = ({ input, brand, tokens, layout, beat, frames }) => {
  const text = cased(beat.text ?? input.tagline, tokens);
  const size = fit(text, layout.headline * 1.15, layout.headline * 0.45, budgetFor(layout, 2));
  const kicker = useBeat(frames, 0, tokens, layout, { travel: 20 });
  const progress = useProgress(frames);
  const card = useBeat(frames, 0, tokens, layout, { travel: 50 });

  if (beat.variant === 1) {
    return (
      <Stage layout={layout} align="flex-start" gap={layout.gap * 1.4}>
        <div style={{ display: "flex", alignItems: "center", gap: layout.px(20), ...kicker.style }}>
          <AccentMark brand={brand} tokens={tokens} layout={layout} progress={1} width={70} />
          <Kicker brand={brand} tokens={tokens} layout={layout}>
            {cased(input.name, tokens)}
          </Kicker>
        </div>
        <Words
          text={text}
          tokens={tokens}
          layout={layout}
          frames={frames}
          delay={5}
          emphasis={2}
          emphasisColor={brand.accent}
          baseColor={brand.ink}
          style={{
            fontFamily: tokens.displayFont,
            fontWeight: tokens.displayWeight,
            fontSize: size,
            letterSpacing: tokens.displayTracking,
            lineHeight: tokens.displayLineHeight,
            maxWidth: layout.contentW,
          }}
        />
      </Stage>
    );
  }

  if (beat.variant === 2) {
    return (
      <Stage layout={layout}>
        <div style={{ ...card.style, width: layout.cardW }}>
          <Chrome
            brand={brand}
            tokens={tokens}
            layout={layout}
            title={hostOf(input.url) || fileTitle(input.name, "md")}
            style={{ width: "100%" }}
            bodyStyle={{ padding: `${layout.px(70)}px ${layout.px(64)}px`, display: "flex", flexDirection: "column", gap: layout.gap * 1.5 }}
          >
            <Kicker
              brand={brand}
              tokens={tokens}
              layout={layout}
              color={chromeAccent(brand, tokens, brand.accent)}
            >
              {cased(input.name, tokens)}
            </Kicker>
            <Words
              text={text}
              tokens={tokens}
              layout={layout}
              frames={frames}
              delay={8}
              baseColor={chromeInk(brand, tokens)}
              style={{
                fontFamily: tokens.displayFont,
                fontWeight: tokens.displayWeight,
                fontSize: size * 0.82,
                letterSpacing: tokens.displayTracking,
                lineHeight: tokens.displayLineHeight,
              }}
            />
            <Rail
              frames={frames}
              color={chromeAccent(brand, tokens, brand.accent)}
              track={brand.line}
              height={layout.px(6)}
              width={layout.px(240)}
            />
          </Chrome>
        </div>
      </Stage>
    );
  }

  return (
    <Stage layout={layout} gap={layout.gap * 2}>
      <div style={kicker.style}>
        <Kicker brand={brand} tokens={tokens} layout={layout} color={brand.accent}>
          {cased(input.name, tokens)}
        </Kicker>
      </div>
      <Words
        text={text}
        tokens={tokens}
        layout={layout}
        frames={frames}
        delay={6}
        baseColor={brand.ink}
        style={{
          fontFamily: tokens.displayFont,
          fontWeight: tokens.displayWeight,
          fontSize: size,
          letterSpacing: tokens.displayTracking,
          lineHeight: tokens.displayLineHeight,
          maxWidth: layout.contentW,
          textAlign: "center",
        }}
      />
      <AccentMark
        brand={brand}
        tokens={tokens}
        layout={layout}
        progress={Math.min(1, progress * 2.4)}
        width={180}
      />
    </Stage>
  );
};

/* -------------------------------- feature -------------------------------- */

const FeatureScene: SceneComponent = ({ input, brand, tokens, layout, beat, frames }) => {
  const text = cased(beat.text ?? "", tokens);
  const index = beat.index ?? 0;
  const count = beat.count ?? 1;
  const tint = brand.tints[index % brand.tints.length];
  const dir: 1 | -1 = index % 2 === 0 ? 1 : -1;
  const body = useBeat(frames, 0, tokens, layout, { direction: dir, travel: 64 });
  const size = fit(text, layout.headline * 0.95, layout.headline * 0.4, budgetFor(layout, 2));
  const counter = `${String(index + 1).padStart(2, "0")} / ${String(count).padStart(2, "0")}`;

  if (beat.variant === 1) {
    // Oversized index number next to the claim; stacks in portrait.
    const stacked = layout.portrait;
    return (
      <Stage layout={layout} align={stacked ? "flex-start" : "center"}>
        <div
          style={{
            ...body.style,
            display: "flex",
            flexDirection: stacked ? "column" : "row",
            alignItems: stacked ? "flex-start" : "center",
            gap: stacked ? layout.gap : layout.px(64),
            width: layout.contentW,
          }}
        >
          <div
            style={{
              fontFamily: tokens.displayFont,
              fontWeight: tokens.displayWeight,
              fontSize: layout.display * (stacked ? 0.9 : 1.05),
              lineHeight: 0.85,
              letterSpacing: "-0.05em",
              color: tint,
            }}
          >
            {String(index + 1).padStart(2, "0")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: layout.gap, flex: 1 }}>
            <DisplayText size={size} tokens={tokens} color={brand.ink} layout={layout}>
              {text}
            </DisplayText>
            <Rail
              frames={frames}
              color={tint}
              track={brand.line}
              height={layout.px(6)}
              width={stacked ? layout.px(220) : "60%"}
            />
          </div>
        </div>
      </Stage>
    );
  }

  if (beat.variant === 2) {
    // Bare, centered, with a dot index — the quietest reading.
    return (
      <Stage layout={layout} gap={layout.gap * 2.2}>
        <div style={{ display: "flex", gap: layout.px(14), ...body.style }}>
          {Array.from({ length: count }, (_, i) => (
            <div
              key={i}
              style={{
                width: layout.px(i === index ? 40 : 14),
                height: layout.px(14),
                borderRadius: layout.px(7),
                backgroundColor: i === index ? tint : brand.line,
              }}
            />
          ))}
        </div>
        <Words
          text={text}
          tokens={tokens}
          layout={layout}
          frames={frames}
          delay={4}
          baseColor={brand.ink}
          style={{
            fontFamily: tokens.displayFont,
            fontWeight: tokens.displayWeight,
            fontSize: size * 1.05,
            letterSpacing: tokens.displayTracking,
            lineHeight: tokens.displayLineHeight,
            maxWidth: layout.contentW,
            textAlign: "center",
          }}
        />
      </Stage>
    );
  }

  return (
    <Stage layout={layout}>
      <div style={{ ...body.style, width: layout.cardW }}>
        <Chrome
          brand={brand}
          tokens={tokens}
          layout={layout}
          title={fileTitle(`why ${input.name}`, "txt")}
          tint={tint}
          style={{ width: "100%" }}
          bodyStyle={{
            padding: `${layout.px(66)}px ${layout.px(64)}px ${layout.px(74)}px`,
            display: "flex",
            flexDirection: "column",
            gap: layout.gap * 1.8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: layout.px(24) }}>
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: layout.px(30),
                fontWeight: 700,
                color: chromeAccent(brand, tokens, tint),
                letterSpacing: "0.12em",
              }}
            >
              {counter}
            </div>
            <div style={{ flex: 1, height: Math.max(1, layout.px(1.5)), backgroundColor: brand.line }} />
            <div
              style={{
                width: layout.px(22),
                height: layout.px(22),
                borderRadius: "50%",
                backgroundColor: chromeAccent(brand, tokens, tint),
              }}
            />
          </div>
          <DisplayText size={size} tokens={tokens} color={chromeInk(brand, tokens)} layout={layout}>
            {text}
          </DisplayText>
        </Chrome>
      </div>
    </Stage>
  );
};

/* ------------------------------- showcase -------------------------------- */

const ShowcaseScene: SceneComponent = ({ input, brand, tokens, layout, beat, frames }) => {
  const kb = useKenBurns(frames, beat.variant);
  const card = useBeat(frames, 0, tokens, layout, { travel: 80 });
  const caption = useBeat(frames, 14, tokens, layout, { travel: 26 });
  const title = hostOf(input.url) || fileTitle(input.name, "app");
  const image = input.imageDataUrl;
  const float = useFloat(layout.px(8), 220);

  if (!image) {
    return (
      <Stage layout={layout}>
        <div style={{ ...card.style, width: layout.cardW }}>
          <Chrome
            brand={brand}
            tokens={tokens}
            layout={layout}
            title={title}
            style={{ width: "100%", height: layout.h * 0.52 }}
            bodyStyle={{ display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <DisplayText
              size={layout.headline * 0.7}
              tokens={tokens}
              color={chromeMuted(brand, tokens)}
              layout={layout}
              style={{ textAlign: "center" }}
            >
              {cased(input.name, tokens)}
            </DisplayText>
          </Chrome>
        </div>
      </Stage>
    );
  }

  if (beat.variant === 1) {
    // Full-bleed product shot with a caption strip riding the bottom edge.
    return (
      <AbsoluteFill>
        <AbsoluteFill style={{ overflow: "hidden", opacity: card.opacity }}>
          <Img
            src={image}
            style={{ width: "100%", height: "100%", objectFit: "cover", transform: kb.transform }}
          />
        </AbsoluteFill>
        <AbsoluteFill
          style={{
            justifyContent: "flex-end",
            background: `linear-gradient(to bottom, ${alpha(brand.paper, 0)} 45%, ${alpha(brand.paper, 0.92)} 100%)`,
          }}
        >
          <div
            style={{
              padding: `${layout.pad * 0.8}px ${layout.pad}px`,
              display: "flex",
              flexDirection: "column",
              gap: layout.gap,
              ...caption.style,
            }}
          >
            <Kicker brand={brand} tokens={tokens} layout={layout} color={brand.accent}>
              {title}
            </Kicker>
            <DisplayText
              size={fit(input.tagline, layout.headline * 0.8, layout.headline * 0.36, budgetFor(layout, 2))}
              tokens={tokens}
              color={brand.ink}
              layout={layout}
            >
              {cased(input.tagline, tokens)}
            </DisplayText>
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }

  // The product shot goes in a device, not a box: a browser for wide cuts, a
  // phone when the frame is tall, a laptop as the take's third reading.
  const device: DeviceKind = layout.portrait ? "phone" : beat.variant === 2 ? "laptop" : "browser";
  const frameHeight = layout.portrait ? layout.h * 0.58 : layout.h * 0.66;
  return (
    <Stage layout={layout}>
      <div
        style={{
          ...card.style,
          width: layout.portrait ? layout.w * 0.66 : layout.cardW,
          height: frameHeight,
          transform: `${card.transform} translateY(${float}px)`,
        }}
      >
        <DeviceFrame
          brand={brand}
          tokens={tokens}
          layout={layout}
          kind={device}
          title={title}
          style={{ width: "100%", height: "100%" }}
        >
          <AbsoluteFill style={{ overflow: "hidden" }}>
            <Img
              src={image}
              style={{ width: "100%", height: "100%", objectFit: "cover", transform: kb.transform }}
            />
          </AbsoluteFill>
        </DeviceFrame>
      </div>
      {tokens.chrome === "window" && !layout.portrait ? (
        <div
          style={{
            position: "absolute",
            right: layout.pad,
            bottom: layout.pad * 0.9,
            ...caption.style,
          }}
        >
          <Sticker layout={layout} rotate={-6}>
            this is the actual product
          </Sticker>
        </div>
      ) : null}
    </Stage>
  );
};

/* ------------------------------- statement ------------------------------- */

const StatementScene: SceneComponent = ({ input, brand, tokens, layout, beat, frames }) => {
  const text = cased(beat.text ?? input.tagline, tokens);
  const size = fit(text, layout.headline * 1.25, layout.headline * 0.5, budgetFor(layout, 2));
  const align = beat.variant === 1 ? "flex-start" : "center";
  return (
    <Stage layout={layout} align={align} gap={layout.gap * 1.6}>
      <Words
        text={text}
        tokens={tokens}
        layout={layout}
        frames={frames}
        delay={3}
        emphasis={Math.min(2, text.split(/\s+/).length)}
        emphasisColor={brand.accent}
        baseColor={beat.variant === 2 ? brand.ink : brand.muted}
        style={{
          fontFamily: tokens.displayFont,
          fontWeight: tokens.displayWeight,
          fontSize: size,
          letterSpacing: tokens.displayTracking,
          lineHeight: tokens.displayLineHeight,
          maxWidth: layout.contentW,
          textAlign: align === "center" ? "center" : "left",
        }}
      />
      {beat.variant === 2 ? (
        <Rail
          frames={frames}
          color={brand.accent}
          track={brand.line}
          height={layout.px(8)}
          width={layout.px(320)}
        />
      ) : null}
    </Stage>
  );
};

/* --------------------------------- proof --------------------------------- */

const ProofChip: React.FC<{
  text: string;
  tint: string;
  delay: number;
  brand: SceneProps["brand"];
  tokens: SceneProps["tokens"];
  layout: Layout;
  frames: number;
}> = ({ text, tint, delay, brand, tokens, layout, frames }) => {
  const chip = useBeat(frames, delay, tokens, layout, { travel: 28 });
  return (
    <div
      style={{
        ...chip.style,
        display: "flex",
        alignItems: "center",
        gap: layout.px(14),
        padding: `${layout.px(18)}px ${layout.px(30)}px`,
        borderRadius: layout.px(999),
        border: `${Math.max(1, layout.px(1.5))}px solid ${brand.line}`,
        backgroundColor: brand.card,
        fontFamily: FONT_BODY,
        fontSize: layout.px(30),
        fontWeight: 600,
        color: brand.ink,
      }}
    >
      <div
        style={{
          width: layout.px(16),
          height: layout.px(16),
          borderRadius: "50%",
          backgroundColor: tint,
        }}
      />
      {text}
    </div>
  );
};

const ProofScene: SceneComponent = ({ input, brand, tokens, layout, beat, frames }) => {
  const head = useBeat(frames, 0, tokens, layout);
  const items = input.features.slice(0, 4);
  return (
    <Stage layout={layout} gap={layout.gap * 2}>
      <div style={head.style}>
        <Kicker brand={brand} tokens={tokens} layout={layout} color={brand.accent}>
          everything in the box
        </Kicker>
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: layout.px(18),
          maxWidth: layout.contentW,
        }}
      >
        {items.map((item, i) => (
          <ProofChip
            key={item}
            text={cased(item, tokens)}
            tint={brand.tints[i % brand.tints.length]}
            delay={6 + i * 5}
            brand={brand}
            tokens={tokens}
            layout={layout}
            frames={frames}
          />
        ))}
      </div>
      <DisplayText
        size={fit(beat.text ?? input.tagline, layout.headline * 0.72, layout.headline * 0.34, budgetFor(layout, 2))}
        tokens={tokens}
        color={brand.muted}
        layout={layout}
        style={{ textAlign: "center" }}
      >
        {cased(beat.text ?? input.tagline, tokens)}
      </DisplayText>
    </Stage>
  );
};

/* --------------------------------- outro --------------------------------- */

const OutroScene: SceneComponent = (props) => {
  const { input, brand, tokens, layout, beat, frames } = props;
  const name = cased(input.name.trim() || "your product", tokens);
  const host = hostOf(input.url);
  const size = fit(name, layout.display * 0.92, layout.display * 0.44, budgetFor(layout, 1));
  const sub = useBeat(frames, 10, tokens, layout, { travel: 24 });
  const pill = useBeat(frames, 20, tokens, layout, { travel: 22 });
  const badge = useBeat(frames, 0, tokens, layout);

  const cta = (
    <div
      style={{
        ...pill.style,
        backgroundColor: brand.accent,
        color: brand.onAccent,
        fontFamily: FONT_BODY,
        fontWeight: 700,
        fontSize: layout.px(34),
        letterSpacing: "-0.01em",
        padding: `${layout.px(24)}px ${layout.px(52)}px`,
        borderRadius: tokens.accentShape === "block" ? 0 : layout.px(999),
        boxShadow: tokens.shadow,
      }}
    >
      {host || cased("get it today", tokens)}
    </div>
  );

  if (beat.variant === 1) {
    return (
      <Stage layout={layout} align="flex-start" gap={layout.gap * 1.4}>
        <div style={badge.style}>
          <LogoBadge {...props} size={86} />
        </div>
        <Reveal tokens={tokens} frames={frames} delay={4}>
          <DisplayText size={size} tokens={tokens} color={brand.ink} layout={layout}>
            {name}
          </DisplayText>
        </Reveal>
        <div style={sub.style}>
          <Kicker brand={brand} tokens={tokens} layout={layout}>
            available today
          </Kicker>
        </div>
        {cta}
      </Stage>
    );
  }

  return (
    <Stage layout={layout} gap={layout.gap * 1.8}>
      <div style={badge.style}>
        <LogoBadge {...props} size={92} />
      </div>
      <Reveal tokens={tokens} frames={frames} delay={2} style={{ textAlign: "center" }}>
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
      <div style={sub.style}>
        <Kicker brand={brand} tokens={tokens} layout={layout}>
          available today
        </Kicker>
      </div>
      {cta}
    </Stage>
  );
};

export const defaultScenes: Record<BeatKind, SceneComponent> = {
  hook: HookScene,
  tagline: TaglineScene,
  feature: FeatureScene,
  showcase: ShowcaseScene,
  statement: StatementScene,
  proof: ProofScene,
  outro: OutroScene,
};

export { DisplayText, Stage, LogoBadge, hostOf, fileTitle };
export { FONT_DISPLAY, FONT_BODY, FONT_MONO };
