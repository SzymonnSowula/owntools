/**
 * A streaming take: the segmenter cuts the microphone feed into utterances and
 * each one goes to the recognizer the moment it closes, while the person is
 * still talking. At the second press only the tail is left to decode.
 *
 * The recognizer (sherpa's resident server) handles one request at a time, so
 * segments go through a FIFO — a promise chain — and results are kept by
 * index, which also keeps the text in speaking order however the decoder is
 * scheduled. `partial()` is what the pill shows live.
 *
 * `finish()` reports two numbers on purpose: `decodeMs`, everything the
 * recognizer spent on the take, and `tailMs`, the time from the stop to the
 * last word — the only one the person waits for. `lastDictationTiming()`
 * carries both so a regression is visible to someone other than the person
 * waiting.
 *
 * Pure apart from the injected transcriber: the pill hands in Parakeet, the
 * tests hand in a fake with controlled delays.
 */

import { concatPcm, Segmenter, type Segment, type SegmenterOptions } from "./segmenter";

export interface SegmentTranscriber {
  (pcm: Float32Array, sampleRate: number): Promise<{ text: string; ms: number }>;
}

export interface PartialState {
  /** Everything decoded so far, in order. */
  text: string;
  /** Segments closed but not decoded yet. */
  pending: number;
  /** Segments closed so far. */
  segments: number;
}

export interface StreamingResult {
  /** The segments' texts joined with spaces, uncleaned. */
  raw: string;
  segments: string[];
  /** Length of the take's audio. */
  audioMs: number;
  /** Total time the recognizer spent, all segments. */
  decodeMs: number;
  /** From the stop to the last word: what the person waited. */
  tailMs: number;
  /** Audio left to decode at the stop — the tail plus anything still queued. */
  tailAudioMs: number;
  /** Deepest the queue got: 1 means the decoder kept up. */
  maxQueue: number;
}

export interface StreamingSessionOptions {
  sampleRate: number;
  transcribe: SegmentTranscriber;
  segmenter?: Partial<Omit<SegmenterOptions, "sampleRate">>;
  onPartial?: (state: PartialState) => void;
  /** Clock, for tests. */
  now?: () => number;
}

export class StreamingFailed extends Error {
  constructor(public readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "StreamingFailed";
  }
}

export interface StreamingSession {
  /** Feed microphone samples at the session's sample rate. */
  push(samples: Float32Array): void;
  /** Text decoded so far. */
  partial(): string;
  /** RMS of the latest frame, for the meter. */
  level(): number;
  /** Ends the take; resolves once the tail is decoded. Rejects with `StreamingFailed`. */
  finish(): Promise<StreamingResult>;
  /** Drops everything; pending decodes are ignored when they land. */
  cancel(): void;
  /** Every sample heard, for a whole-take fallback when streaming fails. */
  audio(): Float32Array;
  readonly sampleRate: number;
}

export function createStreamingSession(options: StreamingSessionOptions): StreamingSession {
  const now = options.now ?? (() => performance.now());
  const segmenter = new Segmenter({ sampleRate: options.sampleRate, ...(options.segmenter ?? {}) });
  const results: (string | null)[] = [];
  const closed: Segment[] = [];
  const heard: Float32Array[] = [];
  let chain: Promise<void> = Promise.resolve();
  let failure: unknown = null;
  let cancelled = false;
  let decodeMs = 0;
  let pending = 0;
  let maxQueue = 0;

  const notify = () => {
    options.onPartial?.({ text: partial(), pending, segments: results.length });
  };

  function partial(): string {
    const parts: string[] = [];
    for (const r of results) {
      if (r === null) break;
      if (r) parts.push(r);
    }
    return parts.join(" ");
  }

  function enqueue(segment: Segment) {
    const index = results.length;
    results.push(null);
    closed.push(segment);
    pending += 1;
    maxQueue = Math.max(maxQueue, pending);
    chain = chain
      .then(async () => {
        if (cancelled || failure) return;
        const started = now();
        const { text } = await options.transcribe(segment.pcm, options.sampleRate);
        decodeMs += now() - started;
        results[index] = text.trim();
      })
      .catch((err) => {
        failure ??= err;
      })
      .finally(() => {
        pending -= 1;
        if (!cancelled) notify();
      });
  }

  return {
    sampleRate: options.sampleRate,
    push(samples) {
      if (cancelled) return;
      heard.push(samples.slice());
      for (const seg of segmenter.push(samples)) enqueue(seg);
    },
    partial,
    level: () => segmenter.lastRms,
    audio: () => concatPcm(heard),
    cancel() {
      cancelled = true;
    },
    async finish() {
      const stoppedAt = now();
      const tail = segmenter.flush();
      // Audio still to decode when the person stopped: queued segments + tail.
      let tailAudioMs = tail ? (tail.pcm.length / options.sampleRate) * 1000 : 0;
      for (let i = 0; i < results.length; i++) {
        if (results[i] === null) tailAudioMs += (closed[i].pcm.length / options.sampleRate) * 1000;
      }
      if (tail) enqueue(tail);
      await chain;
      if (failure) throw new StreamingFailed(failure);
      const segments = results.map((r) => r ?? "").filter(Boolean);
      return {
        raw: segments.join(" "),
        segments,
        audioMs: segmenter.positionMs,
        decodeMs: Math.round(decodeMs),
        tailMs: Math.round(now() - stoppedAt),
        tailAudioMs: Math.round(tailAudioMs),
        maxQueue,
      };
    },
  };
}
