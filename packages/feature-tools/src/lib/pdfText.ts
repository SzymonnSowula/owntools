/**
 * Turns pdf.js text items (positioned runs, in content-stream order) into
 * lines, then paragraphs and headings. Pure, so the heuristics are testable
 * without a PDF: `pdf.ts` feeds it and writes the .txt / .md / .docx.
 */

export interface PdfTextItem {
  str: string;
  /** Left edge, PDF user units (origin bottom-left). */
  x: number;
  /** Baseline. */
  y: number;
  width: number;
  /** Font size, roughly — pdf.js reports the text matrix scale here. */
  height: number;
  /** pdf.js `hasEOL`: the run ends its line. */
  eol: boolean;
}

export interface PdfParagraph {
  text: string;
  heading: boolean;
}

export interface PdfPageText {
  /** 1-based. */
  number: number;
  paragraphs: PdfParagraph[];
}

interface Line {
  text: string;
  x: number;
  y: number;
  right: number;
  height: number;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function toLines(items: PdfTextItem[]): Line[] {
  const lines: Line[] = [];
  let cur: Line | null = null;
  let breakAfter = false;
  const flush = () => {
    if (cur && cur.text.trim()) lines.push({ ...cur, text: cur.text.trim().replace(/\s+/g, " ") });
    cur = null;
  };
  for (const item of items) {
    const blank = item.str.trim() === "";
    if (blank) {
      // pdf.js emits lone spaces between words and marks line ends on them.
      if (cur && !cur.text.endsWith(" ")) cur.text += " ";
      if (item.eol) breakAfter = true;
      continue;
    }
    const h: number = item.height > 0 ? item.height : (cur?.height ?? 10);
    if (cur && !breakAfter && Math.abs(item.y - cur.y) <= 0.5 * Math.max(h, cur.height, 1)) {
      const gap = item.x - cur.right;
      const needsSpace =
        cur.text.length > 0 &&
        !cur.text.endsWith(" ") &&
        !item.str.startsWith(" ") &&
        gap > 0.12 * Math.max(h, cur.height);
      cur.text += (needsSpace ? " " : "") + item.str;
      cur.right = Math.max(cur.right, item.x + item.width);
      cur.height = Math.max(cur.height, item.height);
    } else {
      flush();
      cur = { text: item.str, x: item.x, y: item.y, right: item.x + item.width, height: h };
    }
    breakAfter = item.eol;
  }
  flush();
  return lines;
}

function joinLines(prev: string, next: string): string {
  // "informa-" + "tion" → "information"; "self-" + "aware" stays hyphenated.
  if (/[a-ząćęłńóśźż]-$/i.test(prev) && /^[a-ząćęłńóśźż]/.test(next)) {
    return prev.slice(0, -1) + next;
  }
  return `${prev} ${next}`;
}

/**
 * Groups a page's text items into paragraphs. A blank-line-sized gap, a
 * jump back up the page (a new column), a first-line indent or a change to
 * or from a heading-sized line starts a new paragraph.
 */
export function groupTextItems(items: PdfTextItem[]): PdfParagraph[] {
  const lines = toLines(items);
  if (!lines.length) return [];
  const bodySize = median(lines.map((l) => l.height).filter((h) => h > 0)) || 10;
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1].y - lines[i].y;
    if (gap > 0 && gap < bodySize * 3) gaps.push(gap);
  }
  // The regular line spacing is the tight end of the gap distribution: a
  // paragraph break or a heading only ever makes a gap larger.
  const regular = gaps.filter((g) => g >= bodySize * 0.8).sort((a, b) => a - b);
  const lineGap = regular[Math.floor(regular.length * 0.2)] || median(gaps) || bodySize * 1.2;
  const isHeading = (l: Line) => l.height >= bodySize * 1.25 && l.text.length <= 100;

  const out: PdfParagraph[] = [];
  let cur: PdfParagraph | null = null;
  let prev: Line | null = null;
  for (const line of lines) {
    const heading = isHeading(line);
    let fresh = !cur || !prev;
    if (cur && prev) {
      const drop = prev.y - line.y;
      if (heading || isHeading(prev)) fresh = true;
      else if (drop > lineGap * 1.55 || drop < -bodySize) fresh = true;
      else if (line.x > prev.x + bodySize * 1.2 && !/[,;:-]$/.test(prev.text)) fresh = true;
    }
    if (fresh || !cur) {
      cur = { text: line.text, heading };
      out.push(cur);
    } else {
      cur.text = joinLines(cur.text, line.text);
    }
    prev = line;
  }
  return out;
}

/** "1-3, 7" → [1, 2, 3, 7] within 1..total; empty input means every page. */
export function parsePageRange(input: string, total: number): number[] {
  const trimmed = input.trim();
  if (!trimmed) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>();
  for (const part of trimmed.split(/[,\s]+/)) {
    if (!part) continue;
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new Error(`"${part}" is not a page or a range like 2-5.`);
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    const from = Math.max(1, Math.min(a, b));
    const to = Math.min(total, Math.max(a, b));
    for (let p = from; p <= to; p++) pages.add(p);
  }
  const list = [...pages].sort((x, y) => x - y);
  if (!list.length) throw new Error(`The document has ${total} page${total === 1 ? "" : "s"}.`);
  return list;
}

export interface TextRenderOptions {
  /** Separate pages visibly instead of letting them run together. */
  pageBreaks: boolean;
}

export function pagesToText(pages: PdfPageText[], options: TextRenderOptions): string {
  return pages
    .map((page, i) => {
      const body = page.paragraphs.map((p) => p.text).join("\n\n");
      return options.pageBreaks && i > 0 ? `--- page ${page.number} ---\n\n${body}` : body;
    })
    .filter((s) => s.trim().length > 0)
    .join("\n\n");
}

export function pagesToMarkdown(pages: PdfPageText[], options: TextRenderOptions): string {
  return pages
    .map((page, i) => {
      const body = page.paragraphs.map((p) => (p.heading ? `## ${p.text}` : p.text)).join("\n\n");
      return options.pageBreaks && i > 0 ? `---\n\n${body}` : body;
    })
    .filter((s) => s.trim().length > 0)
    .join("\n\n");
}
