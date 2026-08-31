import { useMemo, useState } from "react";
import { formatLongDate, todayIso } from "../../lib/dates";
import { useAppStore } from "../../store/useAppStore";

export function JournalView() {
  const journal = useAppStore((s) => s.journal);
  const saveJournal = useAppStore((s) => s.saveJournal);
  const today = todayIso();
  const existing = journal.find((j) => j.date === today);
  const [done, setDone] = useState(existing?.done ?? "");
  const [tomorrow, setTomorrow] = useState(existing?.tomorrow ?? "");
  const [rating, setRating] = useState<1 | 2 | 3 | 4 | 5>(existing?.rating ?? 3);

  const history = useMemo(
    () => journal.filter((j) => j.date !== today).sort((a, b) => b.date.localeCompare(a.date)),
    [journal, today],
  );

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="kicker">Rytuał zamknięcia</p>
          <h1 className="page-title">Dziennik</h1>
        </div>
      </header>

      <section className="card stack" style={{ marginBottom: 20 }}>
        <label className="field">
          <span>Co zrobione</span>
          <textarea className="textarea" value={done} onChange={(e) => setDone(e.target.value)} />
        </label>
        <label className="field">
          <span>Co jutro</span>
          <textarea className="textarea" value={tomorrow} onChange={(e) => setTomorrow(e.target.value)} />
        </label>
        <div>
          <span className="muted" style={{ fontSize: 12 }}>
            Ocena dnia
          </span>
          <div className="stars" style={{ marginTop: 8 }}>
            {([1, 2, 3, 4, 5] as const).map((n) => (
              <button key={n} className={`star${rating >= n ? " on" : ""}`} onClick={() => setRating(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <div>
          <button
            className="btn primary"
            onClick={() => saveJournal({ date: today, done, tomorrow, rating })}
          >
            Zapisz dzisiejszy wpis
          </button>
        </div>
      </section>

      {history.length === 0 ? (
        <div className="empty">
          <h3>Jeszcze bez historii</h3>
          <p>Po kilku dniach pojawi się tu krótki ślad zamknięć — bez wykresów, tylko słowa i ocena.</p>
        </div>
      ) : (
        <div className="stack">
          {history.map((j) => (
            <article className="card" key={j.id}>
              <div className="spread">
                <strong>{formatLongDate(j.date)}</strong>
                <span className="muted">Ocena {j.rating}/5</span>
              </div>
              <p style={{ margin: "10px 0 0" }}>{j.done || "—"}</p>
              <p className="muted" style={{ margin: "6px 0 0" }}>
                Jutro: {j.tomorrow || "—"}
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
