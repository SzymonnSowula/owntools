export type ImageFormat = "png" | "jpeg" | "webp";

export const IMAGE_MIME: Record<ImageFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export const IMAGE_EXT: Record<ImageFormat, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
};

export interface ImageOptions {
  format: ImageFormat;
  /** 0..1; ignored for PNG. */
  quality: number;
  /** Longest side in pixels, or null to keep the size. */
  maxSide: number | null;
}

export interface ImageResult {
  blob: Blob;
  width: number;
  height: number;
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i.test(file.name);
}

/** Scales a box down (never up) so its longest side is at most `maxSide`. */
export function fitWithin(width: number, height: number, maxSide: number | null): { width: number; height: number } {
  if (!maxSide || maxSide <= 0) return { width, height };
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height };
  const scale = maxSide / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface ImageSource {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

/**
 * Decodes an image file for drawing. `createImageBitmap` covers the raster
 * formats; SVG (no intrinsic size for the bitmap path) goes through an
 * <img> instead.
 */
export async function loadImageSource(file: File): Promise<ImageSource> {
  if (file.type !== "image/svg+xml") {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      /* fall through to the <img> path */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const width = img.naturalWidth || 1024;
    const height = img.naturalHeight || Math.round((width * 3) / 4);
    return { source: img, width, height, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(`Can't decode ${file.name}.`);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The browser could not encode the image."))),
      type,
      quality,
    );
  });
}

export async function convertImage(file: File, options: ImageOptions): Promise<ImageResult> {
  const source = await loadImageSource(file);
  try {
    const { width, height } = fitWithin(source.width, source.height, options.maxSide);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D canvas available.");
    if (options.format === "jpeg") {
      // JPEG has no alpha: transparent areas would otherwise turn black.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source.source, 0, 0, width, height);
    const blob = await toBlob(canvas, IMAGE_MIME[options.format], options.quality);
    canvas.width = canvas.height = 0;
    return { blob, width, height };
  } finally {
    source.close();
  }
}
