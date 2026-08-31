import type { AspectRatio, Project } from "../types";
import { drawMeshBackground, getPreset } from "./gradients";
import { getZoomTransform } from "./zoom";

export function canvasSize(aspect: AspectRatio): { width: number; height: number } {
  if (aspect === "9:16") return { width: 1080, height: 1920 };
  if (aspect === "1:1") return { width: 1080, height: 1080 };
  return { width: 1920, height: 1080 };
}

function roundRectPath(
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

function windowRect(
  canvasW: number,
  canvasH: number,
  videoW: number,
  videoH: number,
  padding: number,
): { x: number; y: number; w: number; h: number } {
  const pad = padding * Math.min(canvasW, canvasH);
  const maxW = Math.max(32, canvasW - pad * 2);
  const maxH = Math.max(32, canvasH - pad * 2);
  const va = videoW / Math.max(1, videoH);
  let w = maxW;
  let h = w / va;
  if (h > maxH) {
    h = maxH;
    w = h * va;
  }
  return { x: (canvasW - w) / 2, y: (canvasH - h) / 2, w, h };
}

function isVideoReady(video: CanvasImageSource | null | undefined): video is CanvasImageSource {
  if (!video) return false;
  if (video instanceof HTMLVideoElement) {
    return video.readyState >= 2 && video.videoWidth > 0;
  }
  return true;
}

export interface DrawFrameInput {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  sourceTime: number;
  project: Project;
  screenVideo: CanvasImageSource | null;
  webcamVideo?: CanvasImageSource | null;
  backgroundImage?: CanvasImageSource | null;
  watermark?: boolean;
}

/**
 * The background mesh + drop shadow + card fill never change between frames of
 * the same project settings, and shadow blur is by far the most expensive 2D
 * canvas operation here — so this static layer is rendered once and reused.
 */
interface BackdropCacheEntry {
  image: CanvasImageSource | null;
  canvas: HTMLCanvasElement;
}
// Small LRU keyed by settings: preview and export render at different sizes
// simultaneously, and both must keep hitting the cache.
const backdropCache = new Map<string, BackdropCacheEntry>();

function getBackdrop(
  width: number,
  height: number,
  project: Project,
  backgroundImage: CanvasImageSource | null | undefined,
  rect: { x: number; y: number; w: number; h: number },
): HTMLCanvasElement {
  const bg = project.background;
  const image =
    backgroundImage && !(backgroundImage instanceof HTMLImageElement && !backgroundImage.complete)
      ? backgroundImage
      : null;
  const key = [width, height, bg.presetId, bg.padding, bg.windowRadius, bg.shadow].join("|");
  const hit = backdropCache.get(key);
  if (hit && hit.image === image) {
    backdropCache.delete(key);
    backdropCache.set(key, hit);
    return hit.canvas;
  }

  const canvas = hit?.canvas ?? document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, width, height);

  if (image) {
    ctx.drawImage(image, 0, 0, width, height);
  } else {
    drawMeshBackground(ctx, width, height, getPreset(bg.presetId));
  }

  const shadow = bg.shadow;
  ctx.save();
  ctx.shadowColor = `rgba(16, 12, 28, ${0.16 + shadow * 0.5})`;
  ctx.shadowBlur = 18 + shadow * 54;
  ctx.shadowOffsetY = 10 + shadow * 22;
  ctx.fillStyle = "#0b0b12";
  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, bg.windowRadius);
  ctx.fill();
  ctx.restore();

  backdropCache.set(key, { image, canvas });
  if (backdropCache.size > 4) {
    const oldest = backdropCache.keys().next().value;
    if (oldest !== undefined) backdropCache.delete(oldest);
  }
  return canvas;
}

export function drawFrame(input: DrawFrameInput): void {
  const { ctx, width, height, sourceTime, project, screenVideo, webcamVideo, backgroundImage } =
    input;

  const vw = project.videoWidth || 1920;
  const vh = project.videoHeight || 1080;
  const rect = windowRect(width, height, vw, vh, project.background.padding);
  const radius = project.background.windowRadius;

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(getBackdrop(width, height, project, backgroundImage, rect), 0, 0);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, radius);
  ctx.clip();

  const zooms = project.autoZoom
    ? project.zooms
    : project.zooms.filter((z) => z.source === "manual");
  const zoom = getZoomTransform(
    zooms,
    sourceTime,
    project.cursor,
    project.screenWidth || vw,
    project.screenHeight || vh,
  );

  ctx.translate(rect.x, rect.y);
  ctx.translate(rect.w * zoom.x, rect.h * zoom.y);
  ctx.scale(zoom.scale, zoom.scale);
  ctx.translate(-rect.w * zoom.x, -rect.h * zoom.y);

  if (isVideoReady(screenVideo)) {
    ctx.drawImage(screenVideo, 0, 0, rect.w, rect.h);
  } else {
    ctx.fillStyle = "#111018";
    ctx.fillRect(0, 0, rect.w, rect.h);
  }
  ctx.restore();

  if (project.webcam.enabled && isVideoReady(webcamVideo) && sourceTime >= project.webcamOffset) {
    drawWebcam(ctx, width, height, project, webcamVideo);
  }

  drawCaptions(ctx, width, height, project, sourceTime);
  drawTexts(ctx, width, height, project, sourceTime);

  if (input.watermark) drawWatermark(ctx, width, height);
}

export function drawWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const fontSize = Math.max(13, Math.round(height * 0.02));
  const padX = fontSize * 0.85;
  const padY = fontSize * 0.5;
  const margin = Math.round(height * 0.022);
  ctx.save();
  ctx.font = `600 ${fontSize}px Outfit, ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const label = "Made with Screeni";
  const dot = fontSize * 0.5;
  const textW = ctx.measureText(label).width;
  const w = textW + dot + fontSize * 0.5 + padX * 2;
  const h = fontSize + padY * 2;
  const x = width - margin - w;
  const y = height - margin - h;
  ctx.fillStyle = "rgba(12, 10, 20, 0.55)";
  roundRectPath(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = "#ff715f";
  ctx.beginPath();
  ctx.arc(x + padX + dot / 2, y + h / 2, dot / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 253, 251, 0.95)";
  ctx.fillText(label, x + padX + dot + fontSize * 0.5, y + h / 2 + fontSize * 0.06);
  ctx.restore();
}

function drawWebcam(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  project: Project,
  video: CanvasImageSource,
): void {
  const size = project.webcam.size * Math.min(width, height);
  const margin = 28 + project.background.padding * Math.min(width, height) * 0.25;
  let x = margin;
  let y = margin;
  if (project.webcam.corner === "tr") x = width - margin - size;
  if (project.webcam.corner === "bl") y = height - margin - size;
  if (project.webcam.corner === "br") {
    x = width - margin - size;
    y = height - margin - size;
  }

  ctx.save();
  ctx.shadowColor = "rgba(16,12,28,0.35)";
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 8;
  roundRectPath(ctx, x, y, size, size, project.webcam.radius);
  ctx.fillStyle = "#0b0b12";
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRectPath(ctx, x, y, size, size, project.webcam.radius);
  ctx.clip();

  let sw = size;
  let sh = size;
  if (video instanceof HTMLVideoElement && video.videoWidth > 0) {
    const va = video.videoWidth / video.videoHeight;
    if (va > 1) {
      sw = size * va;
      sh = size;
    } else {
      sw = size;
      sh = size / va;
    }
  }
  ctx.drawImage(video, x + (size - sw) / 2, y + (size - sh) / 2, sw, sh);
  ctx.restore();

  if (project.webcam.border) {
    ctx.save();
    ctx.strokeStyle = project.webcam.borderColor;
    ctx.lineWidth = Math.max(2, size * 0.018);
    roundRectPath(ctx, x, y, size, size, project.webcam.radius);
    ctx.stroke();
    ctx.restore();
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawCaptions(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  project: Project,
  t: number,
): void {
  const cap = project.captions.find((c) => t >= c.start && t <= c.end);
  if (!cap) return;

  if (cap.style === "tiktok") {
    const fontSize = Math.round(height * 0.052);
    ctx.font = `800 ${fontSize}px Outfit, ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const words = cap.words?.length
      ? cap.words
      : cap.text.split(/\s+/).map((word, i, arr) => {
          const dur = Math.max(0.001, cap.end - cap.start);
          const slice = dur / Math.max(1, arr.length);
          return { word, start: cap.start + i * slice, end: cap.start + (i + 1) * slice };
        });
    const line = words.map((w) => w.word).join(" ");
    const y = height * 0.84;
    ctx.lineJoin = "round";
    ctx.lineWidth = fontSize * 0.18;
    ctx.strokeStyle = "rgba(12,10,20,0.72)";
    ctx.strokeText(line, width / 2, y);

    let x = width / 2 - ctx.measureText(line).width / 2;
    for (const w of words) {
      const active = t >= w.start && t < w.end;
      ctx.fillStyle = active ? "#ff715f" : "#fffdfb";
      const ww = ctx.measureText(w.word).width;
      const space = ctx.measureText(" ").width;
      ctx.fillText(w.word, x + ww / 2, y);
      x += ww + space;
    }
    return;
  }

  const fontSize = Math.round(height * 0.032);
  ctx.font = `600 ${fontSize}px Outfit, ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = wrapText(ctx, cap.text, width * 0.72);
  const lineH = fontSize * 1.35;
  const boxH = lineH * lines.length + 18;
  const boxW = Math.min(
    width * 0.78,
    Math.max(...lines.map((l) => ctx.measureText(l).width)) + 36,
  );
  const y = height * 0.9;
  ctx.fillStyle = "rgba(12,10,20,0.62)";
  roundRectPath(ctx, (width - boxW) / 2, y - boxH / 2, boxW, boxH, 10);
  ctx.fill();
  ctx.fillStyle = "#fffdfb";
  lines.forEach((line, i) => {
    ctx.fillText(line, width / 2, y - ((lines.length - 1) * lineH) / 2 + i * lineH);
  });
}

function drawTexts(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  project: Project,
  t: number,
): void {
  for (const item of project.texts) {
    if (t < item.start || t > item.end) continue;
    const size = item.fontSize * height;
    ctx.save();
    ctx.font = `${item.weight} ${Math.round(size)}px Outfit, ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = item.color;
    ctx.textAlign = item.align;
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(12,10,20,0.35)";
    ctx.shadowBlur = 10;
    ctx.fillText(item.text, item.x * width, item.y * height);
    ctx.restore();
  }
}
