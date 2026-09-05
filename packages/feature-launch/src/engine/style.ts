import type React from "react";
import { alpha } from "./brand";
import type { Beat, BeatKind, BrandKit, LaunchInput, LaunchScript, StyleId } from "./types";
import type { Layout } from "./layout";

/**
 * A *style pack* is the personality of a cut: its chrome, its typography, the
 * way things enter, and the background it lives on. Scenes are written once
 * (see `scenes.tsx`) against these tokens, so a pack usually only supplies
 * tokens + a background, and overrides the one or two beats that are its
 * signature move.
 */

export interface MotionProfile {
  /** entrance character */
  enter: "rise" | "slam" | "wipe" | "drift" | "type" | "fall";
  /** frames an entrance takes */
  enterFrames: number;
  /** spring damping — high is calm, low overshoots */
  damping: number;
  /** per-item / per-word stagger, in frames */
  stagger: number;
  /** frames of fade at the end of a beat (0 = hard cut) */
  exitFrames: number;
  /** travel distance for rise/fall/wipe, in reference px */
  travel: number;
  /** subtle continuous drift on held elements */
  float: number;
}

export type ChromeKind = "window" | "glass" | "terminal" | "rule" | "block" | "none";

export interface StyleTokens {
  displayFont: string;
  bodyFont: string;
  monoFont: string;
  displayWeight: number;
  displayTracking: string;
  displayLineHeight: number;
  textCase: "lower" | "upper" | "none";
  /** kicker treatment */
  kickerFont: "mono" | "body" | "display";
  kickerTracking: string;
  radius: number;
  chrome: ChromeKind;
  accentShape: "bar" | "dot" | "block" | "underline" | "caret";
  /** how strongly the accent is used in flat fills (0..1) */
  accentWeight: number;
  shadow: string;
  motion: MotionProfile;
}

export interface BackgroundProps {
  input: LaunchInput;
  brand: BrandKit;
  tokens: StyleTokens;
  layout: Layout;
  script: LaunchScript;
  /** the beat under the playhead — lets backgrounds react to the cut */
  beat: Beat;
  /** 0..1 progress inside the current beat */
  beatProgress: number;
}

export interface SceneProps {
  input: LaunchInput;
  brand: BrandKit;
  tokens: StyleTokens;
  layout: Layout;
  beat: Beat;
  /** duration of this beat in frames */
  frames: number;
}

export type SceneComponent = React.FC<SceneProps>;

export interface LaunchStyleDef {
  id: StyleId;
  label: string;
  desc: string;
  /** packs that only work in one theme pin it (terminal is always night) */
  forceTheme?: "day" | "night";
  tokens: (brand: BrandKit) => StyleTokens;
  /** palette adjustments on top of the shared brand kit */
  brand?: (brand: BrandKit) => BrandKit;
  Background: React.FC<BackgroundProps>;
  scenes?: Partial<Record<BeatKind, SceneComponent>>;
}

/** Applies the pack's casing rule to a piece of copy. */
export function cased(text: string, tokens: StyleTokens): string {
  if (tokens.textCase === "lower") return text.toLowerCase();
  if (tokens.textCase === "upper") return text.toUpperCase();
  return text;
}

/**
 * Text colours *inside* the pack's chrome. A `block` chrome fills with the
 * accent, so copy that would normally be ink has to flip to `onAccent` or it
 * loses contrast the moment someone picks a dark brand colour.
 */
export function chromeInk(brand: BrandKit, tokens: StyleTokens): string {
  return tokens.chrome === "block" ? brand.onAccent : brand.ink;
}

export function chromeMuted(brand: BrandKit, tokens: StyleTokens): string {
  return tokens.chrome === "block" ? alpha(brand.onAccent, 0.72) : brand.muted;
}

/** An accent detail drawn on top of the chrome (dots, counters, rails). */
export function chromeAccent(brand: BrandKit, tokens: StyleTokens, tint: string): string {
  return tokens.chrome === "block" ? brand.onAccent : tint;
}

/** Fonts: `var(...)` with an inline fallback so this works outside Next too. */
export const FONT_DISPLAY = "var(--font-outfit, Outfit), Outfit, ui-sans-serif, sans-serif";
export const FONT_BODY = "var(--font-inter, Inter), Inter, ui-sans-serif, sans-serif";
export const FONT_MONO = "'SF Mono', 'Cascadia Code', 'JetBrains Mono', Consolas, ui-monospace, monospace";

export const BASE_MOTION: MotionProfile = {
  enter: "rise",
  enterFrames: 26,
  damping: 200,
  stagger: 3,
  exitFrames: 12,
  travel: 44,
  float: 0,
};
