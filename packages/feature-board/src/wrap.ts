/**
 * Line breaks for dictated text on the board.
 *
 * Dictation never presses Enter, and an auto-sized Excalidraw text box never
 * wraps on its own, so a spoken paragraph would become one endless line. The
 * words are broken at about a paragraph's width instead. Excalifont runs at
 * roughly half an em per character, so the budget is a character count that
 * scales with the font size: 52 characters at 20 px is about 520 px.
 */

const CHARS_AT_20PX = 52;

export function wrapLimit(fontSize: number): number {
  return Math.max(20, Math.round((CHARS_AT_20PX * 20) / Math.max(1, fontSize)));
}

/** Greedy word wrap; a word longer than the limit gets a line of its own. */
export function wrapWords(text: string, limit: number): string {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= limit) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

/**
 * Continues the last line of `existing` with `words`. Earlier lines are the
 * user's own breaks and stay as they are; only the line being continued is
 * re-wrapped.
 */
export function appendWrapped(existing: string, words: string, limit: number): string {
  const lines = existing.split("\n");
  const last = lines.pop() ?? "";
  const merged = last.trim() ? `${last.trimEnd()} ${words.trim()}` : words.trim();
  return [...lines, wrapWords(merged, limit)].join("\n");
}
