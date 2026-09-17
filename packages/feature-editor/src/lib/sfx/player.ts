import { SFX_PACKS, type SfxPack, type SfxSoundId } from "./packs";
import type { SfxEvent } from "./plan";
import { renderedSound } from "./mix";

/**
 * The preview's sound: a lookahead scheduler over the same plan the export
 * mixes, played through Web Audio. Playback's clock is the <video> element
 * (the store's timeline time is read off it every frame), so the scheduler
 * is fed that time and maps it onto the audio clock — a seek shows up as a
 * jump it re-anchors on, a pause stops everything still ringing.
 */

/** How far ahead of the playhead events are queued on the audio clock. */
const LOOKAHEAD = 0.25;
/** A playhead this far from where the audio clock expected it is a seek. */
const SEEK_TOLERANCE = 0.3;
/**
 * Paused (and not auditioning) this long, the context is suspended: a running
 * one keeps an output device open and its render thread waking ~100 times a
 * second in silence. Play resumes it. The editor also disposes of it when it
 * closes (Editor.tsx), where it used to run until owntools quit.
 */
const IDLE_SUSPEND_MS = 20_000;

function lowerBound(events: SfxEvent[], t: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export class SfxPreview {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private events: SfxEvent[] = [];
  private pack: SfxPack = SFX_PACKS[0];
  private cursor = 0;
  private scheduledUntil = -1;
  private lastT = -1;
  private lastNow = 0;
  private wasPlaying = false;
  private active = new Set<AudioBufferSourceNode>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  /** Swaps the plan without re-firing what is already queued. */
  setPlan(events: SfxEvent[], pack: SfxPack): void {
    this.events = events;
    if (pack !== this.pack) {
      this.pack = pack;
      this.buffers.clear();
    }
    this.cursor = this.scheduledUntil < 0 ? 0 : lowerBound(events, this.scheduledUntil);
  }

  /** Called on every timeline tick with the playhead and whether the video is running. */
  sync(timelineTime: number, playing: boolean): void {
    if (!playing) {
      if (this.wasPlaying) {
        this.stopAll();
        this.suspendWhenIdle();
      }
      this.wasPlaying = false;
      this.scheduledUntil = -1;
      this.lastT = -1;
      return;
    }
    const ctx = this.context();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    const now = ctx.currentTime;
    const expected = this.lastT < 0 ? timelineTime : this.lastT + (now - this.lastNow);
    if (!this.wasPlaying || Math.abs(timelineTime - expected) > SEEK_TOLERANCE) {
      this.stopAll();
      this.scheduledUntil = timelineTime - 0.01;
      this.cursor = lowerBound(this.events, this.scheduledUntil);
    }
    const horizon = timelineTime + LOOKAHEAD;
    while (this.cursor < this.events.length && this.events[this.cursor].t < horizon) {
      const e = this.events[this.cursor++];
      const when = now + (e.t - timelineTime);
      if (when >= now - 0.03) this.play(e, Math.max(now, when));
    }
    this.scheduledUntil = horizon;
    this.lastT = timelineTime;
    this.lastNow = now;
    this.wasPlaying = true;
  }

  /** Plays one sound right now — the inspector's "hear it" buttons. */
  audition(pack: SfxPack, sound: SfxSoundId, gain = 0.5): void {
    const ctx = this.context();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    const keep = this.pack;
    this.pack = pack;
    this.play({ id: "audition", t: 0, sound, kind: "click", gain, pan: 0, rate: 1 }, ctx.currentTime);
    this.pack = keep;
    if (!this.wasPlaying) this.suspendWhenIdle();
  }

  stopAll(): void {
    for (const src of this.active) {
      try {
        src.stop();
      } catch {
        /* already ended */
      }
    }
    this.active.clear();
  }

  dispose(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.stopAll();
    this.buffers.clear();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.master = null;
  }

  private suspendWhenIdle(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.wasPlaying || this.active.size > 0) return;
      if (this.ctx?.state === "running") void this.ctx.suspend().catch(() => undefined);
    }, IDLE_SUSPEND_MS);
  }

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof AudioContext === "undefined") return null;
    try {
      this.ctx = new AudioContext();
    } catch {
      return null;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  private buffer(ctx: AudioContext, sound: SfxSoundId): AudioBuffer {
    const key = `${this.pack.id}:${sound}:${ctx.sampleRate}`;
    let hit = this.buffers.get(key);
    if (!hit) {
      const data = renderedSound(this.pack, sound, ctx.sampleRate);
      hit = ctx.createBuffer(1, data.length, ctx.sampleRate);
      hit.copyToChannel(data, 0);
      this.buffers.set(key, hit);
    }
    return hit;
  }

  private play(e: SfxEvent, when: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const src = ctx.createBufferSource();
    src.buffer = this.buffer(ctx, e.sound);
    src.playbackRate.value = e.rate;
    const gain = ctx.createGain();
    gain.gain.value = e.gain;
    if (e.pan && typeof ctx.createStereoPanner === "function") {
      const panner = ctx.createStereoPanner();
      panner.pan.value = e.pan;
      src.connect(panner);
      panner.connect(gain);
    } else {
      src.connect(gain);
    }
    gain.connect(master);
    src.onended = () => {
      this.active.delete(src);
      src.disconnect();
      gain.disconnect();
    };
    src.start(when);
    this.active.add(src);
  }
}

let shared: SfxPreview | null = null;

/** One player for the editor: the preview loop feeds it, the inspector auditions through it. */
export function sfxPreview(): SfxPreview {
  if (!shared) shared = new SfxPreview();
  return shared;
}
