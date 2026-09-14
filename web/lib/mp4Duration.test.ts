import { describe, expect, it } from "vitest";
import { mp4Duration } from "./mp4Duration";

const text = (s: string) => [...s].map((c) => c.charCodeAt(0));
const u32 = (n: number) => [n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
/* no bigint literals: the web tsconfig targets below ES2020 */
const u64 = (n: bigint) => [...u32(Number(n / BigInt(0x100000000))), ...u32(Number(n % BigInt(0x100000000)))];

function box(type: string, body: number[]): number[] {
  return [...u32(8 + body.length), ...text(type), ...body];
}

/* the rest of a real mvhd (rate, volume, matrix, next track id) is 80 bytes */
const mvhdTail = new Array(80).fill(0);
const mvhd0 = (timescale: number, duration: number) =>
  box("mvhd", [0, 0, 0, 0, ...u32(0), ...u32(0), ...u32(timescale), ...u32(duration), ...mvhdTail]);
const mvhd1 = (timescale: number, duration: bigint) =>
  box("mvhd", [1, 0, 0, 0, ...u64(BigInt(0)), ...u64(BigInt(0)), ...u32(timescale), ...u64(duration), ...mvhdTail]);

function probe(bytes: number[]): number | null {
  const file = new Uint8Array(bytes);
  return mp4Duration((at, length) => file.subarray(at, at + length), file.length);
}

const ftyp = box("ftyp", [...text("isom"), ...u32(512), ...text("isomavc1")]);

describe("mp4Duration", () => {
  it("reads a faststart file, moov first", () => {
    const moov = box("moov", mvhd0(1000, 18_176));
    expect(probe([...ftyp, ...moov, ...box("mdat", new Array(64).fill(7))])).toBe(18.176);
  });

  it("walks past a large mdat and the boxes ahead of mvhd", () => {
    // mdat with a 64-bit size, the way long recordings are written
    const payload = new Array(40).fill(9);
    const mdat = [...u32(1), ...text("mdat"), ...u64(BigInt(16 + payload.length)), ...payload];
    const moov = box("moov", [...box("iods", new Array(12).fill(0)), ...mvhd1(90_000, BigInt(7_560_000))]);
    expect(probe([...ftyp, ...mdat, ...moov])).toBe(84);
  });

  it("gives up on a fragmented file without a movie length", () => {
    expect(probe([...ftyp, ...box("moov", mvhd0(1000, 0))])).toBeNull();
  });

  it("gives up on an unknown length", () => {
    expect(probe([...ftyp, ...box("moov", mvhd0(600, 0xffffffff))])).toBeNull();
  });

  it("gives up on anything that is not an MP4", () => {
    expect(probe([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBeNull();
    expect(probe([...ftyp, ...box("mdat", [1, 2, 3])])).toBeNull();
  });
});
