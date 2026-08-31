import { useMemo, useState } from "react";
import type { Priority } from "../../types";
import { useAppStore } from "../../store/useAppStore";

const PRI: { id: Priority; label: string }[] = [
  { id: 0, label: "Brak" },
  { id: 1, label: "Niski" },
  { id: 2, label: "Średni" },
  { id: 3, label: "Wysoki" },
];

export function TasksView() {
  const lists = useAppStore((s) => s.lists);
  const tasks = useAppStore((s) => s.tasks);
  const addTask = useAppStore((s) => s.addTask);
  const toggleTask = useAppStore((s) => s.toggleTask);
  const deleteTask = useAppStore((s) => s.deleteTask);
  const updateTask = useAppStore((s) => s.updateTask);
  const setMit = useAppStore((s) => s.setMit);
  const setScrollGuard = useAppStore((s) => s.setScrollGuard);
  const settings = useAppStore((s) => s.settings);
  const addList = useAppStore((s) => s.addList);
  const addSubtask = useAppStore((s) => s.addSubtask);
  const toggleSubtask = useAppStore((s) => s.toggleSubtask);
  const createPageFromTask = useAppStore((s) => s.createPageFromTask);
  const setActiveNotebookPage = useAppStore((s) => s.setActiveNotebookPage);
  const setView = useAppStore((s) => s.setView);

  const [listId, setListId] = useState(lists[1]?.id ?? "today");
  const [filter, setFilter] = useState<"open" | "done" | "all">("open");
  const [draft, setDraft] = useState("");
  const [listName, setListName] = useState("");
  const [subDraft, setSubDraft] = useState<Record<string, string>>({});

  const visible = useMemo(() => {
    return tasks.filter((t) => {
      if (t.listId !== listId) return false;
      if (filter === "open") return !t.done;
      if (filter === "done") return t.done;
      return true;
    });
  }, [tasks, listId, filter]);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="kicker">Listy</p>
          <h1 className="page-title">Zadania</h1>
        </div>
      </header>

      <div className="row" style={{ marginBottom: 16, flexWrap: "wrap" }}>
        {lists.map((l) => (
          <button key={l.id} className={`pill${l.id === listId ? " active" : ""}`} onClick={() => setListId(l.id)}>
            {l.name}
          </button>
        ))}
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            addList(listName);
            setListName("");
          }}
        >
          <input
            className="input"
            style={{ width: 140, padding: "6px 10px" }}
            placeholder="Nowa lista"
            value={listName}
            onChange={(e) => setListName(e.target.value)}
          />
        </form>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            addTask(draft, listId);
            setDraft("");
          }}
        >
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="Dodaj zadanie do tej listy…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className="btn primary" type="submit">
            Dodaj
          </button>
        </form>
        <div className="row" style={{ marginTop: 12 }}>
          {(["open", "done", "all"] as const).map((f) => (
            <button key={f} className={`pill${filter === f ? " active" : ""}`} onClick={() => setFilter(f)}>
              {f === "open" ? "Otwarte" : f === "done" ? "Zrobione" : "Wszystkie"}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="empty">
          <h3>Tu jest cicho</h3>
          <p>Ta lista nie ma zadań w tym filtrze. Dodaj jedną konkretną rzecz albo przełącz widok.</p>
        </div>
      ) : (
        <div className="card">
          {visible.map((t) => (
            <div className={`task-line${t.done ? " done" : ""}`} key={t.id}>
              <button className={`check${t.done ? " on" : ""}`} onClick={() => toggleTask(t.id)} aria-label="Gotowe" />
              <span className={`pri p${t.priority}`} title="Priorytet" />
              <div style={{ flex: 1 }}>
                <div className="task-title">{t.title}</div>
                <div className="task-meta">
                  {t.mit && <span>MIT</span>}
                  {t.due && <span>{t.due}</span>}
                  {t.subtasks.length > 0 && (
                    <span>
                      {t.subtasks.filter((s) => s.done).length}/{t.subtasks.length}
                    </span>
                  )}
                </div>
                {t.subtasks.map((s) => (
                  <div className="row" key={s.id} style={{ marginTop: 6 }}>
                    <button className={`check${s.done ? " on" : ""}`} onClick={() => toggleSubtask(t.id, s.id)} />
                    <span className={s.done ? "faint" : ""}>{s.title}</span>
                  </div>
                ))}
                <form
                  className="row"
                  style={{ marginTop: 8 }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    addSubtask(t.id, subDraft[t.id] ?? "");
                    setSubDraft((d) => ({ ...d, [t.id]: "" }));
                  }}
                >
                  <input
                    className="input"
                    style={{ padding: "5px 10px", fontSize: 12 }}
                    placeholder="Podzadanie"
                    value={subDraft[t.id] ?? ""}
                    onChange={(e) => setSubDraft((d) => ({ ...d, [t.id]: e.target.value }))}
                  />
                </form>
              </div>
              <div className="stack" style={{ gap: 6 }}>
                <select
                  className="select"
                  style={{ padding: "4px 8px", fontSize: 12 }}
                  value={t.priority}
                  onChange={(e) => updateTask(t.id, { priority: Number(e.target.value) as Priority })}
                >
                  {PRI.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <input
                  className="input"
                  type="date"
                  style={{ padding: "4px 8px", fontSize: 12 }}
                  value={t.due ?? ""}
                  onChange={(e) => updateTask(t.id, { due: e.target.value || undefined })}
                />
                <button className="btn small ghost" onClick={() => setMit(t.id)}>
                  MIT
                </button>
                <button
                  className={`btn small ghost${settings.scrollGuardTaskId === t.id && settings.scrollGuardEnabled ? " on" : ""}`}
                  onClick={() =>
                    setScrollGuard({
                      enabled: true,
                      taskId: settings.scrollGuardTaskId === t.id ? null : t.id,
                    })
                  }
                >
                  {settings.scrollGuardTaskId === t.id && settings.scrollGuardEnabled
                    ? "Chroni"
                    : "Scroll-lock"}
                </button>
                {t.pageId ? (
                  <button
                    className="btn small ghost"
                    onClick={() => {
                      setActiveNotebookPage(t.pageId!);
                      setView("notebook");
                    }}
                  >
                    Strona
                  </button>
                ) : (
                  <button className="btn small ghost" onClick={() => createPageFromTask(t.id)}>
                    Do notatnika
                  </button>
                )}
                <button className="btn small ghost" onClick={() => deleteTask(t.id)}>
                  Usuń
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
