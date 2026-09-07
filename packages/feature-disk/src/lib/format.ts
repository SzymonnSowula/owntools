/** Number formatting for the disk tool. Bytes are binary-scaled but shown with SI-looking units, like Explorer does. */

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

/** "117 GB", "34.4 GB", "764 MB", "5.63 GB", "0 B". Three significant digits, no trailing zeros. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  let text = value.toFixed(digits);
  if (digits > 0) text = text.replace(/\.?0+$/, "");
  return `${text} ${UNITS[unit]}`;
}

/** Signed size for diffs: "+1.2 GB", "−300 MB", "0 B". */
export function formatDelta(bytes: number): string {
  if (bytes === 0) return "0 B";
  return `${bytes > 0 ? "+" : "−"}${formatBytes(Math.abs(bytes))}`;
}

/** "2,082,426" */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

/** "34.4%", "100%", "<0.1%" */
export function formatPercent(part: number, total: number, digits = 1): string {
  if (!total || total <= 0) return "0%";
  const pct = (part / total) * 100;
  if (pct >= 99.95) return "100%";
  if (pct > 0 && pct < 0.05) return "<0.1%";
  return `${pct.toFixed(digits)}%`;
}

const UNKNOWN_TIME = -1e12;

export function knownTime(secs: number | null | undefined): secs is number {
  return typeof secs === "number" && Number.isFinite(secs) && secs > UNKNOWN_TIME;
}

/** "11 minutes ago", "1 year ago", "just now". `now` in unix seconds. */
export function formatRelative(secs: number, now = Date.now() / 1000): string {
  if (!knownTime(secs)) return "unknown";
  const diff = Math.max(0, now - secs);
  const steps: [number, string][] = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4.348, "week"],
    [12, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ];
  if (diff < 45) return "just now";
  let value = diff;
  for (const [span, unit] of steps) {
    if (value < span) {
      const n = Math.max(1, Math.floor(value));
      return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
    }
    value /= span;
  }
  return "long ago";
}

/** "Sep 7, 2026" */
export function formatDate(secs: number): string {
  if (!knownTime(secs)) return "—";
  return new Date(secs * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** "Sep 7, 2026, 10:42" */
export function formatDateTime(secs: number): string {
  if (!knownTime(secs)) return "—";
  return new Date(secs * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatIso(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? formatDateTime(t / 1000) : iso;
}

/** "12.6s scan", "830 ms scan" */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

/** File extension, lower-cased, "" for none. */
export function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  const ext = name.slice(dot + 1);
  return ext.length > 12 ? "" : ext.toLowerCase();
}

/** Last path segment — the root itself when there is only one. */
export function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const i = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  return i >= 0 && i < trimmed.length - 1 ? trimmed.slice(i + 1) : trimmed || path;
}

/** Path segments for a breadcrumb: `C:\Users\x` → ["C:", "Users", "x"]. */
export function pathSegments(path: string): string[] {
  const trimmed = path.replace(/[\\/]+$/, "");
  if (!trimmed) return [path];
  return trimmed.split(/[\\/]+/).filter(Boolean);
}
