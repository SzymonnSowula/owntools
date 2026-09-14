/**
 * Length in seconds of an MP4 (or MOV), read from the movie header - `moov`
 * then `mvhd`. The hero tile prints its clip's runtime but never downloads the
 * clip (the player does, once someone presses play), so the number comes from
 * the file at build time, in page.tsx `shot()`, the way a still's size does.
 *
 * It reads through `read(at, length)` rather than taking the whole file: a
 * clip exported without faststart keeps `moov` behind megabytes of `mdat`,
 * and walking box headers costs a few kilobytes either way. `null` for
 * anything it cannot read; the tile then goes without a runtime.
 */

type Read = (at: number, length: number) => Uint8Array;

/** the body of the first `type` box between `from` and `to`, walking siblings */
function findBox(read: Read, from: number, to: number, type: string): { body: number; end: number } | null {
  let at = from;
  while (at + 8 <= to) {
    const head = read(at, 16);
    if (head.length < 8) return null;
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    let size = view.getUint32(0);
    let header = 8;
    if (size === 1) {
      // a 64-bit size follows the type
      if (head.length < 16) return null;
      size = Number(view.getBigUint64(8));
      header = 16;
    } else if (size === 0) {
      // runs to the end of its parent
      size = to - at;
    }
    if (size < header) return null;
    if (String.fromCharCode(...head.subarray(4, 8)) === type) return { body: at + header, end: Math.min(at + size, to) };
    at += size;
  }
  return null;
}

export function mp4Duration(read: Read, size: number): number | null {
  const moov = findBox(read, 0, size, "moov");
  const mvhd = moov && findBox(read, moov.body, moov.end, "mvhd");
  if (!mvhd) return null;
  const bytes = read(mvhd.body, 32);
  if (bytes.length < 32) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // version 1 stores the times in 64 bits, version 0 in 32
  const long = bytes[0] === 1;
  const timescale = view.getUint32(long ? 20 : 12);
  const duration = long ? Number(view.getBigUint64(24)) : view.getUint32(16);
  const seconds = duration / timescale;
  // 0 = a fragmented file that leaves it to its fragments; all ones = unknown,
  // which reads as weeks - nothing a landing page plays runs for a day
  return timescale && seconds > 0 && seconds < 86_400 ? seconds : null;
}
