import {
  addDays,
  addMinutes,
  differenceInMinutes,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isSameYear,
  parseISO,
  setHours,
  setMinutes,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";

/**
 * Calendar arithmetic. Every function takes plain `Date`s in the machine's
 * zone; the ISO strings on disk carry the offset (`toIso`).
 */

export type WeekStart = 0 | 1;

export function toIso(d: Date): string {
  // Local wall clock + offset, not the UTC "Z" form: it stays readable in the
  // JSON and survives a zone change on the machine.
  const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
  );
}

export function fromIso(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = parseISO(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function weekRange(anchor: Date, weekStart: WeekStart): { start: Date; end: Date; days: Date[] } {
  const start = startOfWeek(anchor, { weekStartsOn: weekStart });
  const end = endOfWeek(anchor, { weekStartsOn: weekStart });
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return { start, end, days };
}

/** The 5–6 rows of a month grid, padded to full weeks. */
export function monthGrid(anchor: Date, weekStart: WeekStart): Date[][] {
  const first = startOfWeek(startOfMonth(anchor), { weekStartsOn: weekStart });
  const last = endOfWeek(endOfMonth(anchor), { weekStartsOn: weekStart });
  const rows: Date[][] = [];
  let cursor = first;
  while (cursor <= last) {
    rows.push(Array.from({ length: 7 }, (_, i) => addDays(cursor, i)));
    cursor = addDays(cursor, 7);
  }
  return rows;
}

/** "April 6 – 12, 2026" / "Mar 30 – Apr 5, 2026" / "Dec 29, 2025 – Jan 4, 2026". */
export function formatWeekTitle(start: Date, end: Date): string {
  if (isSameMonth(start, end)) return `${format(start, "MMMM d")} – ${format(end, "d, yyyy")}`;
  if (isSameYear(start, end)) return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
  return `${format(start, "MMM d, yyyy")} – ${format(end, "MMM d, yyyy")}`;
}

export function formatMonthTitle(anchor: Date): string {
  return format(anchor, "MMMM yyyy");
}

export function formatDayHeader(d: Date): { weekday: string; day: string } {
  return { weekday: format(d, "EEE"), day: format(d, "d") };
}

export function formatTime(d: Date): string {
  return format(d, "h:mm a").toLowerCase();
}

export function formatHour(hour: number): string {
  const d = setMinutes(setHours(new Date(2000, 0, 1), hour), 0);
  return format(d, "h a").toLowerCase();
}

export function formatDateTime(d: Date): string {
  return `${format(d, "MMM d, yyyy")} ${formatTime(d)}`;
}

/** "in 2 h", "3 min ago", "tomorrow 9:00 am" — for cards and the catch-up sheet. */
export function relativeTime(d: Date, now = new Date()): string {
  const mins = differenceInMinutes(d, now);
  const abs = Math.abs(mins);
  if (abs < 1) return "now";
  if (abs < 60) return mins > 0 ? `in ${abs} min` : `${abs} min ago`;
  if (isSameDay(d, now)) {
    const h = Math.round(abs / 60);
    return mins > 0 ? `in ${h} h` : `${h} h ago`;
  }
  if (isSameDay(d, addDays(now, 1))) return `tomorrow ${formatTime(d)}`;
  if (isSameDay(d, addDays(now, -1))) return `yesterday ${formatTime(d)}`;
  return formatDateTime(d);
}

/** `day` at `hour:minute`. */
export function slotDate(day: Date, hour: number, minute = 0): Date {
  return setMinutes(setHours(startOfDay(day), hour), minute);
}

/** Round to the nearest `step` minutes (default 5) — for the "+" on a slot and drops. */
export function roundToStep(d: Date, step = 5): Date {
  const m = d.getMinutes();
  const r = Math.round(m / step) * step;
  return setMinutes(d, r);
}

/** Keep the time-of-day of `source` on `day`. */
export function moveToDay(source: Date, day: Date): Date {
  return slotDate(day, source.getHours(), source.getMinutes());
}

export function isPastSlot(day: Date, hour: number, now = new Date()): boolean {
  return slotDate(day, hour + 1) <= now;
}

export function isPastDay(day: Date, now = new Date()): boolean {
  return startOfDay(day) < startOfDay(now);
}

/** Minutes since midnight, for the "now" line. */
export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** Parse "HH:MM" (24 h) → [hours, minutes]; null when malformed. */
export function parseHm(raw: string): [number, number] | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return [h, min];
}

/** The next sensible default slot: the next round quarter hour at least 15 minutes out. */
export function nextDefaultSlot(now = new Date()): Date {
  const d = addMinutes(now, 15);
  const m = d.getMinutes();
  const up = Math.ceil(m / 15) * 15;
  return setMinutes(d, up);
}

/** Tomorrow at the same wall-clock time (used by "move to next slot" in the catch-up sheet). */
export function tomorrowSameTime(d: Date): Date {
  return addDays(d, 1);
}

export const HOURS = Array.from({ length: 24 }, (_, i) => i);
