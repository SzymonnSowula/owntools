import { HeatmapGrid } from "../../components/HeatmapGrid";
import { currentStreak } from "../../lib/heatmap";
import { formatMs, formatTodayHeading, todayIso } from "../../lib/dates";
import { useAppStore } from "../../store/useAppStore";

export function TodayView() {
  const tasks = useAppStore((s) => s.tasks);
  const habits = useAppStore((s) => s.habits);
  const heatmap = useAppStore((s) => s.heatmap);
  const timer = useAppStore((s) => s.timer);
  const goal = useAppStore((s) => s.settings.heatmapGoalMinutes);
  const setView = useAppStore((s) => s.setView);
  const toggleTimer = useAppStore((s) => s.toggleTimer);
  const resetTimer = useAppStore((s) => s.resetTimer);
  const setTimerPreset = useAppStore((s) => s.setTimerPreset);
  const setSessionName = useAppStore((s) => s.setSessionName);
  const toggleTask = useAppStore((s) => s.toggleTask);
  const toggleHabit = useAppStore((s) => s.toggleHabit);
  const setMit = useAppStore((s) => s.setMit);

  const today = todayIso();
  const mit = tasks.find((t) => t.mit && !t.done) ?? tasks.find((t) => t.listId === "today" && !t.done);
  const next = tasks.filter((t) => !t.done && t.id !== mit?.id).slice(0, 3);
  const streak = currentStreak(heatmap);
  const todayMin = heatmap[today]?.minutes ?? 0;
  const progress = timer.durationMs ? 1 - timer.remainingMs / timer.durationMs : 0;

  return (
    <div className="page grid-surface">
      <header className="page-head">
        <div>
          <p className="kicker">{formatTodayHeading()}</p>
          <h1 className="page-title">Dziś</h1>
        </div>
        <div className="page-actions">
          <span className="pill active">{streak} dni serii</span>
          <span className="pill">{todayMin} min dzisiaj</span>
        </div>
      </header>

      <div className="grid-2">
        <div className="stack">
          <section className="card">
            <p className="kicker">Najważniejsze zadanie</p>
            {mit ? (
              <>
                <h2 className="mit-title">{mit.title}</h2>
                <div className="row" style={{ marginTop: 14 }}>
                  <button className="btn primary" onClick={() => toggleTask(mit.id)}>
                    Oznacz jako zrobione
                  </button>
                  <button
                    className="btn ghost"
                    onClick={() =>
                      useAppStore.getState().setScrollGuard({ enabled: true, taskId: mit.id })
                    }
                  >
                    Broń scrolla do tego
                  </button>
                  <button className="btn ghost" onClick={() => setView("tasks")}>
                    Wszystkie zadania
                  </button>
                </div>
              </>
            ) : (
              <div>
                <p className="muted">Nic nie jest jeszcze wybrane. Wybierz jedno zadanie, które naprawdę się liczy.</p>
                <div className="stack" style={{ marginTop: 12 }}>
                  {tasks
                    .filter((t) => !t.done)
                    .slice(0, 4)
                    .map((t) => (
                      <button key={t.id} className="btn ghost" onClick={() => setMit(t.id)}>
                        Ustaw MIT: {t.title}
                      </button>
                    ))}
                </div>
              </div>
            )}
          </section>

          <section className="card">
            <div className="spread">
              <p className="kicker">{timer.mode === "break" ? "Przerwa" : "Ostry focus"}</p>
              <div className="row">
                {(["25", "50", "custom"] as const).map((p) => (
                  <button
                    key={p}
                    className={`pill${timer.preset === p ? " active" : ""}`}
                    onClick={() => setTimerPreset(p === "custom" ? "custom" : p)}
                  >
                    {p === "25" ? "25 / 5" : p === "50" ? "50 / 10" : "Własny"}
                  </button>
                ))}
              </div>
            </div>
            <div className="timer-face">{formatMs(timer.remainingMs)}</div>
            <div className={`timer-bar${timer.mode === "break" ? " break" : ""}`}>
              <span style={{ width: `${Math.min(100, progress * 100)}%` }} />
            </div>
            <input
              className="input"
              value={timer.sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="Nazwa sesji"
              style={{ marginBottom: 12 }}
            />
            {timer.preset === "custom" && (
              <label className="field" style={{ marginBottom: 12 }}>
                <span>Minuty focusu</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={180}
                  defaultValue={Math.round(timer.durationMs / 60000)}
                  onBlur={(e) => {
                    const n = Number(e.target.value);
                    if (n > 0) useAppStore.getState().setCustomMinutes(n);
                  }}
                />
              </label>
            )}
            <div className="row">
              <button className="btn primary" onClick={toggleTimer}>
                {timer.running ? "Pauza" : "Start"}
              </button>
              <button className="btn" onClick={resetTimer}>
                Reset
              </button>
            </div>
          </section>
        </div>

        <div className="stack">
          <section className="card">
            <p className="kicker">Nawyki</p>
            <div className="habit-row" style={{ marginTop: 10 }}>
              {habits.map((h) => (
                <button key={h.id} className="habit-chip" onClick={() => toggleHabit(h.id)}>
                  <span className={`check${h.checks[today] ? " on" : ""}`} aria-hidden>
                    {h.checks[today] ? "✓" : ""}
                  </span>
                  {h.name}
                </button>
              ))}
            </div>
          </section>

          <section className="card">
            <p className="kicker">Następne trzy</p>
            {next.length === 0 ? (
              <p className="muted">Skrzynka jest czysta. To dobry znak.</p>
            ) : (
              next.map((t) => (
                <div className="task-line" key={t.id}>
                  <button className={`check${t.done ? " on" : ""}`} onClick={() => toggleTask(t.id)} aria-label="Zrobione" />
                  <div>
                    <div className="task-title">{t.title}</div>
                    <div className="task-meta">{t.due ? t.due : "Bez terminu"}</div>
                  </div>
                </div>
              ))
            )}
          </section>

          <section className="card">
            <p className="kicker">Ostatnie 12 tygodni</p>
            <div style={{ marginTop: 10 }}>
              <HeatmapGrid days={heatmap} goal={goal} mini weeks={12} />
            </div>
          </section>

          <button className="btn" onClick={() => setView("journal")}>
            Rytuał zamknięcia dnia
          </button>
        </div>
      </div>
    </div>
  );
}
