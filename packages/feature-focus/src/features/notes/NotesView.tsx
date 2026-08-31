import { useRef, useState, type PointerEvent } from "react";
import { NOTE_COLORS, type NoteColor } from "../../types";
import { useAppStore } from "../../store/useAppStore";

export function NotesView() {
  const notes = useAppStore((s) => s.notes);
  const addNote = useAppStore((s) => s.addNote);
  const updateNote = useAppStore((s) => s.updateNote);
  const moveNote = useAppStore((s) => s.moveNote);
  const bringNote = useAppStore((s) => s.bringNote);
  const [showArchived, setShowArchived] = useState(false);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);

  const visible = notes.filter((n) => (showArchived ? n.archived : !n.archived));

  const onPointerDown = (e: PointerEvent<HTMLElement>, id: string, x: number, y: number) => {
    if ((e.target as HTMLElement).tagName === "TEXTAREA" || (e.target as HTMLElement).closest("button")) {
      return;
    }
    bringNote(id);
    drag.current = { id, dx: e.clientX - x, dy: e.clientY - y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    moveNote(drag.current.id, Math.max(8, e.clientX - drag.current.dx), Math.max(8, e.clientY - drag.current.dy));
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div className="page wide">
      <header className="page-head">
        <div>
          <p className="kicker">Board</p>
          <h1 className="page-title">Notes</h1>
        </div>
        <div className="page-actions">
          <button className={`pill${showArchived ? " active" : ""}`} onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? "Archive" : "Show archive"}
          </button>
          <button className="btn primary" onClick={() => addNote("New thought", "paper")}>
            New note
          </button>
        </div>
      </header>

      {visible.length === 0 ? (
        <div className="empty">
          <h3>{showArchived ? "The archive is empty" : "A clean board"}</h3>
          <p>
            {showArchived
              ? "Nothing put away here. Pinned and active notes stay on the board."
              : "Put down the first note. Short, concrete, no formatting."}
          </p>
        </div>
      ) : (
        <div className="board" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
          {visible
            .slice()
            .sort((a, b) => a.z - b.z)
            .map((n) => (
              <article
                key={n.id}
                className={`sticky ${n.color}`}
                style={{ left: n.x, top: n.y, zIndex: n.z }}
                onPointerDown={(e) => onPointerDown(e, n.id, n.x, n.y)}
              >
                <div className="handle" />
                <textarea
                  value={n.content}
                  onChange={(e) => updateNote(n.id, { content: e.target.value })}
                  placeholder="Write…"
                />
                <div className="sticky-tools">
                  {NOTE_COLORS.map((c: NoteColor) => (
                    <button
                      key={c}
                      className={`color-dot swatch ${c}`}
                      aria-label={c}
                      onClick={() => updateNote(n.id, { color: c })}
                    />
                  ))}
                  <button
                    className={`icon-btn${n.pinned ? " active" : ""}`}
                    style={{ width: 24, height: 24 }}
                    onClick={() => updateNote(n.id, { pinned: !n.pinned })}
                    aria-label="Pin"
                  >
                    •
                  </button>
                  <button
                    className="icon-btn"
                    style={{ width: 24, height: 24 }}
                    onClick={() => updateNote(n.id, { archived: !n.archived })}
                    aria-label="Archive"
                  >
                    ▭
                  </button>
                </div>
              </article>
            ))}
        </div>
      )}
    </div>
  );
}
