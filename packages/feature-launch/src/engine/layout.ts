import { useMemo } from "react";
import { useVideoConfig } from "remotion";
import type { FormatId } from "./types";

/**
 * Every scene is authored against this object instead of hard pixels, so the
 * same beat composes in 16:9, 9:16 and 1:1 without a second layout pass.
 * Sizes are derived from the frame width; the aspect only decides how much
 * vertical room the stack gets and whether split layouts stay side by side.
 */
export interface Layout {
  w: number;
  h: number;
  format: FormatId;
  portrait: boolean;
  square: boolean;
  wide: boolean;
  /** safe margin */
  pad: number;
  /** width text should wrap inside */
  contentW: number;
  /** vertical rhythm unit */
  gap: number;
  /** base sizes — scenes shrink from these with `fit()` */
  display: number;
  headline: number;
  body: number;
  kicker: number;
  /** width of a window/card element */
  cardW: number;
  /** scale factor vs. the 1920×1080 reference, for borders/radii/shadows */
  k: number;
  /** px helper: authored against the reference frame */
  px: (n: number) => number;
}

export function buildLayout(w: number, h: number): Layout {
  const ratio = w / h;
  const portrait = ratio < 0.9;
  const square = ratio >= 0.9 && ratio < 1.2;
  const wide = ratio >= 1.2;
  // Type is sized off the *short* edge in portrait so headlines don't run to
  // 3 characters a line, and off the width everywhere else.
  const base = wide ? w : portrait ? w * 1.32 : w * 1.18;
  const k = base / 1920;
  return {
    w,
    h,
    format: portrait ? "portrait" : square ? "square" : "landscape",
    portrait,
    square,
    wide,
    pad: wide ? w * 0.075 : w * 0.085,
    contentW: w * (wide ? 0.82 : 0.86),
    gap: base * 0.018,
    display: base * 0.098,
    headline: base * 0.062,
    body: base * 0.026,
    kicker: base * 0.0135,
    cardW: w * (wide ? 0.76 : 0.86),
    k,
    px: (n: number) => n * k,
  };
}

export function useLayout(): Layout {
  const { width, height } = useVideoConfig();
  return useMemo(() => buildLayout(width, height), [width, height]);
}

/**
 * Shrinks a size as the string gets longer so long taglines still fit the
 * content box. `budget` is roughly "characters × size that fills the box".
 */
export function fit(text: string, base: number, min: number, budget: number): number {
  const len = Math.max(1, text.trim().length);
  return Math.max(min, Math.min(base, (budget / len) * 1.9));
}

/** Content-box budget for a given layout, in the same units as `fit`. */
export function budgetFor(layout: Layout, lines: number): number {
  return layout.contentW * lines * 0.62;
}
