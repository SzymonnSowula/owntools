import type { HeatmapDay } from "../types";
import { MONTHS_SHORT, parseIso, startOfWeekSunday, todayIso } from "./dates";

export type HeatLevel = 0 | 1 | 2 | 3 | 4;

export interface GridCell {
  iso: string;
  inYear: boolean;
  future: boolean;
}

export interface YearGrid {
  weeks: GridCell[][];
  months: { index: number; name: string }[];
}

export function heatLevel(
  day: HeatmapDay | undefined,
  goal: number,
): HeatLevel {
  if (!day) return 0;
  const minutes = day.minutes || Math.floor((day.seconds ?? 0) / 60);
  if (minutes <= 0) return day.checkIn ? 1 : 0;
  const r = minutes / Math.max(1, goal);
  if (r < 0.25) return 1;
  if (r < 0.5) return 2;
  if (r < 0.8) return 3;
  return 4;
}

export function buildYearGrid(year: number): YearGrid {
  const jan1 = new Date(year, 0, 1);
  const start = startOfWeekSunday(jan1);
  const today = todayIso();
  const weeks: GridCell[][] = [];
  const cursor = new Date(start);

  for (let w = 0; w < 53; w++) {
    const week: GridCell[] = [];
    for (let d = 0; d < 7; d++) {
      const iso = todayIso(cursor);
      week.push({
        iso,
        inYear: cursor.getFullYear() === year,
        future: iso > today,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }

  const months: { index: number; name: string }[] = [];
  let prev = -1;
  weeks.forEach((week, i) => {
    const first = week.find((c) => c.inYear);
    if (!first) return;
    const m = parseIso(first.iso).getMonth();
    if (m !== prev) {
      if (!months.length || i - months[months.length - 1].index >= 2) {
        months.push({ index: i, name: MONTHS_SHORT[m] });
      }
      prev = m;
    }
  });

  return { weeks, months };
}

export function buildRecentWeeks(weekCount: number): GridCell[][] {
  const today = new Date();
  const endSunday = startOfWeekSunday(today);
  const start = new Date(endSunday);
  start.setDate(start.getDate() - (weekCount - 1) * 7);
  const todayIsoStr = todayIso();
  const weeks: GridCell[][] = [];
  const cursor = new Date(start);
  for (let w = 0; w < weekCount; w++) {
    const week: GridCell[] = [];
    for (let d = 0; d < 7; d++) {
      const iso = todayIso(cursor);
      week.push({
        iso,
        inYear: true,
        future: iso > todayIsoStr,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export function yearTotals(
  year: number,
  days: Record<string, HeatmapDay>,
): { minutes: number; sessions: number } {
  let minutes = 0;
  let sessions = 0;
  for (const day of Object.values(days)) {
    if (day.date.startsWith(String(year))) {
      minutes += day.minutes;
      sessions += day.sessions;
    }
  }
  return { minutes, sessions };
}

export function currentStreak(days: Record<string, HeatmapDay>): number {
  let streak = 0;
  let cursor = todayIso();
  const today = days[cursor];
  if (!today || ((today.minutes <= 0 && (today.seconds ?? 0) <= 0) && !today.checkIn)) {
    cursor = isoShift(cursor, -1);
  }
  while (true) {
    const day = days[cursor];
    if (!day || ((day.minutes <= 0 && (day.seconds ?? 0) <= 0) && !day.checkIn)) break;
    streak += 1;
    cursor = isoShift(cursor, -1);
  }
  return streak;
}

function isoShift(iso: string, n: number): string {
  const d = parseIso(iso);
  d.setDate(d.getDate() + n);
  return todayIso(d);
}

export function minutesInRange(
  days: Record<string, HeatmapDay>,
  fromIso: string,
  toIso: string,
): number {
  let m = 0;
  for (const day of Object.values(days)) {
    if (day.date >= fromIso && day.date <= toIso) m += day.minutes;
  }
  return m;
}
