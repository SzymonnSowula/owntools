import { useEffect, useRef, useState } from "react";
import type { CaptureMode } from "../types";
import { useAppStore } from "../store/useAppStore";
import { DictationButton } from "../features/notebook/DictationButton";

const MODES: { id: CaptureMode; label: string }[] = [
  { id: "task", label: "Task" },
  { id: "note", label: "Sticky note" },
  { id: "habit", label: "Habit" },
  { id: "page", label: "New page" },
  { id: "append", label: "Append to notebook" },
];

export function QuickCapture() {
  const open = useAppStore((s) => s.quickOpen);
  const mode = useAppStore((s) => s.quickMode);
  const close = useAppStore((s) => s.closeQuickCapture);
  const openQuick = useAppStore((s) => s.openQuickCapture);
  const addTask = useAppStore((s) => s.addTask);
  const addNote = useAppStore((s) => s.addNote);
  const addHabit = useAppStore((s) => s.addHabit);
  const toggleHabit = useAppStore((s) => s.toggleHabit);
  const createNotebookPage = useAppStore((s) => s.createNotebookPage);
  const appendToNotebook = useAppStore((s) => s.appendToNotebook);
  const habits = useAppStore((s) => s.habits);
  const lang = useAppStore((s) => s.settings.speechLang);
  const [value, setValue] = useState("");
  const [interim, setInterim] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue("");
      setInterim("");
      requestAnimationFrame(() => ref.current?.focus());
    }
  }, [open, mode]);

  if (!open) return null;

  const submit = (raw = value) => {
    const text = raw.trim();
    if (!text) return;
    if (mode === "task") addTask(text, "inbox");
    if (mode === "note") addNote(text, "mist");
    if (mode === "habit") {
      const existing = habits.find((h) => h.name.toLowerCase() === text.toLowerCase());
      if (existing) toggleHabit(existing.id);
      else addHabit(text);
    }
    if (mode === "page") createNotebookPage(text);
    if (mode === "append") appendToNotebook(text);
    close();
  };

  const placeholder =
    mode === "task"
      ? "New task…"
      : mode === "note"
        ? "A short note…"
        : mode === "habit"
          ? "Habit name (checks today)"
          : mode === "page"
            ? "Notebook page title…"
            : "Paragraph for the current page…";

  return (
    <div className="overlay" onClick={close} role="presentation">
      <div className="palette" role="dialog" aria-label="Quick capture" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ marginBottom: 8, flexWrap: "wrap" }}>
          {MODES.map((m) => (
            <button
              key={m.id}
              className={`pill${mode === m.id ? " active" : ""}`}
              onClick={() => openQuick(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="row" style={{ marginBottom: 8 }}>
          <DictationButton
            lang={lang}
            onFinal={(text, command) => {
              if (command === "stop") return;
              if (text) setValue((v) => `${v}${v ? " " : ""}${text}`);
            }}
            onInterim={setInterim}
          />
        </div>
        <input
          ref={ref}
          className="input"
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") close();
          }}
        />
        {interim && <p className="nb-live">{interim}</p>}
        <p className="faint" style={{ margin: "8px 4px 0", fontSize: 12 }}>
          Enter saves. Esc closes. Dictate appends text.
        </p>
      </div>
    </div>
  );
}
