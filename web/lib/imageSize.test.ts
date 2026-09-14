import { describe, expect, it } from "vitest";
import { imageSize } from "./imageSize";

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  const view = new DataView(bytes.buffer);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  view.setUint32(8, 13);
  bytes.set([..."IHDR"].map((c) => c.charCodeAt(0)), 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function jpeg(width: number, height: number): Uint8Array {
  // SOI, an APP0 segment to skip, then SOF0 with the size
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0)];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof0, ...new Array(12).fill(0)]);
}

function webpVp8x(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  const text = (at: number, s: string) => bytes.set([...s].map((c) => c.charCodeAt(0)), at);
  text(0, "RIFF");
  text(8, "WEBP");
  text(12, "VP8X");
  const w = width - 1;
  const h = height - 1;
  bytes.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 24);
  return bytes;
}

describe("imageSize", () => {
  it("reads a PNG header", () => {
    expect(imageSize(png(1276, 795))).toEqual({ width: 1276, height: 795 });
  });

  it("walks JPEG segments to the frame header", () => {
    expect(imageSize(jpeg(2560, 1440))).toEqual({ width: 2560, height: 1440 });
  });

  it("reads an extended WebP header", () => {
    expect(imageSize(webpVp8x(1920, 1080))).toEqual({ width: 1920, height: 1080 });
  });

  it("gives up on anything else", () => {
    expect(imageSize(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
  });
});
