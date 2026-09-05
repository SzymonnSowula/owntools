/**
 * Links, mentions and hashtags found in a post's text. The composer highlights
 * them, the character counter weighs URLs the way X and Mastodon do (23), and
 * the Bluesky provider turns them into `app.bsky.richtext.facet`s, which are
 * addressed in UTF-8 *bytes* — hence `toByteRange`.
 */

export type FacetKind = "link" | "mention" | "tag";

export interface Facet {
  kind: FacetKind;
  /** UTF-16 code unit offsets into the text (what `String#slice` takes). */
  start: number;
  end: number;
  /** The matched text without a trailing punctuation mark. */
  raw: string;
  /** Normalised value: full URL, handle without "@", tag without "#". */
  value: string;
}

const URL_RE = /(?<![\w@])(https?:\/\/[^\s<>()]+|(?<![./])\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>()]*)?)/giu;
const MENTION_RE = /(?<![\w.@/])@([a-zA-Z0-9_](?:[a-zA-Z0-9_.-]*[a-zA-Z0-9_])?)/gu;
const TAG_RE = /(?<![\w&#/])#([\p{L}\p{N}_]+)(?![\p{L}\p{N}_])/gu;

const TRAILING = /[.,;:!?)'"\]»]+$/u;

function trimTrailing(match: string): string {
  return match.replace(TRAILING, "");
}

const TLD_ALLOW = /\.(com|net|org|io|dev|app|co|ai|me|uk|de|pl|fr|es|it|nl|eu|us|ca|au|jp|br|in|se|no|fi|dk|ch|at|be|cz|sk|xyz|so|to|gg|tv|fm|sh|ly|social|blog|page|site|tech|studio|design|store|shop|news|info|edu|gov)(?=\/|$)/i;

/** All facets, sorted by position, non-overlapping (links win over tags/mentions). */
export function findFacets(text: string): Facet[] {
  const out: Facet[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const raw = trimTrailing(m[0]);
    if (!raw) continue;
    const hasScheme = /^https?:\/\//i.test(raw);
    // Bare domains need a recognisable TLD, so "v1.2" or "file.txt" stay text.
    if (!hasScheme && !TLD_ALLOW.test(raw.split("/")[0] ?? "")) continue;
    const start = m.index ?? 0;
    out.push({ kind: "link", start, end: start + raw.length, raw, value: hasScheme ? raw : `https://${raw}` });
  }
  const taken = (s: number, e: number) => out.some((f) => s < f.end && e > f.start);
  for (const m of text.matchAll(MENTION_RE)) {
    const start = m.index ?? 0;
    const raw = trimTrailing(m[0]);
    const end = start + raw.length;
    if (taken(start, end)) continue;
    out.push({ kind: "mention", start, end, raw, value: raw.slice(1) });
  }
  for (const m of text.matchAll(TAG_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (taken(start, end)) continue;
    // Pure numbers are not hashtags on any network.
    if (/^\d+$/.test(m[1] ?? "")) continue;
    out.push({ kind: "tag", start, end, raw: m[0], value: m[1] ?? "" });
  }
  return out.sort((a, b) => a.start - b.start);
}

export function findLinks(text: string): Facet[] {
  return findFacets(text).filter((f) => f.kind === "link");
}

export function findHashtags(text: string): string[] {
  return findFacets(text)
    .filter((f) => f.kind === "tag")
    .map((f) => f.value);
}

/** Bytes of the UTF-8 encoding of `text.slice(0, index)`. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

export function toByteRange(text: string, start: number, end: number): { byteStart: number; byteEnd: number } {
  return { byteStart: utf8Length(text.slice(0, start)), byteEnd: utf8Length(text.slice(0, end)) };
}

/** The text with every facet swapped for `replacer(facet)`. */
export function replaceFacets(text: string, replacer: (f: Facet) => string): string {
  let out = "";
  let cursor = 0;
  for (const f of findFacets(text)) {
    out += text.slice(cursor, f.start) + replacer(f);
    cursor = f.end;
  }
  return out + text.slice(cursor);
}
