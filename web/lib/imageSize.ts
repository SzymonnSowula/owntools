/**
 * Width and height of a PNG, JPEG, WebP or GIF, read from the first bytes of
 * the file. The landing resolves its shots at build time (page.tsx `shot()`)
 * and next/image needs the size up front - a real one, so the still keeps its
 * proportions and the row does not jump when it loads. `null` for anything it
 * cannot read; the caller then shows the drawn stand-in instead.
 */

export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));

  // PNG: the IHDR chunk always comes first
  if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47 && ascii(12, 4) === "IHDR") {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  // GIF87a / GIF89a
  if (bytes.length >= 10 && ascii(0, 3) === "GIF") {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }

  // WebP: lossy (VP8), lossless (VP8L) or extended (VP8X)
  if (bytes.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8 ") return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = view.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") {
      const w = bytes[24] | (bytes[25] << 8) | (bytes[26] << 16);
      const h = bytes[27] | (bytes[28] << 8) | (bytes[29] << 16);
      return { width: w + 1, height: h + 1 };
    }
    return null;
  }

  // JPEG: walk the segments to the first start-of-frame marker
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1];
      const length = view.getUint16(at + 2);
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) return { width: view.getUint16(at + 7), height: view.getUint16(at + 5) };
      at += 2 + length;
    }
  }

  return null;
}
