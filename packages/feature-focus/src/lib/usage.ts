import type { UsageBucket, UsageDay } from "../types";

export function ranked(map: Record<string, UsageBucket> | undefined): UsageBucket[] {
  return Object.values(map ?? {}).sort((a, b) => b.seconds - a.seconds);
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return sec && m < 10 ? `${m} min ${sec} s` : `${m} min`;
  return `${sec} s`;
}

export function emptyUsageDay(date: string): UsageDay {
  return { date, seconds: 0, sessions: 0, apps: {}, sites: {} };
}
