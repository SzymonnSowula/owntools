import type { ButtonEvent, InputButton, KeyKind, Project, TransitionKind, ZoomClip } from "../../types";
import { extractClicks } from "../cursorFx";
import { cursorFrameAt, normalizeCursor } from "../cursorMap";
import { timelineDuration } from "../segments";
import { clamp } from "../time";
import { segmentTimelineStart } from "../transitions";
import { getZoomTransform, viewWindow, zoomEase } from "../zoom";
import type { SfxSoundId } from "./packs";
import { mulberry32 } from "./synth";

/**
 * The plan: every moment the video should make a sound, on the cut timeline.
 * Pure — it reads the project and nothing else — so the preview, the export
 * and the timeline's marker row all agree, and it is cheap enough to redo on
 * every edit (a few thousand events at most).
 *
 * Sources, in order:
 * - clicks: the native input track when the take has one (press *and*
 *   release, every button, stamped at 250 Hz — the press plays `click`, the
 *   release `clickUp`), otherwise the down-edges of the 33 ms cursor track,
 *   which is what the click rings use too (each plays `clickFull`, press and
 *   release together as they were recorded);
 * - typing: the input track's key events — what sort of key, never which;
 * - zooms: a whoosh into each clip and one out, skipped where two clips join;
 * - transitions: a swell, a dip or a whoosh, by the transition's kind.
 *
 * Anything that happened inside a cut is dropped, not moved.
 */

export type SfxEventKind = "click" | "key" | "zoom" | "transition";

export interface SfxEvent {
  /** Seconds on the cut timeline. */
  t: number;
  sound: SfxSoundId;
  kind: SfxEventKind;
  /** Linear gain, master and per-kind volume included. */
  gain: number;
  /** -1 (left) … 1 (right). */
  pan: number;
  /** Playback rate, 1 = as rendered. */
  rate: number;
}

const CLICK_GAIN = 0.5;
const KEY_GAIN = 0.3;
const ZOOM_GAIN = 0.34;
const TRANSITION_GAIN = 0.4;
/** Two presses closer than this are one sound — a bounce, not a double-click. */
const MIN_CLICK_GAP = 0.03;
const MIN_KEY_GAP = 0.028;
/** Sound leads motion: a whoosh that starts a hair before the picture moves reads as one thing. */
const ZOOM_LEAD = 0.03;
const TRANSITION_LEAD = 0.08;
/** Two zoom clips this close are one shot; no out-and-in between them. */
const ZOOM_JOIN = 0.15;
/** How far left/right a click at the frame's edge is panned. */
const PAN_SPREAD = 0.55;
const ZOOM_PAN_SPREAD = 0.3;

const KEY_SOUND: Record<KeyKind, SfxSoundId> = {
  key: "key",
  modifier: "key",
  space: "keySpace",
  enter: "keyEnter",
  backspace: "keyBackspace",
};

const TRANSITION_SOUND: Record<Exclude<TransitionKind, "none">, SfxSoundId> = {
  crossfade: "swell",
  "dip-black": "dip",
  "dip-white": "dip",
  "slide-left": "whoosh",
  "slide-up": "whoosh",
  zoom: "whoosh",
};

interface Press {
  t: number;
  x: number;
  y: number;
  button: InputButton;
  down: boolean;
}

/** Presses from the precise track when there is one, else the cursor track's down-edges. */
export function pointerPresses(project: Project): { presses: Press[]; precise: boolean } {
  const inputs = project.inputs;
  if (inputs) {
    const presses = inputs.buttons.map((b: ButtonEvent) => ({
      t: b.t,
      x: b.x,
      y: b.y,
      button: b.button,
      down: b.down,
    }));
    return { presses, precise: true };
  }
  return {
    presses: extractClicks(project.cursor).map((c) => ({ ...c, button: "left" as const, down: true })),
    precise: false,
  };
}

/** Timeline time of a moment in the recording, or null when it was cut out. */
export function timelineTimeOf(project: Project, source: number): number | null {
  let acc = 0;
  for (const seg of project.segments) {
    const len = Math.max(0, seg.end - seg.start);
    if (source >= seg.start && source < seg.end) return acc + (source - seg.start);
    acc += len;
  }
  return null;
}

/**
 * Where on the *screen* a desktop point sits at that moment (0 = left edge,
 * 1 = right), with the zoom taken into account: a click at the frame's far
 * right that the camera has centred on should sound centred.
 */
export function screenX(project: Project, x: number, y: number, sourceTime: number): number | null {
  const frame = cursorFrameAt(project, sourceTime);
  if (!frame) return null;
  const p = normalizeCursor(x, y, frame.rect, frame.videoAspect, frame.align);
  if (!p.inside) return null;
  const z = getZoomTransform(project.zooms, sourceTime, project.cursor, frame.rect);
  if (z.scale <= 1.001) return clamp(p.nx, 0, 1);
  const win = viewWindow(z.x, z.scale);
  return clamp((p.nx - win.start) * z.scale, 0, 1);
}

export function planSfx(project: Project): SfxEvent[] {
  const { sfx, segments } = project;
  if (!segments.length || timelineDuration(segments) <= 0) return [];
  const events: SfxEvent[] = [];
  const master = clamp(sfx.volume, 0, 2);
  const spatial = Boolean(sfx.spatial && project.captureRect);
  const pan = (x: number, y: number, sourceTime: number, spread: number): number => {
    if (!spatial) return 0;
    const sx = screenX(project, x, y, sourceTime);
    return sx === null ? 0 : clamp((sx - 0.5) * 2, -1, 1) * spread;
  };

  if (sfx.clicks && sfx.clickVolume > 0) {
    const { presses, precise } = pointerPresses(project);
    const level = clamp(sfx.clickVolume, 0, 2) * master;
    let lastDown = -Infinity;
    for (const p of presses) {
      const t = timelineTimeOf(project, p.t);
      if (t === null) continue;
      if (p.down) {
        if (p.t - lastDown < MIN_CLICK_GAP) continue;
        lastDown = p.t;
        events.push({
          t,
          sound: p.button === "right" ? "rightClick" : precise ? "click" : "clickFull",
          kind: "click",
          gain: CLICK_GAIN * (p.button === "middle" ? 0.8 : 1) * level,
          pan: pan(p.x, p.y, p.t, PAN_SPREAD),
          rate: 1,
        });
      } else if (precise && p.button !== "right") {
        // A release off the 33 ms track lands up to a frame late; only the native one is worth hearing.
        // The right click plays whole at the press — its release is in the recording already.
        events.push({
          t,
          sound: "clickUp",
          kind: "click",
          gain: CLICK_GAIN * level,
          pan: pan(p.x, p.y, p.t, PAN_SPREAD),
          rate: 1,
        });
      }
    }
  }

  if (sfx.typing && sfx.typingVolume > 0 && project.inputs) {
    const level = clamp(sfx.typingVolume, 0, 2) * master;
    // Real keys never sound twice the same: a little spread in level and pitch, seeded so the export never changes.
    const rand = mulberry32(7);
    let last = -Infinity;
    for (const k of project.inputs.keys) {
      const t = timelineTimeOf(project, k.t);
      if (t === null) continue;
      if (k.t - last < MIN_KEY_GAP) continue;
      last = k.t;
      events.push({
        t,
        sound: KEY_SOUND[k.kind] ?? "key",
        kind: "key",
        gain: KEY_GAIN * (k.kind === "modifier" ? 0.7 : 1) * (0.85 + 0.15 * rand()) * level,
        pan: 0,
        rate: 0.96 + 0.08 * rand(),
      });
    }
  }

  if (sfx.zooms && sfx.zoomVolume > 0) {
    const level = clamp(sfx.zoomVolume, 0, 2) * master;
    const zooms = [...project.zooms].sort((a, b) => a.start - b.start);
    zooms.forEach((z: ZoomClip, i) => {
      if (z.end - z.start <= 0.2) return;
      const { inT, outT } = zoomEase(z);
      const prev = zooms[i - 1];
      const next = zooms[i + 1];
      const zoomPan = spatial ? clamp((z.x - 0.5) * 2, -1, 1) * ZOOM_PAN_SPREAD : 0;
      if (!prev || z.start - prev.end > ZOOM_JOIN) {
        const t = timelineTimeOf(project, z.start);
        if (t !== null) {
          events.push({
            t: Math.max(0, t - ZOOM_LEAD),
            sound: "zoomIn",
            kind: "zoom",
            gain: ZOOM_GAIN * level,
            pan: zoomPan,
            rate: clamp(0.65 / inT, 0.75, 1.5),
          });
        }
      }
      if (!next || next.start - z.end > ZOOM_JOIN) {
        const t = timelineTimeOf(project, z.end - outT);
        if (t !== null) {
          events.push({
            t,
            sound: "zoomOut",
            kind: "zoom",
            gain: ZOOM_GAIN * 0.85 * level,
            pan: zoomPan,
            rate: clamp(0.75 / outT, 0.75, 1.5),
          });
        }
      }
    });
  }

  if (sfx.transitions && sfx.transitionVolume > 0) {
    const level = clamp(sfx.transitionVolume, 0, 2) * master;
    segments.forEach((seg, i) => {
      if (i === 0) return;
      const tr = seg.transition;
      if (!tr || tr.kind === "none" || tr.duration <= 0) return;
      const dur = Math.min(tr.duration, Math.max(0.05, seg.end - seg.start));
      const sound = TRANSITION_SOUND[tr.kind as Exclude<TransitionKind, "none">];
      const nominal = sound === "swell" ? 0.9 : 0.8;
      events.push({
        t: Math.max(0, segmentTimelineStart(segments, i) - TRANSITION_LEAD),
        sound,
        kind: "transition",
        gain: TRANSITION_GAIN * level,
        pan: 0,
        rate: clamp(nominal / (dur + 0.25), 0.75, 1.5),
      });
    });
  }

  events.sort((a, b) => a.t - b.t);
  return events;
}

const planCache = new WeakMap<Project, SfxEvent[]>();

/** The plan for a project object, computed once per edit (every edit makes a new object). */
export function sfxPlanFor(project: Project): SfxEvent[] {
  let hit = planCache.get(project);
  if (!hit) {
    hit = planSfx(project);
    planCache.set(project, hit);
  }
  return hit;
}

export type SfxCounts = Record<SfxEventKind, number>;

export function sfxCounts(events: SfxEvent[]): SfxCounts {
  const counts: SfxCounts = { click: 0, key: 0, zoom: 0, transition: 0 };
  for (const e of events) counts[e.kind] += 1;
  return counts;
}
