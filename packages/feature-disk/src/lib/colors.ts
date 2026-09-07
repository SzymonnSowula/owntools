import { CAT_OTHER } from "../api/types";

/**
 * Colour rules for the visual views. Three modes: by file type (category
 * palette), by folder (one pastel hue per top-level branch, a little darker
 * with every level), by age (a cold-to-warm scale on the newest mtime).
 * Everything is computed in HSL so the same rules give a dark variant.
 */
export type ColorMode = "type" | "folder" | "age";

export interface Theme {
  dark: boolean;
  ink: string;
  paper: string;
  card: string;
  line: string;
  accent: string;
  muted: string;
}

export const LIGHT_THEME: Theme = {
  dark: false,
  ink: "#1d1d1f",
  paper: "#f5f5f7",
  card: "#ffffff",
  line: "#e3e3e6",
  accent: "#0a84ff",
  muted: "#6e6e73",
};

/** Category palette, index = category id. */
export const CATEGORY_COLORS = [
  "#c9ced6", // other · cool gray
  "#ef8fa9", // video · rose
  "#f3b46a", // audio · orange
  "#a3d16b", // image · green
  "#74aef2", // document · blue
  "#b19af2", // developer · violet
  "#d0aa7f", // archive · sand
  "#9aa1ab", // app & system · gray
];

/** Branch palette for "by folder": pastel, distinct, in the screenshot's family. */
export const FOLDER_PALETTE = [
  "#f0d98a", // straw
  "#f2a7c3", // pink
  "#c8b4f2", // lilac
  "#a8d9a1", // sage
  "#f6bf98", // peach
  "#a4cdf1", // sky
  "#e3c69f", // sand
  "#b6e0d6", // mint
  "#e8a9a9", // rosewood
  "#c9d68f", // olive
  "#d9b8e6", // mauve
  "#f2cf9a", // apricot
];

export const AGE_STOPS: { days: number; color: string; label: string }[] = [
  { days: 7, color: "#4c9df0", label: "this week" },
  { days: 30, color: "#63c1e8", label: "this month" },
  { days: 90, color: "#8ed081", label: "3 months" },
  { days: 365, color: "#e9cf6c", label: "this year" },
  { days: 730, color: "#f0a56c", label: "2 years" },
  { days: Number.POSITIVE_INFINITY, color: "#b8ada0", label: "older" },
];

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/** Linear mix in RGB; t = 0 → a, t = 1 → b. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Shifts a swatch by depth: each level mixes a little further toward a warm
 * dark anchor (light themes) or back toward the pastel from a dim base (dark
 * themes). Mixing, not HSL lightness, so deeper is always visibly deeper —
 * yellows fooled the HSL version.
 */
export function shade(hex: string, depth: number, dark: boolean): string {
  const step = Math.min(Math.max(depth, 0), 6);
  if (dark) {
    const dim = mix(hex, "#141418", 0.66);
    return mix(dim, hex, step * 0.09);
  }
  return mix(hex, "#2b2620", step * 0.085);
}

/** Age colour for an mtime (unix seconds). Unknown → the oldest stop. */
export function ageColor(mtime: number, now: number): string {
  if (!Number.isFinite(mtime) || mtime < -1e12) return AGE_STOPS[AGE_STOPS.length - 1].color;
  const days = Math.max(0, (now - mtime) / 86400);
  for (const stop of AGE_STOPS) if (days < stop.days) return stop.color;
  return AGE_STOPS[AGE_STOPS.length - 1].color;
}

export function categoryColor(cat: number, isDir: boolean, dark: boolean): string {
  const base = CATEGORY_COLORS[cat] ?? CATEGORY_COLORS[CAT_OTHER];
  if (dark) return mix(base, "#1a1a1e", isDir ? 0.55 : 0.35);
  return isDir ? mix(base, "#ffffff", 0.42) : base;
}

export function folderColor(branchIndex: number, depth: number, dark: boolean): string {
  const base = FOLDER_PALETTE[((branchIndex % FOLDER_PALETTE.length) + FOLDER_PALETTE.length) % FOLDER_PALETTE.length];
  return shade(base, depth, dark);
}

export interface ColorInput {
  mode: ColorMode;
  isDir: boolean;
  cat: number;
  mtime: number;
  depth: number;
  branchIndex: number;
  isRest?: boolean;
}

export function colorFor(input: ColorInput, theme: Theme, now: number): string {
  if (input.isRest) return theme.dark ? "#2a2a30" : "#e4e4e9";
  switch (input.mode) {
    case "type":
      return categoryColor(input.cat, input.isDir, theme.dark);
    case "age": {
      const c = ageColor(input.mtime, now);
      if (theme.dark) return mix(c, "#1a1a1e", input.isDir ? 0.5 : 0.3);
      return input.isDir ? mix(c, "#ffffff", 0.4) : c;
    }
    default:
      return folderColor(input.branchIndex, input.depth, theme.dark);
  }
}

/** Text colour that reads on a fill. */
export function inkOn(fill: string): string {
  return luminance(fill) > 0.42 ? "#1d1d1f" : "#f5f5f7";
}

/** Reads the suite tokens off an element so the canvas matches the theme. */
export function readTheme(el: Element | null): Theme {
  if (!el || typeof getComputedStyle !== "function") return LIGHT_THEME;
  const cs = getComputedStyle(el);
  const get = (name: string, fallback: string) => {
    const v = cs.getPropertyValue(name).trim();
    return v && v.startsWith("#") ? v : fallback;
  };
  const paper = get("--color-paper", LIGHT_THEME.paper);
  return {
    dark: luminance(paper) < 0.35,
    ink: get("--color-ink", LIGHT_THEME.ink),
    paper,
    card: get("--color-card", LIGHT_THEME.card),
    line: get("--color-line", LIGHT_THEME.line),
    accent: get("--color-accent", LIGHT_THEME.accent),
    muted: get("--color-muted", LIGHT_THEME.muted),
  };
}
