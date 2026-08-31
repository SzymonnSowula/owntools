import { useState } from "react";
import { addDays, lastNDates, todayIso } from "../../lib/dates";
import { useAppStore } from "../../store/useAppStore";

function streakOf(checks: Record<string, boolean>): number {
  let n = 0;
  let cursor = todayIso();
  if (!checks[cursor]) cursor = addDays(cursor, -1);
  while (checks[cursor]) {
    n += 1;
    cursor = addDays(cursor, -1);
  }
  return n;
}

export function HabitsView() {
  const habits = useAppStore((s) => s.habits);
  const addHabit = useAppStore((s) => s.addHabit);
  const removeHabit = useAppStore((s) => s.removeHabit);
  const toggleHabit = useAppStore((s) => s.toggleHabit);
  const [name, setName] = useState("");
  const week = lastNDates(7);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="kicker">Every day</p>
          <h1 className="page-title">Habits</h1>
        </div>
      </header>

      <form
        className="card row"
        style={{ marginBottom: 16 }}
        onSubmit={(e) => {
          e.preventDefault();
          addHabit(name);
          setName("");
        }}
      >
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder="New habit…"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn primary" type="submit">
          Add
        </button>
      </form>

      {habits.length === 0 ? (
        <div className="empty">
          <h3>No rituals yet</h3>
          <p>Add three things you want to do every day. The rest is noise.</p>
        </div>
      ) : (
        <div className="stack">
          {habits.map((h) => (
            <section className="card" key={h.id}>
              <div className="spread">
                <div>
                  <strong>{h.name}</strong>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Streak: {streakOf(h.checks)} days
                  </div>
                </div>
                <button className="btn small ghost" onClick={() => removeHabit(h.id)}>
                  Remove
                </button>
              </div>
              <div className="dots" style={{ marginTop: 14 }}>
                {week.map((iso) => (
                  <button
                    key={iso}
                    className={`dot${h.checks[iso] ? " on" : ""}`}
                    title={iso}
                    onClick={() => toggleHabit(h.id, iso)}
                    aria-label={iso}
                  />
                ))}
              </div>
              <div className="row" style={{ marginTop: 14 }}>
                <button className="btn small" onClick={() => toggleHabit(h.id)}>
                  {h.checks[todayIso()] ? "Undo today" : "Check today"}
                </button>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
