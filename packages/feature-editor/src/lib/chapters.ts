import { llmJson, llmStatus } from "@core/llm";
import type { Chapter, Segment } from "../types";
import { sourceToTimeline } from "./segments";
import { normalizeToken, type Sentence, type Word } from "./transcriptEdit";

/**
 * Chapters from the shape of the speech: a long pause before a sentence is
 * where a person paused to change subject, so the strongest pauses become
 * chapter starts, spaced out so a ten-minute take gets four to eight rather
 * than one per breath. Titles are the opening words of the chapter with the
 * fillers taken out; when a language model is set up it may rewrite the
 * titles, never the boundaries — the heuristic is the product, the model is
 * polish.
 */

/** A pause at least this long can start a chapter. */
export const CHAPTER_PAUSE = 1.5;
/** Takes shorter than this get no chapters — there is nothing to navigate. */
const MIN_DURATION = 45;

const LEAD_INS = new Set([
  "so", "and", "okay", "ok", "now", "well", "alright", "right", "then", "but", "also", "yeah",
  "no", "więc", "a", "i", "to", "czyli", "dobrze", "teraz", "tak", "ale",
]);
const FILLERS = /^(?:u+m+|u+h+m*|e+r+m*|h+m+|m{2,}|y{2,}|e{2,}m*|y+h+m*)$/;

/** How many chapters a take of this length wants: 3 for anything short, about one per 75 s, at most 12. */
export function targetChapterCount(duration: number): number {
  return Math.max(3, Math.min(12, Math.round(duration / 75)));
}

/**
 * Capitalised, punctuation-trimmed opening of the words — up to `max` of them,
 * stopping at the first clause break once at least `min` are in — fillers and
 * lead-ins dropped. A colon is not a break: it introduces the subject.
 */
export function chapterTitleFromWords(words: Word[], min = 3, max = 7): string {
  const usable = words.filter((w) => {
    const n = normalizeToken(w.text);
    return n.length > 0 && !FILLERS.test(n);
  });
  let start = 0;
  while (start < usable.length - 1 && LEAD_INS.has(normalizeToken(usable[start].text))) start++;
  const pool = usable.slice(start);
  if (!pool.length) return "";
  let take = Math.min(max, pool.length);
  for (let i = min - 1; i < Math.min(max, pool.length); i++) {
    if (/[,;.!?…]$/.test(pool[i].text)) {
      take = i + 1;
      break;
    }
  }
  const text = pool
    .slice(0, take)
    .map((w) => w.text)
    .join(" ")
    .replace(/[\s,;:.!?…–—-]+$/u, "")
    .replace(/^[\s“"'(-]+/u, "");
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

/** Title for the chapter starting at sentence `index`, pulling from the next sentence when the first is a stub. */
function titleAt(sentences: Sentence[], index: number): string {
  const words: Word[] = [];
  for (let i = index; i < sentences.length && words.length < 7; i++) words.push(...sentences[i].words);
  return chapterTitleFromWords(words) || "Chapter";
}

export interface ProposeOptions {
  /** Overrides the length-based count. */
  target?: number;
  pause?: number;
}

/**
 * Chapter starts from pauses. Candidates are sentence starts preceded by a
 * pause of `CHAPTER_PAUSE`+; the longest pauses win, subject to a minimum
 * spacing, until the target count is met. A long take with too few pauses is
 * split evenly at sentence starts instead. Chapter one is always at 0.
 */
export function proposeChapters(sentences: Sentence[], duration: number, options: ProposeOptions = {}): Chapter[] {
  if (duration < MIN_DURATION || sentences.length < 3) return [];
  const target = options.target ?? targetChapterCount(duration);
  const minPause = options.pause ?? CHAPTER_PAUSE;
  const minGap = Math.max(12, duration / (target * 2.5));

  const candidates: { index: number; pause: number }[] = [];
  for (let k = 1; k < sentences.length; k++) {
    const pause = sentences[k].start - sentences[k - 1].end;
    const start = sentences[k].start;
    if (pause >= minPause && start >= minGap && start <= duration - minGap) candidates.push({ index: k, pause });
  }
  candidates.sort((a, b) => b.pause - a.pause || a.index - b.index);

  const picked: number[] = [];
  const farEnough = (t: number) => t >= minGap && picked.every((i) => Math.abs(sentences[i].start - t) >= minGap);
  for (const c of candidates) {
    if (picked.length >= target - 1) break;
    if (farEnough(sentences[c.index].start)) picked.push(c.index);
  }

  // Few pauses in a long take: fill the gaps at evenly spaced sentence starts.
  if (picked.length < target - 1 && duration >= 240) {
    for (let k = 1; k < target && picked.length < target - 1; k++) {
      const want = (k * duration) / target;
      let best = -1;
      let bestDist = Infinity;
      for (let i = 1; i < sentences.length; i++) {
        const d = Math.abs(sentences[i].start - want);
        if (d < bestDist && farEnough(sentences[i].start)) {
          best = i;
          bestDist = d;
        }
      }
      if (best >= 0 && bestDist <= duration / target / 2) picked.push(best);
    }
  }

  picked.sort((a, b) => a - b);
  const chapters: Chapter[] = [{ start: 0, title: titleAt(sentences, 0) }];
  for (const index of picked) chapters.push({ start: sentences[index].start, title: titleAt(sentences, index) });
  return chapters;
}

/** Type guard for the model's answer — the model is not trusted. */
export function isChapterAnswer(v: unknown): v is { chapters: { start: number; title: string }[] } {
  if (typeof v !== "object" || v === null) return false;
  const list = (v as { chapters?: unknown }).chapters;
  return (
    Array.isArray(list) &&
    list.every(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        typeof (c as { start?: unknown }).start === "number" &&
        typeof (c as { title?: unknown }).title === "string",
    )
  );
}

/** The opening words of each chapter, what the model gets to title it from. */
export function chapterExcerpts(chapters: Chapter[], sentences: Sentence[], words = 40): string[] {
  return chapters.map((ch, i) => {
    const next = chapters[i + 1]?.start ?? Infinity;
    const out: string[] = [];
    for (const s of sentences) {
      if (s.start < ch.start - 1e-3 || s.start >= next) continue;
      for (const w of s.words) {
        if (out.length >= words) break;
        out.push(w.text);
      }
      if (out.length >= words) break;
    }
    return out.join(" ");
  });
}

/**
 * Better titles from the language model, when one is set up. Boundaries never
 * change; a title comes back only where the model gave a usable one. Without
 * a model — the state every fresh install is in — the heuristic titles stand.
 */
export async function improveChapterTitles(
  chapters: Chapter[],
  sentences: Sentence[],
): Promise<{ chapters: Chapter[]; used: "model" | "heuristic" }> {
  if (!chapters.length) return { chapters, used: "heuristic" };
  try {
    const status = await llmStatus();
    if (!status.available) return { chapters, used: "heuristic" };
    const excerpts = chapterExcerpts(chapters, sentences);
    const listing = chapters
      .map((ch, i) => `${i + 1}. start=${ch.start.toFixed(1)} — "${excerpts[i]}"`)
      .join("\n");
    const answer = await llmJson(
      {
        purpose: "video chapters",
        system:
          "You title chapters of a screen recording. Answer with JSON only: {\"chapters\":[{\"start\":number,\"title\":string}]} — one entry per chapter, same order and same start values as given. Titles: 2 to 6 words, in the language of the transcript, no numbering, no quotes, no trailing punctuation.",
        prompt: `Chapters with their opening words:\n${listing}`,
        maxTokens: 400,
        temperature: 0.2,
      },
      isChapterAnswer,
    );
    if (answer.chapters.length !== chapters.length) return { chapters, used: "heuristic" };
    const merged = chapters.map((ch, i) => {
      const title = answer.chapters[i].title.trim().replace(/[.!?…]+$/, "");
      return title && title.length <= 60 ? { start: ch.start, title } : ch;
    });
    return { chapters: merged, used: "model" };
  } catch {
    return { chapters, used: "heuristic" };
  }
}

function youtubeStamp(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * The chapter list as YouTube wants it in a description: one per line, time
 * first, the first at 00:00 — in *timeline* time, because the video that gets
 * uploaded is the cut one. Chapters that fell into a cut collapse onto the
 * same second and the first of them wins.
 */
export function chaptersToYouTube(chapters: Chapter[], segments: Segment[]): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  const sorted = [...chapters].sort((a, b) => a.start - b.start);
  sorted.forEach((ch, i) => {
    const t = i === 0 ? 0 : sourceToTimeline(ch.start, segments);
    const stamp = youtubeStamp(t);
    if (seen.has(stamp)) return;
    seen.add(stamp);
    lines.push(`${stamp} ${ch.title.trim() || "Chapter"}`);
  });
  if (lines.length && !/^00:00 /.test(lines[0])) lines[0] = lines[0].replace(/^\S+/, "00:00");
  return lines.join("\n");
}
