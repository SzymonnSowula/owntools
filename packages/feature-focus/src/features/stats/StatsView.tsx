import { currentStreak, minutesInRange } from "../../lib/heatmap";
import { addDays, todayIso } from "../../lib/dates";
import { formatDuration, ranked } from "../../lib/usage";
import type { UsageBucket } from "../../types";
import { useAppStore, weekStartIso } from "../../store/useAppStore";

export function StatsView() {
  const heatmap = useAppStore((s) => s.heatmap);
  const usage = useAppStore((s) => s.usage);
  const tasks = useAppStore((s) => s.tasks);
  const habits = useAppStore((s) => s.habits);
  const goal = useAppStore((s) => s.settings.heatmapGoalMinutes);
  const today = todayIso();
  const year = new Date().getFullYear();
  const weekFrom = weekStartIso();
  const weekMin = minutesInRange(heatmap, weekFrom, today);
  const yearMin = minutesInRange(heatmap, `${year}-01-01`, today);
  const streak = currentStreak(heatmap);
  const tasksDone = tasks.filter((t) => t.done).length;
  const tasksToday = tasks.filter((t) => t.done && t.doneAt?.slice(0, 10) === today).length;

  let habitHits = 0;
  let habitTotal = 0;
  for (let i = 0; i < 7; i++) {
    const iso = addDays(weekFrom, i);
    if (iso > today) break;
    habits.forEach((h) => {
      habitTotal += 1;
      if (h.checks[iso]) habitHits += 1;
    });
  }
  const habitPct = habitTotal ? Math.round((habitHits / habitTotal) * 100) : 0;
  const weekGoal = goal * 5;
  const weekPct = Math.min(100, Math.round((weekMin / Math.max(1, weekGoal)) * 100));

  const weekAppsMap: Record<string, UsageBucket> = {};
  for (const day of Object.values(usage)) {
    if (day.date < weekFrom || day.date > today) continue;
    for (const app of Object.values(day.apps)) {
      const cur = weekAppsMap[app.id] ?? { id: app.id, name: app.name, seconds: 0 };
      weekAppsMap[app.id] = { ...cur, name: app.name, seconds: cur.seconds + app.seconds };
    }
  }
  const weekApps = ranked(weekAppsMap).slice(0, 6);

  return (
    <div className="page grid-surface">
      <header className="page-head">
        <div>
          <p className="kicker">Spokojne liczby</p>
          <h1 className="page-title">Statystyki</h1>
        </div>
      </header>

      <div className="grid-4" style={{ marginBottom: 16 }}>
        <article className="card">
          <div className="stat-hero">{streak}</div>
          <div className="stat-label">Dni serii</div>
        </article>
        <article className="card">
          <div className="stat-hero">{weekMin}</div>
          <div className="stat-label">Minut w tym tygodniu</div>
        </article>
        <article className="card">
          <div className="stat-hero">{yearMin}</div>
          <div className="stat-label">Minut w tym roku</div>
        </article>
        <article className="card">
          <div className="stat-hero">{tasksDone}</div>
          <div className="stat-label">Zadań ukończonych</div>
        </article>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="spread">
            <span>Cel tygodnia</span>
            <span className="muted">{weekPct}%</span>
          </div>
          <div className="meter" style={{ marginTop: 12 }}>
            <span style={{ width: `${weekPct}%` }} />
          </div>
          <p className="muted" style={{ margin: "10px 0 0", fontSize: 12 }}>
            {weekMin} / {weekGoal} min (pięć dni × {goal})
          </p>
        </section>
        <section className="card">
          <div className="spread">
            <span>Nawyki w tym tygodniu</span>
            <span className="muted">{habitPct}%</span>
          </div>
          <div className="meter" style={{ marginTop: 12 }}>
            <span style={{ width: `${habitPct}%` }} />
          </div>
          <p className="muted" style={{ margin: "10px 0 0", fontSize: 12 }}>
            Dziś domknięte zadania: {tasksToday}
          </p>
        </section>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <strong>Aplikacje w tym tygodniu</strong>
        <ul className="usage-list" style={{ marginTop: 14 }}>
          {weekApps.length === 0 ? (
            <li className="muted">Brak zmierzonego czasu — odpal desktopowe focus i pracuj normalnie.</li>
          ) : (
            weekApps.map((a) => (
              <li key={a.id}>
                <div className="spread">
                  <span>{a.name}</span>
                  <span className="muted">{formatDuration(a.seconds)}</span>
                </div>
                <div className="meter">
                  <span style={{ width: `${Math.round((a.seconds / weekApps[0].seconds) * 100)}%` }} />
                </div>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
