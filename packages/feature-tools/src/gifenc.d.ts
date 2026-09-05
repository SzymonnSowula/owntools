/**
 * gifenc ships no type declarations (MIT, https://github.com/mattdesl/gifenc).
 * Only the surface `lib/gif.ts` uses is declared here.
 */
declare module "gifenc" {
  export type Palette = number[][];
  export type PixelFormat = "rgb565" | "rgb444" | "rgba4444";

  export interface QuantizeOptions {
    format?: PixelFormat;
    oneBitAlpha?: boolean | number;
    clearAlpha?: boolean;
    clearAlphaThreshold?: number;
    clearAlphaColor?: number;
  }

  export interface FrameOptions {
    palette?: Palette;
    first?: boolean;
    transparent?: boolean;
    transparentIndex?: number;
    /** Frame delay in milliseconds. */
    delay?: number;
    /** -1 once, 0 forever, n times otherwise. Read from the first frame. */
    repeat?: number;
    dispose?: number;
  }

  export interface GIFEncoderInstance {
    writeFrame(index: Uint8Array, width: number, height: number, options?: FrameOptions): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    reset(): void;
  }

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: QuantizeOptions,
  ): Palette;
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: Palette,
    format?: PixelFormat,
  ): Uint8Array;
  export function GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): GIFEncoderInstance;
}
