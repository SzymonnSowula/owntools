import { WATERMARK_TEXT } from "@core/branding";
import type { AspectRatio, OverlayFont, Project } from "../types";
import { drawCursorLayer } from "./cursorFx";
import { cursorFrameAt, zoomRect } from "./cursorMap";
import { drawTransition, fadeVeilAlpha, type ActiveTransition } from "./transitions";
import {
  drawLinearGradient,
  drawWallpaper,
  getLinearGradient,
  getWallpaper,
  isLight,
} from "./wallpapers";
import { getZoomTransform } from "./zoom";

export function canvasSize(aspect: AspectRatio): { width: number; height: number } {
  if (aspect === "9:16") return { width: 1080, height: 1920 };
  if (aspect === "1:1") return { width: 1080, height: 1080 };
  return { width: 1920, height: 1080 };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function roundRectPath(
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

/** The height of the fake title bar, when the frame style asks for one. */
function frameBarHeight(width: number, height: number, project: Project): number {
  if (project.background.frame !== "bar") return 0;
  return Math.round(Math.max(24, Math.min(46, 34 * (Math.min(width, height) / 1080))));
}

export interface FrameLayout {
  /** The window card: title bar + video. */
  card: Rect;
  /** Where the video itself is drawn. */
  video: Rect;
  barH: number;
}

/**
 * Fits the video (plus its optional title bar) inside the padded canvas and
 * centres the whole card. Everything else — camera, overlays, captions — is
 * placed relative to the canvas, not the card.
 */
export function frameLayout(width: number, height: number, project: Project): FrameLayout {
  const vw = project.videoWidth || 1920;
  const vh = project.videoHeight || 1080;
  const barH = frameBarHeight(width, height, project);
  const pad = project.background.padding * Math.min(width, height);
  const maxW = Math.max(32, width - pad * 2);
  const maxH = Math.max(32, height - pad * 2 - barH);
  const va = vw / Math.max(1, vh);
  let w = maxW;
  let h = w / va;
  if (h > maxH) {
    h = maxH;
    w = h * va;
  }
  const cardH = h + barH;
  const x = (width - w) / 2;
  const y = (height - cardH) / 2;
  return {
    card: { x, y, w, h: cardH },
    video: { x, y: y + barH, w, h },
    barH,
  };
}

function isVideoReady(video: CanvasImageSource | null | undefined): video is CanvasImageSource {
  if (!video) return false;
  if (video instanceof HTMLVideoElement) {
    return video.readyState >= 2 && video.videoWidth > 0;
  }
  if (video instanceof HTMLImageElement) return video.complete && video.naturalWidth > 0;
  return true;
}

export interface DrawFrameInput {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  /** Time in the recording, for the video, cursor, captions and clips. */
  sourceTime: number;
  /** Time on the cut timeline, for the progress bar and the fades. */
  timelineTime?: number;
  timelineDuration?: number;
  project: Project;
  screenVideo: CanvasImageSource | null;
  webcamVideo?: CanvasImageSource | null;
  backgroundImage?: CanvasImageSource | null;
  /** Decoded image overlays keyed by `ImageOverlay.src`. */
  overlayImages?: Record<string, CanvasImageSource | undefined>;
  transition?: ActiveTransition | null;
  /**
   * Called with the finished picture just before any blend, progress bar, fade
   * or watermark goes on it — the moment a transition wants to remember. Taking
   * that snapshot afterwards would fold the previous blend and a second
   * watermark into the next one.
   */
  onFrameReady?: (canvas: HTMLCanvasElement) => void;
  watermark?: boolean;
}

/**
 * The background + drop shadow + card fill never change between frames of
 * the same settings, and shadow blur is by far the most expensive 2D canvas
 * operation here — so that static layer is rendered once and reused.
 */
interface BackdropCacheEntry {
  image: CanvasImageSource | null;
  canvas: HTMLCanvasElement;
}
// Small LRU keyed by settings: preview and export render at different sizes
// simultaneously, and both must keep hitting the cache.
const backdropCache = new Map<string, BackdropCacheEntry>();

/** Draws `image` covering the whole canvas without distortion. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  width: number,
  height: number,
): void {
  let iw = width;
  let ih = height;
  if (image instanceof HTMLImageElement) {
    iw = image.naturalWidth || width;
    ih = image.naturalHeight || height;
  } else if (image instanceof HTMLCanvasElement || image instanceof HTMLVideoElement) {
    iw = (image as HTMLCanvasElement).width || width;
    ih = (image as HTMLCanvasElement).height || height;
  }
  const scale = Math.max(width / iw, height / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(image, (width - dw) / 2, (height - dh) / 2, dw, dh);
}

function paintBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  project: Project,
  image: CanvasImageSource | null,
): void {
  const bg = project.background;
  const mode = bg.mode === "image" && !image ? "wallpaper" : bg.mode;
  switch (mode) {
    case "color":
      ctx.fillStyle = bg.color;
      ctx.fillRect(0, 0, width, height);
      break;
    case "gradient":
      drawLinearGradient(ctx, width, height, getLinearGradient(bg.gradientId).stops, bg.gradientAngle);
      break;
    case "image":
      drawCover(ctx, image!, width, height);
      break;
    default:
      drawWallpaper(ctx, width, height, getWallpaper(bg.presetId));
  }
}

/** Whether the backdrop reads as light, so hairlines and the title bar can pick a side. */
export function backgroundIsLight(project: Project): boolean {
  const bg = project.background;
  if (bg.mode === "color") return isLight(bg.color);
  if (bg.mode === "gradient") return isLight(getLinearGradient(bg.gradientId).stops[0]);
  if (bg.mode === "image") return false;
  return isLight(getWallpaper(bg.presetId).base);
}

function getBackdrop(
  width: number,
  height: number,
  project: Project,
  backgroundImage: CanvasImageSource | null | undefined,
  layout: FrameLayout,
): HTMLCanvasElement {
  const bg = project.background;
  const image =
    backgroundImage && !(backgroundImage instanceof HTMLImageElement && !backgroundImage.complete)
      ? backgroundImage
      : null;
  const key = [
    width,
    height,
    bg.mode,
    bg.presetId,
    bg.gradientId,
    bg.gradientAngle,
    bg.color,
    bg.blur,
    bg.padding,
    bg.windowRadius,
    bg.shadow,
    bg.frame,
    project.videoWidth,
    project.videoHeight,
  ].join("|");
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

  const blurPx = bg.blur > 0 && bg.mode !== "color" ? bg.blur * 40 * (Math.min(width, height) / 1080) : 0;
  if (blurPx > 0) {
    // Blur pulls transparency in from the edges, so the layer is drawn oversize.
    const layer = document.createElement("canvas");
    layer.width = width;
    layer.height = height;
    const lctx = layer.getContext("2d")!;
    paintBackground(lctx, width, height, project, image);
    const m = blurPx * 2;
    ctx.save();
    ctx.filter = `blur(${blurPx}px)`;
    ctx.drawImage(layer, -m, -m, width + m * 2, height + m * 2);
    ctx.restore();
  } else {
    paintBackground(ctx, width, height, project, image);
  }

  const shadow = bg.shadow;
  const { card } = layout;
  ctx.save();
  ctx.shadowColor = `rgba(16, 12, 28, ${0.16 + shadow * 0.5})`;
  ctx.shadowBlur = 18 + shadow * 54;
  ctx.shadowOffsetY = 10 + shadow * 22;
  ctx.fillStyle = "#0b0b12";
  roundRectPath(ctx, card.x, card.y, card.w, card.h, bg.windowRadius);
  ctx.fill();
  ctx.restore();

  if (layout.barH > 0) drawFrameBar(ctx, layout, bg.windowRadius);

  backdropCache.set(key, { image, canvas });
  if (backdropCache.size > 4) {
    const oldest = backdropCache.keys().next().value;
    if (oldest !== undefined) backdropCache.delete(oldest);
  }
  return canvas;
}

/** A mac-style title strip with three dots — the suite's window cards, on the video. */
function drawFrameBar(ctx: CanvasRenderingContext2D, layout: FrameLayout, radius: number): void {
  const { card, barH } = layout;
  ctx.save();
  roundRectPath(ctx, card.x, card.y, card.w, card.h, radius);
  ctx.clip();
  ctx.fillStyle = "#1c1c22";
  ctx.fillRect(card.x, card.y, card.w, barH);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(card.x, card.y + barH - 1, card.w, 1);
  const r = barH * 0.17;
  const cy = card.y + barH / 2;
  ["#ff5f57", "#febc2e", "#28c840"].forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(card.x + barH * 0.62 + i * r * 2.9, cy, r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

export function drawFrame(input: DrawFrameInput): void {
  const { ctx, width, height, sourceTime, project, screenVideo, webcamVideo, backgroundImage } = input;
  const layout = frameLayout(width, height, project);
  const { video, card } = layout;
  const radius = project.background.windowRadius;
  const unit = Math.min(width, height) / 1080;

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(getBackdrop(width, height, project, backgroundImage, layout), 0, 0);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // Clip to the card so the video's top corners stay square under the title bar.
  roundRectPath(ctx, card.x, card.y, card.w, card.h, radius);
  ctx.clip();
  ctx.beginPath();
  ctx.rect(video.x, video.y, video.w, video.h);
  ctx.clip();

  const zooms = project.autoZoom
    ? project.zooms
    : project.zooms.filter((z) => z.source === "manual");
  const zoom = getZoomTransform(zooms, sourceTime, project.cursor, zoomRect(project));

  ctx.translate(video.x, video.y);
  ctx.translate(video.w * zoom.x, video.h * zoom.y);
  ctx.scale(zoom.scale, zoom.scale);
  ctx.translate(-video.w * zoom.x, -video.h * zoom.y);

  if (isVideoReady(screenVideo)) {
    ctx.drawImage(screenVideo, 0, 0, video.w, video.h);
  } else {
    ctx.fillStyle = "#111018";
    ctx.fillRect(0, 0, video.w, video.h);
  }

  // Only when we know which rectangle of the desktop this video shows — see
  // cursorMap.ts. Without it the pointer would land somewhere else entirely.
  const cursorFrame = cursorFrameAt(project, sourceTime);
  if (cursorFrame) {
    drawCursorLayer({
      ctx,
      w: video.w,
      h: video.h,
      frame: cursorFrame,
      samples: project.cursor,
      inputs: project.inputs,
      sourceTime,
      settings: project.cursorStyle,
    });
  }
  ctx.restore();

  if (project.background.border > 0) {
    ctx.save();
    ctx.strokeStyle = backgroundIsLight(project)
      ? `rgba(0,0,0,${project.background.border * 0.22})`
      : `rgba(255,255,255,${project.background.border * 0.45})`;
    ctx.lineWidth = Math.max(1, 1.5 * unit);
    roundRectPath(ctx, card.x + 0.75 * unit, card.y + 0.75 * unit, card.w - 1.5 * unit, card.h - 1.5 * unit, radius);
    ctx.stroke();
    ctx.restore();
  }

  if (project.webcam.enabled && isVideoReady(webcamVideo) && sourceTime >= project.webcamOffset) {
    drawWebcam(ctx, width, height, project, webcamVideo);
  }

  drawImageOverlays(ctx, width, height, project, sourceTime, input.overlayImages);
  drawCaptions(ctx, width, height, project, sourceTime);
  drawTexts(ctx, width, height, project, sourceTime);

  input.onFrameReady?.(ctx.canvas);

  if (input.transition && input.transition.kind !== "none") {
    drawTransition(ctx, width, height, input.transition);
  }

  const tl = input.timelineTime ?? sourceTime;
  const tlDur = input.timelineDuration ?? project.duration;
  if (project.progressBar.enabled && tlDur > 0) {
    drawProgressBar(ctx, width, height, project, Math.min(1, Math.max(0, tl / tlDur)));
  }

  const veil = fadeVeilAlpha(tl, tlDur, project.fade.in, project.fade.out);
  if (veil > 0) {
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${veil})`;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  if (input.watermark) drawWatermark(ctx, width, height);
}

function drawProgressBar(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  project: Project,
  progress: number,
): void {
  const unit = Math.min(width, height) / 1080;
  const h = Math.max(2, project.progressBar.height * unit);
  const y = project.progressBar.position === "top" ? 0 : height - h;
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(0, y, width, h);
  ctx.fillStyle = project.progressBar.color;
  ctx.fillRect(0, y, width * progress, h);
  ctx.restore();
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
  const label = WATERMARK_TEXT;
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

/** Where the camera bubble sits, for the compositor and for hit-testing in the UI. */
export function webcamRect(width: number, height: number, project: Project): Rect {
  const short = Math.min(width, height);
  const size = project.webcam.size * short;
  const margin = project.webcam.margin * short;
  let x = margin;
  let y = margin;
  if (project.webcam.corner === "tr") x = width - margin - size;
  if (project.webcam.corner === "bl") y = height - margin - size;
  if (project.webcam.corner === "br") {
    x = width - margin - size;
    y = height - margin - size;
  }
  return { x, y, w: size, h: size };
}

function drawWebcam(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  project: Project,
  video: CanvasImageSource,
): void {
  const cam = project.webcam;
  const { x, y, w: size } = webcamRect(width, height, project);
  const unit = Math.min(width, height) / 1080;
  const radius = cam.shape === "circle" ? size / 2 : cam.shape === "square" ? 4 * unit : cam.radius * unit;

  if (cam.shadow > 0) {
    ctx.save();
    ctx.shadowColor = `rgba(16,12,28,${0.2 + cam.shadow * 0.35})`;
    ctx.shadowBlur = (8 + cam.shadow * 30) * unit;
    ctx.shadowOffsetY = (3 + cam.shadow * 10) * unit;
    roundRectPath(ctx, x, y, size, size, radius);
    ctx.fillStyle = "#0b0b12";
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  roundRectPath(ctx, x, y, size, size, radius);
  ctx.clip();

  let sw = size;
  let sh = size;
  if (video instanceof HTMLVideoElement && video.videoWidth > 0) {
    const va = video.videoWidth / video.videoHeight;
    if (va > 1) {
      sw = size * va;
    } else {
      sh = size / va;
    }
  } else if (video instanceof HTMLCanvasElement && video.width > 0) {
    const va = video.width / video.height;
    if (va > 1) sw = size * va;
    else sh = size / va;
  }
  if (cam.mirror) {
    ctx.translate(x + size, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, (size - sw) / 2, y + (size - sh) / 2, sw, sh);
  } else {
    ctx.drawImage(video, x + (size - sw) / 2, y + (size - sh) / 2, sw, sh);
  }
  ctx.restore();

  if (cam.border && cam.borderWidth > 0) {
    ctx.save();
    ctx.strokeStyle = cam.borderColor;
    ctx.lineWidth = Math.max(1, cam.borderWidth * unit);
    const inset = ctx.lineWidth / 2;
    roundRectPath(ctx, x + inset, y + inset, size - inset * 2, size - inset * 2, Math.max(0, radius - inset));
    ctx.stroke();
    ctx.restore();
  }
}

function drawImageOverlays(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  project: Project,
  t: number,
  images: DrawFrameInput["overlayImages"],
): void {
  if (!project.overlays.length || !images) return;
  const unit = Math.min(width, height) / 1080;
  for (const item of project.overlays) {
    if (t < item.start || t > item.end) continue;
    const img = images[item.src];
    if (!isVideoReady(img)) continue;
    let iw = 1;
    let ih = 1;
    if (img instanceof HTMLImageElement) {
      iw = img.naturalWidth || 1;
      ih = img.naturalHeight || 1;
    } else if (img instanceof HTMLCanvasElement) {
      iw = img.width || 1;
      ih = img.height || 1;
    }
    const w = item.width * width;
    const h = (w * ih) / iw;
    const x = item.x * width - w / 2;
    const y = item.y * height - h / 2;
    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0, item.opacity));
    if (item.radius > 0) {
      roundRectPath(ctx, x, y, w, h, item.radius * unit);
      ctx.clip();
    }
    ctx.drawImage(img, x, y, w, h);
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

const FONT_STACK: Record<OverlayFont, string> = {
  outfit: "Outfit, ui-sans-serif, system-ui, sans-serif",
  inter: "Inter, ui-sans-serif, system-ui, sans-serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

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
    ctx.font = `${item.weight} ${Math.round(size)}px ${FONT_STACK[item.font] ?? FONT_STACK.outfit}`;
    ctx.textAlign = item.align;
    ctx.textBaseline = "middle";
    const x = item.x * width;
    const y = item.y * height;
    if (item.background) {
      const textW = ctx.measureText(item.text).width;
      const padX = size * 0.55;
      const padY = size * 0.3;
      const boxW = textW + padX * 2;
      const boxH = size + padY * 2;
      const left = item.align === "left" ? x - padX : item.align === "right" ? x - textW - padX : x - boxW / 2;
      ctx.fillStyle = "rgba(12,10,20,0.62)";
      roundRectPath(ctx, left, y - boxH / 2, boxW, boxH, size * 0.35);
      ctx.fill();
    } else {
      ctx.shadowColor = "rgba(12,10,20,0.35)";
      ctx.shadowBlur = 10;
    }
    ctx.fillStyle = item.color;
    ctx.fillText(item.text, x, y);
    ctx.restore();
  }
}
