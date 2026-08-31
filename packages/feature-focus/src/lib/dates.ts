export function todayIso(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(iso: string, n: number): string {
  const d = parseIso(iso);
  d.setDate(d.getDate() + n);
  return todayIso(d);
}

export function startOfWeekSunday(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay());
  return x;
}

export const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function formatLongDate(iso: string): string {
  const d = parseIso(iso);
  return `${d.getDate()} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatTodayHeading(d = new Date()): string {
  const raw = `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function plural(
  n: number,
  one: string,
  few: string,
  many: string,
): string {
  const abs = Math.abs(n);
  if (abs === 1) return one;
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function formatMinutes(n: number): string {
  return `${n} ${plural(n, "minute", "minutes", "minutes")}`;
}

export function formatSessions(n: number): string {
  return `${n} ${plural(n, "session", "sessions", "sessions")}`;
}

export function formatMs(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export function weekDates(fromIso: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(fromIso, i));
}

export function lastNDates(n: number, end = todayIso()): string[] {
  return Array.from({ length: n }, (_, i) => addDays(end, -(n - 1 - i)));
}
