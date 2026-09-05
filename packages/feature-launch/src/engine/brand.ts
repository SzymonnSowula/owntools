import type { BrandKit } from "./types";

/** shipshape family — used as fallbacks and for per-feature tint rotation */
export const APPLE_BLUE = "#0a84ff";
const INDIGO = "#5e5ce6";
const CYAN = "#32ade6";

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function mix(a: string, b: string, t: number): string {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return a;
  return rgbToHex(
    ra[0] + (rb[0] - ra[0]) * t,
    ra[1] + (rb[1] - ra[1]) * t,
    ra[2] + (rb[2] - ra[2]) * t,
  );
}

/** `#rrggbb` + alpha → `rgba(...)`. Safe for any renderer (no 8-digit hex). */
export function alpha(hex: string, a: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${clamp(a, 0, 1)})`;
}

/** Rotates hue-ish by mixing toward the family colors — cheap, always on-brand. */
export function shift(hex: string, step: number): string {
  const family = [hex, mix(hex, INDIGO, 0.7), mix(hex, CYAN, 0.7), mix(hex, INDIGO, 0.35)];
  return family[((step % family.length) + family.length) % family.length];
}

/** Nudges a color until it reads on `bg` — used for accents on dark styles. */
export function readable(hex: string, bg: string, minDelta = 0.28): string {
  const target = relativeLuminance(bg) > 0.5 ? "#101014" : "#ffffff";
  let out = hex;
  for (let i = 0; i < 8; i++) {
    if (Math.abs(relativeLuminance(out) - relativeLuminance(bg)) >= minDelta) return out;
    out = mix(out, target, 0.18);
  }
  return out;
}

/**
 * Accepts whatever a site put in theme-color; rejects near-white/near-black
 * values (those make terrible accents) and falls back to Apple blue.
 */
export function normalizeAccent(raw: string | null | undefined): string {
  if (!raw) return APPLE_BLUE;
  const rgb = hexToRgb(raw);
  if (!rgb) return APPLE_BLUE;
  const lum = relativeLuminance(rgbToHex(...rgb));
  const [r, g, b] = rgb;
  const sat = Math.max(r, g, b) - Math.min(r, g, b);
  if (lum > 0.86 || lum < 0.02 || sat < 18) return APPLE_BLUE;
  return rgbToHex(...rgb);
}

/**
 * Samples the dominant saturated color from an image (data URL — canvas stays
 * untainted). Used when the site ships no usable theme-color.
 */
export async function dominantAccent(dataUrl: string): Promise<string | null> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image failed"));
      el.src = dataUrl;
    });
    const size = 48;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);
    // score colors by saturation × count in a coarse 4-bit bucket space
    const buckets = new Map<number, { r: number; g: number; b: number; score: number }>();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (data[i + 3] < 128) continue;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max - min;
      if (sat < 40 || max < 50 || min > 235) continue; // grays, blacks, whites
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const cur = buckets.get(key) ?? { r: 0, g: 0, b: 0, score: 0 };
      cur.r += r;
      cur.g += g;
      cur.b += b;
      cur.score += sat;
      buckets.set(key, cur);
    }
    let best: { r: number; g: number; b: number; score: number } | null = null;
    for (const bucket of buckets.values()) {
      if (bucket.score > (best?.score ?? 0)) best = bucket;
    }
    if (!best || best.score === 0) return null;
    return normalizeAccent(bucketAverage(best));
  } catch {
    return null;
  }
}

function bucketAverage(b: { r: number; g: number; b: number; score: number }): string {
  // r/g/b are sums weighted by occurrences; score is the sat-weighted count.
  // Recover an average by normalizing against the largest channel sum.
  const maxSum = Math.max(b.r, b.g, b.b);
  if (maxSum === 0) return APPLE_BLUE;
  const scale = 255 / maxSum;
  return `#${[b.r, b.g, b.b]
    .map((v) => Math.round(clamp(v * scale, 0, 255)).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Full palette for the composition, day or night. Style packs tweak it further. */
export function buildBrandKit(accent: string, theme: "day" | "night"): BrandKit {
  const a = normalizeAccent(accent);
  const day = theme === "day";
  return {
    accent: a,
    onAccent: relativeLuminance(a) > 0.55 ? "#1d1d1f" : "#ffffff",
    paper: day ? "#f5f5f7" : "#0a0a0e",
    card: day ? "#ffffff" : "#141419",
    ink: day ? "#1d1d1f" : "#f5f5f7",
    muted: day ? "#6e6e73" : "#9a9aa1",
    line: day ? "rgba(29,29,31,0.12)" : "rgba(255,255,255,0.10)",
    winBar: day ? "rgba(29,29,31,0.045)" : "rgba(255,255,255,0.05)",
    dot: day ? "rgba(29,29,31,0.10)" : "rgba(255,255,255,0.07)",
    tints: [a, mix(a, INDIGO, 0.75), mix(a, CYAN, 0.75), mix(a, INDIGO, 0.4)],
    theme,
  };
}
