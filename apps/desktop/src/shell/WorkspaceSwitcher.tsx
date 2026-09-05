import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@feature-focus/store/useAppStore";
import { ritualOf } from "@feature-focus/store/persist";
import { useShellStore } from "./shellStore";
import { activeSteps, ritualIsEmpty } from "./ritual";

const EMOJI = ["🏡", "💼", "🚀", "🌿", "🎬", "📚", "🧪", "🎨"];

export function WorkspaceSwitcher() {
  const workspaces = useAppStore((s) => s.workspaces);
  const workspaceId = useAppStore((s) => s.workspaceId);
  const switchWorkspace = useAppStore((s) => s.switchWorkspace);
  const createWorkspace = useAppStore((s) => s.createWorkspace);
  const renameWorkspace = useAppStore((s) => s.renameWorkspace);
  const deleteWorkspace = useAppStore((s) => s.deleteWorkspace);
  const openSession = useShellStore((s) => s.openSession);
  const openSetup = useShellStore((s) => s.openSetup);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftEmoji, setDraftEmoji] = useState(EMOJI[1]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const active = workspaces.find((w) => w.id === workspaceId);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setEditingId(null);
      setConfirmDeleteId(null);
    }
  }, [open]);

  /** Switch, then offer (or run) whatever that workspace opens. */
  const activate = async (id: string) => {
    setOpen(false);
    await switchWorkspace(id);
    const ws = useAppStore.getState().workspaces.find((w) => w.id === id);
    const ritual = ritualOf(ws);
    if (!ritualIsEmpty(ritual)) openSession(id, ritual.autoRun);
  };

  const submitCreate = () => {
    if (!draft.trim()) return;
    const name = draft;
    setDraft("");
    setOpen(false);
    void (async () => {
      await createWorkspace(name, draftEmoji);
      const created = useAppStore.getState().workspaceId;
      openSetup(created);
    })();
  };

  const submitRename = (id: string) => {
    renameWorkspace(id, editName);
    setEditingId(null);
  };

  return (
    <div className="ws-wrap" ref={wrapRef}>
      <button
        className="ws-pill"
        aria-expanded={open}
        title="Workspaces"
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden>{active?.emoji ?? "🏡"}</span>
        {active?.name ?? "Personal"}
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <path d="M2 3.5l3 3 3-3" />
        </svg>
      </button>

      {open ? (
        <div className="ws-pop" role="menu">
          <div className="ws-pop-label">Workspaces</div>
          {workspaces.map((w) =>
            editingId === w.id ? (
              <div key={w.id} className="ws-row editing">
                <span aria-hidden>{w.emoji}</span>
                <input
                  className="ws-input"
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === "Return") submitRename(w.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
                <button className="ws-mini" title="Save" onClick={() => submitRename(w.id)}>
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                    <path d="M2 6.4l2.6 2.6L10 3.4" />
                  </svg>
                </button>
              </div>
            ) : (
              <div key={w.id} className={`ws-row${w.id === workspaceId ? " active" : ""}`}>
                <button className="ws-row-main" onClick={() => void activate(w.id)}>
                  <span aria-hidden>{w.emoji}</span>
                  {w.name}
                  {activeSteps(ritualOf(w)).length ? (
                    <span className="ws-count">{activeSteps(ritualOf(w)).length}</span>
                  ) : null}
                </button>
                <button
                  className="ws-mini"
                  title="What this workspace opens"
                  onClick={() => {
                    setOpen(false);
                    openSetup(w.id);
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
                    <circle cx="6" cy="6" r="2" />
                    <path d="M6 1v1.6M6 9.4V11M1 6h1.6M9.4 6H11M2.5 2.5l1.1 1.1M8.4 8.4l1.1 1.1M9.5 2.5L8.4 3.6M3.6 8.4L2.5 9.5" />
                  </svg>
                </button>
                <button
                  className="ws-mini"
                  title="Rename"
                  onClick={() => {
                    setEditingId(w.id);
                    setEditName(w.name);
                    setConfirmDeleteId(null);
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
                    <path d="M8.3 1.7l2 2L4 10H2V8l6.3-6.3z" />
                  </svg>
                </button>
                {w.id !== workspaceId && workspaces.length > 1 ? (
                  confirmDeleteId === w.id ? (
                    <button
                      className="ws-mini danger"
                      title="Click again to delete permanently"
                      onClick={() => {
                        void deleteWorkspace(w.id);
                        setConfirmDeleteId(null);
                      }}
                    >
                      sure?
                    </button>
                  ) : (
                    <button className="ws-mini" title="Delete workspace" onClick={() => setConfirmDeleteId(w.id)}>
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                        <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
                      </svg>
                    </button>
                  )
                ) : null}
              </div>
            ),
          )}

          <div className="ws-new">
            <button
              className="ws-emoji"
              title="Pick an icon"
              onClick={() => setDraftEmoji(EMOJI[(EMOJI.indexOf(draftEmoji) + 1) % EMOJI.length])}
            >
              {draftEmoji}
            </button>
            <input
              className="ws-input"
              placeholder="New workspace…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Return") submitCreate();
              }}
            />
            <button className="ws-mini" title="Create" onClick={submitCreate} disabled={!draft.trim()}>
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M6 2v8M2 6h8" />
              </svg>
            </button>
          </div>
          <div className="ws-hint">
            A workspace is a session: its own tasks, notes and theme — plus the apps,
            links and timer it starts for you.
          </div>
        </div>
      ) : null}
    </div>
  );
}
