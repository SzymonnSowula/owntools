/**
 * Scene engine for product-launch videos. Deterministic: every frame is a pure
 * function of (spec, template, time), so preview and offline export are
 * pixel-identical. Aesthetic: the suite's desktop metaphor — dotted canvas,
 * window-chrome cards, calm keynote typography.
 */

export interface LaunchSpec {
  name: string;
  tagline: string;
  features: string[];
  url: string;
  accent: string;
  image: HTMLImageElement | null;
}

export type TemplateId = "keynote" | "showcase" | "floating";

export const TEMPLATES: { id: TemplateId; label: string; desc: string }[] = [
  { id: "keynote", label: "Keynote", desc: "Big type, one idea at a time" },
  { id: "showcase", label: "Showcase", desc: "Your product shot front and center" },
  { id: "floating", label: "Floating", desc: "Scattered desktop windows" },
];

interface Scene {
  duration: number;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number, t: number, spec: LaunchSpec) => void;
}

/* ------------------------------ helpers ------------------------------ */

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function smooth(t: number): number {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

function easeOut(t: number): number {
  return 1 - (1 - clamp01(t)) ** 3;
}

/** Progress of a sub-animation inside a scene: starts at `from`, lasts `len`. */
function seg(t: number, from: number, len: number): number {
  return clamp01((t - from) / len);
}

const INK = "#141414";
const MUTED = "#8a8a8a";
const PAPER = "#fafafa";

function display(size: number, weight = 700): string {
  return `${weight} ${Math.round(size)}px Outfit, Inter, ui-sans-serif, sans-serif`;
}

function body(size: number, weight = 500): string {
  return `${weight} ${Math.round(size)}px Inter, ui-sans-serif, sans-serif`;
}

function drawBg(ctx: CanvasRenderingContext2D, w: number, h: number, accent: string): void {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);
  // dot grid
  const gap = Math.round(w / 72);
  ctx.fillStyle = "rgba(17,17,17,0.07)";
  for (let y = gap / 2; y < h; y += gap) {
    for (let x = gap / 2; x < w; x += gap) {
      ctx.fillRect(x, y, 2, 2);
    }
  }
  // soft accent glow
  const g = ctx.createRadialGradient(w * 0.5, h * 1.05, 0, w * 0.5, h * 1.05, h * 0.9);
  g.addColorStop(0, `${accent}2e`);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Draws a mac-style window card; returns the content rect. */
function drawWindow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  opts: { alpha?: number; rotate?: number; shadow?: number } = {},
): { x: number; y: number; w: number; h: number } {
  const { alpha = 1, rotate = 0, shadow = 0.16 } = opts;
  const bar = Math.max(30, h * 0.075);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.translate(-(x + w / 2), -(y + h / 2));

  ctx.shadowColor = `rgba(17,17,17,${shadow})`;
  ctx.shadowBlur = 46;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, x, y, w, h, 16);
  ctx.fill();
  ctx.shadowColor = "transparent";

  ctx.strokeStyle = "rgba(17,17,17,0.1)";
  ctx.lineWidth = 1.5;
  roundRect(ctx, x, y, w, h, 16);
  ctx.stroke();

  ctx.fillStyle = "rgba(17,17,17,0.045)";
  roundRect(ctx, x, y, w, bar, 16);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y + bar - 16, w, 16);
  ctx.strokeStyle = "rgba(17,17,17,0.08)";
  ctx.beginPath();
  ctx.moveTo(x, y + bar);
  ctx.lineTo(x + w, y + bar);
  ctx.stroke();

  const dotR = bar * 0.16;
  const colors = ["#ff5f57", "#febc2e", "#28c840"];
  colors.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x + bar * 0.55 + i * dotR * 3.1, y + bar / 2, dotR, 0, Math.PI * 2);
    ctx.fill();
  });

  if (title) {
    ctx.fillStyle = MUTED;
    ctx.font = body(bar * 0.34, 500);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(title, x + bar * 0.55 + 3 * dotR * 3.1 + 6, y + bar / 2 + 1);
  }

  ctx.restore();
  return { x, y: y + bar, w, h: h - bar };
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  rect: { x: number; y: number; w: number; h: number },
  zoom = 1,
  alpha = 1,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 0);
  ctx.clip();
  const scale = Math.max(rect.w / img.width, rect.h / img.height) * zoom;
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, rect.x + (rect.w - dw) / 2, rect.y + (rect.h - dh) / 2, dw, dh);
  ctx.restore();
}

function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  base: number,
  fontFor: (size: number) => string,
): number {
  let size = base;
  ctx.font = fontFor(size);
  while (size > base * 0.4 && ctx.measureText(text).width > maxWidth) {
    size *= 0.94;
    ctx.font = fontFor(size);
  }
  return size;
}

function fadeRiseText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  color: string,
  p: number,
  rise = 26,
): void {
  ctx.save();
  ctx.globalAlpha = smooth(p);
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + (1 - easeOut(p)) * rise);
  ctx.restore();
}

function urlPill(
  ctx: CanvasRenderingContext2D,
  url: string,
  cx: number,
  cy: number,
  accent: string,
  p: number,
): void {
  if (!url) return;
  const label = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  ctx.save();
  ctx.globalAlpha = smooth(p);
  ctx.font = body(26, 600);
  const w = ctx.measureText(label).width + 64;
  const h = 56;
  ctx.fillStyle = accent;
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx, cy + 1);
  ctx.restore();
}

/* ------------------------------ templates ------------------------------ */

function keynoteScenes(spec: LaunchSpec): Scene[] {
  const scenes: Scene[] = [];

  scenes.push({
    duration: 2.4,
    draw(ctx, w, h, t, s) {
      drawBg(ctx, w, h, s.accent);
      fadeRiseText(ctx, "introducing", w / 2, h * 0.38, body(30, 600), MUTED, seg(t, 0.05, 0.3));
      const size = fitFont(ctx, s.name, w * 0.82, h * 0.17, (n) => display(n));
      const p = seg(t, 0.16, 0.42);
      ctx.save();
      ctx.globalAlpha = smooth(p);
      const scale = 0.94 + 0.06 * easeOut(p);
      ctx.translate(w / 2, h * 0.52);
      ctx.scale(scale, scale);
      ctx.font = display(size);
      ctx.fillStyle = INK;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(s.name, 0, 0);
      ctx.restore();
    },
  });

  scenes.push({
    duration: 2.8,
    draw(ctx, w, h, t, s) {
      drawBg(ctx, w, h, s.accent);
      ctx.font = display(h * 0.045);
      ctx.fillStyle = MUTED;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(s.name, w / 2, h * 0.16);
      const size = fitFont(ctx, s.tagline, w * 0.84, h * 0.085, (n) => display(n, 650));
      fadeRiseText(ctx, s.tagline, w / 2, h * 0.5, display(size, 650), INK, seg(t, 0.05, 0.4));
      const barP = seg(t, 0.35, 0.4);
      ctx.fillStyle = s.accent;
      const bw = w * 0.12 * easeOut(barP);
      roundRect(ctx, w / 2 - bw / 2, h * 0.6, bw, 8, 4);
      ctx.fill();
    },
  });

  if (spec.features.length) {
    scenes.push({
      duration: 3.6,
      draw(ctx, w, h, t, s) {
        drawBg(ctx, w, h, s.accent);
        fadeRiseText(ctx, "what you get", w / 2, h * 0.16, body(30, 600), MUTED, seg(t, 0, 0.25));
        const feats = s.features.slice(0, 4);
        const rowH = h * 0.13;
        const startY = h * 0.5 - ((feats.length - 1) * rowH) / 2;
        feats.forEach((f, i) => {
          const p = seg(t, 0.12 + i * 0.14, 0.35);
          const y = startY + i * rowH;
          ctx.save();
          ctx.globalAlpha = smooth(p);
          const dx = (1 - easeOut(p)) * 60;
          ctx.fillStyle = s.accent;
          ctx.beginPath();
          ctx.arc(w * 0.24 + dx, y, 9, 0, Math.PI * 2);
          ctx.fill();
          const size = fitFont(ctx, f, w * 0.52, h * 0.05, (n) => display(n, 600));
          ctx.font = display(size, 600);
          ctx.fillStyle = INK;
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(f, w * 0.27 + dx, y + 1);
          ctx.restore();
        });
      },
    });
  }

  if (spec.image) {
    scenes.push({
      duration: 2.8,
      draw(ctx, w, h, t, s) {
        drawBg(ctx, w, h, s.accent);
        const p = seg(t, 0, 0.35);
        const cw = w * 0.68;
        const ch = h * 0.72;
        const rect = drawWindow(ctx, (w - cw) / 2, h * 0.5 - ch / 2 + (1 - easeOut(p)) * 50, cw, ch, `${s.name.toLowerCase()}.app`, {
          alpha: smooth(p),
        });
        if (s.image) drawImageCover(ctx, s.image, rect, 1 + t * 0.05, smooth(p));
      },
    });
  }

  scenes.push({
    duration: 2.2,
    draw(ctx, w, h, t, s) {
      drawBg(ctx, w, h, s.accent);
      const size = fitFont(ctx, s.name, w * 0.7, h * 0.13, (n) => display(n));
      fadeRiseText(ctx, s.name, w / 2, h * 0.42, display(size), INK, seg(t, 0, 0.35));
      fadeRiseText(ctx, "available today", w / 2, h * 0.55, body(30, 600), MUTED, seg(t, 0.2, 0.35));
      urlPill(ctx, s.url, w / 2, h * 0.68, s.accent, seg(t, 0.32, 0.35));
    },
  });

  return scenes;
}

function showcaseScenes(spec: LaunchSpec): Scene[] {
  const scenes: Scene[] = [];

  scenes.push({
    duration: 2.2,
    draw(ctx, w, h, t, s) {
      drawBg(ctx, w, h, s.accent);
      const size = fitFont(ctx, s.name, w * 0.8, h * 0.15, (n) => display(n));
      fadeRiseText(ctx, s.name, w / 2, h * 0.44, display(size), INK, seg(t, 0.05, 0.4));
      const tagSize = fitFont(ctx, s.tagline, w * 0.7, h * 0.04, (n) => body(n, 500));
      fadeRiseText(ctx, s.tagline, w / 2, h * 0.58, body(tagSize, 500), MUTED, seg(t, 0.3, 0.4));
    },
  });

  if (spec.image) {
    scenes.push({
      duration: 4.4,
      draw(ctx, w, h, t, s) {
        drawBg(ctx, w, h, s.accent);
        const inP = seg(t, 0, 0.18);
        const cw = w * (0.6 + 0.16 * smooth(seg(t, 0.1, 0.8)));
        const ch = cw * 0.62;
        const rect = drawWindow(
          ctx,
          (w - cw) / 2,
          (h - ch) / 2,
          cw,
          ch,
          `${s.name.toLowerCase()}.app`,
          { alpha: smooth(inP), shadow: 0.2 },
        );
        if (s.image) drawImageCover(ctx, s.image, rect, 1 + t * 0.08, smooth(inP));
        ctx.save();
        ctx.globalAlpha = smooth(seg(t, 0.55, 0.3));
        ctx.font = body(28, 600);
        ctx.fillStyle = INK;
        ctx.textAlign = "center";
        ctx.fillText(s.tagline, w / 2, h * 0.93);
        ctx.restore();
      },
    });
  }

  if (spec.features.length) {
    scenes.push({
      duration: 3.4,
      draw(ctx, w, h, t, s) {
        drawBg(ctx, w, h, s.accent);
        const feats = s.features.slice(0, 3);
        const cw = Math.min(w * 0.28, (w * 0.9) / feats.length - 24);
        const ch = h * 0.4;
        const totalW = feats.length * cw + (feats.length - 1) * 28;
        feats.forEach((f, i) => {
          const p = seg(t, 0.08 + i * 0.16, 0.4);
          const x = (w - totalW) / 2 + i * (cw + 28);
          const y = h * 0.5 - ch / 2 + (1 - easeOut(p)) * 70;
          const rect = drawWindow(ctx, x, y, cw, ch, `feature ${i + 1}`, {
            alpha: smooth(p),
            rotate: i % 2 === 0 ? -1 : 1,
          });
          ctx.save();
          ctx.globalAlpha = smooth(p);
          ctx.fillStyle = s.accent;
          ctx.beginPath();
          ctx.arc(rect.x + 34, rect.y + 40, 10, 0, Math.PI * 2);
          ctx.fill();
          ctx.font = body(Math.min(30, cw * 0.09), 600);
          ctx.fillStyle = INK;
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          // naive wrap
          const words = f.split(/\s+/);
          let line = "";
          let ly = rect.y + 72;
          for (const word of words) {
            const next = line ? `${line} ${word}` : word;
            if (ctx.measureText(next).width > cw - 60 && line) {
              ctx.fillText(line, rect.x + 30, ly);
              ly += 38;
              line = word;
            } else {
              line = next;
            }
          }
          if (line) ctx.fillText(line, rect.x + 30, ly);
          ctx.restore();
        });
        fadeRiseText(ctx, "why people switch", w / 2, h * 0.14, body(30, 600), MUTED, seg(t, 0, 0.3));
      },
    });
  }

  scenes.push({
    duration: 2.2,
    draw(ctx, w, h, t, s) {
      drawBg(ctx, w, h, s.accent);
      const size = fitFont(ctx, s.name, w * 0.7, h * 0.13, (n) => display(n));
      fadeRiseText(ctx, s.name, w / 2, h * 0.45, display(size), INK, seg(t, 0, 0.35));
      urlPill(ctx, s.url, w / 2, h * 0.62, s.accent, seg(t, 0.25, 0.35));
    },
  });

  return scenes;
}

function floatingScenes(spec: LaunchSpec): Scene[] {
  interface FloatCard {
    rx: number; // relative center x
    ry: number;
    rw: number;
    rot: number;
    delay: number;
    kind: "image" | "feature";
    text?: string;
  }

  const cards: FloatCard[] = [];
  if (spec.image) cards.push({ rx: 0.2, ry: 0.3, rw: 0.26, rot: -3, delay: 0, kind: "image" });
  spec.features.slice(0, 4).forEach((f, i) => {
    const spots = [
      { rx: 0.8, ry: 0.26, rot: 2.5 },
      { rx: 0.16, ry: 0.74, rot: 2 },
      { rx: 0.83, ry: 0.72, rot: -2.5 },
      { rx: 0.5, ry: 0.86, rot: 1.2 },
    ];
    const s = spots[i % spots.length];
    cards.push({ ...s, rw: 0.2, delay: 0.08 + i * 0.09, kind: "feature", text: f });
  });

  const drawScatter = (
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    t: number,
    s: LaunchSpec,
    reveal: number,
  ) => {
    drawBg(ctx, w, h, s.accent);
    for (const card of cards) {
      const p = seg(reveal, card.delay, 0.4);
      if (p <= 0) continue;
      const cw = w * card.rw;
      const ch = card.kind === "image" ? cw * 0.68 : cw * 0.52;
      const drift = Math.sin((t * 2 + card.rx * 10) * Math.PI * 0.2) * 6;
      const x = w * card.rx - cw / 2;
      const y = h * card.ry - ch / 2 + (1 - easeOut(p)) * 90 + drift;
      const rect = drawWindow(ctx, x, y, cw, ch, card.kind === "image" ? "preview.png" : "note.txt", {
        alpha: smooth(p),
        rotate: card.rot,
        shadow: 0.14,
      });
      ctx.save();
      ctx.globalAlpha = smooth(p);
      if (card.kind === "image" && s.image) {
        drawImageCover(ctx, s.image, rect, 1, smooth(p));
      } else if (card.text) {
        ctx.font = body(Math.min(24, cw * 0.085), 600);
        ctx.fillStyle = INK;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        const words = card.text.split(/\s+/);
        let line = "";
        let ly = rect.y + 20;
        for (const word of words) {
          const next = line ? `${line} ${word}` : word;
          if (ctx.measureText(next).width > cw - 44 && line) {
            ctx.fillText(line, rect.x + 22, ly);
            ly += 30;
            line = word;
          } else {
            line = next;
          }
        }
        if (line) ctx.fillText(line, rect.x + 22, ly);
      }
      ctx.restore();
    }
  };

  return [
    {
      duration: 4.4,
      draw(ctx, w, h, t, s) {
        drawScatter(ctx, w, h, t, s, seg(t, 0, 0.75));
        const size = fitFont(ctx, s.name, w * 0.5, h * 0.15, (n) => display(n));
        fadeRiseText(ctx, s.name, w / 2, h * 0.46, display(size), INK, seg(t, 0.25, 0.35));
        fadeRiseText(ctx, s.tagline, w / 2, h * 0.58, body(30, 500), MUTED, seg(t, 0.45, 0.35));
      },
    },
    {
      duration: 2.4,
      draw(ctx, w, h, t, s) {
        drawScatter(ctx, w, h, t + 4.4, s, 1);
        const size = fitFont(ctx, s.name, w * 0.5, h * 0.15, (n) => display(n));
        ctx.font = display(size);
        ctx.fillStyle = INK;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(s.name, w / 2, h * 0.46);
        urlPill(ctx, s.url, w / 2, h * 0.62, s.accent, seg(t, 0.15, 0.35));
      },
    },
  ];
}

/* ------------------------------ public API ------------------------------ */

export function buildScenes(template: TemplateId, spec: LaunchSpec): Scene[] {
  if (template === "showcase") return showcaseScenes(spec);
  if (template === "floating") return floatingScenes(spec);
  return keynoteScenes(spec);
}

export function totalDuration(scenes: Scene[]): number {
  return scenes.reduce((sum, s) => sum + s.duration, 0);
}

export function drawAtTime(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
  scenes: Scene[],
  spec: LaunchSpec,
): void {
  let t = Math.max(0, time);
  for (const scene of scenes) {
    if (t <= scene.duration || scene === scenes[scenes.length - 1]) {
      scene.draw(ctx, w, h, Math.min(1, t / scene.duration), spec);
      return;
    }
    t -= scene.duration;
  }
}
