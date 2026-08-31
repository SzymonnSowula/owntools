import { useMemo, useState } from "react";
import { todayIso } from "../../lib/dates";
import { useAppStore } from "../../store/useAppStore";

export function PlannerView() {
  const planner = useAppStore((s) => s.planner);
  const addBlock = useAppStore((s) => s.addBlock);
  const toggleBlock = useAppStore((s) => s.toggleBlock);
  const removeBlock = useAppStore((s) => s.removeBlock);
  const today = todayIso();
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [title, setTitle] = useState("");

  const blocks = useMemo(
    () =>
      planner
        .filter((b) => b.date === today)
        .slice()
        .sort((a, b) => a.start.localeCompare(b.start)),
    [planner, today],
  );

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="kicker">Time blocks</p>
          <h1 className="page-title">Planner</h1>
        </div>
      </header>

      <form
        className="card"
        style={{ marginBottom: 16, display: "grid", gridTemplateColumns: "1fr 1fr 2fr auto", gap: 10 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          addBlock({ start, end, title: title.trim() });
          setTitle("");
        }}
      >
        <label className="field">
          <span>Start</span>
          <input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="field">
          <span>End</span>
          <input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label className="field">
          <span>What you're doing</span>
          <input
            className="input"
            placeholder="Deep work"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <button className="btn primary" type="submit" style={{ alignSelf: "end" }}>
          Add
        </button>
      </form>

      {blocks.length === 0 ? (
        <div className="empty">
          <h3>The day isn't planned yet</h3>
          <p>Add a few blocks — for example 90 minutes of deep work and a short admin session.</p>
        </div>
      ) : (
        <div className="card">
          {blocks.map((b) => (
            <div className={`block-row${b.done ? " done" : ""}`} key={b.id}>
              <span className="muted">
                {b.start}–{b.end}
              </span>
              <span className="block-title">{b.title}</span>
              <div className="row">
                <button className="btn small" onClick={() => toggleBlock(b.id)}>
                  {b.done ? "Undo" : "Done"}
                </button>
                <button className="btn small ghost" onClick={() => removeBlock(b.id)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
