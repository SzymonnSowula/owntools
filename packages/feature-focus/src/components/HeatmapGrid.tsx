import { useMemo, useState } from "react";
import type { HeatmapDay } from "../types";
import {
  formatLongDate,
  formatMinutes,
  formatSessions,
  MONTHS_SHORT,
  parseIso,
} from "../lib/dates";
import {
  buildRecentWeeks,
  buildYearGrid,
  heatLevel,
  yearTotals,
  type HeatLevel,
} from "../lib/heatmap";

interface Props {
  days: Record<string, HeatmapDay>;
  goal: number;
  year?: number;
  years?: number[];
  onYear?: (year: number) => void;
  mini?: boolean;
  weeks?: number;
  selected?: string | null;
  onSelect?: (iso: string) => void;
}

export function HeatmapGrid({
  days,
  goal,
  year,
  years = [],
  onYear,
  mini = false,
  weeks = 12,
  selected = null,
  onSelect,
}: Props) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);

  const model = useMemo(() => {
    if (mini) {
      return { weeks: buildRecentWeeks(weeks), months: [] as { index: number; name: string }[] };
    }
    return buildYearGrid(year ?? new Date().getFullYear());
  }, [mini, weeks, year]);

  const totals = useMemo(
    () => (mini || year == null ? { minutes: 0, sessions: 0 } : yearTotals(year, days)),
    [mini, year, days],
  );

  const showTip = (el: HTMLElement, cellIso: string) => {
    const r = el.getBoundingClientRect();
    const day = days[cellIso];
    const minutes = day?.minutes ?? 0;
    const sessions = day?.sessions ?? 0;
    const check = day?.checkIn ? " · checked in" : "";
    setTip({
      x: r.left + r.width / 2,
      y: r.top,
      text: `${formatLongDate(cellIso)} · ${formatMinutes(minutes)} · ${formatSessions(sessions)}${check}`,
    });
  };

  const header = mini
    ? null
    : `${formatSessions(totals.sessions)} / ${formatMinutes(totals.minutes)} in ${
        year === new Date().getFullYear() ? "the last year" : String(year)
      }`;

  const monthWidth = 14;

  return (
    <div className="contrib">
      <div className="contrib-main">
        {header && <p className="contrib-head">{header}</p>}
        <div className="contrib-layout">
          <div />
          <div className="contrib-months">
            {model.months.map((m) => (
              <span
                key={`${m.name}-${m.index}`}
                className="contrib-month"
                style={{ left: m.index * monthWidth }}
              >
                {m.name}
              </span>
            ))}
            {mini &&
              model.weeks.map((week, i) => {
                const d = parseIso(week[0].iso);
                if (d.getDate() > 7 && i !== 0) return null;
                return (
                  <span key={week[0].iso} className="contrib-month" style={{ left: i * monthWidth }}>
                    {MONTHS_SHORT[d.getMonth()]}
                  </span>
                );
              })}
          </div>
          <div className="contrib-dows" aria-hidden>
            <span />
            <span>Mon</span>
            <span />
            <span>Wed</span>
            <span />
            <span>Fri</span>
            <span />
          </div>
          <div className="contrib-weeks">
            {model.weeks.map((week) =>
              week.map((cell) => {
                const level = heatLevel(days[cell.iso], goal);
                const isSelected = selected === cell.iso;
                return (
                  <button
                    key={cell.iso}
                    type="button"
                    className={`contrib-cell l${level}${cell.inYear ? "" : " out"}${cell.future ? " future" : ""}${isSelected ? " selected" : ""}`}
                    aria-label={cell.iso}
                    onMouseEnter={(e) => showTip(e.currentTarget, cell.iso)}
                    onMouseLeave={() => setTip(null)}
                    onClick={() => onSelect?.(cell.iso)}
                  />
                );
              }),
            )}
          </div>
        </div>
        <div className="contrib-legend">
          <span>Less</span>
          {([0, 1, 2, 3, 4] as HeatLevel[]).map((l) => (
            <span key={l} className={`contrib-cell l${l}`} />
          ))}
          <span>More</span>
        </div>
      </div>
      {!mini && (
        <aside className="year-list" aria-label="Years">
          {years.map((y) => (
            <button
              key={y}
              className={`pill${y === year ? " active" : ""}`}
              onClick={() => onYear?.(y)}
            >
              {y}
            </button>
          ))}
        </aside>
      )}
      {tip && (
        <div className="tip" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}
