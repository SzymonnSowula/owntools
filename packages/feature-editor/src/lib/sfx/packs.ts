import type { SfxPackId } from "../../types";
import { MOUSE_CLICK_SPLIT, sample } from "./samples";
import type { NoiseLayer, Recipe, SampleLayer, ToneLayer } from "./synth";

/**
 * Three sound packs, each a full set of the moments the planner can hit. A
 * pack is what keeps a video sounding like one studio: the same character on
 * every click, key and whoosh. "Soft" is the understated default — rounded
 * taps you feel more than hear; "mechanical" is crisp and clicky, a
 * typewriter's cousin; "playful" is pops and bloops, the sound of a friendly
 * app.
 *
 * The mouse click is a recording (`samples.ts`), the same one in every pack
 * with the pack's own colouring on top. It comes in three cuts: `click` is
 * the press alone and `clickUp` the release, for a take whose input track
 * knows when the button came up; `clickFull` is the whole click — press and
 * release as they were recorded, 85 ms apart — for a take that only has the
 * cursor track's down-edges.
 */

export type SfxSoundId =
  | "click"
  | "clickUp"
  | "clickFull"
  | "rightClick"
  | "key"
  | "keySpace"
  | "keyEnter"
  | "keyBackspace"
  | "zoomIn"
  | "zoomOut"
  | "whoosh"
  | "swell"
  | "dip";

export interface SfxPack {
  id: SfxPackId;
  name: string;
  hint: string;
  sounds: Record<SfxSoundId, Recipe>;
}

export const SFX_SOUND_LABELS: Record<SfxSoundId, string> = {
  click: "Click (press)",
  clickUp: "Click (release)",
  clickFull: "Click",
  rightClick: "Right click",
  key: "Key",
  keySpace: "Space bar",
  keyEnter: "Enter",
  keyBackspace: "Backspace",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  whoosh: "Whoosh",
  swell: "Swell",
  dip: "Dip",
};

type Filter = NonNullable<NoiseLayer["filter"]>;

function noise(
  gain: number,
  attack: number,
  decay: number,
  filter?: Filter,
  more: Partial<Omit<NoiseLayer, "type">> = {},
): NoiseLayer {
  return { type: "noise", gain, attack, decay, filter, ...more };
}

function tone(
  gain: number,
  freq: number,
  attack: number,
  decay: number,
  to?: number,
  more: Partial<Omit<ToneLayer, "type">> = {},
): ToneLayer {
  return { type: "tone", gain, freq, attack, decay, to, ...more };
}

const bp = (freq: number, q = 1, to?: number): Filter => ({ type: "bandpass", freq, q, to });
const lp = (freq: number, to?: number, q = 0.707): Filter => ({ type: "lowpass", freq, q, to });
const hp = (freq: number, q = 0.707): Filter => ({ type: "highpass", freq, q });

function recipe(duration: number, layers: Recipe["layers"], seed = 1, peak = 0.9): Recipe {
  return { duration, seed, peak, layers };
}

const MOUSE_CLICK_SECONDS = sample("mouseClick").data.length / sample("mouseClick").sampleRate;

type Colour = Omit<SampleLayer, "type" | "sample" | "gain" | "from" | "to">;

/**
 * The three cuts of the recorded click, coloured per pack. Levels are left as
 * recorded (no normalisation) so the release stays as much louder than the
 * press as a real button is, whichever cut plays.
 */
function clickCuts(
  colour: Colour,
  extra: Recipe["layers"] = [],
): { click: Recipe; clickUp: Recipe; clickFull: Recipe; rightClick: Recipe } {
  const rate = colour.rate ?? 1;
  const cut = (from: number | undefined, to: number | undefined, more: Partial<SampleLayer> = {}): SampleLayer => ({
    type: "sample",
    sample: "mouseClick",
    gain: 1,
    from,
    to,
    ...colour,
    ...more,
  });
  const pressLen = MOUSE_CLICK_SPLIT / rate;
  const fullLen = MOUSE_CLICK_SECONDS / rate;
  return {
    click: { duration: pressLen + 0.01, normalize: false, layers: [cut(0, MOUSE_CLICK_SPLIT), ...extra] },
    clickUp: { duration: fullLen - pressLen + 0.01, normalize: false, layers: [cut(MOUSE_CLICK_SPLIT, undefined)] },
    clickFull: { duration: fullLen + 0.01, normalize: false, layers: [cut(0, undefined), ...extra] },
    rightClick: {
      duration: fullLen / 0.9 + 0.01,
      normalize: false,
      layers: [cut(0, undefined, { rate: rate * 0.9, gain: 0.95 }), ...extra],
    },
  };
}

const soft: SfxPack = {
  id: "soft",
  name: "Soft",
  hint: "Rounded taps and airy whooshes — you feel them more than hear them.",
  sounds: {
    // The click as recorded, only a touch of the very top taken off.
    ...clickCuts({ filter: { type: "lowpass", freq: 9000, q: 0.6 } }),
    key: recipe(0.07, [
      noise(1, 0.0005, 0.012, bp(1500, 0.9)),
      noise(0.35, 0.0002, 0.003, hp(5000)),
      tone(0.45, 115, 0.001, 0.016),
    ], 4, 0.85),
    keySpace: recipe(0.09, [
      noise(1, 0.0006, 0.016, bp(950, 0.8)),
      noise(0.25, 0.0002, 0.003, hp(4000)),
      tone(0.6, 85, 0.001, 0.024),
    ], 5),
    keyEnter: recipe(0.09, [
      noise(1, 0.0006, 0.017, bp(1150, 0.9)),
      noise(0.3, 0.0002, 0.003, hp(4500)),
      tone(0.6, 95, 0.001, 0.024),
    ], 6, 0.92),
    keyBackspace: recipe(0.07, [
      noise(1, 0.0005, 0.011, bp(1750, 1)),
      noise(0.3, 0.0002, 0.003, hp(5000)),
      tone(0.4, 120, 0.001, 0.014),
    ], 7, 0.85),
    zoomIn: recipe(0.65, [
      noise(1, 0.12, 0.16, bp(450, 0.7, 2300), { hold: 0.05 }),
      noise(0.35, 0.1, 0.15, lp(700)),
    ], 8, 0.8),
    zoomOut: recipe(0.75, [
      noise(1, 0.15, 0.2, bp(2300, 0.7, 450), { hold: 0.05 }),
      noise(0.35, 0.12, 0.2, lp(600)),
    ], 9, 0.8),
    whoosh: recipe(0.85, [
      noise(1, 0.14, 0.22, bp(380, 0.8, 2800), { hold: 0.06 }),
      noise(0.3, 0.1, 0.2, lp(900), { hold: 0.05 }),
    ], 10, 0.85),
    swell: recipe(0.95, [
      noise(1, 0.3, 0.3, lp(800, 2000), { hold: 0.05 }),
      tone(0.12, 220, 0.25, 0.3),
    ], 11, 0.7),
    dip: recipe(0.85, [noise(1, 0.16, 0.3, lp(550)), tone(0.6, 68, 0.03, 0.28)], 12, 0.8),
  },
};

const mechanical: SfxPack = {
  id: "mechanical",
  name: "Mechanical",
  hint: "Crisp clicks and typewriter keys, bright sweeps.",
  sounds: {
    // Brighter and a shade quicker: the body rolled off, the snap kept.
    ...clickCuts({ filter: { type: "highpass", freq: 900, q: 0.7 }, rate: 1.06 }),
    key: recipe(0.07, [
      noise(1, 0.0003, 0.009, bp(2600, 2)),
      noise(0.8, 0.0002, 0.004, hp(4000)),
      tone(0.35, 160, 0.001, 0.012),
      tone(0.3, 3200, 0.0002, 0.005),
    ], 24, 0.88),
    keySpace: recipe(0.09, [
      noise(1, 0.0004, 0.014, bp(1400, 1.5)),
      noise(0.6, 0.0002, 0.004, hp(3500)),
      tone(0.5, 110, 0.001, 0.02),
    ], 25),
    keyEnter: recipe(0.09, [
      noise(1, 0.0004, 0.015, bp(1700, 1.6)),
      noise(0.6, 0.0002, 0.004, hp(3800)),
      tone(0.5, 125, 0.001, 0.02),
      tone(0.25, 2800, 0.0002, 0.006),
    ], 26, 0.92),
    keyBackspace: recipe(0.07, [
      noise(1, 0.0003, 0.009, bp(3000, 2)),
      noise(0.7, 0.0002, 0.004, hp(4500)),
      tone(0.3, 170, 0.001, 0.011),
    ], 27, 0.88),
    zoomIn: recipe(0.6, [
      noise(1, 0.1, 0.15, bp(500, 1.1, 4000), { hold: 0.04 }),
      noise(0.25, 0.08, 0.14, lp(900)),
    ], 28, 0.8),
    zoomOut: recipe(0.7, [
      noise(1, 0.14, 0.18, bp(4000, 1.1, 500), { hold: 0.04 }),
      noise(0.25, 0.1, 0.18, lp(800)),
    ], 29, 0.8),
    whoosh: recipe(0.8, [
      noise(1, 0.12, 0.2, bp(400, 1, 4200), { hold: 0.05 }),
      noise(0.25, 0.1, 0.18, lp(1000), { hold: 0.05 }),
    ], 30, 0.85),
    swell: recipe(0.9, [
      noise(1, 0.28, 0.28, lp(1000, 3000), { hold: 0.05 }),
      tone(0.1, 330, 0.25, 0.28),
    ], 31, 0.7),
    dip: recipe(0.8, [noise(1, 0.14, 0.28, lp(500)), tone(0.6, 60, 0.03, 0.26)], 32, 0.8),
  },
};

const playful: SfxPack = {
  id: "playful",
  name: "Playful",
  hint: "Pops and bloops — the sound of a friendly app.",
  sounds: {
    // The real click with a small bloop under the press.
    ...clickCuts({}, [tone(0.22, 720, 0.002, 0.035, 360)]),
    key: recipe(0.08, [tone(0.8, 880, 0.001, 0.025, 520), noise(0.3, 0.0004, 0.008, lp(2500))], 44, 0.85),
    keySpace: recipe(0.1, [tone(1, 520, 0.001, 0.035, 300), noise(0.3, 0.0004, 0.01, lp(1800))], 45),
    keyEnter: recipe(0.12, [tone(1, 620, 0.001, 0.04, 310), tone(0.4, 930, 0.001, 0.03, 465)], 46, 0.92),
    keyBackspace: recipe(0.08, [tone(0.9, 700, 0.001, 0.02, 980), noise(0.25, 0.0004, 0.006, lp(2500))], 47, 0.85),
    zoomIn: recipe(0.65, [
      noise(1, 0.12, 0.16, bp(500, 0.8, 3000), { hold: 0.05 }),
      tone(0.2, 300, 0.1, 0.25, 600),
    ], 48, 0.8),
    zoomOut: recipe(0.75, [
      noise(1, 0.15, 0.2, bp(3000, 0.8, 500), { hold: 0.05 }),
      tone(0.2, 600, 0.12, 0.28, 300),
    ], 49, 0.8),
    whoosh: recipe(0.85, [
      noise(1, 0.14, 0.22, bp(400, 0.8, 3200), { hold: 0.06 }),
      tone(0.15, 400, 0.12, 0.25, 800),
    ], 50, 0.85),
    swell: recipe(1, [
      noise(0.8, 0.3, 0.3, lp(900, 2200), { hold: 0.05 }),
      tone(0.2, 262, 0.3, 0.32),
      tone(0.12, 392, 0.32, 0.3),
    ], 51, 0.7),
    dip: recipe(0.85, [noise(1, 0.16, 0.3, lp(500)), tone(0.6, 65, 0.03, 0.28)], 52, 0.8),
  },
};

export const SFX_PACKS: SfxPack[] = [soft, mechanical, playful];

export function sfxPack(id: SfxPackId | string | undefined): SfxPack {
  return SFX_PACKS.find((p) => p.id === id) ?? soft;
}
