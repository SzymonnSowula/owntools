import { monthOf, shiftMonth } from "@core/net";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = [
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

/** "0 B", "812 B", "3.4 KB", "12.0 MB", "1.20 GB" — zero stays a proud "0 B". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 100 * 1024 ? 1 : 0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

const pad = (n: number) => String(n).padStart(2, "0");
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "just now", "4 min ago", "2 h ago", "today 14:02", "yesterday 09:15", "3 Sep 14:02", "3 Sep 2025 14:02". */
export function formatWhen(ts: number, now = Date.now()): string {
  const diff = now - ts;
  if (diff >= 0 && diff < 45_000) return "just now";
  if (diff >= 0 && diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))} min ago`;
  if (diff >= 0 && diff < 6 * 3_600_000) return `${Math.round(diff / 3_600_000)} h ago`;
  const d = new Date(ts);
  const n = new Date(now);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (sameDay(d, n)) return `today ${time}`;
  const yesterday = new Date(n);
  yesterday.setDate(n.getDate() - 1);
  if (sameDay(d, yesterday)) return `yesterday ${time}`;
  const year = d.getFullYear() === n.getFullYear() ? "" : ` ${d.getFullYear()}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year} ${time}`;
}

/** "this month", "last month", else "September 2026". */
export function monthLabel(month: string, now = Date.now()): string {
  const current = monthOf(now);
  if (month === current) return "this month";
  if (month === shiftMonth(current, -1)) return "last month";
  const [y, m] = month.split("-").map(Number);
  const name = MONTH_NAMES[(m ?? 1) - 1] ?? month;
  return `${name} ${y}`;
}

export function formatIso(ts: number): string {
  return new Date(ts).toISOString();
}
