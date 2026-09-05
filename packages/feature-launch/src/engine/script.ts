import { FPS, type ArcId, type Beat, type BeatKind, type LaunchInput, type LaunchScript } from "./types";
import { pick, pickIndex } from "./take";

/**
 * The writer. Turns the brief into a beat sheet: which beats, in what order,
 * for how long. Deterministic — the same (brief, seed, length) always produces
 * the same cut — and always exactly `seconds × FPS` frames: missing material
 * never shortens the video, the remaining beats stretch to fill it.
 *
 * The seed picks the *arc* (how the story is told) and each beat's layout
 * variant, which is what stops two videos from looking like the same template.
 */

interface Draft {
  kind: BeatKind;
  weight: number;
  text?: string;
  label?: string;
  index?: number;
}

export const ARCS: { id: ArcId; label: string; desc: string }[] = [
  { id: "classic", label: "Classic", desc: "Name → promise → proof → CTA" },
  { id: "coldOpen", label: "Cold open", desc: "Lead with the claim, reveal the name after" },
  { id: "showFirst", label: "Show first", desc: "Product shot up front, copy after" },
  { id: "rapid", label: "Rapid", desc: "Short beats, features fast, no lingering" },
];

/** How many features a cut of this length can actually land. */
function featureBudget(seconds: number): number {
  if (seconds <= 15) return 2;
  if (seconds <= 30) return 3;
  return 4;
}

/** Copy fallbacks, so an empty field never produces an empty frame. */
function copy(input: LaunchInput) {
  const name = input.name.trim() || "your product";
  const tagline = input.tagline.trim() || "one line about why it matters";
  const host = input.url.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return { name, tagline, host };
}

function arcFor(input: LaunchInput, hasImage: boolean): ArcId {
  const pool: ArcId[] = ["classic", "coldOpen", "rapid"];
  if (hasImage) pool.push("showFirst");
  if (input.seconds <= 15) pool.push("rapid");
  return pick(input.seed, "arc", pool);
}

function draftsFor(arc: ArcId, input: LaunchInput, features: string[], hasImage: boolean): Draft[] {
  const { name, tagline, host } = copy(input);
  const long = input.seconds >= 60;
  const short = input.seconds <= 15;

  const hook: Draft = { kind: "hook", weight: 100, text: name };
  const tag: Draft = { kind: "tagline", weight: 125, text: tagline };
  const show: Draft = { kind: "showcase", weight: long ? 210 : 200, label: host };
  const outro: Draft = { kind: "outro", weight: short ? 100 : 115, text: name, label: host };
  const featureDrafts: Draft[] = features.map((text, index) => ({
    kind: "feature",
    weight: (short ? 200 : long ? 380 : 300) / Math.max(1, features.length),
    text,
    index,
  }));
  // Without material to show, the cut leans on typography instead of leaving a hole.
  const filler: Draft = hasImage
    ? show
    : { kind: "statement", weight: 165, text: tagline };

  let beats: Draft[];
  switch (arc) {
    case "coldOpen":
      beats = [{ ...tag, weight: 150 }, hook, ...featureDrafts, filler, outro];
      break;
    case "showFirst":
      beats = [hook, { ...show, weight: 170 }, tag, ...featureDrafts, outro];
      break;
    case "rapid":
      beats = [{ ...hook, weight: 78 }, ...featureDrafts, { ...tag, weight: 105 }, filler, outro];
      break;
    default:
      beats = [hook, tag, ...featureDrafts, filler, outro];
  }

  if (long) {
    // The full tour has room for a second look and a closing statement.
    const proof: Draft = { kind: "proof", weight: 150, text: tagline, label: host };
    const insertAt = Math.max(1, beats.length - 1);
    beats = [...beats.slice(0, insertAt), proof, ...beats.slice(insertAt)];
    if (hasImage && arc !== "showFirst") {
      beats = [...beats.slice(0, 2), { ...show, kind: "showcase", weight: 140 }, ...beats.slice(2)];
    }
  }
  if (short) {
    // 15s can't hold a statement *and* a showcase — keep whichever carries more.
    const seen = new Set<BeatKind>();
    beats = beats.filter((b) => {
      if (b.kind === "statement" || b.kind === "proof") {
        if (seen.has("statement")) return false;
        seen.add("statement");
      }
      return true;
    });
  }
  return beats;
}

export function buildScript(input: LaunchInput): LaunchScript {
  const totalFrames = Math.round(input.seconds * FPS);
  const features = input.features
    .map((f) => f.trim())
    .filter(Boolean)
    .slice(0, featureBudget(input.seconds));
  const hasImage = Boolean(input.imageDataUrl);
  const arc = arcFor(input, hasImage);
  const drafts = draftsFor(arc, input, features, hasImage);
  const featureCount = drafts.filter((d) => d.kind === "feature").length;

  const totalWeight = drafts.reduce((sum, d) => sum + d.weight, 0);
  let cursor = 0;
  const beats: Beat[] = drafts.map((draft, i) => {
    const last = i === drafts.length - 1;
    const frames = last
      ? totalFrames - cursor
      : Math.max(20, Math.round((draft.weight / totalWeight) * totalFrames));
    const beat: Beat = {
      kind: draft.kind,
      from: cursor,
      frames,
      text: draft.text,
      label: draft.label,
      index: draft.index,
      count: featureCount,
      variant: pickIndex(input.seed, `variant:${draft.kind}:${draft.index ?? i}`, 3),
    };
    cursor += frames;
    return beat;
  });

  // Rounding can leave the last beat a frame or two short/long — absorb it.
  const drift = totalFrames - beats.reduce((sum, b) => sum + b.frames, 0);
  if (drift !== 0 && beats.length) beats[beats.length - 1].frames += drift;

  return { arc, beats, totalFrames };
}

/** The beat under a given frame — used by backgrounds that react to the cut. */
export function beatAt(script: LaunchScript, frame: number): { beat: Beat; progress: number } {
  const beat =
    script.beats.find((b) => frame >= b.from && frame < b.from + b.frames) ??
    script.beats[script.beats.length - 1] ??
    ({ kind: "hook", from: 0, frames: 1, variant: 0 } as Beat);
  return { beat, progress: Math.min(1, Math.max(0, (frame - beat.from) / Math.max(1, beat.frames))) };
}
