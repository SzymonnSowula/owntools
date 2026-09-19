/**
 * Image + matte → the picture the person asked for. Everything here is canvas
 * compositing (`destination-in`, a blur filter, a fill) and never a pixel
 * loop, so a 24-megapixel photo composes on the UI thread without a hitch.
 */
import { padBounds, type Bounds } from "./mask";
import type { Matte } from "./engine";

export type Backdrop =
  | { kind: "transparent" }
  | { kind: "color"; color: string }
  /** The original photo behind the subject, blurred — a portrait-mode look. */
  | { kind: "blur"; radius: number };

export type CutoutFormat = "png" | "webp" | "jpeg";

export const CUTOUT_MIME: Record<CutoutFormat, string> = {
  png: "image/png",
  webp: "image/webp",
  jpeg: "image/jpeg",
};

export const CUTOUT_EXT: Record<CutoutFormat, string> = { png: "png", webp: "webp", jpeg: "jpg" };

export interface ComposeOptions {
  backdrop: Backdrop;
  /** Crop to the subject (with a small margin). Ignored for a blurred backdrop, which needs the whole frame. */
  trim: boolean;
}

/** A transparent result cannot be a JPEG; everything else can be anything. */
export function formatAllowed(format: CutoutFormat, backdrop: Backdrop): boolean {
  return format !== "jpeg" || backdrop.kind !== "transparent";
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D canvas available.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return ctx;
}

/** The subject alone on a transparent canvas, full frame. */
function cutoutCanvas(image: CanvasImageSource, matte: Matte): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = matte.width;
  canvas.height = matte.height;
  const ctx = context(canvas);
  ctx.drawImage(image, 0, 0, matte.width, matte.height);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(matte.mask, 0, 0, matte.width, matte.height);
  ctx.globalCompositeOperation = "source-over";
  return canvas;
}

/** The frame the result keeps: the whole image, or the subject's box with a margin. */
export function resultFrame(matte: Pick<Matte, "width" | "height" | "bounds">, options: ComposeOptions): Bounds {
  const whole = { x: 0, y: 0, width: matte.width, height: matte.height };
  if (!options.trim || options.backdrop.kind === "blur" || !matte.bounds) return whole;
  return padBounds(matte.bounds, matte);
}

/** Draws the composed result. The caller owns (and should zero) the canvas. */
export function composeCutout(image: CanvasImageSource, matte: Matte, options: ComposeOptions): HTMLCanvasElement {
  const subject = cutoutCanvas(image, matte);
  const frame = resultFrame(matte, options);
  const { backdrop } = options;
  if (backdrop.kind === "transparent" && frame.width === matte.width && frame.height === matte.height) return subject;

  const out = document.createElement("canvas");
  out.width = frame.width;
  out.height = frame.height;
  const ctx = context(out);
  if (backdrop.kind === "color") {
    ctx.fillStyle = backdrop.color;
    ctx.fillRect(0, 0, frame.width, frame.height);
  } else if (backdrop.kind === "blur") {
    // Drawn a little larger than the frame: a blur pulls transparent pixels
    // in from beyond the edge and would leave a pale border otherwise.
    const bleed = Math.ceil(backdrop.radius * 2);
    ctx.filter = `blur(${backdrop.radius}px)`;
    ctx.drawImage(image, -bleed, -bleed, matte.width + bleed * 2, matte.height + bleed * 2);
    ctx.filter = "none";
  }
  ctx.drawImage(subject, -frame.x, -frame.y);
  subject.width = subject.height = 0;
  return out;
}

export function canvasToBlob(canvas: HTMLCanvasElement, format: CutoutFormat, quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The browser could not encode the image."))),
      CUTOUT_MIME[format],
      quality,
    );
  });
}

/** Blur radius that looks the same on a phone photo and a 24 MP one: a share of the longer side. */
export function blurRadiusFor(width: number, height: number, strength = 0.018): number {
  return Math.max(4, Math.round(Math.max(width, height) * strength));
}
