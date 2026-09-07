import type { CursorSample, CursorSettings, InputTrack } from "../types";
import { normalizeCursor, type CursorFrame } from "./cursorMap";
import { sampleCursorAt } from "./zoom";

/**
 * Cursor effects drawn over the captured video. WebView2 always bakes the
 * real pointer into a screen capture, so nothing here can hide it — a custom
 * pointer is drawn on top and, at 1.4× or more, covers the recorded one. Click
 * ripples and the spotlight sit around the pointer and work at any size.
 * Positions come from the recorder's 33 ms samples in screen coordinates.
 */

export interface ClickEvent {
  t: number;
  x: number;
  y: number;
}

export const CLICK_RIPPLE_SECONDS = 0.55;

/** Every press: a sample that is down while the previous one was not. */
export function extractClicks(samples: CursorSample[]): ClickEvent[] {
  const out: ClickEvent[] = [];
  let wasDown = false;
  for (const s of samples) {
    if (s.down && !wasDown) out.push({ t: s.t, x: s.x, y: s.y });
    wasDown = s.down;
  }
  return out;
}

/** Left-button presses off the native input track: stamped at 250 Hz, at the exact pointer position. */
export function clicksFromInputs(inputs: InputTrack): ClickEvent[] {
  const out: ClickEvent[] = [];
  for (const b of inputs.buttons) {
    if (b.down && b.button === "left") out.push({ t: b.t, x: b.x, y: b.y });
  }
  return out;
}

const clickCache = new WeakMap<CursorSample[] | InputTrack, ClickEvent[]>();

/** The take's clicks — the precise track when there is one, else the cursor track's down-edges. */
export function clicksFor(samples: CursorSample[], inputs?: InputTrack): ClickEvent[] {
  const key = inputs ?? samples;
  let hit = clickCache.get(key);
  if (!hit) {
    hit = inputs ? clicksFromInputs(inputs) : extractClicks(samples);
    clickCache.set(key, hit);
  }
  return hit;
}

/** Clicks whose ripple is still visible at `t`. */
export function activeClicks(clicks: ClickEvent[], t: number): ClickEvent[] {
  // Clicks are in time order; scan back from the last one that started before t.
  const out: ClickEvent[] = [];
  for (let i = clicks.length - 1; i >= 0; i--) {
    const c = clicks[i];
    if (c.t > t) continue;
    if (t - c.t > CLICK_RIPPLE_SECONDS) break;
    out.push(c);
  }
  return out;
}

export interface CursorDrawInput {
  ctx: CanvasRenderingContext2D;
  /** The video rectangle, in the coordinate space the context is already in. */
  w: number;
  h: number;
  /** Maps desktop pixels to this frame; null means we cannot place the pointer. */
  frame: CursorFrame;
  samples: CursorSample[];
  /** Precise presses, when the take has them; the rings land on these instead. */
  inputs?: InputTrack;
  sourceTime: number;
  settings: CursorSettings;
}

/** Windows-style pointer outline; hotspot at (0, 0), designed in a 24 px box. */
const ARROW: [number, number][] = [
  [0, 0],
  [0, 17],
  [4.6, 13],
  [7.6, 19.6],
  [10.6, 18.3],
  [7.7, 11.8],
  [13.6, 11.8],
];

function contrast(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#000000";
  const n = parseInt(m[1], 16);
  const l = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return l > 0.55 ? "#14141a" : "#ffffff";
}

function hexAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(10,132,255,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/**
 * Draws spotlight, ripples and pointer in that order. Call inside the clipped,
 * zoomed video space so everything scales exactly like the captured pointer.
 */
export function drawCursorLayer(input: CursorDrawInput): void {
  const { ctx, w, h, frame, samples, inputs, sourceTime, settings } = input;
  if (!samples.length) return;
  if (settings.style === "system" && !settings.clicks && !settings.spotlight) return;
  const unit = h / 1080; // 1 "canvas pixel" at 1080p, keeps sizes stable across aspects
  /** Desktop pixels → this frame. Null when the pointer was off the recorded surface. */
  const place = (px: number, py: number): { x: number; y: number } | null => {
    const p = normalizeCursor(px, py, frame.rect, frame.videoAspect, frame.align);
    return p.inside ? { x: p.nx * w, y: p.ny * h } : null;
  };

  if (settings.spotlight) {
    const c = sampleCursorAt(samples, sourceTime);
    const at = c ? place(c.x, c.y) : null;
    if (at) {
      const x = at.x;
      const y = at.y;
      const r = settings.spotlightSize * Math.min(w, h);
      const g = ctx.createRadialGradient(x, y, r * 0.55, x, y, r);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, `rgba(0,0,0,${settings.spotlightDim})`);
      ctx.save();
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = `rgba(0,0,0,${settings.spotlightDim})`;
      // Everything outside the gradient's outer radius is uniformly dimmed.
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.arc(x, y, r, 0, Math.PI * 2, true);
      ctx.fill("evenodd");
      ctx.restore();
    }
  }

  if (settings.clicks) {
    for (const click of activeClicks(clicksFor(samples, inputs), sourceTime)) {
      const at = place(click.x, click.y);
      if (!at) continue;
      const p = (sourceTime - click.t) / CLICK_RIPPLE_SECONDS;
      const x = at.x;
      const y = at.y;
      const radius = unit * (14 + 46 * p) * Math.max(1, settings.size * 0.7);
      ctx.save();
      ctx.strokeStyle = hexAlpha(settings.clickColor, 0.9 * (1 - p));
      ctx.lineWidth = unit * 3 * (1 - p * 0.6);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = hexAlpha(settings.clickColor, 0.28 * (1 - p));
      ctx.beginPath();
      ctx.arc(x, y, radius * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  if (settings.style !== "system") {
    const c = sampleCursorAt(samples, sourceTime);
    const at = c ? place(c.x, c.y) : null;
    if (!at) return;
    const x = at.x;
    const y = at.y;
    const size = unit * 24 * settings.size;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = unit * 6;
    ctx.shadowOffsetY = unit * 2;
    if (settings.style === "dot") {
      ctx.fillStyle = settings.color;
      ctx.beginPath();
      ctx.arc(x, y, size * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.lineWidth = Math.max(1, unit * 2);
      ctx.strokeStyle = contrast(settings.color);
      ctx.stroke();
    } else {
      const k = size / 24;
      ctx.translate(x, y);
      ctx.beginPath();
      ARROW.forEach(([px, py], i) => {
        if (i === 0) ctx.moveTo(px * k, py * k);
        else ctx.lineTo(px * k, py * k);
      });
      ctx.closePath();
      ctx.fillStyle = settings.color;
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(1, k * 1.6);
      ctx.strokeStyle = contrast(settings.color);
      ctx.stroke();
    }
    ctx.restore();
  }
}
