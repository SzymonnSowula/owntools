import { decodeAudioBlob } from "@core/audio";
import type { Segment } from "../types";
import { uid } from "./id";

export interface SilenceInterval {
  start: number;
  end: number;
}

export interface SilenceOptions {
  /** RMS analysis hop, seconds. */
  hop?: number;
  /** Minimum raw silence run to consider, seconds. */
  minSilence?: number;
  /** Breathing room kept on each side of a cut, seconds. */
  padding?: number;
  /** Minimum interval length after padding, seconds. */
  minInterval?: number;
  /** Never cut into this initial part of the recording, seconds. */
  headKeep?: number;
}

/**
 * Detects long pauses in a recording's audio track. Times are in source
 * seconds. Throws if the blob has no decodable audio.
 */
export async function detectSilence(
  blob: Blob,
  opts: SilenceOptions = {},
): Promise<{ intervals: SilenceInterval[]; duration: number }> {
  const hopSec = opts.hop ?? 0.05;
  const minSilence = opts.minSilence ?? 0.9;
  const padding = opts.padding ?? 0.18;
  const minInterval = opts.minInterval ?? 0.35;
  const headKeep = opts.headKeep ?? 0.15;

  const buffer = await decodeAudioBlob(blob);
  const length = buffer.length;
  const mono = new Float32Array(length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) mono[i] += data[i];
  }
  if (buffer.numberOfChannels > 1) {
    for (let i = 0; i < length; i++) mono[i] /= buffer.numberOfChannels;
  }

  const hop = Math.max(1, Math.round(hopSec * buffer.sampleRate));
  const rms: number[] = [];
  for (let i = 0; i < length; i += hop) {
    const end = Math.min(length, i + hop);
    let sum = 0;
    for (let j = i; j < end; j++) sum += mono[j] * mono[j];
    rms.push(Math.sqrt(sum / (end - i)));
  }

  const sorted = [...rms].sort((a, b) => a - b);
  const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] ?? 0;
  const threshold = Math.max(0.006, 0.12 * p90);

  const intervals: SilenceInterval[] = [];
  let runStart = -1;
  const flush = (endIndex: number) => {
    if (runStart < 0) return;
    const rawStart = runStart * hopSec;
    const rawEnd = Math.min(buffer.duration, endIndex * hopSec);
    runStart = -1;
    if (rawEnd - rawStart < minSilence) return;
    const start = Math.max(headKeep, rawStart + padding);
    const end = rawEnd - padding;
    if (end - start >= minInterval) intervals.push({ start, end });
  };
  for (let i = 0; i < rms.length; i++) {
    if (rms[i] < threshold) {
      if (runStart < 0) runStart = i;
    } else {
      flush(i);
    }
  }
  flush(rms.length);

  return { intervals, duration: buffer.duration };
}

/**
 * Subtracts source-time intervals from the kept segments. Pieces shorter than
 * 0.15s are dropped. Untouched segments keep their ids; split/trimmed pieces
 * get fresh ids.
 */
export function cutIntervalsFromSegments(
  segments: Segment[],
  intervals: SilenceInterval[],
): Segment[] {
  const MIN_PIECE = 0.15;
  const out: Segment[] = [];
  for (const seg of segments) {
    let pieces: { start: number; end: number }[] = [{ start: seg.start, end: seg.end }];
    for (const iv of intervals) {
      const next: { start: number; end: number }[] = [];
      for (const p of pieces) {
        if (iv.end <= p.start || iv.start >= p.end) {
          next.push(p);
          continue;
        }
        if (iv.start > p.start) next.push({ start: p.start, end: iv.start });
        if (iv.end < p.end) next.push({ start: iv.end, end: p.end });
      }
      pieces = next;
    }
    pieces = pieces.filter((p) => p.end - p.start >= MIN_PIECE);
    if (pieces.length === 1 && pieces[0].start === seg.start && pieces[0].end === seg.end) {
      out.push(seg);
    } else {
      for (const p of pieces) out.push({ id: uid("seg"), start: p.start, end: p.end });
    }
  }
  return out;
}
