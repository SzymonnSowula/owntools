/**
 * Shared types for the launch-video engine (desktop + web).
 *
 * A render is fully described by `LaunchInput`: the brief (copy, assets,
 * accent), the *style pack*, the format, the length and a `seed`. Everything
 * downstream is a pure function of that object — same input, same frames — so
 * the player preview and the offline export are pixel-identical, and a seed
 * you liked can always be replayed.
 */

export const FPS = 30;

/* --------------------------------- format -------------------------------- */

export type FormatId = "landscape" | "portrait" | "square";

export interface FormatDef {
  id: FormatId;
  label: string;
  desc: string;
  width: number;
  height: number;
}

export const FORMATS: FormatDef[] = [
  { id: "landscape", label: "16:9", desc: "YouTube, site hero, Product Hunt", width: 1920, height: 1080 },
  { id: "portrait", label: "9:16", desc: "Reels, TikTok, Shorts", width: 1080, height: 1920 },
  { id: "square", label: "1:1", desc: "X, LinkedIn, Instagram feed", width: 1080, height: 1080 },
];

export function formatDef(id: FormatId): FormatDef {
  return FORMATS.find((f) => f.id === id) ?? FORMATS[0];
}

/* -------------------------------- duration ------------------------------- */

export type DurationId = 15 | 30 | 60;

export const DURATIONS: { id: DurationId; label: string; desc: string }[] = [
  { id: 15, label: "0:15", desc: "Ad cut — hook, one promise, CTA" },
  { id: 30, label: "0:30", desc: "The launch cut" },
  { id: 60, label: "1:00", desc: "The full tour" },
];

/* --------------------------------- style --------------------------------- */

export type StyleId = "desk" | "noir" | "editorial" | "terminal" | "aurora" | "poster";

/* --------------------------------- intel --------------------------------- */

/** What page analysis extracts from a product page. */
export interface LaunchIntel {
  url: string;
  host: string;
  name: string;
  tagline: string;
  description: string;
  features: string[];
  /** theme-color / msapplication-TileColor if present, e.g. "#5e5ce6". */
  accent: string | null;
  /** og:image, inlined as a data URL so canvases stay untainted. */
  imageDataUrl: string | null;
  /** apple-touch-icon / favicon, inlined as a data URL. */
  logoDataUrl: string | null;
}

/* --------------------------------- input --------------------------------- */

export interface LaunchInput {
  name: string;
  tagline: string;
  features: string[];
  url: string;
  accent: string;
  theme: "day" | "night";
  imageDataUrl: string | null;
  logoDataUrl: string | null;
  watermark: boolean;
  style: StyleId;
  format: FormatId;
  seconds: DurationId;
  /** The take. Drives arc choice, per-beat layout variants and motion. */
  seed: number;
}

/* --------------------------------- brand --------------------------------- */

export interface BrandKit {
  accent: string;
  /** readable text color on top of the accent */
  onAccent: string;
  paper: string;
  card: string;
  ink: string;
  muted: string;
  line: string;
  winBar: string;
  dot: string;
  /** per-index card tints: accent, indigo, cyan rotation seeded by accent */
  tints: string[];
  theme: "day" | "night";
}

/* --------------------------------- script -------------------------------- */

export type BeatKind =
  | "hook"
  | "tagline"
  | "feature"
  | "showcase"
  | "statement"
  | "proof"
  | "outro";

export type ArcId = "classic" | "coldOpen" | "showFirst" | "rapid";

export interface Beat {
  kind: BeatKind;
  /** first frame (inclusive), relative to the whole video */
  from: number;
  /** length in frames */
  frames: number;
  /** primary copy for the beat */
  text?: string;
  /** secondary copy (kicker / label) */
  label?: string;
  /** feature index (0-based) for "feature" beats */
  index?: number;
  /** how many feature beats the cut has in total */
  count?: number;
  /** layout variant picked by the take (0..n) */
  variant: number;
}

export interface LaunchScript {
  arc: ArcId;
  beats: Beat[];
  totalFrames: number;
}
