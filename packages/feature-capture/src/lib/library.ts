import type { CaptureItem } from "../api/types";

/**
 * Pure helpers for the library page: search over recognised text, grouping
 * by day, labels. Nothing here touches the DOM or the backend.
 */

const DAY = 86_400_000;

function tokens(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Every token has to appear somewhere in the title, the recognised text or the id. */
export function searchItems(items: readonly CaptureItem[], query: string): CaptureItem[] {
  const words = tokens(query);
  if (words.length === 0) return [...items];
  return items.filter((item) => {
    const hay = `${item.title ?? ""}\n${item.ocrText ?? ""}\n${item.id}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Local midnight of a timestamp. */
function dayStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface DayGroup {
  key: number;
  label: string;
  items: CaptureItem[];
}

/** Today / Yesterday / weekday for this week / a date beyond that. `locale` is for tests; the UI uses the system's. */
export function dayLabel(dayMs: number, nowMs: number, locale?: string): string {
  const today = dayStart(nowMs);
  const diff = Math.round((today - dayMs) / DAY);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  const d = new Date(dayMs);
  if (diff < 7) return d.toLocaleDateString(locale, { weekday: "long" });
  const sameYear = d.getFullYear() === new Date(nowMs).getFullYear();
  return d.toLocaleDateString(locale, sameYear ? { day: "numeric", month: "long" } : { day: "numeric", month: "long", year: "numeric" });
}

/** Newest first, grouped by the local day they were taken. */
export function groupByDay(items: readonly CaptureItem[], nowMs: number = Date.now(), locale?: string): DayGroup[] {
  const sorted = [...items].sort((a, b) => b.createdAt - a.createdAt);
  const groups: DayGroup[] = [];
  for (const item of sorted) {
    const key = dayStart(item.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, label: dayLabel(key, nowMs, locale), items: [item] });
  }
  return groups;
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** What a capture is called when it was never named: its size. */
export function itemLabel(item: CaptureItem): string {
  return item.title?.trim() || `${item.width} × ${item.height}`;
}

/**
 * A short piece of the recognised text around the first match of `query`
 * (or its beginning), for the card under the thumbnail. Whitespace collapsed.
 */
export function excerpt(text: string | undefined, query: string, length = 90): string {
  if (!text) return "";
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= length) return flat;
  const words = tokens(query);
  let at = -1;
  for (const w of words) {
    const i = flat.toLowerCase().indexOf(w);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at <= length / 3) return `${flat.slice(0, length).trimEnd()}…`;
  const start = Math.max(0, at - Math.floor(length / 3));
  return `…${flat.slice(start, start + length).trim()}…`;
}

/** The file name for a "save as" of a capture. */
export function suggestedFileName(item: CaptureItem): string {
  const d = new Date(item.createdAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  const name = item.title?.trim().replace(/[\\/:*?"<>|]+/g, "-");
  return `${name ? `${name} ` : ""}${stamp}.png`;
}
