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
          <p className="kicker">Closing ritual</p>
          <h1 className="page-title">Journal</h1>
        </div>
      </header>

      <section className="card stack" style={{ marginBottom: 20 }}>
        <label className="field">
          <span>What got done</span>
          <textarea className="textarea" value={done} onChange={(e) => setDone(e.target.value)} />
        </label>
        <label className="field">
          <span>What's next tomorrow</span>
          <textarea className="textarea" value={tomorrow} onChange={(e) => setTomorrow(e.target.value)} />
        </label>
        <div>
          <span className="muted" style={{ fontSize: 12 }}>
            Day rating
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
            Save today's entry
          </button>
        </div>
      </section>

      {history.length === 0 ? (
        <div className="empty">
          <h3>No history yet</h3>
          <p>After a few days a short trail of closings will appear here — no charts, just words and a rating.</p>
        </div>
      ) : (
        <div className="stack">
          {history.map((j) => (
            <article className="card" key={j.id}>
              <div className="spread">
                <strong>{formatLongDate(j.date)}</strong>
                <span className="muted">Rating {j.rating}/5</span>
              </div>
              <p style={{ margin: "10px 0 0" }}>{j.done || "—"}</p>
              <p className="muted" style={{ margin: "6px 0 0" }}>
                Tomorrow: {j.tomorrow || "—"}
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
