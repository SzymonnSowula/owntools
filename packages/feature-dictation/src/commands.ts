/**
 * Voice commands — the handful of phrases that are instructions rather than
 * text: "new line", "scratch that", "send it" and their Polish twins.
 *
 * Applied to the *cleaned* transcript of a take (after sound tags, vocabulary
 * and sentence casing), English and Polish always both active, because
 * Parakeet decides the language on its own and a Polish speaker says "wyślij"
 * in the middle of an English sentence about an e-mail.
 *
 * The one rule that matters more than any phrase list: a dictation tool that
 * eats real words is worse than one that leaves a command in. So each command
 * says *where* it may appear:
 *
 *   anywhere  — the phrase is never ordinary speech ("scratch that",
 *               "new paragraph", "delete last word");
 *   boundary  — plausible as words ("a new line of products"), so it has to
 *               sit on a clause boundary: preceded or followed by punctuation
 *               or the edge of the take. Recognizers punctuate, so "tomorrow.
 *               New line. Best regards" is what a spoken command looks like;
 *   trailing  — only as the last thing said ("send it", "undo"): mid-take
 *               those are the sentence, not an instruction.
 *
 * `applyVoiceCommands` is pure. Undo is recognised so the pill can say it is
 * not available yet rather than typing the word "undo" into a chat.
 */

export type CommandId = "newline" | "paragraph" | "scratch" | "deleteWord" | "send" | "undo";

export type CommandPlacement = "anywhere" | "boundary" | "trailing";

export interface VoiceCommand {
  id: CommandId;
  en: string[];
  pl: string[];
  where: CommandPlacement;
  /** What it does, for the Settings page. */
  effect: string;
}

export const VOICE_COMMANDS: VoiceCommand[] = [
  {
    id: "newline",
    en: ["new line", "newline", "line break"],
    pl: ["nowa linia", "nowy wiersz"],
    where: "boundary",
    effect: "Starts a new line.",
  },
  {
    id: "paragraph",
    en: ["new paragraph"],
    pl: ["nowy akapit", "nowy paragraf"],
    where: "anywhere",
    effect: "Leaves an empty line and starts a new paragraph.",
  },
  {
    id: "scratch",
    en: ["scratch that", "strike that"],
    pl: ["skasuj to", "usuń to", "wykasuj to", "cofnij to"],
    where: "anywhere",
    effect: "Drops what you just said — the previous utterance while decoding live, otherwise the previous sentence.",
  },
  {
    id: "deleteWord",
    en: ["delete last word", "delete the last word"],
    pl: ["usuń ostatnie słowo", "skasuj ostatnie słowo"],
    where: "anywhere",
    effect: "Removes the word before it.",
  },
  {
    id: "send",
    en: ["send it", "send message"],
    pl: ["wyślij", "wyślij to"],
    where: "trailing",
    effect: "Types the text, then presses Enter in the app you dictated into. Only as the last words of a take.",
  },
  {
    id: "undo",
    en: ["undo", "undo that"],
    pl: ["cofnij"],
    where: "trailing",
    effect: "Not available yet: the take is dropped and the pill says so. Ctrl+Z in the app undoes the previous one.",
  },
];

export interface CommandResult {
  text: string;
  /** "send it" was the last thing said: press Enter after typing. */
  send: boolean;
  /** "undo" was asked for; nothing to undo with yet, the caller says so. */
  undo: boolean;
  applied: CommandId[];
}

/** Marks the boundary between two live segments while commands are applied. */
const SEG = String.fromCharCode(0xe001);

/** Punctuation that ends a clause or a sentence, as recognizers write it. */
const CLAUSE_PUNCT = "[.,!?…;:—–-]";
const SENTENCE_END = /[.!?…]/;

interface Match {
  command: VoiceCommand;
  start: number;
  end: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word, case-insensitive; tokens may be joined by spaces or a hyphen. */
function phraseRegExp(phrase: string): RegExp {
  const body = phrase
    .split(/\s+/)
    .map(escapeRegExp)
    .join("[\\s-]+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "giu");
}

const PHRASES: { command: VoiceCommand; re: RegExp; length: number }[] = VOICE_COMMANDS.flatMap((command) =>
  [...command.en, ...command.pl].map((phrase) => ({ command, re: phraseRegExp(phrase), length: phrase.length })),
);

function isTrailing(text: string, end: number): boolean {
  return /^[\s.,!?…;:]*$/u.test(text.slice(end).replace(new RegExp(SEG, "g"), ""));
}

function onBoundary(text: string, start: number, end: number): boolean {
  const before = text.slice(0, start).replace(new RegExp(SEG, "g"), "").trimEnd();
  const after = text.slice(end).replace(new RegExp(SEG, "g"), "").trimStart();
  const beforeOk = before === "" || new RegExp(`${CLAUSE_PUNCT}$`, "u").test(before) || /\n$/.test(before);
  const afterOk = after === "" || new RegExp(`^${CLAUSE_PUNCT}`, "u").test(after) || /^\n/.test(after);
  return beforeOk || afterOk;
}

/** The first command in the text that is allowed where it sits. */
function findCommand(text: string): Match | null {
  let best: Match | null = null;
  for (const { command, re, length } of PHRASES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      const allowed =
        command.where === "anywhere" ||
        (command.where === "trailing" && isTrailing(text, end)) ||
        (command.where === "boundary" && onBoundary(text, start, end));
      if (!allowed) continue;
      // Earliest wins; on the same spot the longer phrase ("cofnij to" over
      // "cofnij") so a scratch is never read as an undo.
      if (!best || start < best.start || (start === best.start && length > best.end - best.start)) {
        best = { command, start, end };
      }
      break;
    }
  }
  return best;
}

function capitalize(s: string): string {
  const i = s.search(/\p{L}/u);
  return i < 0 ? s : s.slice(0, i) + s[i].toLocaleUpperCase() + s.slice(i + 1);
}

/** Leading punctuation the command dragged along ("scratch that. Option C" → "Option C"). */
function stripLead(after: string): string {
  return after.replace(/^[\s.,;:!?…]+/u, "");
}

/** A dangling comma or colon left before a removed phrase ("thanks, send it" → "thanks"). */
function stripDanglingComma(before: string): string {
  return before.replace(/[\s,;:—–-]+$/u, "");
}

/** Index just past the previous boundary — a segment mark, a line break or a sentence end — or 0. */
function previousBoundary(before: string): number {
  let idx = -1;
  for (let i = before.length - 1; i >= 0; i--) {
    const ch = before[i];
    if (ch === SEG || ch === "\n" || SENTENCE_END.test(ch)) {
      idx = i;
      break;
    }
  }
  return idx + 1;
}

/**
 * Removes what was said before the command: the previous live segment when the
 * command opened one, the previous sentence when it opened a sentence, and
 * otherwise everything since the last boundary in this sentence.
 */
function scratch(before: string): string {
  let b = before.trimEnd();
  if (b.endsWith(SEG)) {
    const prev = b.lastIndexOf(SEG, b.length - 2);
    return prev >= 0 ? b.slice(0, prev + 1) : "";
  }
  if (b && SENTENCE_END.test(b[b.length - 1])) {
    // The command started a sentence: drop the one that just ended.
    const inner = b.slice(0, -1).trimEnd();
    return inner.slice(0, previousBoundary(inner));
  }
  b = stripDanglingComma(b);
  return b.slice(0, previousBoundary(b));
}

function deleteLastWord(before: string): string {
  let b = stripDanglingComma(before.trimEnd());
  // The word may sit at the end of the previous live segment.
  while (b.endsWith(SEG)) b = b.slice(0, -1).trimEnd();
  return b.replace(/[\p{L}\p{N}][\p{L}\p{N}'’\-@.]*[.,;:!?…]*\s*$/u, "");
}

function endsSentence(before: string): boolean {
  const b = before.replace(new RegExp(SEG, "g"), "").trimEnd();
  return b === "" || SENTENCE_END.test(b[b.length - 1]) || b.endsWith("\n");
}

function tidy(text: string): string {
  return text
    .replace(new RegExp(`\\s*${SEG}\\s*`, "g"), " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ +([,.!?;:…])/g, "$1")
    // Spaces at the ends go; a line break at the end stays, because "milk,
    // eggs, new line" means the next take belongs on a new line.
    .replace(/^\s+/, "")
    .replace(/[ \t]+$/, "");
}

export interface CommandOptions {
  /**
   * The take's live segments in order, when it was decoded while speaking.
   * "Scratch that" at the start of a segment then drops the whole previous
   * segment — the utterance — rather than only its last sentence.
   */
  segments?: string[];
}

export function applyVoiceCommands(text: string, options: CommandOptions = {}): CommandResult {
  const pieces = options.segments?.map((s) => s.trim()).filter(Boolean);
  let work = pieces && pieces.length ? pieces.join(` ${SEG} `) : text;
  const applied: CommandId[] = [];
  let send = false;
  let undo = false;

  for (let guard = 0; guard < 64; guard++) {
    const hit = findCommand(work);
    if (!hit) break;
    applied.push(hit.command.id);
    const before = work.slice(0, hit.start);
    const after = work.slice(hit.end);
    switch (hit.command.id) {
      case "newline":
      case "paragraph": {
        const b = stripDanglingComma(before);
        const a = capitalize(stripLead(after));
        const brk = hit.command.id === "newline" ? "\n" : "\n\n";
        work = b.trim() === "" ? a : `${b}${brk}${a}`;
        break;
      }
      case "scratch": {
        const b = scratch(before);
        const a = stripLead(after);
        work = `${b} ${endsSentence(b) ? capitalize(a) : a}`;
        break;
      }
      case "deleteWord": {
        const b = deleteLastWord(before);
        const a = stripLead(after);
        work = `${b} ${endsSentence(b) ? capitalize(a) : a}`;
        break;
      }
      case "send":
      case "undo": {
        if (hit.command.id === "send") send = true;
        else undo = true;
        work = stripDanglingComma(before);
        break;
      }
    }
  }

  const out = tidy(work);
  return { text: out ? capitalize(out) : "", send, undo, applied };
}

/** The phrase list the way Settings shows it: "new line · nowa linia". */
export function commandPhrases(command: VoiceCommand): { en: string; pl: string } {
  return { en: command.en.join(" / "), pl: command.pl.join(" / ") };
}
