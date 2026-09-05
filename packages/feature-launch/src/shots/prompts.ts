/**
 * Store-screenshot prompt generator.
 *
 * We deliberately do not *render* store screenshots. A good one is an image
 * model's job, and a mediocre generator baked into the app would be worse than
 * the tool people already use. What is genuinely missing is the brief: the
 * exact canvas, the copy plan across a gallery, and a prompt that carries the
 * brand instead of "make it look modern". That is what this file produces —
 * from the same `LaunchInput` the video renders from, so a listing and a launch
 * video come out of one brief.
 */

import type { LaunchInput, StyleId } from "../engine/types";
import { targetRatio, targetSize, type ShotTarget } from "./targets";

/* ------------------------------- style voice ------------------------------ */

interface StyleVoice {
  /** The background and surface treatment. */
  scene: string;
  /** Typography instruction. */
  type: string;
  /** One-word-ish mood, kept at the end of the prompt. */
  mood: string;
}

/**
 * The same six packs the video engine ships, described in words an image model
 * understands. Keeping them in sync is the whole point: a listing shot and the
 * launch video should look like they came from the same studio.
 */
const STYLE_VOICE: Record<StyleId, StyleVoice> = {
  desk: {
    scene:
      "soft off-white paper ground with a faint dot grid, a gentle daylight sky gradient bleeding in from the top, subtle floating card shadows",
    type: "geometric sans (Outfit-like), bold, tight tracking, all lowercase",
    mood: "calm, bright, unhurried — a tidy desk by an open window",
  },
  aurora: {
    scene:
      "drifting soft colour washes bleeding into each other, frosted glass panels with a light inner glow, no hard edges",
    type: "geometric sans, semibold, generous letter spacing, sentence case",
    mood: "soft, friendly, weightless",
  },
  noir: {
    scene:
      "a near-black stage lit by one soft overhead pool of light, deep falloff into the corners, no texture",
    type: "oversized display sans, extrabold, very tight tracking, one idea only",
    mood: "cinematic, confident, keynote stage",
  },
  editorial: {
    scene:
      "an off-white magazine page with thin hairline rules, a visible column grid and wide outer margins",
    type: "serif or high-contrast sans headline with a small-caps kicker above it",
    mood: "slow, considered, printed",
  },
  terminal: {
    scene:
      "near-black background with a faint scanline texture and a thin bordered terminal panel",
    type: "monospaced throughout, a blinking block caret after the headline",
    mood: "technical, dry, built by hand",
  },
  poster: {
    scene:
      "flat blocks of solid colour meeting at hard edges, zero gradients, zero shadows",
    type: "oversized condensed uppercase, packed tight, filling the block",
    mood: "loud, graphic, made to survive a small thumbnail",
  },
};

/* -------------------------------- shot plan ------------------------------- */

export type ShotRole = "hero" | "feature" | "proof" | "close";

export interface PlannedShot {
  n: number;
  role: ShotRole;
  /** The one line rendered large in the image. */
  headline: string;
  /** The supporting line, or "" when the shot is better off with none. */
  subhead: string;
  /** What the attached app screenshot should be showing for this shot. */
  screen: string;
}

const ROLE_SCREEN: Record<ShotRole, string> = {
  hero: "the screen someone lands on first — the app doing its main job",
  feature: "the exact screen where this feature lives",
  proof: "a screen that shows the result, not the settings",
  close: "the cleanest, emptiest state of the app, or the icon on its own",
};

/**
 * A gallery is a sentence, not five posters. Shot 1 sells the promise, the
 * middle shots each carry one feature, and the last one closes. Everything is
 * derived from the brief — nothing is invented on the user's behalf.
 */
export function planShots(input: LaunchInput, count: number): PlannedShot[] {
  const name = input.name.trim() || "your product";
  const tagline = input.tagline.trim();
  const features = input.features.map((f) => f.trim()).filter(Boolean);

  const shots: PlannedShot[] = [
    {
      n: 1,
      role: "hero",
      headline: tagline || name,
      subhead: tagline ? name : "",
      screen: ROLE_SCREEN.hero,
    },
  ];

  // One feature per shot, in the order they were written — that order is the
  // pitch, and reshuffling it would quietly rewrite the pitch.
  const room = Math.max(0, count - 2);
  features.slice(0, room).forEach((feature) => {
    shots.push({
      n: shots.length + 1,
      role: "feature",
      headline: feature,
      subhead: "",
      screen: ROLE_SCREEN.feature,
    });
  });

  // If the brief is thin, fill the middle with the promise again rather than
  // making claims the product may not support.
  while (shots.length < count - 1) {
    shots.push({
      n: shots.length + 1,
      role: "proof",
      headline: tagline || name,
      subhead: "",
      screen: ROLE_SCREEN.proof,
    });
  }

  if (count > 1) {
    shots.push({
      n: shots.length + 1,
      role: "close",
      headline: name,
      subhead: tagline,
      screen: ROLE_SCREEN.close,
    });
  }

  return shots.slice(0, count);
}

/* --------------------------------- prompts -------------------------------- */

const FRAME_TEXT: Record<ShotTarget["frame"], string> = {
  phone:
    "place the attached screenshot inside a realistic modern phone frame, straight on, centred, filling the lower two thirds of the canvas and cropped by the bottom edge",
  tablet:
    "place the attached screenshot inside a realistic tablet frame, straight on, centred, filling the lower two thirds of the canvas",
  desktop:
    "place the attached screenshot inside a realistic desktop window with a title bar, straight on, centred, slightly cropped by the bottom edge",
  flat:
    "place the attached screenshot as a flat rectangle with rounded corners and a soft shadow, angled no more than 4 degrees, sitting to one side of the copy",
};

export interface ShotPrompt extends PlannedShot {
  /** The prompt to paste into an image model, alongside the screenshot. */
  prompt: string;
  /** What to rule out — some tools take this in a separate field. */
  negative: string;
}

const NEGATIVE =
  "Do not redraw, restyle or invent any UI inside the attached screenshot — reproduce it pixel-accurate. No lorem ipsum, no placeholder text, no misspelled or warped letters, no watermark, no stock photos of people, no clip-art icons, no extra logos, no drop-shadowed 3D text.";

export function buildShotPrompt(
  input: LaunchInput,
  target: ShotTarget,
  shot: PlannedShot,
  total: number,
): ShotPrompt {
  const voice = STYLE_VOICE[input.style] ?? STYLE_VOICE.desk;
  const name = input.name.trim() || "your product";
  const day = input.theme === "day";
  const ground = day ? "light" : "dark";

  const lines = [
    `A ${storeWord(target)} screenshot for "${name}" — shot ${shot.n} of ${total}.`,
    ``,
    `CANVAS: exactly ${targetSize(target)} px (${targetRatio(target)}), ${
      target.width > target.height ? "landscape" : "portrait"
    }, ${ground} background. ${capitalise(target.safe)}.`,
    `SCENE: ${voice.scene}.`,
    `HEADLINE, set large and rendered as real text: "${shot.headline}"`,
    shot.subhead ? `SUBHEAD, one size down, directly beneath: "${shot.subhead}"` : null,
    `SCREENSHOT: ${FRAME_TEXT[target.frame]}. It should be showing ${shot.screen}.`,
    `COLOUR: accent ${input.accent} used sparingly for one emphasis only; everything else is ${
      day ? "near-black type on the light ground" : "near-white type on the dark ground"
    }.`,
    `TYPE: ${voice.type}. The headline is the loudest thing in the frame.`,
    `COMPOSITION: copy on top, product below, nothing overlapping the safe area. It has to stay readable as a thumbnail a third of this size.`,
    `MOOD: ${voice.mood}.`,
    ``,
    NEGATIVE,
  ].filter(Boolean) as string[];

  return { ...shot, prompt: lines.join("\n"), negative: NEGATIVE };
}

export function buildShotPrompts(
  input: LaunchInput,
  target: ShotTarget,
  count: number,
): ShotPrompt[] {
  const plan = planShots(input, count);
  return plan.map((shot) => buildShotPrompt(input, target, shot, plan.length));
}

function storeWord(target: ShotTarget): string {
  switch (target.store) {
    case "appstore":
      return `App Store (${target.label})`;
    case "playstore":
      return `Google Play (${target.label})`;
    case "macstore":
      return "Mac App Store";
    default:
      return target.label;
  }
}

function capitalise(s: string): string {
  return s ? s[0].toLocaleUpperCase() + s.slice(1) : s;
}

/** The whole set as one markdown file — the thing you actually hand to a tool. */
export function shotsToMarkdown(
  input: LaunchInput,
  target: ShotTarget,
  prompts: ShotPrompt[],
): string {
  const name = input.name.trim() || "your product";
  const head = [
    `# ${name} — ${storeWord(target)} screenshots`,
    ``,
    `- **Canvas:** ${targetSize(target)} px (${targetRatio(target)})`,
    `- **Store note:** ${target.requirement}`,
    `- **Style:** ${input.style} · ${input.theme} · accent ${input.accent}`,
    `- **Attach your app screenshot to every prompt below.**`,
    ``,
  ];
  const body = prompts.flatMap((p) => [
    `## ${String(p.n).padStart(2, "0")} — ${p.headline}`,
    ``,
    "```",
    p.prompt,
    "```",
    ``,
  ]);
  return [...head, ...body].join("\n");
}
