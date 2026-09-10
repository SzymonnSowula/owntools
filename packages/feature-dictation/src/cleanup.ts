/**
 * Post-processing for whisper output.
 *
 * Whisper is trained on subtitles, so on silence or noise it happily emits the
 * things subtitles are full of: `[BLANK_AUDIO]`, `(muzyka)`, "Napisy stworzone
 * przez społeczność Amara.org", "Thanks for watching!" — and, when a chunk goes
 * wrong, the same sentence twenty times. None of that is speech, so it never
 * belongs in a dictated note.
 *
 * The same pass applies the vocabulary: canonical spellings for the words the
 * user listed, and the spoken-phrase → text replacements ("my email address"
 * becomes the address).
 */

import type { ReplacementRule } from "./vocabulary";

/** Bracketed / parenthesised sound tags — `[MUSIC]`, `(śmiech)`, `♪ … ♪`. */
const SOUND_TAG_WORDS =
  "blank_audio|blank audio|music|musique|muzyka|muzyki|silence|cisza|ciszy|applause|oklaski|brawa|laughter|śmiech|laughs|sound|dźwięk|dźwięki|noise|szum|inaudible|niesłyszalne|foreign|speaking in foreign language|coughs|kaszel|sighs|westchnienie|beep|sygnał";

const SOUND_TAG_RE = new RegExp(
  `[\\[(<]\\s*(?:${SOUND_TAG_WORDS})[^\\])>]{0,24}[\\])>]`,
  "gi",
);

/** Whole lines whisper invents out of silence. Matched after normalisation. */
const HALLUCINATIONS = [
  "napisy stworzone przez społeczność amara.org",
  "napisy stworzone przez spolecznosc amara.org",
  "napisy: amara.org",
  "napisy amara.org",
  "zapraszam do subskrypcji",
  "zapraszamy do subskrypcji",
  "dziękuję za uwagę",
  "dziękuję za obejrzenie",
  "dziękuję za oglądanie",
  "do zobaczenia w następnym odcinku",
  "subtitles by the amara.org community",
  "subtitles by amara.org community",
  "thank you for watching",
  "thanks for watching",
  "thank you",
  "please subscribe",
  "subscribe to my channel",
  "transcription by castingwords",
  "продолжение следует",
  "amara.org",
];

/**
 * Hesitation sounds, English and Polish. Deliberately short: "no", "well",
 * "like", "so" are fillers *sometimes* and words the rest of the time, and a
 * dictation tool that eats real words is worse than one that leaves an "um".
 */
const FILLERS = "um+|uh+|uhm+|erm+|ehm+|hmm+|mhm+|mm+|yyy+|eee+|yhm+|eh+|ee+|yy+";

const FILLER_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${FILLERS})(?![\\p{L}\\p{N}]),?`, "giu");

/** Private-use character: stands in for a removed filler while the text is repaired. */
const MARK = String.fromCharCode(0xe000);
const MARK_AT_SENTENCE_START = new RegExp(`(^|[.!?…]\\s+)(?:${MARK}[,.]?\\s*)+(\\p{Ll})`, "gu");
const MARK_ANYWHERE = new RegExp(`\\s*${MARK}`, "g");

/** Collapses a run of the same sentence into one — whisper's repetition loop. */
function dedupeRuns(text: string): string {
  const parts = text.split(/(?<=[.!?…])\s+/);
  const out: string[] = [];
  for (const part of parts) {
    const key = normalise(part);
    const prev = out.length ? normalise(out[out.length - 1]) : "";
    if (key && key === prev) continue;
    out.push(part);
  }
  return out.join(" ");
}

/**
 * Whisper can also loop *inside* one sentence ("tak tak tak tak tak"). Three or
 * more identical words in a row is never real speech.
 */
function dedupeWords(text: string): string {
  // Lookarounds rather than \b: in unicode mode \b is ASCII-only, so it would
  // split "łódź" and never see the repetition.
  return text.replace(
    /(?<![\p{L}\p{N}])([\p{L}\p{N}]+)(?:\s+\1(?![\p{L}\p{N}])){2,}/giu,
    (_m, word: string) => `${word} ${word}`,
  );
}

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,!?;:…"'`´„”«»\-—–()[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isHallucination(line: string): boolean {
  const key = normalise(line);
  if (!key) return true;
  return HALLUCINATIONS.some((h) => key === normalise(h));
}

export interface CleanupOptions {
  /** Canonical spellings — each occurrence is rewritten to this exact casing. */
  vocabulary?: string[];
  /** Spoken phrase → text, applied last (after sentence casing). */
  replacements?: ReplacementRule[];
  /** Uppercase the first letter and make sure the text ends with punctuation. */
  sentenceCase?: boolean;
  /** Drop "um", "uh", "yyy" and their friends. */
  removeFillers?: boolean;
  /** Sound tags, subtitle boilerplate and repetition loops out. Default true. */
  hallucinations?: boolean;
}

/** Strips sound tags and invented lines; safe to run on a single segment. */
export function stripNonSpeech(raw: string): string {
  let text = raw.replace(SOUND_TAG_RE, " ").replace(/♪[^♪]*♪|♪/g, " ");
  // `*sighs*` style tags, but not a lone asterisk inside a word.
  text = text.replace(/\*[^*\n]{1,40}\*/g, " ");
  text = text
    .split("\n")
    .filter((line) => !isHallucination(line))
    .join("\n");
  return text.replace(/[ \t]+/g, " ").trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every spelling of a term whisper is likely to produce: the term itself, plus
 * the same word broken at one point ("owntools" heard as "own tools" or
 * "own-tools"). One break only — more than that and the pattern starts
 * matching things that were never the word.
 */
function termVariants(word: string): string[] {
  const variants = [escapeRegExp(word)];
  if (!/\s/.test(word) && word.length >= 6) {
    for (let i = 2; i <= word.length - 2; i++) {
      variants.push(`${escapeRegExp(word.slice(0, i))}[\\s-]${escapeRegExp(word.slice(i))}`);
    }
  }
  // Longest first, so the unbroken spelling wins when both could match.
  return variants;
}

/** Rewrites known terms to their canonical spelling ("own tools" → "owntools"). */
export function applyVocabulary(text: string, vocabulary: string[]): string {
  let out = text;
  for (const term of vocabulary) {
    const word = term.trim();
    if (word.length < 2) continue;
    const re = new RegExp(
      `(?<![\\p{L}\\p{N}])(?:${termVariants(word).join("|")})(?![\\p{L}\\p{N}])`,
      "giu",
    );
    out = out.replace(re, word);
  }
  return out;
}

/**
 * A spoken token as whisper might write it. Letters must come in order, but a
 * token of four letters or more may be broken by a space or hyphen anywhere
 * ("email" → "e-mail", "superwhisper" → "super whisper"); anything that is not
 * a letter or digit (an apostrophe, a dot) matches loosely.
 */
function tokenPattern(token: string): string {
  const chars = [...token];
  const flexible = chars.length >= 4;
  return chars
    .map((ch) => (/[\p{L}\p{N}]/u.test(ch) ? escapeRegExp(ch) : "[^\\p{L}\\p{N}\\s]?"))
    .join(flexible ? "[\\s-]?" : "");
}

/**
 * The whole phrase: tokens in order with spaces or hyphens between them — or
 * nothing at all, since whisper writes "superwhisper" as readily as "super
 * whisper".
 */
export function phrasePattern(spoken: string): RegExp {
  const tokens = spoken.split(/[\s\-–]+/).filter(Boolean);
  const body = tokens.map(tokenPattern).join("[\\s\\-–]*");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "giu");
}

/**
 * "my email address" → the address, "super whisper" → "Superwhisper". Rules
 * come longest-first from `replacementRules`, so a longer phrase is never
 * eaten by a shorter one it contains. The replacement is inserted verbatim.
 */
export function applyReplacements(text: string, rules: ReplacementRule[]): string {
  let out = text;
  for (const rule of rules) {
    const spoken = rule.spoken.trim();
    if (spoken.length < 2 || !rule.replacement) continue;
    out = out.replace(phrasePattern(spoken), () => rule.replacement);
  }
  return out;
}

/**
 * Drops hesitation sounds. A filler that opened a sentence takes its comma
 * with it and the next word is capitalised ("Um, so we ship." → "So we ship.").
 */
export function removeFillers(text: string): string {
  let out = text.replace(FILLER_RE, MARK);
  if (!out.includes(MARK)) return text;
  // A filler that opened a sentence: the word after it now starts the sentence.
  out = out.replace(MARK_AT_SENTENCE_START, (_m, lead: string, ch: string) => lead + ch.toLocaleUpperCase());
  // Everywhere else the filler and its comma simply go, and the text closes up.
  out = out.replace(MARK_ANYWHERE, "");
  return out
    .replace(/,\s*([.!?…])/g, "$1")
    .replace(/\s+([,.!?;:…])/g, "$1")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.]+/, "")
    .trim();
}

/** Full pass: non-speech out, loops collapsed, spacing fixed, vocabulary applied. */
export function cleanTranscript(raw: string, options: CleanupOptions = {}): string {
  const hallucinations = options.hallucinations !== false;
  let text = hallucinations ? stripNonSpeech(raw) : raw.trim();
  if (!text) return "";

  if (hallucinations) {
    text = dedupeWords(text);
    text = dedupeRuns(text);
  }

  // Whisper leaves a space before punctuation when a segment boundary lands there.
  text = text
    .replace(/\s+([,.!?;:…])/g, "$1")
    .replace(/([([])\s+/g, "$1")
    .replace(/\s+([)\]])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (options.removeFillers) text = removeFillers(text);
  if (options.vocabulary?.length) text = applyVocabulary(text, options.vocabulary);

  if (options.sentenceCase && text) {
    text = text[0].toLocaleUpperCase() + text.slice(1);
  }
  if (options.replacements?.length) text = applyReplacements(text, options.replacements);
  return text;
}

/**
 * Joins dictated text onto whatever is already in the field: adds the missing
 * space, and capitalises when the previous chunk ended a sentence.
 */
export function joinDictation(previous: string, next: string): string {
  if (!next) return "";
  const tail = previous.slice(-2);
  const needsSpace = previous.length > 0 && !/\s$/.test(previous);
  const startsSentence = !previous.trim() || /[.!?…]\s*$/.test(tail);
  const body = startsSentence && next ? next[0].toLocaleUpperCase() + next.slice(1) : next;
  return `${needsSpace ? " " : ""}${body}`;
}
