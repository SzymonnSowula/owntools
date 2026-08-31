import { useMemo, useState } from "react";
import { HeatmapGrid } from "../../components/HeatmapGrid";
import { todayIso } from "../../lib/dates";
import { formatDuration, ranked } from "../../lib/usage";
import { useAppStore } from "../../store/useAppStore";
import { isTauri } from "../../lib/env";

export function HeatmapView() {
  const heatmap = useAppStore((s) => s.heatmap);
  const usage = useAppStore((s) => s.usage);
  const year = useAppStore((s) => s.heatmapYear);
  const setYear = useAppStore((s) => s.setHeatmapYear);
  const goal = useAppStore((s) => s.settings.heatmapGoalMinutes);
  const tracking = useAppStore((s) => s.settings.usageTracking);
  const setTracking = useAppStore((s) => s.setUsageTracking);
  const checkInDay = useAppStore((s) => s.checkInDay);
  const addFocusMinutes = useAppStore((s) => s.addFocusMinutes);
  const now = useAppStore((s) => s.usageNow);
  const today = todayIso();
  const [selected, setSelected] = useState(today);
  const day = heatmap[selected];
  const breakdown = usage[selected];
  const current = new Date().getFullYear();
  const years = [current, current - 1, current - 2];
  const apps = useMemo(() => ranked(breakdown?.apps).slice(0, 8), [breakdown]);
  const sites = useMemo(() => ranked(breakdown?.sites).slice(0, 8), [breakdown]);
  const totalSec = breakdown?.seconds ?? (day?.seconds ?? (day?.minutes ?? 0) * 60);
  const maxApp = apps[0]?.seconds || 1;
  const maxSite = sites[0]?.seconds || 1;

  return (
    <div className="page wide">
      <header className="page-head">
        <div>
          <p className="kicker">Czas przy komputerze</p>
          <h1 className="page-title">Heatmapa</h1>
        </div>
        <div className="page-actions">
          <button className={`pill${tracking ? " active" : ""}`} onClick={() => setTracking(!tracking)}>
            {tracking ? "Śledzenie włączone" : "Śledzenie wyłączone"}
          </button>
          <button className="btn" onClick={() => checkInDay()}>
            {heatmap[today]?.checkIn ? "Dzień odznaczony" : "Oznacz dziś"}
          </button>
          <button className="btn ghost" onClick={() => addFocusMinutes(15, 0)}>
            +15 min
          </button>
        </div>
      </header>

      <section className="card usage-now">
        {!isTauri() ? (
          <p className="muted" style={{ margin: 0 }}>
            Tracker działa w aplikacji desktopowej. W przeglądarce heatmapa nie widzi okien.
          </p>
        ) : now?.idle ? (
          <p style={{ margin: 0 }}>
            <span className="dot idle" /> Bezczynność — czas nie jest doliczany.
          </p>
        ) : (
          <p style={{ margin: 0 }}>
            <span className="dot live" /> Teraz: <strong>{now?.appName || "—"}</strong>
            {now?.site ? (
              <>
                {" "}
                · <span className="muted">{now.site}</span>
              </>
            ) : null}
            {now?.title ? <span className="faint"> — {now.title.slice(0, 72)}</span> : null}
          </p>
        )}
      </section>

      <section className="card">
        <HeatmapGrid
          days={heatmap}
          goal={goal}
          year={year}
          years={years}
          onYear={setYear}
          selected={selected}
          onSelect={setSelected}
        />
      </section>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <section className="card">
          <div className="spread">
            <strong>Aplikacje</strong>
            <span className="muted">{selected === today ? "dziś" : selected}</span>
          </div>
          <p className="muted" style={{ margin: "6px 0 14px", fontSize: 12 }}>
            {formatDuration(totalSec)} aktywnego czasu · {day?.sessions ?? 0} sesji
          </p>
          {apps.length === 0 ? (
            <p className="muted">Brak danych z tego dnia. Zostaw focus w zasobniku — liczy się pierwsze okno.</p>
          ) : (
            <ul className="usage-list">
              {apps.map((a) => (
                <li key={a.id}>
                  <div className="spread">
                    <span>{a.name}</span>
                    <span className="muted">{formatDuration(a.seconds)}</span>
                  </div>
                  <div className="meter">
                    <span style={{ width: `${Math.round((a.seconds / maxApp) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <div className="spread">
            <strong>Strony</strong>
            <span className="muted">z paska adresu</span>
          </div>
          <p className="muted" style={{ margin: "6px 0 14px", fontSize: 12 }}>
            Chrome, Edge, Firefox, Brave — domena, bez pełnej historii.
          </p>
          {sites.length === 0 ? (
            <p className="muted">Brak stron. Otwórz przeglądarkę z widocznym paskiem adresu.</p>
          ) : (
            <ul className="usage-list">
              {sites.map((s) => (
                <li key={s.id}>
                  <div className="spread">
                    <span>{s.name}</span>
                    <span className="muted">{formatDuration(s.seconds)}</span>
                  </div>
                  <div className="meter">
                    <span style={{ width: `${Math.round((s.seconds / maxSite) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <p className="muted" style={{ marginTop: 16, maxWidth: "62ch" }}>
        Heatmapa liczy aktywny czas przy komputerze (nie bezczynność powyżej minuty). Każda sesja
        zaczyna się po powrocie z pauzy. Intensywność względem celu {goal} min / dzień. Dane zostają
        na tym komputerze.
      </p>
    </div>
  );
}
