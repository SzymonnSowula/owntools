import "./automations.css";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { confirmDialog } from "@ui/Dialog";
import { isTauri } from "@core/env";
import { backend } from "./api";
import type { FolderEntry } from "./backend";
import {
  clearRuns,
  deleteRule,
  runRule,
  runRuleOnFile,
  saveRule,
  setRuleEnabled,
  simulateTrigger,
  startAutomations,
  type SimulatedTrigger,
} from "./engine";
import {
  DAY_SHORT,
  describeAction,
  describeTrigger,
  extOf,
  newRule,
  normalizeExtensions,
  suggestName,
  TEMPLATES,
  validateRule,
  type Action,
  type ActionKind,
  type Condition,
  type ConditionField,
  type ConditionOp,
  type Rule,
  type RuleTemplate,
  type RunRecord,
  type SaveFormat,
  type SummaryStyle,
  type TextSource,
  type Trigger,
  type TriggerKind,
} from "./rules";
import { useAutomationsStore } from "./store";

export { useAutomationsSummary } from "./store";

/* ------------------------------------------------------------------------- */
/* Vocabulary                                                                */
/* ------------------------------------------------------------------------- */

const TRIGGER_PICKS: { kind: TriggerKind; title: string; blurb: string }[] = [
  { kind: "meet-finished", title: "Meeting finishes", blurb: "meet stopped and the transcript is on disk" },
  { kind: "recording-finished", title: "Recording finishes", blurb: "screeni saved a take" },
  { kind: "export-finished", title: "Export finishes", blurb: "screeni rendered a video" },
  { kind: "capture-saved", title: "Capture saved", blurb: "a screenshot, with its text when OCR ran" },
  { kind: "dictation-take", title: "Dictation take", blurb: "after each take, with the app it went to" },
  { kind: "file-added", title: "File lands in a folder", blurb: "watch Downloads, or any folder, for new files" },
  { kind: "schedule", title: "At a time of day", blurb: "once a day, on the days you pick" },
  { kind: "manual", title: "When you run it", blurb: "a button here, nothing automatic" },
];

const ACTION_LABELS: Record<ActionKind, string> = {
  transcribe: "Transcribe the file",
  summarize: "Summarize with the language model",
  "save-text": "Save as a file",
  "social-draft": "Draft a post in social",
  "add-task": "Add tasks in focus",
  "copy-clipboard": "Copy to the clipboard",
  notify: "Show a notification",
  open: "Open a link, file or program",
  "remove-fillers": "Remove filler words",
};
const ACTION_ORDER: ActionKind[] = [
  "transcribe",
  "remove-fillers",
  "summarize",
  "save-text",
  "add-task",
  "social-draft",
  "copy-clipboard",
  "notify",
  "open",
];

const FIELD_LABELS: Record<ConditionField, string> = {
  app: "app",
  title: "title",
  path: "file path",
  text: "text",
  durationMs: "length (ms)",
  ext: "file type",
};
const OP_LABELS: Record<ConditionOp, string> = {
  contains: "contains",
  matches: "matches pattern",
  eq: "is",
  gt: "is more than",
  lt: "is less than",
};

const SIMULATIONS: { kind: SimulatedTrigger; label: string }[] = [
  { kind: "meet-finished", label: "meeting finished" },
  { kind: "export-finished", label: "export finished" },
  { kind: "recording-finished", label: "recording finished" },
  { kind: "capture-saved", label: "capture saved" },
  { kind: "dictation-take", label: "dictation take" },
  { kind: "file-added", label: "file added" },
];

function defaultTrigger(kind: TriggerKind): Trigger {
  switch (kind) {
    case "file-added":
      return { kind, folder: "", extensions: ["mp3", "m4a", "wav", "mp4", "webm"] };
    case "schedule":
      return { kind, time: "18:00", days: [1, 2, 3, 4, 5] };
    default:
      return { kind } as Trigger;
  }
}

function defaultAction(kind: ActionKind): Action {
  switch (kind) {
    case "transcribe":
    case "remove-fillers":
      return { kind };
    case "summarize":
      return { kind, style: "bullets" };
    case "save-text":
      return { kind, folder: "", name: "{date} {title}", format: "md", source: "text" };
    case "social-draft":
      return { kind, source: "text" };
    case "add-task":
      return { kind, source: "text" };
    case "copy-clipboard":
      return { kind, source: "text" };
    case "notify":
      return { kind, title: "owntools", body: "{title} is done" };
    case "open":
      return { kind, target: "" };
  }
}

/* ------------------------------------------------------------------------- */
/* Formatting                                                                */
/* ------------------------------------------------------------------------- */

const pad2 = (n: number) => String(n).padStart(2, "0");

function whenLabel(ts: number | undefined, now = new Date()): string {
  if (!ts) return "never";
  const d = new Date(ts);
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return `today ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return `yesterday ${time}`;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${time}`;
}

function msLabel(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/* ------------------------------------------------------------------------- */
/* Drafts                                                                    */
/* ------------------------------------------------------------------------- */

interface Draft {
  /** The rule being edited, `null` for a new one. */
  base: Rule | null;
  name: string;
  /** Once the person typed a name, stop suggesting one. */
  nameTouched: boolean;
  enabled: boolean;
  trigger: Trigger;
  conditions: Condition[];
  actions: Action[];
}

function blankDraft(): Draft {
  return { base: null, name: "", nameTouched: false, enabled: true, trigger: { kind: "manual" }, conditions: [], actions: [] };
}

function draftFromRule(rule: Rule): Draft {
  return {
    base: rule,
    name: rule.name,
    nameTouched: rule.name !== suggestName(rule),
    enabled: rule.enabled,
    trigger: rule.trigger,
    conditions: rule.conditions,
    actions: rule.actions,
  };
}

function draftFromTemplate(t: RuleTemplate): Draft {
  const made = t.make();
  return { base: null, name: made.name, nameTouched: true, enabled: true, trigger: made.trigger, conditions: made.conditions, actions: made.actions };
}

function ruleFromDraft(d: Draft): Rule {
  return newRule({
    ...(d.base ?? {}),
    id: d.base?.id,
    name: d.name.trim() || suggestName(d),
    enabled: d.enabled,
    trigger: d.trigger,
    conditions: d.conditions,
    actions: d.actions,
  });
}

/* ------------------------------------------------------------------------- */
/* Pickers                                                                   */
/* ------------------------------------------------------------------------- */

async function pickAnyPath(): Promise<string | null> {
  if (!isTauri()) return "C:\\Users\\demo\\Documents\\launch checklist.md";
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ multiple: false, title: "Choose what to open" });
  return typeof picked === "string" ? picked : null;
}

/* ------------------------------------------------------------------------- */
/* The card                                                                  */
/* ------------------------------------------------------------------------- */

export default function AutomationsCard() {
  const loaded = useAutomationsStore((s) => s.loaded);
  const rules = useAutomationsStore((s) => s.rules);
  const runs = useAutomationsStore((s) => s.runs);
  const running = useAutomationsStore((s) => s.running);
  const queued = useAutomationsStore((s) => s.queued);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);

  useEffect(() => {
    // Idempotent: App.tsx starts the engine on launch; this covers the dev page.
    void startAutomations().catch(() => undefined);
  }, []);

  const enabledCount = rules.filter((r) => r.enabled).length;
  const today = new Date();
  const ranToday = runs.filter((r) => whenLabel(r.startedAt, today).startsWith("today")).length;
  const templatesOpen = showTemplates || (loaded && rules.length === 0 && !draft);

  const save = async () => {
    if (!draft) return;
    await saveRule(ruleFromDraft(draft));
    setDraft(null);
  };

  return (
    <section className="card stack" data-settings-section="automations">
      <div className="au-head">
        <div>
          <strong>Automations</strong>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
            Small rules that connect the tools: when something finishes, the next step happens for you - a meeting
            becomes a note, an export becomes a draft post, a download gets its transcript. Everything runs here, on this
            device, and a rule is gone the moment you delete it.
          </p>
        </div>
        <span className="au-summary" title={queued ? `${queued} run${queued === 1 ? "" : "s"} in progress` : undefined}>
          <span className={`au-dot ${queued ? "running" : enabledCount ? "ok" : ""}`} />
          {enabledCount} on · {ranToday} ran today
        </span>
      </div>

      {loaded && rules.length > 0 ? (
        <div className="au-rules">
          {rules.map((rule) => (
            <RuleRow key={rule.id} rule={rule} running={running === rule.id} onEdit={() => setDraft(draftFromRule(rule))} />
          ))}
        </div>
      ) : loaded ? (
        <div className="empty" style={{ padding: "22px 20px" }}>
          No automations yet. Start from a template below, or build one.
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 12 }}>
          Loading…
        </div>
      )}

      {draft ? (
        <RuleEditor draft={draft} onChange={setDraft} onSave={() => void save()} onCancel={() => setDraft(null)} />
      ) : (
        <div className="row" style={{ flexWrap: "wrap" }}>
          <button className="btn" onClick={() => setDraft(blankDraft())}>
            New automation
          </button>
          <button className={`btn ghost${templatesOpen ? " small" : ""}`} onClick={() => setShowTemplates((v) => !v)}>
            {templatesOpen ? "Hide templates" : "Templates"}
          </button>
        </div>
      )}

      {templatesOpen && !draft ? (
        <div className="au-templates">
          {TEMPLATES.map((t) => (
            <button key={t.id} className="au-template" onClick={() => setDraft(draftFromTemplate(t))}>
              <strong>{t.title}</strong>
              <span>{t.blurb}</span>
            </button>
          ))}
        </div>
      ) : null}

      <RunsList runs={runs} running={running} />

      {!isTauri() ? (
        <div className="au-dev">
          <span>Simulate:</span>
          {SIMULATIONS.map((s) => (
            <button key={s.kind} className="pill" onClick={() => void simulateTrigger(s.kind)}>
              {s.label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* A rule in the list                                                        */
/* ------------------------------------------------------------------------- */

function RuleRow({ rule, running, onEdit }: { rule: Rule; running: boolean; onEdit: () => void }) {
  const [files, setFiles] = useState<FolderEntry[] | null>(null);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    const ok = await confirmDialog({
      title: "Delete automation",
      message: `Delete "${rule.name}"? Files it already wrote stay where they are; the rule just stops.`,
      kind: "danger",
      okLabel: "Delete",
    });
    if (ok) await deleteRule(rule.id);
  };

  const runNow = async () => {
    setBusy(true);
    try {
      await runRule(rule.id);
    } finally {
      setBusy(false);
    }
  };

  const listFiles = async () => {
    if (rule.trigger.kind !== "file-added") return;
    if (files) {
      setFiles(null);
      return;
    }
    const { folder, extensions } = rule.trigger;
    try {
      const all = await backend().listFolder(folder);
      setFiles(all.filter((f) => extensions.length === 0 || extensions.includes(extOf(f.name))).slice(0, 12));
    } catch {
      setFiles([]);
    }
  };

  const runOnFile = async (file: FolderEntry) => {
    setFiles(null);
    setBusy(true);
    try {
      await runRuleOnFile(rule.id, file.path, file.size);
    } finally {
      setBusy(false);
    }
  };

  const line = rule.actions.length ? `${describeTrigger(rule.trigger)} → ${rule.actions.map(describeAction).join(", ")}` : describeTrigger(rule.trigger);
  const meta = running ? (
    <span className="au-running">running…</span>
  ) : rule.runCount ? (
    `ran ${rule.runCount}× · last ${whenLabel(rule.lastRunAt)}`
  ) : (
    "hasn't run yet"
  );

  return (
    <div className={`au-rule${rule.enabled ? "" : " off"}`}>
      <input
        type="checkbox"
        className="au-switch"
        checked={rule.enabled}
        title={rule.enabled ? "On - switch off" : "Off - switch on"}
        onChange={(e) => void setRuleEnabled(rule.id, e.target.checked)}
      />
      <div className="au-rule-body">
        <span className="au-rule-name" title={rule.name}>
          {rule.name}
        </span>
        <span className="au-rule-line" title={line}>
          {line}
        </span>
        <span className="au-rule-meta">{meta}</span>
      </div>
      <div className="au-rule-actions">
        {rule.trigger.kind === "file-added" ? (
          <button className="btn small ghost" disabled={busy} onClick={() => void listFiles()}>
            Run on a file…
          </button>
        ) : (
          <button className="btn small ghost" disabled={busy || running} onClick={() => void runNow()}>
            Run now
          </button>
        )}
        <button className="btn small ghost" onClick={onEdit}>
          Edit
        </button>
        <button className="btn small ghost" onClick={() => void remove()}>
          Delete
        </button>
      </div>
      {files ? (
        <div className="au-files">
          {files.length === 0 ? <span className="au-hint">No matching files in that folder (or it is not allowed yet - pick it again in the rule).</span> : null}
          {files.map((f) => (
            <button key={f.path} className="pill" title={`${f.path} · ${sizeLabel(f.size)}`} onClick={() => void runOnFile(f)}>
              {f.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Editor                                                                    */
/* ------------------------------------------------------------------------- */

function RuleEditor({
  draft,
  onChange,
  onSave,
  onCancel,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const problems = useMemo(() => validateRule(draft), [draft]);
  const suggested = suggestName(draft);
  const name = draft.nameTouched ? draft.name : suggested;

  const patch = (p: Partial<Draft>) => onChange({ ...draft, ...p });
  const setTrigger = (trigger: Trigger) => patch({ trigger });
  const setAction = (i: number, action: Action) => patch({ actions: draft.actions.map((a, j) => (j === i ? action : a)) });
  const moveAction = (i: number, dir: -1 | 1) => {
    const next = draft.actions.slice();
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    patch({ actions: next });
  };
  const removeAction = (i: number) => patch({ actions: draft.actions.filter((_, j) => j !== i) });
  const addAction = (kind: ActionKind) => patch({ actions: [...draft.actions, defaultAction(kind)] });
  const setCondition = (i: number, c: Condition) => patch({ conditions: draft.conditions.map((x, j) => (j === i ? c : x)) });

  return (
    <div className="au-editor">
      <div className="au-block">
        <div className="au-block-title">
          <strong>{draft.base ? "Edit automation" : "New automation"}</strong>
          <span>When … then …</span>
        </div>
        <label className="field">
          <span>Name</span>
          <input
            className="input"
            value={name}
            placeholder={suggested}
            onChange={(e) => patch({ name: e.target.value, nameTouched: true })}
            onBlur={(e) => {
              if (!e.target.value.trim()) patch({ name: "", nameTouched: false });
            }}
          />
        </label>
      </div>

      <div className="au-block">
        <div className="au-block-title">
          <strong>When</strong>
          <span>the trigger</span>
        </div>
        <div className="au-picks">
          {TRIGGER_PICKS.map((t) => (
            <button
              key={t.kind}
              type="button"
              className={`au-pick${draft.trigger.kind === t.kind ? " on" : ""}`}
              onClick={() => {
                if (draft.trigger.kind !== t.kind) setTrigger(defaultTrigger(t.kind));
              }}
            >
              <strong>{t.title}</strong>
              <span>{t.blurb}</span>
            </button>
          ))}
        </div>
        <TriggerFields trigger={draft.trigger} onChange={setTrigger} />
      </div>

      <div className="au-block">
        <div className="au-block-title">
          <strong>Only if</strong>
          <span>{draft.conditions.length ? "every condition has to hold" : "optional - no conditions means always"}</span>
        </div>
        {draft.conditions.length ? (
          <div className="au-items">
            {draft.conditions.map((c, i) => (
              <div key={i} className="au-cond">
                <select className="select" value={c.field} onChange={(e) => setCondition(i, { ...c, field: e.target.value as ConditionField })}>
                  {(Object.keys(FIELD_LABELS) as ConditionField[]).map((f) => (
                    <option key={f} value={f}>
                      {FIELD_LABELS[f]}
                    </option>
                  ))}
                </select>
                <select className="select" value={c.op} onChange={(e) => setCondition(i, { ...c, op: e.target.value as ConditionOp })}>
                  {(Object.keys(OP_LABELS) as ConditionOp[]).map((op) => (
                    <option key={op} value={op}>
                      {OP_LABELS[op]}
                    </option>
                  ))}
                </select>
                <input
                  className="input"
                  value={String(c.value)}
                  placeholder={c.op === "matches" ? "regular expression" : c.op === "gt" || c.op === "lt" ? "number" : "text"}
                  onChange={(e) => setCondition(i, { ...c, value: e.target.value })}
                />
                <button className="icon-btn" title="Remove condition" onClick={() => patch({ conditions: draft.conditions.filter((_, j) => j !== i) })}>
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div>
          <button className="btn small ghost" onClick={() => patch({ conditions: [...draft.conditions, { field: "title", op: "contains", value: "" }] })}>
            Add a condition
          </button>
        </div>
      </div>

      <div className="au-block">
        <div className="au-block-title">
          <strong>Then</strong>
          <span>in this order; each step hands what it made to the next</span>
        </div>
        {draft.actions.length ? (
          <div className="au-items">
            {draft.actions.map((a, i) => (
              <ActionRow
                key={i}
                index={i}
                total={draft.actions.length}
                action={a}
                onChange={(next) => setAction(i, next)}
                onMove={(dir) => moveAction(i, dir)}
                onRemove={() => removeAction(i)}
              />
            ))}
          </div>
        ) : null}
        <div className="au-inline" style={{ maxWidth: 360 }}>
          <select
            className="select"
            value=""
            onChange={(e) => {
              if (e.target.value) addAction(e.target.value as ActionKind);
              e.target.value = "";
            }}
          >
            <option value="">Add a step…</option>
            {ACTION_ORDER.map((k) => (
              <option key={k} value={k}>
                {ACTION_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {problems.length ? (
        <ul className="au-problems">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}

      <div className="au-editor-foot">
        <button className="btn primary" disabled={problems.length > 0} onClick={onSave}>
          {draft.base ? "Save changes" : "Save automation"}
        </button>
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <label className="row" style={{ fontSize: 13 }}>
          <input type="checkbox" checked={draft.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
          On
        </label>
        <span className="au-spacer" />
        <span className="au-hint">
          Templates: <code>{"{date}"}</code> <code>{"{time}"}</code> <code>{"{title}"}</code> <code>{"{app}"}</code> <code>{"{name}"}</code>{" "}
          <code>{"{folder}"}</code> <code>{"{duration}"}</code> <code>{"{text}"}</code> <code>{"{summary}"}</code>
        </span>
      </div>
    </div>
  );
}

function TriggerFields({ trigger, onChange }: { trigger: Trigger; onChange: (t: Trigger) => void }) {
  const [extText, setExtText] = useState<string | null>(null);
  if (trigger.kind === "file-added") {
    const pick = async () => {
      const folder = await backend().pickFolder("Choose the folder to watch");
      if (folder) onChange({ ...trigger, folder });
    };
    return (
      <div className="au-fields">
        <div className="field">
          <span>Folder to watch</span>
          <div className="au-inline">
            <input className="input" readOnly value={trigger.folder} placeholder="Pick a folder…" />
            <button className="btn small" onClick={() => void pick()}>
              Pick
            </button>
          </div>
        </div>
        <label className="field">
          <span>File types (comma-separated)</span>
          <input
            className="input"
            value={extText ?? trigger.extensions.join(", ")}
            placeholder="mp3, m4a, wav"
            onChange={(e) => setExtText(e.target.value)}
            onBlur={() => {
              if (extText !== null) {
                onChange({ ...trigger, extensions: normalizeExtensions([extText]) });
                setExtText(null);
              }
            }}
          />
        </label>
        <span className="au-hint" style={{ gridColumn: "1 / -1" }}>
          Only this folder, not its subfolders. A file counts once it has stopped growing for 1.5 s, so a download in progress waits.
        </span>
      </div>
    );
  }
  if (trigger.kind === "schedule") {
    const toggleDay = (d: number) => {
      const days = trigger.days.includes(d) ? trigger.days.filter((x) => x !== d) : [...trigger.days, d].sort();
      onChange({ ...trigger, days });
    };
    return (
      <div className="au-fields">
        <label className="field" style={{ maxWidth: 160 }}>
          <span>Time</span>
          <input className="input" type="time" value={trigger.time} onChange={(e) => onChange({ ...trigger, time: e.target.value || "18:00" })} />
        </label>
        <div className="field">
          <span>Days</span>
          <div className="au-days">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <button key={d} type="button" className={`pill${trigger.days.includes(d) ? " active" : ""}`} onClick={() => toggleDay(d)}>
                {DAY_SHORT[d]}
              </button>
            ))}
          </div>
        </div>
        <span className="au-hint" style={{ gridColumn: "1 / -1" }}>
          Runs once per day, the first time the app is open after that time. The text it works on is everything you dictated that day.
        </span>
      </div>
    );
  }
  return null;
}

function SourceSelect({ value, onChange }: { value: TextSource; onChange: (v: TextSource) => void }) {
  return (
    <label className="field">
      <span>Use</span>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value as TextSource)}>
        <option value="text">the text (transcript, take, OCR)</option>
        <option value="summary">the summary (falls back to the text)</option>
      </select>
    </label>
  );
}

function ActionRow({
  index,
  total,
  action,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  total: number;
  action: Action;
  onChange: (a: Action) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const pickFolder = async (title: string): Promise<string | null> => backend().pickFolder(title);

  let fields: React.ReactNode = null;
  switch (action.kind) {
    case "summarize":
      fields = (
        <div className="au-fields">
          <label className="field">
            <span>Style</span>
            <select className="select" value={action.style} onChange={(e) => onChange({ ...action, style: e.target.value as SummaryStyle })}>
              <option value="brief">a short paragraph</option>
              <option value="bullets">bullet points</option>
              <option value="actions">action items</option>
            </select>
          </label>
          <span className="au-hint" style={{ alignSelf: "end" }}>
            Needs a language model (Settings → Intelligence). Without one the step is noted and skipped; later steps use the text.
          </span>
        </div>
      );
      break;
    case "save-text": {
      const sameFolder = action.folder === "{folder}";
      fields = (
        <div className="au-fields">
          <div className="field">
            <span>Folder</span>
            <div className="au-inline">
              <input className="input" readOnly value={sameFolder ? "next to the file" : action.folder} placeholder="Pick a folder…" />
              <button
                className="btn small"
                onClick={() =>
                  void pickFolder("Choose where to save").then((folder) => {
                    if (folder) onChange({ ...action, folder });
                  })
                }
              >
                Pick
              </button>
              <button
                className={`btn small${sameFolder ? "" : " ghost"}`}
                title="Save into the same folder as the file that triggered the rule"
                onClick={() => onChange({ ...action, folder: sameFolder ? "" : "{folder}" })}
              >
                Same folder
              </button>
            </div>
          </div>
          <label className="field">
            <span>File name</span>
            <input className="input" value={action.name} onChange={(e) => onChange({ ...action, name: e.target.value })} placeholder="{date} {title}" />
          </label>
          <label className="field">
            <span>Format</span>
            <select className="select" value={action.format} onChange={(e) => onChange({ ...action, format: e.target.value as SaveFormat })}>
              <option value="md">Markdown (.md)</option>
              <option value="txt">plain text (.txt)</option>
              <option value="srt">subtitles (.srt, needs a transcription)</option>
            </select>
          </label>
          <SourceSelect value={action.source} onChange={(source) => onChange({ ...action, source })} />
          <span className="au-hint" style={{ gridColumn: "1 / -1" }}>
            Never overwrites: a name that exists gets &quot;(2)&quot;.
          </span>
        </div>
      );
      break;
    }
    case "social-draft":
      fields = (
        <div className="au-fields">
          <SourceSelect value={action.source} onChange={(source) => onChange({ ...action, source })} />
          <label className="field">
            <span>Post text (optional template)</span>
            <input
              className="input"
              value={action.template ?? ""}
              placeholder="New video: {title} ({duration})"
              onChange={(e) => onChange({ ...action, template: e.target.value || undefined })}
            />
          </label>
          <label className="row" style={{ fontSize: 13, alignSelf: "end" }}>
            <input type="checkbox" checked={Boolean(action.queue)} onChange={(e) => onChange({ ...action, queue: e.target.checked || undefined })} />
            Put it in the next free queue slot
          </label>
          <span className="au-hint" style={{ gridColumn: "1 / -1" }}>
            Lands in social as a draft that waits for your review; a video or image the trigger produced is attached.
          </span>
        </div>
      );
      break;
    case "add-task":
    case "copy-clipboard":
      fields = (
        <div className="au-fields">
          <SourceSelect value={action.source} onChange={(source) => onChange({ ...action, source })} />
          {action.kind === "add-task" ? (
            <span className="au-hint" style={{ alignSelf: "end" }}>
              List lines become one task each; anything else becomes a single task.
            </span>
          ) : null}
        </div>
      );
      break;
    case "notify":
      fields = (
        <div className="au-fields">
          <label className="field">
            <span>Title</span>
            <input className="input" value={action.title} onChange={(e) => onChange({ ...action, title: e.target.value })} />
          </label>
          <label className="field">
            <span>Body</span>
            <input className="input" value={action.body} onChange={(e) => onChange({ ...action, body: e.target.value })} placeholder="{title} is done" />
          </label>
        </div>
      );
      break;
    case "open":
      fields = (
        <div className="au-fields">
          <div className="field">
            <span>What to open</span>
            <div className="au-inline">
              <input
                className="input"
                value={action.target}
                placeholder="https://…, a file, a folder or a program"
                onChange={(e) => onChange({ ...action, target: e.target.value })}
              />
              <button
                className="btn small"
                onClick={() =>
                  void pickAnyPath().then((path) => {
                    if (path) onChange({ ...action, target: path });
                  })
                }
              >
                Pick
              </button>
            </div>
          </div>
          <span className="au-hint" style={{ alignSelf: "end" }}>
            <code>{"{path}"}</code> is the file the rule worked on, <code>{"{folder}"}</code> its folder.
          </span>
        </div>
      );
      break;
    case "transcribe":
      fields = (
        <span className="au-hint">
          On-device, with the engine dictate uses. Audio and video files only; the text goes to the next step (and timings to a .srt).
        </span>
      );
      break;
    case "remove-fillers":
      fields = <span className="au-hint">Drops &quot;um&quot;, &quot;uh&quot; and friends from the text before the next step.</span>;
      break;
  }

  return (
    <div className="au-item">
      <div className="au-item-head">
        <span className="au-step">{index + 1}</span>
        <select className="select" value={action.kind} onChange={(e) => onChange(defaultAction(e.target.value as ActionKind))}>
          {ACTION_ORDER.map((k) => (
            <option key={k} value={k}>
              {ACTION_LABELS[k]}
            </option>
          ))}
        </select>
        <button className="icon-btn" title="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
          ↑
        </button>
        <button className="icon-btn" title="Move down" disabled={index === total - 1} onClick={() => onMove(1)}>
          ↓
        </button>
        <button className="icon-btn" title="Remove step" onClick={onRemove}>
          ×
        </button>
      </div>
      {fields}
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Recent runs                                                               */
/* ------------------------------------------------------------------------- */

const RUNS_SHOWN = 8;

function RunsList({ runs, running }: { runs: RunRecord[]; running: string | null }) {
  const [all, setAll] = useState(false);
  const shown = all ? runs : runs.slice(0, RUNS_SHOWN);

  const reveal = async (path: string) => {
    try {
      await backend().revealPath(path);
    } catch {
      /* the file may be gone; nothing to do */
    }
  };

  const clear = async () => {
    const ok = await confirmDialog({ title: "Clear run history", message: "Forget every recorded run? The rules stay.", okLabel: "Clear" });
    if (ok) await clearRuns();
  };

  return (
    <div className="au-block">
      <div className="au-block-title">
        <strong>Recent runs</strong>
        <span>
          {runs.length === 0 ? "nothing yet" : `${runs.length} kept`}
          {running ? " · one running now" : ""}
        </span>
      </div>
      {shown.length ? (
        <div className="au-runs">
          {shown.map((run) => (
            <div key={run.id} className="au-run">
              <span className={`au-dot ${run.status}`} title={run.status} />
              <div className="au-run-body">
                <span className="au-run-title">
                  <span>{run.ruleName}</span>
                  <span className="au-when">{whenLabel(run.startedAt)}</span>
                  <span className="au-when">{run.status}</span>
                </span>
                {run.notes.length ? <span className="au-run-notes">{run.notes.join(" · ")}</span> : null}
                {run.error ? <span className="au-run-error">{run.error}</span> : null}
              </div>
              <div className="au-run-side">
                <span>{msLabel(run.ms)}</span>
                {run.outputPath ? (
                  <button className="btn small ghost" title={run.outputPath} onClick={() => void reveal(run.outputPath!)}>
                    Open
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {runs.length > RUNS_SHOWN || runs.length > 0 ? (
        <div className="row">
          {runs.length > RUNS_SHOWN ? (
            <button className="btn small ghost" onClick={() => setAll((v) => !v)}>
              {all ? `Show the last ${RUNS_SHOWN}` : `Show all ${runs.length}`}
            </button>
          ) : null}
          {runs.length > 0 ? (
            <button className="btn small ghost" onClick={() => void clear()}>
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
