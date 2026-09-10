import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "@feature-focus/store/useAppStore";
import {
  ritualOf,
  type RitualStep,
  type RitualStepKind,
  type RitualTool,
  type WorkspaceRitual,
} from "@feature-focus/store/persist";
import { useShellStore } from "./shellStore";
import { pathExists, STEP_LABEL } from "./ritual";

const TOOL_OPTIONS: Array<{ value: RitualTool | ""; label: string }> = [
  { value: "", label: "stay where I am" },
  { value: "focus", label: "focus" },
  { value: "create", label: "screeni" },
  { value: "launch", label: "launch" },
  { value: "dictate", label: "dictate" },
  { value: "hub", label: "the hub" },
];

const PLACEHOLDER: Record<RitualStepKind, string> = {
  app: "C:\\Program Files\\…\\app.exe",
  url: "http://localhost:3000",
  folder: "C:\\Users\\you\\projects\\app",
  terminal: "pnpm dev",
};

/** Neutral scaffolds: labels and empty slots — the input placeholders show what goes where. */
const TEMPLATES: Array<{
  key: string;
  label: string;
  hint: string;
  build: () => Omit<WorkspaceRitual, "autoRun">;
}> = [
  {
    key: "coding",
    label: "coding",
    hint: "editor, dev server, localhost",
    build: () => ({
      steps: [
        step("app", "editor", ""),
        step("terminal", "dev server", ""),
        step("url", "localhost", "http://localhost:3000"),
      ],
      timerMinutes: 50,
      openTool: "focus",
      scrollGuard: true,
    }),
  },
  {
    key: "study",
    label: "study",
    hint: "notes, reading, a course folder",
    build: () => ({
      steps: [
        step("url", "notes", ""),
        step("url", "reading", ""),
        step("folder", "course folder", ""),
      ],
      timerMinutes: 25,
      openTool: "focus",
      scrollGuard: true,
    }),
  },
  {
    key: "deep",
    label: "deep work",
    hint: "no apps — just a long timer and the guard",
    build: () => ({
      steps: [],
      timerMinutes: 90,
      openTool: "focus",
      scrollGuard: true,
    }),
  },
];

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function step(kind: RitualStepKind, label: string, target: string): RitualStep {
  return { id: uid(), kind, label, target, enabled: true };
}

async function pick(kind: "file" | "folder"): Promise<string | null> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const result = await open({ multiple: false, directory: kind === "folder" });
    return typeof result === "string" ? result : null;
  } catch {
    return null;
  }
}

/** Editor for what a workspace opens when its session starts. */
export function WorkspaceSetup() {
  const setupFor = useShellStore((s) => s.setupFor);
  const closeSetup = useShellStore((s) => s.closeSetup);
  const openSession = useShellStore((s) => s.openSession);
  const workspaces = useAppStore((s) => s.workspaces);
  const setWorkspaceRitual = useAppStore((s) => s.setWorkspaceRitual);

  const ws = workspaces.find((w) => w.id === setupFor);
  const [draft, setDraft] = useState<WorkspaceRitual>(() => ritualOf(ws));

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const idRef = useRef<string | null>(setupFor);
  idRef.current = setupFor;

  useEffect(() => {
    const current = useAppStore.getState().workspaces.find((w) => w.id === setupFor);
    setDraft(ritualOf(current));
  }, [setupFor]);

  // Debounced autosave, plus one final write when the sheet goes away.
  useEffect(() => {
    if (!setupFor) return;
    const t = window.setTimeout(() => setWorkspaceRitual(setupFor, draft), 350);
    return () => window.clearTimeout(t);
  }, [draft, setupFor, setWorkspaceRitual]);

  useEffect(
    () => () => {
      if (idRef.current) {
        useAppStore.getState().setWorkspaceRitual(idRef.current, draftRef.current);
      }
    },
    [],
  );

  // Flag steps whose file or folder has moved away since they were added.
  const [missing, setMissing] = useState<Record<string, boolean>>({});
  const pathKey = draft.steps
    .filter((s) => s.kind === "app" || s.kind === "folder")
    .map((s) => `${s.id}:${s.target}`)
    .join("|");

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      void (async () => {
        const checks = pathKey
          .split("|")
          .filter(Boolean)
          .map(async (entry) => {
            const at = entry.indexOf(":");
            const id = entry.slice(0, at);
            const target = entry.slice(at + 1);
            if (!target.trim()) return [id, false] as const;
            return [id, !(await pathExists(target))] as const;
          });
        const entries = await Promise.all(checks);
        if (!cancelled) setMissing(Object.fromEntries(entries));
      })();
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [pathKey]);

  // Escape can beat the debounce, so write before leaving.
  const commit = useCallback(() => {
    if (idRef.current) {
      useAppStore.getState().setWorkspaceRitual(idRef.current, draftRef.current);
    }
    closeSetup();
  }, [closeSetup]);

  useEffect(() => {
    if (!setupFor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") commit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setupFor, commit]);

  if (!setupFor || !ws) return null;

  const patchStep = (id: string, patch: Partial<RitualStep>) =>
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));

  const removeStep = (id: string) =>
    setDraft((d) => ({ ...d, steps: d.steps.filter((s) => s.id !== id) }));

  const moveStep = (id: string, delta: number) =>
    setDraft((d) => {
      const index = d.steps.findIndex((s) => s.id === id);
      const next = index + delta;
      if (index < 0 || next < 0 || next >= d.steps.length) return d;
      const steps = [...d.steps];
      const [moved] = steps.splice(index, 1);
      steps.splice(next, 0, moved);
      return { ...d, steps };
    });

  const addStep = (kind: RitualStepKind) =>
    setDraft((d) => ({ ...d, steps: [...d.steps, step(kind, "", "")] }));

  const browse = async (id: string, kind: "file" | "folder", field: "target" | "cwd") => {
    const path = await pick(kind);
    if (path) patchStep(id, { [field]: path } as Partial<RitualStep>);
  };

  return (
    <div className="rit" role="dialog" aria-label={`${ws.name} setup`}>
      <div className="rit-card wincard">
        <div className="wincard-bar">
          <span className="wincard-dot r" />
          <span className="wincard-dot y" />
          <span className="wincard-dot g" />
          <span className="wincard-title">
            {ws.name.toLowerCase().replace(/\s+/g, "-")}.setup
          </span>
        </div>

        <div className="rit-body">
          <div className="rit-head">
            <span className="ses-emoji" aria-hidden>
              {ws.emoji}
            </span>
            <div>
              <div className="ses-name">{ws.name}</div>
              <div className="ses-sub">
                Everything here starts together when you open this workspace.
              </div>
            </div>
          </div>

          {draft.steps.length === 0 ? (
            <div className="rit-templates">
              <div className="rit-label">start from</div>
              <div className="rit-template-row">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.key}
                    className="rit-template"
                    onClick={() =>
                      setDraft((d) => ({ ...d, ...t.build(), autoRun: d.autoRun }))
                    }
                  >
                    <span className="rit-template-name">{t.label}</span>
                    <span className="rit-template-hint">{t.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="rit-label">opens with the session</div>
          <div className="rit-steps">
            {draft.steps.map((s, i) => (
              <div key={s.id} className={`rit-step${s.enabled ? "" : " off"}`}>
                <div className="rit-step-top">
                  <button
                    className="rit-check"
                    role="switch"
                    aria-checked={s.enabled}
                    title={s.enabled ? "Skip this one" : "Include this one"}
                    onClick={() => patchStep(s.id, { enabled: !s.enabled })}
                  >
                    {s.enabled ? (
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
                        <path d="M2 6.4l2.6 2.6L10 3.4" />
                      </svg>
                    ) : null}
                  </button>
                  <span className="rit-badge">{STEP_LABEL[s.kind]}</span>
                  <input
                    className="rit-input rit-grow"
                    placeholder="name it"
                    value={s.label}
                    onChange={(e) => patchStep(s.id, { label: e.target.value })}
                  />
                  <button
                    className="ws-mini"
                    title="Move up"
                    disabled={i === 0}
                    onClick={() => moveStep(s.id, -1)}
                  >
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                      <path d="M2.5 7.5L6 4l3.5 3.5" />
                    </svg>
                  </button>
                  <button
                    className="ws-mini"
                    title="Move down"
                    disabled={i === draft.steps.length - 1}
                    onClick={() => moveStep(s.id, 1)}
                  >
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                      <path d="M2.5 4.5L6 8l3.5-3.5" />
                    </svg>
                  </button>
                  <button className="ws-mini danger" title="Remove" onClick={() => removeStep(s.id)}>
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                      <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
                    </svg>
                  </button>
                </div>

                <div className="rit-step-fields">
                  <input
                    className="rit-input rit-grow"
                    placeholder={PLACEHOLDER[s.kind]}
                    value={s.target}
                    onChange={(e) => patchStep(s.id, { target: e.target.value })}
                  />
                  {s.kind === "app" || s.kind === "folder" ? (
                    <>
                      {missing[s.id] ? <span className="rit-missing">not found</span> : null}
                      <button
                        className="rit-browse"
                        onClick={() => void browse(s.id, s.kind === "folder" ? "folder" : "file", "target")}
                      >
                        browse…
                      </button>
                    </>
                  ) : null}
                </div>

                {s.kind === "app" || s.kind === "terminal" ? (
                  <div className="rit-step-fields">
                    {s.kind === "app" ? (
                      <input
                        className="rit-input rit-grow"
                        placeholder="arguments (optional)"
                        value={s.args ?? ""}
                        onChange={(e) => patchStep(s.id, { args: e.target.value })}
                      />
                    ) : null}
                    <input
                      className="rit-input rit-grow"
                      placeholder="working folder (optional)"
                      value={s.cwd ?? ""}
                      onChange={(e) => patchStep(s.id, { cwd: e.target.value })}
                    />
                    <button className="rit-browse" onClick={() => void browse(s.id, "folder", "cwd")}>
                      browse…
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <div className="rit-add">
            {(["app", "url", "folder", "terminal"] as RitualStepKind[]).map((kind) => (
              <button key={kind} className="rit-add-btn" onClick={() => addStep(kind)}>
                + {STEP_LABEL[kind]}
              </button>
            ))}
          </div>

          <div className="rit-label">and in owntools</div>
          <div className="rit-options">
            <label className="rit-option">
              <input
                type="checkbox"
                checked={draft.timerMinutes != null}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, timerMinutes: e.target.checked ? 50 : null }))
                }
              />
              <span>start a focus timer</span>
              {draft.timerMinutes != null ? (
                <input
                  className="rit-input rit-num"
                  type="number"
                  min={1}
                  max={600}
                  value={draft.timerMinutes}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      timerMinutes: Math.max(1, Number(e.target.value) || 1),
                    }))
                  }
                />
              ) : null}
              {draft.timerMinutes != null ? <span className="rit-unit">min</span> : null}
            </label>

            <label className="rit-option">
              <span className="rit-option-name">land on</span>
              <select
                className="rit-select"
                value={draft.openTool ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    openTool: (e.target.value || null) as RitualTool | null,
                  }))
                }
              >
                {TOOL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="rit-option">
              <span className="rit-option-name">scroll guard</span>
              <select
                className="rit-select"
                value={draft.scrollGuard === null ? "" : draft.scrollGuard ? "on" : "off"}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    scrollGuard: e.target.value === "" ? null : e.target.value === "on",
                  }))
                }
              >
                <option value="">leave it as it is</option>
                <option value="on">arm it</option>
                <option value="off">turn it off</option>
              </select>
            </label>

            <label className="rit-option">
              <input
                type="checkbox"
                checked={draft.autoRun}
                onChange={(e) => setDraft((d) => ({ ...d, autoRun: e.target.checked }))}
              />
              <span>launch straight away when I switch here (no confirmation)</span>
            </label>
          </div>

          <div className="rit-foot">
            <button
              className="btn primary"
              onClick={() => {
                const id = setupFor;
                commit();
                openSession(id);
              }}
            >
              save & preview
            </button>
            <button
              className="btn"
              onClick={commit}
            >
              done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
