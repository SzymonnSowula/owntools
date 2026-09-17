/**
 * One place for the numbers every scene shares: the frame rate, the beat the
 * cuts land on, the palette (the app's `suite.css` @theme, hard-coded here
 * because a video has no stylesheet to inherit) and the two fonts.
 */

export const FPS = 60;

/** The cut runs on a 128 BPM grid: a beat is 0.46875 s, four beats 1.875 s. */
export const BPM = 128;
export const BEAT_SECONDS = 60 / BPM;

/** Seconds → frames at the composition's rate. */
export const sec = (s: number, fps = FPS): number => Math.round(s * fps);
/** Beats → frames. */
export const beat = (b: number, fps = FPS): number => Math.round(b * BEAT_SECONDS * fps);

export const COLORS = {
  ink: "#1d1d1f",
  muted: "#6e6e73",
  paper: "#f5f5f7",
  card: "#ffffff",
  line: "#e3e3e6",
  accent: "#0a84ff",
  accent2: "#0071e3",
  indigo: "#5e5ce6",
  cyan: "#32ade6",
  red: "#ff453a",
  amber: "#ff9f0a",
  green: "#32d74b",
  yellow: "#febc2e",
  /** The app icon's hairline and the deep end of its sky. */
  navy: "#0b2a55",
  /** The bar, the pill and the recorder bar: one dark surface in every theme. */
  surface: "rgba(22,22,24,0.96)",
  surfaceLine: "rgba(255,255,255,0.13)",
} as const;

export const FONT_DISPLAY = "Outfit, Inter, ui-sans-serif, system-ui, sans-serif";
export const FONT_BODY = "Inter, ui-sans-serif, system-ui, sans-serif";
export const FONT_MONO = "'Cascadia Mono', Consolas, 'JetBrains Mono', ui-monospace, Menlo, monospace";

/** The window chrome's three lights. */
export const LIGHTS = ["#ff5f57", "#febc2e", "#28c840"] as const;
