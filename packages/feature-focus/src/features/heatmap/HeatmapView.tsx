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
          <p className="kicker">Time at the computer</p>
          <h1 className="page-title">Heatmap</h1>
        </div>
        <div className="page-actions">
          <button className={`pill${tracking ? " active" : ""}`} onClick={() => setTracking(!tracking)}>
            {tracking ? "Tracking on" : "Tracking off"}
          </button>
          <button className="btn" onClick={() => checkInDay()}>
            {heatmap[today]?.checkIn ? "Day checked in" : "Check in today"}
          </button>
          <button className="btn ghost" onClick={() => addFocusMinutes(15, 0)}>
            +15 min
          </button>
        </div>
      </header>

      <section className="card usage-now">
        {!isTauri() ? (
          <p className="muted" style={{ margin: 0 }}>
            The tracker runs in the desktop app. In the browser the heatmap can't see windows.
          </p>
        ) : now?.idle ? (
          <p style={{ margin: 0 }}>
            <span className="dot idle" /> Idle — time is not being counted.
          </p>
        ) : (
          <p style={{ margin: 0 }}>
            <span className="dot live" /> Now: <strong>{now?.appName || "—"}</strong>
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
            <strong>Apps</strong>
            <span className="muted">{selected === today ? "today" : selected}</span>
          </div>
          <p className="muted" style={{ margin: "6px 0 14px", fontSize: 12 }}>
            {formatDuration(totalSec)} active time · {day?.sessions ?? 0} sessions
          </p>
          {apps.length === 0 ? (
            <p className="muted">No data for this day. Leave focus in the tray — the first window counts.</p>
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
            <strong>Sites</strong>
            <span className="muted">from the address bar</span>
          </div>
          <p className="muted" style={{ margin: "6px 0 14px", fontSize: 12 }}>
            Chrome, Edge, Firefox, Brave — domain only, no full history.
          </p>
          {sites.length === 0 ? (
            <p className="muted">No sites yet. Open a browser with the address bar visible.</p>
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
        The heatmap counts active time at the computer (idle over a minute doesn't count). Each
        session starts after returning from a pause. Intensity is relative to the goal of {goal} min
        / day. Data stays on this computer.
      </p>
    </div>
  );
}
