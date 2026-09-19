/**
 * The arithmetic around a segmentation model, kept pure so it is tested
 * without a GPU: what size the model is fed, how pixels become a tensor, how
 * the raw output becomes an 8-bit matte, where the subject sits, and the edge
 * curve. `worker.ts` does the canvas and ONNX parts around these.
 */
import type { MattingModel } from "./models";

export interface Size {
  width: number;
  height: number;
}

/** The size the image is resized to before it goes into `model`. */
export function modelInputSize(model: MattingModel, image: Size): Size {
  if (model.input.mode === "fixed") return { width: model.input.size, height: model.input.size };
  const { size, multiple, maxSide } = model.input;
  const shortest = Math.max(1, Math.min(image.width, image.height));
  let scale = size / shortest;
  const longest = Math.max(image.width, image.height) * scale;
  if (longest > maxSide) scale *= maxSide / longest;
  const snap = (v: number) => Math.max(multiple, Math.round((v * scale) / multiple) * multiple);
  return { width: snap(image.width), height: snap(image.height) };
}

/**
 * RGBA bytes (row-major, as `getImageData` gives them) → a planar float
 * tensor `[1, 3, H, W]`, normalised the way the model was trained.
 */
export function toTensor(rgba: Uint8ClampedArray | Uint8Array, size: Size, model: MattingModel): Float32Array {
  const pixels = size.width * size.height;
  const out = new Float32Array(pixels * 3);
  const { scale, mean, std } = model;
  const [mr, mg, mb] = mean;
  const [sr, sg, sb] = std;
  for (let i = 0, p = 0; i < pixels; i++, p += 4) {
    out[i] = (rgba[p] * scale - mr) / sr;
    out[pixels + i] = (rgba[p + 1] * scale - mg) / sg;
    out[2 * pixels + i] = (rgba[p + 2] * scale - mb) / sb;
  }
  return out;
}

/** Raw model output → 0..255 matte, applying the model's activation and range rule. */
export function toMatte(raw: Float32Array | number[], model: Pick<MattingModel, "activation" | "normalizeOutput">): Uint8ClampedArray {
  const n = raw.length;
  const out = new Uint8ClampedArray(n);
  if (n === 0) return out;
  const sigmoid = model.activation === "sigmoid";
  let lo = Infinity;
  let hi = -Infinity;
  if (model.normalizeOutput) {
    for (let i = 0; i < n; i++) {
      const v = sigmoid ? 1 / (1 + Math.exp(-raw[i])) : raw[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  // A flat output (an empty frame, a model that found nothing) must not
  // divide by zero and turn into a full white matte.
  const span = hi - lo;
  const stretch = model.normalizeOutput && span > 1e-6;
  for (let i = 0; i < n; i++) {
    let v = sigmoid ? 1 / (1 + Math.exp(-raw[i])) : raw[i];
    if (stretch) v = (v - lo) / span;
    out[i] = v * 255;
  }
  return out;
}

export type EdgeStyle = "soft" | "balanced" | "crisp";

/**
 * A 256-entry curve applied to the matte. Models leave a faint haze around
 * the subject (alpha 5–30) that reads as a dirty halo on a white page;
 * `balanced` clears it and firms up the near-opaque end without touching the
 * soft middle that hair lives in. `soft` is the matte as the model gave it.
 */
export function edgeCurve(style: EdgeStyle): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  const [lo, hi] = style === "soft" ? [0, 255] : style === "balanced" ? [18, 238] : [70, 185];
  for (let i = 0; i < 256; i++) {
    const t = Math.min(1, Math.max(0, (i - lo) / (hi - lo)));
    // smoothstep keeps the ends flat and the middle close to linear
    lut[i] = style === "soft" ? i : t * t * (3 - 2 * t) * 255;
  }
  return lut;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The box around everything the matte keeps (alpha above `threshold`), or null for an empty matte. */
export function matteBounds(matte: Uint8ClampedArray | Uint8Array, size: Size, threshold = 12): Bounds | null {
  const { width, height } = size;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (matte[row + x] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** `bounds` grown by `margin` (a fraction of its longer side), clamped to the image. */
export function padBounds(bounds: Bounds, image: Size, margin = 0.04): Bounds {
  const pad = Math.round(Math.max(bounds.width, bounds.height) * margin);
  const x = Math.max(0, bounds.x - pad);
  const y = Math.max(0, bounds.y - pad);
  const right = Math.min(image.width, bounds.x + bounds.width + pad);
  const bottom = Math.min(image.height, bounds.y + bounds.height + pad);
  return { x, y, width: right - x, height: bottom - y };
}

/** Share of the frame the subject covers, 0..1 — "nothing found" and "everything kept" are both worth telling the person. */
export function matteCoverage(matte: Uint8ClampedArray | Uint8Array): number {
  if (matte.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < matte.length; i++) sum += matte[i];
  return sum / (matte.length * 255);
}
