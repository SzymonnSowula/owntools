import { useEffect, useRef, useState } from "react";
import { timeAgo, type BoardMeta } from "./boards";
import type { BoardStorage } from "./storage";
import { IconFolder, IconImport, IconPencil, IconPlus, IconSketch, IconTrash } from "./icons";

interface Props {
  storage: BoardStorage;
  boards: BoardMeta[];
  currentId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onImport: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

/** The list of boards: open, rename, delete, new, import. Closes on outside click / Escape. */
export function BoardsPopover({
  storage,
  boards,
  currentId,
  onOpen,
  onNew,
  onImport,
  onRename,
  onDelete,
  onClose,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="board-pop" ref={wrapRef} role="dialog" aria-label="Boards">
      <div className="board-pop-head">
        <span className="board-pop-label">
          boards · {boards.length}
        </span>
        <div className="board-pop-actions">
          <button
            type="button"
            className="board-mini"
            title="Open an .excalidraw file as a new board"
            onClick={onImport}
          >
            <IconImport />
            import
          </button>
          <button type="button" className="board-mini primary" onClick={onNew}>
            <IconPlus />
            new board
          </button>
        </div>
      </div>

      <div className="board-list">
        {boards.map((b) => (
          <Row
            key={b.id}
            board={b}
            storage={storage}
            active={b.id === currentId}
            editing={editingId === b.id}
            onOpen={() => onOpen(b.id)}
            onStartEdit={() => setEditingId(b.id)}
            onEndEdit={(name) => {
              setEditingId(null);
              if (name !== null) onRename(b.id, name);
            }}
            onDelete={() => onDelete(b.id)}
          />
        ))}
      </div>

      <div className="board-pop-foot">
        {storage.kind === "tauri" ? (
          <>
            Saved on this device, nowhere else.
            <button
              type="button"
              className="board-link"
              onClick={() => void storage.reveal(currentId ?? undefined)}
            >
              <IconFolder />
              show folder
            </button>
          </>
        ) : (
          "Saved in this browser's storage."
        )}
      </div>
    </div>
  );
}

function Row({
  board,
  storage,
  active,
  editing,
  onOpen,
  onStartEdit,
  onEndEdit,
  onDelete,
}: {
  board: BoardMeta;
  storage: BoardStorage;
  active: boolean;
  editing: boolean;
  onOpen: () => void;
  onStartEdit: () => void;
  onEndEdit: (name: string | null) => void;
  onDelete: () => void;
}) {
  const [thumb, setThumb] = useState<string | null>(null);
  const [draft, setDraft] = useState(board.name);

  useEffect(() => {
    let on = true;
    void storage
      .thumbUrl(board.id, board.thumbAt)
      .then((url) => {
        if (on) setThumb(url);
      })
      .catch(() => undefined);
    return () => {
      on = false;
    };
  }, [board.id, board.thumbAt, storage]);

  useEffect(() => {
    if (editing) setDraft(board.name);
  }, [editing, board.name]);

  return (
    <div
      className={`board-row${active ? " active" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => {
        if (!editing) onOpen();
      }}
      onKeyDown={(e) => {
        if (!editing && e.key === "Enter") onOpen();
      }}
    >
      <div className="board-thumb" aria-hidden>
        {thumb ? <img src={thumb} alt="" /> : <IconSketch />}
      </div>
      <div className="board-row-main">
        {editing ? (
          <input
            className="board-row-input"
            value={draft}
            maxLength={80}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") onEndEdit(draft);
              if (e.key === "Escape") onEndEdit(null);
            }}
            onBlur={() => onEndEdit(draft)}
          />
        ) : (
          <div className="board-row-name">{board.name}</div>
        )}
        <div className="board-row-meta">edited {timeAgo(board.updatedAt)}</div>
      </div>
      <div className="board-row-tools">
        <button
          type="button"
          className="board-icon-btn"
          title="Rename"
          aria-label="Rename board"
          onClick={(e) => {
            e.stopPropagation();
            onStartEdit();
          }}
        >
          <IconPencil />
        </button>
        <button
          type="button"
          className="board-icon-btn danger"
          title="Delete"
          aria-label="Delete board"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <IconTrash />
        </button>
      </div>
    </div>
  );
}
