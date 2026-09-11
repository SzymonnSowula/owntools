/**
 * Cuts a live microphone feed into utterances, so each one can be sent to the
 * recognizer while the next is still being spoken.
 *
 * The whole point of streaming dictation is that when the second press comes,
 * almost everything has already been decoded and only the tail is left. That
 * needs a cheap, deterministic way to decide where one utterance ends and the
 * next begins, running on the audio thread's schedule — this is an energy
 * voice-activity detector, nothing fancier, because the browser's own DSP
 * (`DICTATION_MIC_CONSTRAINTS`: noise suppression + AGC) already sits in
 * front of it and levels the room out.
 *
 * Rules, in order:
 *   - a frame (20 ms) is *loud* when its RMS is above the gate — the fixed
 *     threshold or the adaptive noise floor plus a margin, whichever is higher;
 *   - loud frames after silence open a segment, with `padMs` of the preceding
 *     audio kept in front (the first syllable is otherwise clipped);
 *   - `hangoverMs` of quiet closes it; a segment with less than `minSpeechMs`
 *     of loud frames was a click or a cough and is dropped;
 *   - past `softMaxMs` any pause of `softHangoverMs` closes it, and at
 *     `maxSegmentMs` it is cut regardless (the recognizer has a limit and the
 *     partial text has to move);
 *   - `flush()` at the end returns whatever is open — that is the tail.
 *
 * Pure, synchronous, no Web Audio types: tested with synthetic PCM.
 */

export interface SegmenterOptions {
  sampleRate: number;
  /** Analysis window. */
  frameMs?: number;
  /** Absolute gate in dBFS (RMS); speech is above this in any usable set-up. */
  thresholdDb?: number;
  /** Speech has to sit this far above the noise floor when the floor is above the threshold. */
  marginDb?: number;
  /**
   * Track the noise floor and lift the gate over a constant hum (a fan, a
   * fridge). The floor only ever rises slowly and never above `floorCapDb`,
   * so a long unbroken sentence cannot talk the gate up to its own level.
   */
  adaptive?: boolean;
  floorCapDb?: number;
  minSpeechMs?: number;
  hangoverMs?: number;
  softMaxMs?: number;
  softHangoverMs?: number;
  maxSegmentMs?: number;
  padMs?: number;
}

export type SegmentReason = "silence" | "max" | "flush";

export interface Segment {
  /** Mono PCM at the segmenter's sample rate, pads included. */
  pcm: Float32Array;
  /** Position in the take, from the first sample pushed. */
  startMs: number;
  endMs: number;
  /** How much of it was above the gate — the words, roughly. */
  speechMs: number;
  reason: SegmentReason;
}

export const SEGMENTER_DEFAULTS: Required<Omit<SegmenterOptions, "sampleRate">> = {
  frameMs: 20,
  thresholdDb: -42,
  marginDb: 9,
  adaptive: true,
  floorCapDb: -36,
  minSpeechMs: 300,
  hangoverMs: 600,
  softMaxMs: 10000,
  softHangoverMs: 250,
  maxSegmentMs: 15000,
  padMs: 200,
};

/** How fast the floor may climb: slowly on varying sound, quicker on a flat hum. */
const FLOOR_RISE_DB_PER_S = 2;
const FLOOR_RISE_FLAT_DB_PER_S = 8;
/** Two frames within this of each other read as the same steady sound. */
const FLAT_DB = 1.5;

export function rmsOf(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return frame.length ? Math.sqrt(sum / frame.length) : 0;
}

export function toDb(rms: number): number {
  return 20 * Math.log10(Math.max(rms, 1e-6));
}

export function concatPcm(chunks: Float32Array[]): Float32Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/**
 * Linear resampling — good enough for speech going *down* to 16 kHz from a
 * context that refused to open at that rate. Anything above 8 kHz in the
 * source is noise to the recognizer anyway.
 */
export function resampleLinear(pcm: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || pcm.length === 0) return pcm;
  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.round(pcm.length / ratio));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = pcm[Math.min(idx, pcm.length - 1)];
    const b = pcm[Math.min(idx + 1, pcm.length - 1)];
    out[i] = a + (b - a) * frac;
  }
  return out;
}

export class Segmenter {
  readonly opts: Required<SegmenterOptions>;
  private readonly frameLen: number;
  private readonly prerollFrames: number;

  /** Samples that did not fill a frame yet. */
  private carry: Float32Array;
  private carryLen = 0;
  private preroll: Float32Array[] = [];
  private state: "silence" | "speech" = "silence";
  private current: Float32Array[] = [];
  private currentStartMs = 0;
  private speechMs = 0;
  private silenceMs = 0;
  private framesSeen = 0;
  private floorDb: number;
  private prevDb = Number.NaN;

  /** RMS of the last frame, for a level meter. */
  lastRms = 0;
  /** Whether the last frame was above the gate. */
  speaking = false;

  constructor(options: SegmenterOptions) {
    this.opts = { ...SEGMENTER_DEFAULTS, ...options };
    this.frameLen = Math.max(1, Math.round((this.opts.sampleRate * this.opts.frameMs) / 1000));
    this.prerollFrames = Math.ceil(this.opts.padMs / this.opts.frameMs);
    this.carry = new Float32Array(this.frameLen);
    // Starts where the gate equals the fixed threshold, so the first frames
    // are judged by it alone and a hum can only *raise* the bar from there.
    this.floorDb = this.opts.thresholdDb - this.opts.marginDb;
  }

  /** Milliseconds of audio seen so far. */
  get positionMs(): number {
    return this.framesSeen * this.opts.frameMs;
  }

  /** The gate a frame has to clear right now, in dBFS. */
  get gateDb(): number {
    return this.opts.adaptive
      ? Math.max(this.opts.thresholdDb, this.floorDb + this.opts.marginDb)
      : this.opts.thresholdDb;
  }

  /** Feeds samples of any length; returns the segments that closed. */
  push(samples: Float32Array): Segment[] {
    const closed: Segment[] = [];
    let offset = 0;
    while (offset < samples.length) {
      const take = Math.min(this.frameLen - this.carryLen, samples.length - offset);
      this.carry.set(samples.subarray(offset, offset + take), this.carryLen);
      this.carryLen += take;
      offset += take;
      if (this.carryLen === this.frameLen) {
        const seg = this.processFrame(this.carry.slice());
        if (seg) closed.push(seg);
        this.carryLen = 0;
      }
    }
    return closed;
  }

  /** Ends the take: whatever is open comes back as the tail, or null. */
  flush(): Segment | null {
    let tail: Segment | null = null;
    if (this.state === "speech" && this.current.length) {
      if (this.speechMs >= this.opts.minSpeechMs) tail = this.emit("flush");
    }
    this.current = [];
    this.state = "silence";
    this.speechMs = 0;
    this.silenceMs = 0;
    this.carryLen = 0;
    return tail;
  }

  private processFrame(frame: Float32Array): Segment | null {
    const t = this.framesSeen * this.opts.frameMs;
    this.framesSeen += 1;
    const rms = rmsOf(frame);
    const db = toDb(rms);
    this.lastRms = rms;

    if (this.opts.adaptive) {
      if (db < this.floorDb) {
        this.floorDb = db;
      } else {
        const flat = !Number.isNaN(this.prevDb) && Math.abs(db - this.prevDb) < FLAT_DB;
        const rise = ((flat ? FLOOR_RISE_FLAT_DB_PER_S : FLOOR_RISE_DB_PER_S) * this.opts.frameMs) / 1000;
        this.floorDb = Math.min(this.floorDb + rise, this.opts.floorCapDb, db);
      }
    }
    this.prevDb = db;

    const loud = db > this.gateDb;
    this.speaking = loud;

    if (this.state === "silence") {
      if (loud) {
        this.current = [...this.preroll, frame];
        this.currentStartMs = t - this.preroll.length * this.opts.frameMs;
        this.preroll = [];
        this.speechMs = this.opts.frameMs;
        this.silenceMs = 0;
        this.state = "speech";
      } else {
        this.preroll.push(frame);
        if (this.preroll.length > this.prerollFrames) this.preroll.shift();
      }
      return null;
    }

    this.current.push(frame);
    if (loud) {
      this.speechMs += this.opts.frameMs;
      this.silenceMs = 0;
    } else {
      this.silenceMs += this.opts.frameMs;
    }
    const durationMs = this.current.length * this.opts.frameMs;

    if (this.silenceMs >= this.opts.hangoverMs) return this.closeOnSilence();
    if (durationMs >= this.opts.maxSegmentMs) return this.closeHard();
    if (durationMs >= this.opts.softMaxMs && this.silenceMs >= this.opts.softHangoverMs) {
      return this.closeOnSilence();
    }
    return null;
  }

  /** Quiet long enough: keep `padMs` of it, the rest becomes the next pre-roll. */
  private closeOnSilence(): Segment | null {
    const extraFrames = Math.max(0, Math.round((this.silenceMs - this.opts.padMs) / this.opts.frameMs));
    const keep = Math.max(1, this.current.length - extraFrames);
    const dropped = this.current.slice(keep);
    this.current = this.current.slice(0, keep);
    const seg = this.speechMs >= this.opts.minSpeechMs ? this.emit("silence") : null;
    this.preroll = dropped.slice(-this.prerollFrames);
    this.current = [];
    this.state = "silence";
    this.speechMs = 0;
    this.silenceMs = 0;
    return seg;
  }

  /** The hard limit: cut here and carry on in the same breath. */
  private closeHard(): Segment {
    const seg = this.emit("max");
    this.current = [];
    this.currentStartMs = this.positionMs;
    // The continuation is speech by definition; do not make it earn the
    // minimum again, or a sentence ending 200 ms after the cut would vanish.
    this.speechMs = this.opts.minSpeechMs;
    this.silenceMs = 0;
    this.state = "speech";
    return seg;
  }

  private emit(reason: SegmentReason): Segment {
    const pcm = concatPcm(this.current);
    const startMs = this.currentStartMs;
    return {
      pcm,
      startMs,
      endMs: startMs + (pcm.length / this.opts.sampleRate) * 1000,
      speechMs: this.speechMs,
      reason,
    };
  }
}
