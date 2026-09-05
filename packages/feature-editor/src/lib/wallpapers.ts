import { GRADIENT_PRESETS, drawMeshBackground, type GradientBlob } from "./gradients";

/**
 * Backgrounds are generated, never shipped as files: a wallpaper is a recipe
 * (a kind plus a handful of colours) drawn at whatever size the frame needs,
 * so the picker's thumbnails, the preview and a 4K export all come from the
 * same few bytes. The six original mesh presets keep their ids, which is what
 * old project files reference.
 */

export type WallpaperKind = "mesh" | "linear" | "aurora" | "rings" | "beams" | "dots";

export interface WallpaperCategory {
  id: string;
  name: string;
}

export interface Wallpaper {
  id: string;
  name: string;
  category: string;
  kind: WallpaperKind;
  base: string;
  colors: string[];
  /** Degrees, CSS convention (0 = to top, 90 = to right). */
  angle?: number;
  /** Explicit blob layout for meshes; otherwise the colours land on a standard layout. */
  blobs?: GradientBlob[];
}

export const WALLPAPER_CATEGORIES: WallpaperCategory[] = [
  { id: "shipshape", name: "shipshape" },
  { id: "sky", name: "Sky" },
  { id: "night", name: "Night" },
  { id: "warm", name: "Warm" },
  { id: "nature", name: "Nature" },
  { id: "mono", name: "Mono" },
];

const legacy = (id: string, category: string): Wallpaper => {
  const p = GRADIENT_PRESETS.find((g) => g.id === id)!;
  return {
    id: p.id,
    name: p.name,
    category,
    kind: "mesh",
    base: p.base,
    colors: p.blobs.map((b) => b.color),
    blobs: p.blobs,
  };
};

export const WALLPAPERS: Wallpaper[] = [
  // shipshape — the brand blues.
  {
    id: "harbour",
    name: "Harbour",
    category: "shipshape",
    kind: "mesh",
    base: "#0b1e3a",
    colors: ["#0a84ff", "#5e5ce6", "#32ade6", "#7dd3fc"],
  },
  {
    id: "day",
    name: "Day",
    category: "shipshape",
    kind: "linear",
    base: "#f5f5f7",
    colors: ["#f5f5f7", "#e6f0ff", "#dbeafe"],
    angle: 160,
  },
  { id: "desk", name: "Desk", category: "shipshape", kind: "dots", base: "#f5f5f7", colors: ["#0a84ff"] },
  { id: "night", name: "Night desk", category: "shipshape", kind: "dots", base: "#1d1d1f", colors: ["#5e5ce6"] },

  // sky
  legacy("aurora", "sky"),
  legacy("sky", "sky"),
  legacy("citrus", "sky"),
  { id: "dawn", name: "Dawn", category: "sky", kind: "aurora", base: "#1e1b4b", colors: ["#f472b6", "#fb923c", "#818cf8"] },
  { id: "polar", name: "Polar", category: "sky", kind: "aurora", base: "#061a2e", colors: ["#34d399", "#22d3ee", "#a78bfa"] },

  // night
  legacy("noir", "night"),
  { id: "graphite", name: "Graphite", category: "night", kind: "linear", base: "#111114", colors: ["#111114", "#2a2a31"], angle: 150 },
  { id: "ink", name: "Ink", category: "night", kind: "rings", base: "#0f172a", colors: ["#1d4ed8"] },
  {
    id: "nebula",
    name: "Nebula",
    category: "night",
    kind: "mesh",
    base: "#12071f",
    colors: ["#7c3aed", "#db2777", "#2563eb", "#0ea5e9"],
  },

  // warm
  legacy("sunset", "warm"),
  { id: "peach", name: "Peach", category: "warm", kind: "linear", base: "#ffd6a5", colors: ["#ffd6a5", "#ffadad", "#fdba74"], angle: 145 },
  { id: "ember", name: "Ember", category: "warm", kind: "aurora", base: "#2a0a0a", colors: ["#f97316", "#ef4444", "#fbbf24"] },
  { id: "sand", name: "Sand", category: "warm", kind: "linear", base: "#f5e9d6", colors: ["#f5e9d6", "#e7d3b3"], angle: 120 },

  // nature
  legacy("mint", "nature"),
  {
    id: "forest",
    name: "Forest",
    category: "nature",
    kind: "mesh",
    base: "#052e16",
    colors: ["#22c55e", "#16a34a", "#a3e635", "#14b8a6"],
  },
  { id: "meadow", name: "Meadow", category: "nature", kind: "linear", base: "#d9f99d", colors: ["#d9f99d", "#86efac", "#67e8f9"], angle: 120 },
  { id: "ocean", name: "Ocean", category: "nature", kind: "beams", base: "#0c4a6e", colors: ["#0c4a6e", "#0369a1", "#06b6d4"], angle: 30 },

  // mono
  { id: "paper", name: "Paper", category: "mono", kind: "linear", base: "#fafafa", colors: ["#fafafa", "#ececf1"], angle: 180 },
  { id: "slate", name: "Slate", category: "mono", kind: "linear", base: "#334155", colors: ["#334155", "#1e293b"], angle: 160 },
  { id: "beams", name: "Beams", category: "mono", kind: "beams", base: "#ffffff", colors: ["#ffffff", "#e5e7eb"], angle: 20 },
  { id: "ripple", name: "Ripple", category: "mono", kind: "rings", base: "#f3f4f6", colors: ["#c7d2fe"] },
];

export function getWallpaper(id: string): Wallpaper {
  return WALLPAPERS.find((w) => w.id === id) ?? WALLPAPERS[0];
}

export interface LinearGradientPreset {
  id: string;
  name: string;
  stops: string[];
}

export const LINEAR_GRADIENTS: LinearGradientPreset[] = [
  { id: "ocean", name: "Ocean", stops: ["#0a84ff", "#5e5ce6"] },
  { id: "sky", name: "Sky", stops: ["#7dd3fc", "#c4b5fd"] },
  { id: "sunset", name: "Sunset", stops: ["#fb7185", "#fb923c", "#fde047"] },
  { id: "candy", name: "Candy", stops: ["#f9a8d4", "#a5b4fc"] },
  { id: "mint", name: "Mint", stops: ["#a7f3d0", "#67e8f9"] },
  { id: "lime", name: "Lime", stops: ["#bef264", "#22c55e"] },
  { id: "peach", name: "Peach", stops: ["#fed7aa", "#fda4af"] },
  { id: "royal", name: "Royal", stops: ["#312e81", "#7c3aed"] },
  { id: "midnight", name: "Midnight", stops: ["#0f172a", "#1e3a8a"] },
  { id: "graphite", name: "Graphite", stops: ["#3f3f46", "#18181b"] },
  { id: "pearl", name: "Pearl", stops: ["#fafafa", "#e5e7eb"] },
  { id: "cherry", name: "Cherry", stops: ["#9f1239", "#fb7185"] },
];

export function getLinearGradient(id: string): LinearGradientPreset {
  return LINEAR_GRADIENTS.find((g) => g.id === id) ?? LINEAR_GRADIENTS[0];
}

export const SOLID_COLORS: { id: string; name: string; color: string }[] = [
  { id: "blue", name: "Blue", color: "#0a84ff" },
  { id: "indigo", name: "Indigo", color: "#5e5ce6" },
  { id: "cyan", name: "Cyan", color: "#32ade6" },
  { id: "green", name: "Green", color: "#30d158" },
  { id: "yellow", name: "Yellow", color: "#ffd60a" },
  { id: "orange", name: "Orange", color: "#ff9f0a" },
  { id: "red", name: "Red", color: "#ff453a" },
  { id: "purple", name: "Purple", color: "#bf5af2" },
  { id: "ink", name: "Ink", color: "#1d1d1f" },
  { id: "graphite", name: "Graphite", color: "#2a2a31" },
  { id: "paper", name: "Paper", color: "#f5f5f7" },
  { id: "white", name: "White", color: "#ffffff" },
];

export function gradientCss(stops: string[], angle: number): string {
  return `linear-gradient(${angle}deg, ${stops.join(", ")})`;
}

/** Relative luminance of a hex colour, 0 (black) to 1 (white). */
export function luma(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function isLight(hex: string): boolean {
  return luma(hex) > 0.6;
}

/** A CSS-compatible linear gradient: 0° points up, 90° to the right. */
export function drawLinearGradient(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  stops: string[],
  angleDeg: number,
): void {
  const a = (angleDeg * Math.PI) / 180;
  const len = Math.abs(width * Math.sin(a)) + Math.abs(height * Math.cos(a));
  const cx = width / 2;
  const cy = height / 2;
  const dx = (Math.sin(a) * len) / 2;
  const dy = (Math.cos(a) * len) / 2;
  const g = ctx.createLinearGradient(cx - dx, cy + dy, cx + dx, cy - dy);
  const n = Math.max(1, stops.length - 1);
  stops.forEach((c, i) => g.addColorStop(i / n, c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
}

const MESH_LAYOUT = [
  { x: 0.2, y: 0.2, r: 0.6 },
  { x: 0.8, y: 0.25, r: 0.55 },
  { x: 0.5, y: 0.85, r: 0.58 },
  { x: 0.9, y: 0.75, r: 0.35 },
];

function drawAurora(ctx: CanvasRenderingContext2D, w: number, h: number, wp: Wallpaper): void {
  ctx.fillStyle = wp.base;
  ctx.fillRect(0, 0, w, h);
  const big = Math.max(w, h);
  wp.colors.forEach((color, i) => {
    const cx = (0.2 + 0.3 * i) * w;
    const cy = (0.35 + 0.22 * Math.sin(i * 1.7)) * h;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(((-28 + i * 22) * Math.PI) / 180);
    ctx.scale(1, 0.34);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, big * 0.7);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = g;
    ctx.fillRect(-big * 2, -big * 2, big * 4, big * 4);
    ctx.restore();
  });
  const depth = ctx.createLinearGradient(0, 0, 0, h);
  depth.addColorStop(0, "rgba(0,0,0,0)");
  depth.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.fillStyle = depth;
  ctx.fillRect(0, 0, w, h);
}

function drawRings(ctx: CanvasRenderingContext2D, w: number, h: number, wp: Wallpaper): void {
  ctx.fillStyle = wp.base;
  ctx.fillRect(0, 0, w, h);
  const cx = w * 0.7;
  const cy = h * 0.35;
  const r = Math.max(w, h) * 1.15;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  const color = wp.colors[0] ?? "#ffffff";
  const steps = 11;
  for (let k = 0; k <= steps; k++) {
    const on = k % 2 === 0;
    g.addColorStop(k / steps, `${color}${on ? "52" : "08"}`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawBeams(ctx: CanvasRenderingContext2D, w: number, h: number, wp: Wallpaper): void {
  drawLinearGradient(ctx, w, h, wp.colors, wp.angle ?? 30);
  const big = Math.max(w, h) * 2;
  const light = isLight(wp.base);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(((wp.angle ?? 30) - 90) * (Math.PI / 180));
  const beams = [-0.42, -0.2, 0.05, 0.28, 0.5];
  beams.forEach((offset, i) => {
    const bw = big * (0.05 + (i % 3) * 0.03);
    ctx.fillStyle = light ? `rgba(0,0,0,${0.035 + (i % 2) * 0.02})` : `rgba(255,255,255,${0.06 + (i % 2) * 0.04})`;
    ctx.fillRect(offset * big - bw / 2, -big, bw, big * 2);
  });
  ctx.restore();
}

function drawDots(ctx: CanvasRenderingContext2D, w: number, h: number, wp: Wallpaper): void {
  ctx.fillStyle = wp.base;
  ctx.fillRect(0, 0, w, h);
  const light = isLight(wp.base);
  const accent = wp.colors[0] ?? "#0a84ff";
  const glow = ctx.createRadialGradient(w * 0.15, h * 0.1, 0, w * 0.15, h * 0.1, Math.max(w, h) * 0.8);
  glow.addColorStop(0, `${accent}${light ? "33" : "40"}`);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  const spacing = Math.max(w, h) / 44;
  const radius = Math.max(1, spacing * 0.075);
  ctx.fillStyle = light ? "rgba(29,29,31,0.16)" : "rgba(255,255,255,0.13)";
  for (let y = spacing / 2; y < h; y += spacing) {
    for (let x = spacing / 2; x < w; x += spacing) {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function drawWallpaper(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  wp: Wallpaper,
): void {
  ctx.save();
  switch (wp.kind) {
    case "mesh": {
      const light = isLight(wp.base);
      const blobs =
        wp.blobs ??
        wp.colors.slice(0, 4).map((color, i) => ({
          ...MESH_LAYOUT[i],
          color,
          blend: light ? ("source-over" as const) : ("screen" as const),
        }));
      drawMeshBackground(ctx, width, height, { id: wp.id, name: wp.name, base: wp.base, blobs });
      break;
    }
    case "linear": {
      drawLinearGradient(ctx, width, height, wp.colors, wp.angle ?? 135);
      if (!isLight(wp.base)) {
        const v = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) * 0.75);
        v.addColorStop(0, "rgba(0,0,0,0)");
        v.addColorStop(1, "rgba(0,0,0,0.22)");
        ctx.fillStyle = v;
        ctx.fillRect(0, 0, width, height);
      }
      break;
    }
    case "aurora":
      drawAurora(ctx, width, height, wp);
      break;
    case "rings":
      drawRings(ctx, width, height, wp);
      break;
    case "beams":
      drawBeams(ctx, width, height, wp);
      break;
    case "dots":
      drawDots(ctx, width, height, wp);
      break;
  }
  ctx.restore();
}

const thumbCache = new Map<string, string>();

/** A small JPEG of the wallpaper for the picker, rendered once per id. */
export function wallpaperThumbnail(id: string, width = 192, height = 108): string {
  const key = `${id}|${width}x${height}`;
  const hit = thumbCache.get(key);
  if (hit) return hit;
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  drawWallpaper(ctx, width, height, getWallpaper(id));
  const url = canvas.toDataURL("image/jpeg", 0.86);
  thumbCache.set(key, url);
  return url;
}
