import { addDays, addMonths, addWeeks, isBefore, parseISO } from "date-fns";
import type { RepeatRule } from "./types";

/**
 * Repeat rules. A rule lives on the post; after a successful publish the
 * runner asks for the next occurrence and creates a new post for it. The
 * wall-clock time is kept (a 9:00 post stays at 9:00 across a DST change).
 */

export const REPEAT_OPTIONS: { kind: RepeatRule["kind"]; label: string }[] = [
  { kind: "none", label: "Does not repeat" },
  { kind: "daily", label: "Every day" },
  { kind: "weekly", label: "Every week" },
  { kind: "monthly", label: "Every month" },
  { kind: "every-n-days", label: "Every N days" },
];

export function describeRepeat(rule: RepeatRule): string {
  switch (rule.kind) {
    case "none":
      return "Does not repeat";
    case "daily":
      return "Every day";
    case "weekly":
      return "Every week";
    case "monthly":
      return "Every month";
    case "every-n-days": {
      const n = Math.max(1, Math.round(rule.every ?? 2));
      return n === 1 ? "Every day" : `Every ${n} days`;
    }
  }
}

/**
 * Next scheduled time after `fromIso` according to `rule`, or null when the
 * rule is off or the next one would fall after `until`.
 */
export function nextOccurrence(rule: RepeatRule, fromIso: string): Date | null {
  if (rule.kind === "none") return null;
  const from = parseISO(fromIso);
  if (Number.isNaN(from.getTime())) return null;
  let next: Date;
  switch (rule.kind) {
    case "daily":
      next = addDays(from, 1);
      break;
    case "weekly":
      next = addWeeks(from, 1);
      break;
    case "monthly":
      next = addMonths(from, 1);
      break;
    case "every-n-days":
      next = addDays(from, Math.max(1, Math.round(rule.every ?? 2)));
      break;
  }
  if (rule.until) {
    const until = parseISO(rule.until);
    if (!Number.isNaN(until.getTime()) && isBefore(until, next)) return null;
  }
  return next;
}

/** The first `count` occurrences after `fromIso` — what the calendar previews. */
export function expandOccurrences(rule: RepeatRule, fromIso: string, count: number): Date[] {
  const out: Date[] = [];
  let cursor = fromIso;
  for (let i = 0; i < count; i += 1) {
    const next = nextOccurrence(rule, cursor);
    if (!next) break;
    out.push(next);
    cursor = next.toISOString();
  }
  return out;
}

export function normalizeRepeat(raw: unknown): RepeatRule {
  if (typeof raw !== "object" || raw === null) return { kind: "none" };
  const r = raw as Partial<RepeatRule>;
  const kinds: RepeatRule["kind"][] = ["none", "daily", "weekly", "monthly", "every-n-days"];
  const kind = kinds.includes(r.kind as RepeatRule["kind"]) ? (r.kind as RepeatRule["kind"]) : "none";
  const rule: RepeatRule = { kind };
  if (kind === "every-n-days") rule.every = Math.max(1, Math.round(Number(r.every) || 2));
  if (typeof r.until === "string" && r.until) rule.until = r.until;
  return rule;
}
