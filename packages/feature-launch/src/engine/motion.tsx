import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Layout } from "./layout";
import type { MotionProfile, StyleTokens } from "./style";

/**
 * Motion vocabulary shared by every scene. Entrances read their character from
 * the style pack's `MotionProfile`, so swapping packs re-choreographs the whole
 * cut without touching a single scene.
 *
 * Renderer note: no clip-path, no filters, no blend modes — reveals are done
 * with `overflow: hidden` + a transform, which every renderer agrees on.
 */

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export interface Enter {
  /** 0..1 entrance progress */
  p: number;
  opacity: number;
  transform: string;
  /** ready-to-spread style */
  style: React.CSSProperties;
}

export function useEnter(
  delay: number,
  tokens: StyleTokens,
  layout: Layout,
  opts: { frames?: number; direction?: 1 | -1; travel?: number } = {},
): Enter {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const m = tokens.motion;
  const dir = opts.direction ?? 1;
  const travel = layout.px(opts.travel ?? m.travel);
  const p = spring({
    frame: frame - delay,
    fps,
    config: { damping: m.damping },
    durationInFrames: opts.frames ?? m.enterFrames,
  });
  const rest = 1 - p;
  let transform = "";
  switch (m.enter) {
    case "slam":
      transform = `scale(${1 + rest * 0.16}) translateY(${rest * travel * 0.35 * dir}px)`;
      break;
    case "fall":
      transform = `translateY(${-rest * travel * dir}px)`;
      break;
    case "drift":
      transform = `translateX(${rest * travel * 0.8 * dir}px) scale(${1 - rest * 0.03})`;
      break;
    case "type":
    case "wipe":
      transform = `translateY(${rest * travel * 0.25 * dir}px)`;
      break;
    default:
      transform = `translateY(${rest * travel * dir}px)`;
  }
  return { p, opacity: p, transform, style: { opacity: p, transform } };
}

/** Fade over the tail of a beat. Packs with `exitFrames: 0` cut hard instead. */
export function useExit(frames: number, tokens: StyleTokens): number {
  const frame = useCurrentFrame();
  const len = tokens.motion.exitFrames;
  if (len <= 0) return 1;
  return interpolate(frame, [frames - len, frames - 1], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

/** Entrance × exit, the combination almost every scene wants. */
export function useBeat(
  frames: number,
  delay: number,
  tokens: StyleTokens,
  layout: Layout,
  opts: { direction?: 1 | -1; travel?: number; frames?: number } = {},
): Enter {
  const enter = useEnter(delay, tokens, layout, opts);
  const exit = useExit(frames, tokens);
  const opacity = enter.opacity * exit;
  return { ...enter, opacity, style: { opacity, transform: enter.transform } };
}

/** Slow continuous drift, for elements that are held on screen. */
export function useFloat(amount: number, periodInFrames = 150, phase = 0): number {
  const frame = useCurrentFrame();
  if (amount === 0) return 0;
  return Math.sin((frame / periodInFrames) * Math.PI * 2 + phase) * amount;
}

/** 0..1 through the current beat. */
export function useProgress(frames: number): number {
  const frame = useCurrentFrame();
  return clamp01(frame / Math.max(1, frames));
}

/** Slow push-in on stills. Variants pan from different corners. */
export function useKenBurns(frames: number, variant = 0): { transform: string } {
  const t = useProgress(frames);
  const eased = t * t * (3 - 2 * t);
  const dirs: [number, number][] = [
    [0, -1],
    [-1, -0.4],
    [1, -0.4],
    [0, 1],
  ];
  const [dx, dy] = dirs[variant % dirs.length];
  const zoom = 1.04 + 0.08 * eased;
  return { transform: `scale(${zoom}) translate(${dx * eased * 1.4}%, ${dy * eased * 1.6}%)` };
}

/* ------------------------------ components ------------------------------ */

/**
 * A line of type that slides up from behind its own baseline box. The classic
 * title reveal — done with overflow instead of a mask so it survives export.
 */
export const Reveal: React.FC<{
  delay?: number;
  tokens: StyleTokens;
  frames: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ delay = 0, tokens, frames, children, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const m = tokens.motion;
  const p = spring({
    frame: frame - delay,
    fps,
    config: { damping: m.damping },
    durationInFrames: m.enterFrames,
  });
  const exit = useExit(frames, tokens);
  return (
    <div style={{ overflow: "hidden", paddingBottom: "0.12em", opacity: exit, ...style }}>
      <div style={{ transform: `translateY(${(1 - p) * 108}%)` }}>{children}</div>
    </div>
  );
};

/** Word-by-word entrance using the pack's motion character. */
export const Words: React.FC<{
  text: string;
  tokens: StyleTokens;
  layout: Layout;
  frames: number;
  delay?: number;
  /** color for the last `emphasis` words */
  emphasis?: number;
  emphasisColor?: string;
  baseColor: string;
  style?: React.CSSProperties;
}> = ({ text, tokens, layout, frames, delay = 0, emphasis = 0, emphasisColor, baseColor, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const m = tokens.motion;
  const exit = useExit(frames, tokens);
  const words = text.split(/\s+/).filter(Boolean);
  const from = words.length - emphasis;
  return (
    <div style={{ opacity: exit, ...style }}>
      {words.map((word, i) => {
        const p = spring({
          frame: frame - delay - i * m.stagger,
          fps,
          config: { damping: m.damping },
          durationInFrames: m.enterFrames,
        });
        const rest = 1 - p;
        const t =
          m.enter === "slam"
            ? `scale(${1 + rest * 0.3})`
            : m.enter === "fall"
              ? `translateY(${-rest * layout.px(m.travel * 0.7)}px)`
              : m.enter === "drift"
                ? `translateX(${rest * layout.px(m.travel * 0.5)}px)`
                : `translateY(${rest * layout.px(m.travel * 0.7)}px)`;
        return (
          <span
            key={`${word}-${i}`}
            style={{
              display: "inline-block",
              marginRight: "0.26em",
              opacity: p,
              transform: t,
              color: emphasis > 0 && i >= from ? emphasisColor ?? baseColor : baseColor,
            }}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
};

/** Monospace typing, with a blinking caret. The terminal pack's signature. */
export const Typed: React.FC<{
  text: string;
  delay?: number;
  cps?: number;
  caret?: boolean;
  caretColor: string;
  style?: React.CSSProperties;
}> = ({ text, delay = 0, cps = 26, caret = true, caretColor, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const chars = Math.max(0, Math.floor(((frame - delay) / fps) * cps));
  const shown = text.slice(0, chars);
  const done = chars >= text.length;
  const blink = Math.floor(frame / 15) % 2 === 0;
  const caretVisible = caret && (!done || blink);
  return (
    <span style={style}>
      {shown}
      {caretVisible ? <span style={{ color: caretColor }}>▍</span> : null}
    </span>
  );
};

/** Progress rail that fills across a beat — used as a "chapter" indicator. */
export const Rail: React.FC<{
  frames: number;
  color: string;
  track: string;
  height: number;
  width: number | string;
  radius?: number;
}> = ({ frames, color, track, height, width, radius }) => {
  const t = useProgress(frames);
  return (
    <div
      style={{
        width,
        height,
        borderRadius: radius ?? height / 2,
        backgroundColor: track,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${t * 100}%`,
          height: "100%",
          backgroundColor: color,
          borderRadius: radius ?? height / 2,
        }}
      />
    </div>
  );
};

export function motionOf(tokens: StyleTokens): MotionProfile {
  return tokens.motion;
}
