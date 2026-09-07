/**
 * The dictation vocabulary.
 *
 * One list, two kinds of entry, told apart by whether `replacement` is set:
 *
 *   - a **spelling**: `spoken` alone ("shipshape", "Rzeszów", "Claude Code").
 *     The word goes into whisper's prompt so it is recognised in the first
 *     place, and every spelling whisper produces for it afterwards is rewritten
 *     to exactly this one.
 *   - a **replacement**: `spoken` → `replacement` ("my email address" →
 *     "anna@shipshape.app", "super whisper" → "Superwhisper"). Whatever is said
 *     is typed as the replacement — a long address, a sign-off, a fixed
 *     spelling of a brand.
 *
 * Everything here is pure and synchronous; storage is the settings JSON
 * (`engine.ts`), the UI is `pages/VocabularyPage.tsx`.
 */

export interface VocabularyEntry {
  id: string;
  /** What is said — or how whisper tends to write it. */
  spoken: string;
  /** What gets typed instead; empty = spelling-only entry. */
  replacement: string;
  /** Epoch milliseconds; newest first in the list. */
  createdAt: number;
}

export interface ReplacementRule {
  spoken: string;
  replacement: string;
}

/** Whisper keeps ~224 prompt tokens; beyond this the list stops helping. */
export const MAX_PROMPT_TERMS = 80;
/** A replacement target longer than this is a snippet, not a word to prime. */
const MAX_PROMPT_TARGET_CHARS = 40;
const MAX_PROMPT_TARGET_WORDS = 3;

let counter = 0;

function newId(): string {
  counter += 1;
  return `v${Date.now().toString(36)}${counter.toString(36)}`;
}

/** Collapses inner whitespace; a phrase is stored the way it will be matched. */
export function normalizeSpoken(spoken: string): string {
  return spoken.replace(/\s+/g, " ").trim();
}

/** Trims the ends only — a snippet may carry line breaks on purpose. */
export function normalizeReplacement(replacement: string): string {
  return replacement.replace(/^\s+|\s+$/g, "");
}

export function isReplacement(entry: Pick<VocabularyEntry, "replacement">): boolean {
  return entry.replacement.length > 0;
}

/** Builds a valid entry, or null when there is nothing to say. */
export function createEntry(spoken: string, replacement = ""): VocabularyEntry | null {
  const s = normalizeSpoken(spoken);
  if (s.length < 2) return null;
  const r = normalizeReplacement(replacement);
  return { id: newId(), spoken: s, replacement: r === s ? "" : r, createdAt: Date.now() };
}

/**
 * Adds an entry, replacing an earlier one with the same spoken form (case-
 * insensitively) so the list never carries two rules for one phrase. Newest
 * first.
 */
export function upsertEntry(entries: VocabularyEntry[], entry: VocabularyEntry): VocabularyEntry[] {
  const key = entry.spoken.toLocaleLowerCase();
  const rest = entries.filter((e) => e.id !== entry.id && e.spoken.toLocaleLowerCase() !== key);
  return [entry, ...rest];
}

export function removeEntry(entries: VocabularyEntry[], id: string): VocabularyEntry[] {
  return entries.filter((e) => e.id !== id);
}

/**
 * The old settings had one comma- or line-separated field of terms. Each
 * becomes a spelling entry; a `word -> other` or `word → other` line becomes a
 * replacement, so a pasted list works too.
 */
export function entriesFromText(text: string): VocabularyEntry[] {
  const out: VocabularyEntry[] = [];
  for (const raw of text.split(/[\n;]/)) {
    const line = raw.trim();
    if (!line) continue;
    const arrow = line.match(/^(.*?)\s*(?:->|→|=>)\s*(.*)$/);
    if (arrow) {
      const entry = createEntry(arrow[1], arrow[2]);
      if (entry) out.push(entry);
      continue;
    }
    for (const part of line.split(",")) {
      const entry = createEntry(part);
      if (entry) out.push(entry);
    }
  }
  // Stable ids for a migration: derive from the position so a reload does not
  // mint new ones for the same words.
  return out.map((e, i) => ({ ...e, id: `legacy-${i}`, createdAt: e.createdAt - (out.length - i) }));
}

/** Anything that is not a well-formed entry is dropped rather than crashing the view. */
export function sanitizeEntries(value: unknown): VocabularyEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: VocabularyEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const e = item as Partial<VocabularyEntry>;
    const spoken = typeof e.spoken === "string" ? normalizeSpoken(e.spoken) : "";
    if (spoken.length < 2) continue;
    const id = typeof e.id === "string" && e.id ? e.id : newId();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      spoken,
      replacement: typeof e.replacement === "string" ? normalizeReplacement(e.replacement) : "",
      createdAt: typeof e.createdAt === "number" && Number.isFinite(e.createdAt) ? e.createdAt : 0,
    });
  }
  return out;
}

/** Canonical spellings — the words that get rewritten to this exact casing. */
export function spellingTerms(entries: VocabularyEntry[]): string[] {
  return entries.filter((e) => !isReplacement(e)).map((e) => e.spoken);
}

/** Longest phrase first, so "my work email" wins over "my email" where both match. */
export function replacementRules(entries: VocabularyEntry[]): ReplacementRule[] {
  return entries
    .filter(isReplacement)
    .map((e) => ({ spoken: e.spoken, replacement: e.replacement }))
    .sort((a, b) => b.spoken.length - a.spoken.length);
}

function looksLikeWord(text: string): boolean {
  return (
    text.length <= MAX_PROMPT_TARGET_CHARS &&
    !/[\r\n]/.test(text) &&
    text.split(/\s+/).length <= MAX_PROMPT_TARGET_WORDS
  );
}

/**
 * What whisper gets told about: every spelling, plus the *target* of a
 * replacement when it is a word or a name (a brand's proper spelling is
 * exactly the kind of thing the model can then produce directly). Snippets —
 * an address, a sign-off — stay out; the model does not need to know them and
 * the prompt budget is small.
 */
export function promptTerms(entries: VocabularyEntry[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (term: string) => {
    const key = term.toLocaleLowerCase();
    if (seen.has(key) || out.length >= MAX_PROMPT_TERMS) return;
    seen.add(key);
    out.push(term);
  };
  for (const e of entries) if (!isReplacement(e)) push(e.spoken);
  for (const e of entries) {
    if (isReplacement(e) && looksLikeWord(e.replacement) && !/[@/]/.test(e.replacement)) {
      push(e.replacement);
    }
  }
  return out;
}

/** Case-insensitive substring search over both sides of every entry. */
export function searchEntries(entries: VocabularyEntry[], query: string): VocabularyEntry[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return entries;
  return entries.filter(
    (e) => e.spoken.toLocaleLowerCase().includes(q) || e.replacement.toLocaleLowerCase().includes(q),
  );
}

/** Newest first; ties (a migrated list) keep their order. */
export function sortEntries(entries: VocabularyEntry[]): VocabularyEntry[] {
  return [...entries].sort((a, b) => b.createdAt - a.createdAt);
}

/** Plain-text export: one entry per line, `spoken -> replacement` for rules. */
export function entriesToText(entries: VocabularyEntry[]): string {
  return entries
    .map((e) => (isReplacement(e) ? `${e.spoken} -> ${e.replacement.replace(/\r?\n/g, " ")}` : e.spoken))
    .join("\n");
}
