/**
 * Bold / italic for networks without formatting: the letters are swapped for
 * their Mathematical Alphanumeric Symbols counterparts (sans-serif, so they
 * read like the surrounding text). Reversible, so toggling twice restores
 * plain text. Characters without a styled form (accents, punctuation) pass
 * through unchanged.
 */

export type UnicodeStyle = "bold" | "italic" | "boldItalic";

/** First code point of the A–Z / a–z / 0–9 runs per style. */
const RUNS: Record<UnicodeStyle, { upper: number; lower: number; digit: number | null }> = {
  bold: { upper: 0x1d5d4, lower: 0x1d5ee, digit: 0x1d7ec },
  italic: { upper: 0x1d608, lower: 0x1d622, digit: null },
  boldItalic: { upper: 0x1d63c, lower: 0x1d656, digit: null },
};

const STYLES: UnicodeStyle[] = ["bold", "italic", "boldItalic"];

function styleOfCodePoint(cp: number): { style: UnicodeStyle; plain: number } | null {
  for (const style of STYLES) {
    const run = RUNS[style];
    if (cp >= run.upper && cp < run.upper + 26) return { style, plain: 0x41 + (cp - run.upper) };
    if (cp >= run.lower && cp < run.lower + 26) return { style, plain: 0x61 + (cp - run.lower) };
    if (run.digit !== null && cp >= run.digit && cp < run.digit + 10) {
      return { style, plain: 0x30 + (cp - run.digit) };
    }
  }
  return null;
}

/** Plain ASCII letters/digits back from any styled run. */
export function stripUnicodeStyle(text: string): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const hit = styleOfCodePoint(cp);
    out += hit ? String.fromCodePoint(hit.plain) : ch;
  }
  return out;
}

/** The style shared by every styled letter in `text`, or null when it is plain / mixed. */
export function detectUnicodeStyle(text: string): UnicodeStyle | null {
  let found: UnicodeStyle | null = null;
  let plainLetters = false;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const hit = styleOfCodePoint(cp);
    if (hit) {
      if (found && found !== hit.style) return null;
      found = hit.style;
    } else if (/[A-Za-z]/.test(ch)) {
      // Digits stay plain in italic (no styled run exists), so only letters count.
      plainLetters = true;
    }
  }
  return found && !plainLetters ? found : null;
}

export function applyUnicodeStyle(text: string, style: UnicodeStyle): string {
  const plain = stripUnicodeStyle(text);
  const run = RUNS[style];
  let out = "";
  for (const ch of plain) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x41 && cp <= 0x5a) out += String.fromCodePoint(run.upper + (cp - 0x41));
    else if (cp >= 0x61 && cp <= 0x7a) out += String.fromCodePoint(run.lower + (cp - 0x61));
    else if (run.digit !== null && cp >= 0x30 && cp <= 0x39) out += String.fromCodePoint(run.digit + (cp - 0x30));
    else out += ch;
  }
  return out;
}

/**
 * Toolbar behaviour: bold on plain → bold; bold on bold → plain; bold on
 * italic → bold-italic; bold on bold-italic → italic. Same for italic.
 */
export function toggleUnicodeStyle(text: string, want: "bold" | "italic"): string {
  const current = detectUnicodeStyle(text);
  const hasBold = current === "bold" || current === "boldItalic";
  const hasItalic = current === "italic" || current === "boldItalic";
  const bold = want === "bold" ? !hasBold : hasBold;
  const italic = want === "italic" ? !hasItalic : hasItalic;
  if (bold && italic) return applyUnicodeStyle(text, "boldItalic");
  if (bold) return applyUnicodeStyle(text, "bold");
  if (italic) return applyUnicodeStyle(text, "italic");
  return stripUnicodeStyle(text);
}
