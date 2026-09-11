/** Time and label formatting for meet. Pure, tested. */

/** "0:00", "4:07", "1:02:15" — the running clock and transcript stamps. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/** "35 s", "12 min", "1 h 05 min" — how long a meeting was. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total} s`;
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  if (h === 0) return `${m} min`;
  if (m === 60) return `${h + 1} h`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")} min`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Call · Thu 14:32" — what a meeting is called until someone names it. */
export function defaultTitle(startedAt: Date | string | number): string {
  const d = new Date(startedAt);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `Call · ${WEEKDAYS[d.getDay()]} ${hh}:${mm}`;
}

/** "Today", "Yesterday", then "Monday, 8 September". */
export function dayLabel(at: Date | string | number, now: Date = new Date()): string {
  const d = new Date(at);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  const t = d.getTime();
  if (t >= startOfToday && t < startOfToday + day) return "Today";
  if (t >= startOfToday - day && t < startOfToday) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

export function timeLabel(at: Date | string | number): string {
  return new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** "11 September 2026, 14:32" for the export header. */
export function dateLabel(at: Date | string | number): string {
  const d = new Date(at);
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}, ${timeLabel(d)}`;
}

export function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** First non-empty line of a summary, clipped for a list row. */
export function firstLine(text: string | undefined, max = 120): string {
  if (!text) return "";
  const line = text.split(/\n+/).map((l) => l.trim()).find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** A folder-safe id: time-sortable, unique enough for one machine. */
export function meetingId(now: Date = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 6);
  return `${stamp}-${rand}`;
}
