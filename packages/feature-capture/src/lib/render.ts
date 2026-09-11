import type { Rect } from "../api/types";
import { HIGHLIGHT_ALPHA, type Annotation, type StrokeAnnotation } from "./annotations";

/**
 * Drawing. One routine paints the annotations for both the live preview and
 * the export: the overlay calls it clipped to the selection on top of the
 * full frame, `composeCapture` calls it translated onto a canvas the size of
 * the crop. Coordinates are screenshot pixels throughout (see annotations.ts).
 */

export const FONT_STACK = "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif";

/** Relative luminance of a #rgb / #rrggbb colour (0 = black, 1 = white). */
export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.5;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function inkOn(color: string): string {
  return luminance(color) > 0.6 ? "#1d1d1f" : "#ffffff";
}

function haloFor(color: string): string {
  return luminance(color) > 0.6 ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.75)";
}

function drawArrowHead(ctx: CanvasRenderingContext2D, a: StrokeAnnotation): void {
  const angle = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
  const head = Math.max(10, a.width * 3.2);
  const spread = 0.46;
  ctx.beginPath();
  ctx.moveTo(a.x2, a.y2);
  ctx.lineTo(a.x2 - head * Math.cos(angle - spread), a.y2 - head * Math.sin(angle - spread));
  ctx.lineTo(a.x2 - head * Math.cos(angle + spread), a.y2 - head * Math.sin(angle + spread));
  ctx.closePath();
  ctx.fillStyle = a.color;
  ctx.fill();
}

function drawStroke(ctx: CanvasRenderingContext2D, a: StrokeAnnotation): void {
  ctx.strokeStyle = a.color;
  ctx.lineWidth = a.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  let ex = a.x2;
  let ey = a.y2;
  if (a.kind === "arrow") {
    // Stop the shaft short of the tip so the head's point stays sharp.
    const len = Math.hypot(a.x2 - a.x1, a.y2 - a.y1);
    const head = Math.max(10, a.width * 3.2) * 0.7;
    if (len > head) {
      ex = a.x2 - ((a.x2 - a.x1) / len) * head;
      ey = a.y2 - ((a.y2 - a.y1) / len) * head;
    }
  }
  ctx.beginPath();
  ctx.moveTo(a.x1, a.y1);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  if (a.kind === "arrow") drawArrowHead(ctx, a);
}

function drawPixelate(ctx: CanvasRenderingContext2D, source: CanvasImageSource, r: Rect, cell: number): void {
  const w = Math.max(1, Math.round(r.w));
  const h = Math.max(1, Math.round(r.h));
  const small = document.createElement("canvas");
  small.width = Math.max(1, Math.ceil(w / cell));
  small.height = Math.max(1, Math.ceil(h / cell));
  const sctx = small.getContext("2d");
  if (!sctx) return;
  sctx.imageSmoothingEnabled = true;
  sctx.drawImage(source, r.x, r.y, w, h, 0, 0, small.width, small.height);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, small.width, small.height, r.x, r.y, w, h);
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string, size: number): void {
  ctx.font = `600 ${size}px ${FONT_STACK}`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, size / 6);
  ctx.strokeStyle = haloFor(color);
  ctx.fillStyle = color;
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const ly = y + i * size * 1.25;
    ctx.strokeText(line, x, ly);
    ctx.fillText(line, x, ly);
  });
}

function drawBadge(ctx: CanvasRenderingContext2D, x: number, y: number, n: number, color: string, radius: number): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, radius / 7);
  ctx.strokeStyle = inkOn(color) === "#ffffff" ? "rgba(255,255,255,0.9)" : "rgba(29,29,31,0.85)";
  ctx.stroke();
  ctx.font = `700 ${radius * 1.15}px ${FONT_STACK}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = inkOn(color);
  ctx.fillText(String(n), x, y + radius * 0.06);
}

/**
 * Paints `list` in order. `source` is the untouched screenshot — a blur reads
 * its pixels from there, so a blur drawn over an arrow hides the arrow only
 * if the arrow came first in the list (the order things were made).
 */
export function renderAnnotations(ctx: CanvasRenderingContext2D, list: readonly Annotation[], source: CanvasImageSource): void {
  for (const a of list) {
    ctx.save();
    switch (a.kind) {
      case "arrow":
      case "line":
        drawStroke(ctx, a);
        break;
      case "rect":
        ctx.strokeStyle = a.color;
        ctx.lineWidth = a.width;
        ctx.lineJoin = "round";
        ctx.strokeRect(a.x, a.y, a.w, a.h);
        break;
      case "ellipse":
        ctx.strokeStyle = a.color;
        ctx.lineWidth = a.width;
        ctx.beginPath();
        ctx.ellipse(a.x + a.w / 2, a.y + a.h / 2, a.w / 2, a.h / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case "highlight":
        ctx.globalCompositeOperation = "multiply";
        ctx.globalAlpha = HIGHLIGHT_ALPHA;
        ctx.fillStyle = a.color;
        ctx.fillRect(a.x, a.y, a.w, a.h);
        break;
      case "text":
        drawText(ctx, a.x, a.y, a.text, a.color, a.size);
        break;
      case "badge":
        drawBadge(ctx, a.x, a.y, a.n, a.color, a.size);
        break;
      case "blur":
        drawPixelate(ctx, source, a, a.cell);
        break;
    }
    ctx.restore();
  }
}

/**
 * The overlay's picture: the frozen frame, a veil over everything but the
 * selection, the annotations clipped to it. Draws in device pixels — the
 * canvas is the size of the frame and the caller sizes it in CSS to the window.
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  frame: ImageBitmap,
  selection: Rect | null,
  list: readonly Annotation[],
  veil = 0.45,
): void {
  const W = frame.width;
  const H = frame.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(frame, 0, 0);
  ctx.fillStyle = `rgba(10, 10, 14, ${veil})`;
  if (!selection) {
    ctx.fillRect(0, 0, W, H);
    return;
  }
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.rect(selection.x, selection.y, selection.w, selection.h);
  ctx.fill("evenodd");
  if (list.length) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(selection.x, selection.y, selection.w, selection.h);
    ctx.clip();
    renderAnnotations(ctx, list, frame);
    ctx.restore();
  }
}

/** The crop with its mark-up, ready to encode. */
export function composeCapture(frame: ImageBitmap, rect: Rect, list: readonly Annotation[]): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(rect.w));
  canvas.height = Math.max(1, Math.round(rect.h));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(frame, rect.x, rect.y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  if (list.length) {
    ctx.save();
    ctx.translate(-rect.x, -rect.y);
    renderAnnotations(ctx, list, frame);
    ctx.restore();
  }
  return canvas;
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error("PNG encode failed"));
      blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
    }, "image/png");
  });
}
