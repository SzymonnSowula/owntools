/**
 * Automations — the model.
 *
 * A rule is one trigger, optional conditions and an ordered list of actions.
 * Data flows through a `Ctx`: the trigger fills what it knows (a path, a
 * transcript, a title, the foreground app), every action reads what it needs
 * and adds what it made (`text` from a transcription, `summary` from the
 * model, `savedPath` from a file write), and templates such as
 * `{date} {title}` are filled from the same object.
 *
 * Everything in this file is pure and unit-tested; the engine (`run.ts`,
 * `engine.ts`) is what talks to the world.
 */

export type Trigger =
  | { kind: "recording-finished" }
  | { kind: "export-finished" }
  | { kind: "meet-finished" }
  | { kind: "capture-saved" }
  | { kind: "dictation-take" }
  | { kind: "file-added"; folder: string; extensions: string[] }
  | { kind: "schedule"; time: string; days: number[] }
  | { kind: "manual" };

export type TriggerKind = Trigger["kind"];

export type ConditionField = "app" | "title" | "path" | "text" | "durationMs" | "ext";
export type ConditionOp = "contains" | "matches" | "gt" | "lt" | "eq";

export interface Condition {
  field: ConditionField;
  op: ConditionOp;
  value: string | number;
}

export type SummaryStyle = "brief" | "bullets" | "actions";
export type TextSource = "text" | "summary";
export type SaveFormat = "md" | "txt" | "srt";

export type Action =
  | { kind: "transcribe" }
  | { kind: "summarize"; style: SummaryStyle }
  | { kind: "save-text"; folder: string; name: string; format: SaveFormat; source: TextSource }
  | {
      kind: "social-draft";
      channelIds?: string[];
      source: TextSource;
      queue?: boolean;
      /** Optional template for the post itself ("New video: {title}"); the source text is used when empty. */
      template?: string;
    }
  | { kind: "add-task"; source: TextSource }
  | { kind: "copy-clipboard"; source: TextSource }
  | { kind: "notify"; title: string; body: string }
  | { kind: "open"; target: string }
  | { kind: "remove-fillers" };

export type ActionKind = Action["kind"];

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: Trigger;
  conditions: Condition[];
  actions: Action[];
  createdAt: number;
  lastRunAt?: number;
  runCount: number;
  /** `YYYY-MM-DD` of the last day a schedule trigger fired, so it fires once per day. */
  lastFiredDay?: string;
}

export interface Cue {
  /** Seconds. */
  start: number;
  end: number;
  text: string;
}

/** What a run knows. Triggers fill it, actions read from and add to it. */
export interface Ctx {
  /** Local `YYYY-MM-DD`. */
  date: string;
  /** Local `HH:MM`. */
  time: string;
  path?: string;
  text?: string;
  summary?: string;
  cues?: Cue[];
  title?: string;
  app?: string;
  durationMs?: number;
  /** Lower-case, without the dot. */
  ext?: string;
  /** Where `save-text` put its file. */
  savedPath?: string;
  /** Bytes of the file behind `path`, when the trigger knew. */
  size?: number;
}

export type RunStatus = "ok" | "skipped" | "error";

export interface RunRecord {
  id: string;
  ruleId: string;
  ruleName: string;
  startedAt: number;
  ms: number;
  status: RunStatus;
  notes: string[];
  error?: string;
  /** A file the run produced (or acted on), for the "open" button. */
  outputPath?: string;
}

export const RUNS_LIMIT = 200;

/* ------------------------------------------------------------------------- */
/* Ids and time                                                              */
/* ------------------------------------------------------------------------- */

export function uid(prefix = "r"): string {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rnd}`;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Local `YYYY-MM-DD` — the key a schedule fires once per. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Local `HH:MM`. */
export function clockTime(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** A fresh context for a run starting now. */
export function baseCtx(now: Date = new Date()): Ctx {
  return { date: dayKey(now), time: clockTime(now) };
}

export function formatDuration(ms: number | undefined): string {
  if (!ms || !Number.isFinite(ms) || ms < 0) return "";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/* ------------------------------------------------------------------------- */
/* Paths (pure string work; both separators, since a path may come from Rust) */
/* ------------------------------------------------------------------------- */

export function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const i = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return i < 0 ? trimmed : trimmed.slice(i + 1);
}

export function dirName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const i = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return i < 0 ? "" : trimmed.slice(0, i);
}

/** File name without its extension. */
export function fileStem(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** Lower-case extension without the dot; "" when there is none. */
export function extOf(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * Makes a template result safe as a single file name: no separators or
 * reserved characters, no leading/trailing dots or spaces, at most 120
 * characters. Never empty — a rule that produced nothing still writes a file.
 */
export function safeFileName(raw: string, fallback = "untitled"): string {
  const cleaned = raw
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\p{Cc}/gu, "-")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .slice(0, 120)
    .replace(/[\s.]+$/g, "");
  return cleaned || fallback;
}

/* ------------------------------------------------------------------------- */
/* Templates                                                                 */
/* ------------------------------------------------------------------------- */

export const TEMPLATE_VARS = [
  "date",
  "time",
  "title",
  "app",
  "name",
  "ext",
  "path",
  "folder",
  "duration",
  "text",
  "summary",
] as const;

/**
 * Fills `{date}`, `{time}`, `{title}`, `{app}`, `{name}` (file stem), `{ext}`,
 * `{path}`, `{folder}` (the file's directory), `{duration}`, `{text}` and
 * `{summary}` from the context. Unknown or empty variables become nothing and
 * the surrounding whitespace collapses, so "{date} {title}" without a title
 * is still "2026-09-11" rather than "2026-09-11 ".
 */
export function fillTemplate(template: string, ctx: Ctx): string {
  const values: Record<string, string> = {
    date: ctx.date,
    time: ctx.time,
    title: ctx.title ?? "",
    app: ctx.app ?? "",
    name: ctx.path ? fileStem(ctx.path) : "",
    ext: ctx.ext ?? (ctx.path ? extOf(ctx.path) : ""),
    path: ctx.path ?? "",
    folder: ctx.path ? dirName(ctx.path) : "",
    duration: formatDuration(ctx.durationMs),
    text: ctx.text ?? "",
    summary: ctx.summary ?? "",
  };
  return template
    .replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? values[key] : whole))
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** The text an action reads: the summary when asked for and present, else the text. */
export function pickSource(ctx: Ctx, source: TextSource): { text: string; fellBack: boolean } {
  if (source === "summary") {
    if (ctx.summary?.trim()) return { text: ctx.summary, fellBack: false };
    return { text: ctx.text ?? "", fellBack: Boolean(ctx.text?.trim()) };
  }
  return { text: ctx.text ?? "", fellBack: false };
}

/* ------------------------------------------------------------------------- */
/* Conditions                                                                */
/* ------------------------------------------------------------------------- */

function fieldValue(ctx: Ctx, field: ConditionField): string | number | undefined {
  switch (field) {
    case "app":
      return ctx.app;
    case "title":
      return ctx.title;
    case "path":
      return ctx.path;
    case "text":
      return ctx.text;
    case "durationMs":
      return ctx.durationMs;
    case "ext":
      return ctx.ext ?? (ctx.path ? extOf(ctx.path) : undefined);
  }
}

export function matchesCondition(c: Condition, ctx: Ctx): boolean {
  const actual = fieldValue(ctx, c.field);
  switch (c.op) {
    case "contains":
      return actual !== undefined && String(actual).toLowerCase().includes(String(c.value).toLowerCase());
    case "matches": {
      if (actual === undefined) return false;
      try {
        return new RegExp(String(c.value), "i").test(String(actual));
      } catch {
        return false;
      }
    }
    case "gt":
    case "lt": {
      const a = Number(actual);
      const b = Number(c.value);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      return c.op === "gt" ? a > b : a < b;
    }
    case "eq": {
      if (actual === undefined) return false;
      const a = Number(actual);
      const b = Number(c.value);
      if (Number.isFinite(a) && Number.isFinite(b) && String(c.value).trim() !== "") return a === b;
      return String(actual).toLowerCase() === String(c.value).toLowerCase();
    }
  }
}

/** Every condition has to hold; no conditions means the rule always applies. */
export function matchesAll(conditions: Condition[], ctx: Ctx): boolean {
  return conditions.every((c) => matchesCondition(c, ctx));
}

/* ------------------------------------------------------------------------- */
/* Schedules                                                                 */
/* ------------------------------------------------------------------------- */

/**
 * Whether a schedule trigger is due: today is one of its days, the clock has
 * passed its time, and it has not fired today. "Passed" rather than "equals"
 * so a tick that lands at 18:00:29 or an app opened at 20:00 still runs the
 * 18:00 rule once — and never twice.
 */
export function scheduleDue(
  trigger: Extract<Trigger, { kind: "schedule" }>,
  lastFiredDay: string | undefined,
  now: Date,
): boolean {
  const today = dayKey(now);
  if (lastFiredDay === today) return false;
  if (trigger.days.length > 0 && !trigger.days.includes(now.getDay())) return false;
  const [h, m] = trigger.time.split(":").map((n) => Number(n));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return false;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return nowMinutes >= h * 60 + m;
}

/* ------------------------------------------------------------------------- */
/* Describing rules (one line each, used for names and the list)             */
/* ------------------------------------------------------------------------- */

export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function describeDays(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 0 || sorted.length === 7) return "every day";
  if (sorted.join(",") === "1,2,3,4,5") return "weekdays";
  if (sorted.join(",") === "0,6") return "weekends";
  return sorted.map((d) => DAY_SHORT[d] ?? "?").join(", ");
}

export function describeTrigger(t: Trigger): string {
  switch (t.kind) {
    case "recording-finished":
      return "When a recording finishes";
    case "export-finished":
      return "When an export finishes";
    case "meet-finished":
      return "When a meeting finishes";
    case "capture-saved":
      return "When a capture is saved";
    case "dictation-take":
      return "After a dictation take";
    case "file-added": {
      const where = t.folder ? baseName(t.folder) || t.folder : "a folder";
      const what = t.extensions.length ? ` (${t.extensions.join(", ")})` : "";
      return `When a file lands in ${where}${what}`;
    }
    case "schedule":
      return `At ${t.time}, ${describeDays(t.days)}`;
    case "manual":
      return "When you run it";
  }
}

export function describeAction(a: Action): string {
  switch (a.kind) {
    case "transcribe":
      return "transcribe";
    case "summarize":
      return a.style === "brief" ? "summarize" : a.style === "bullets" ? "summarize as bullets" : "pull out action items";
    case "save-text":
      return `save .${a.format}${a.folder ? ` in ${baseName(a.folder) || a.folder}` : ""}`;
    case "social-draft":
      return a.queue ? "queue a post" : "draft a post";
    case "add-task":
      return "add tasks";
    case "copy-clipboard":
      return "copy to clipboard";
    case "notify":
      return "notify";
    case "open":
      return a.target ? `open ${baseName(a.target) || a.target}` : "open";
    case "remove-fillers":
      return "remove fillers";
  }
}

/** "When a meeting finishes → summarize as bullets, save .md in Notes" */
export function suggestName(rule: Pick<Rule, "trigger" | "actions">): string {
  const actions = rule.actions.map(describeAction).join(", ");
  return actions ? `${describeTrigger(rule.trigger)} → ${actions}` : describeTrigger(rule.trigger);
}

/* ------------------------------------------------------------------------- */
/* Construction and normalisation                                            */
/* ------------------------------------------------------------------------- */

export function newRule(partial: Partial<Rule> & Pick<Rule, "trigger" | "actions">): Rule {
  const rule: Rule = {
    id: partial.id ?? uid(),
    name: partial.name?.trim() || suggestName(partial),
    enabled: partial.enabled ?? true,
    trigger: partial.trigger,
    conditions: partial.conditions ?? [],
    actions: partial.actions,
    createdAt: partial.createdAt ?? Date.now(),
    runCount: partial.runCount ?? 0,
  };
  if (partial.lastRunAt) rule.lastRunAt = partial.lastRunAt;
  if (partial.lastFiredDay) rule.lastFiredDay = partial.lastFiredDay;
  return rule;
}

const TRIGGER_KINDS: TriggerKind[] = [
  "recording-finished",
  "export-finished",
  "meet-finished",
  "capture-saved",
  "dictation-take",
  "file-added",
  "schedule",
  "manual",
];
const ACTION_KINDS: ActionKind[] = [
  "transcribe",
  "summarize",
  "save-text",
  "social-draft",
  "add-task",
  "copy-clipboard",
  "notify",
  "open",
  "remove-fillers",
];
const FIELDS: ConditionField[] = ["app", "title", "path", "text", "durationMs", "ext"];
const OPS: ConditionOp[] = ["contains", "matches", "gt", "lt", "eq"];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

export function normalizeTrigger(raw: unknown): Trigger | null {
  if (!isRecord(raw) || !TRIGGER_KINDS.includes(raw.kind as TriggerKind)) return null;
  switch (raw.kind as TriggerKind) {
    case "file-added":
      return {
        kind: "file-added",
        folder: str(raw.folder),
        extensions: normalizeExtensions(strList(raw.extensions)),
      };
    case "schedule": {
      const time = /^\d{2}:\d{2}$/.test(str(raw.time)) ? str(raw.time) : "18:00";
      const days = Array.isArray(raw.days)
        ? raw.days.filter((d): d is number => typeof d === "number" && d >= 0 && d <= 6)
        : [1, 2, 3, 4, 5];
      return { kind: "schedule", time, days };
    }
    default:
      return { kind: raw.kind as Exclude<TriggerKind, "file-added" | "schedule"> };
  }
}

/** "MP3, .wav m4a" → ["mp3", "wav", "m4a"]. */
export function normalizeExtensions(list: string[]): string[] {
  const out = new Set<string>();
  for (const item of list) {
    for (const part of item.split(/[\s,;]+/)) {
      const ext = part.trim().replace(/^\.+/, "").toLowerCase();
      if (ext) out.add(ext);
    }
  }
  return [...out];
}

export function normalizeCondition(raw: unknown): Condition | null {
  if (!isRecord(raw)) return null;
  if (!FIELDS.includes(raw.field as ConditionField) || !OPS.includes(raw.op as ConditionOp)) return null;
  const value = typeof raw.value === "number" ? raw.value : str(raw.value);
  return { field: raw.field as ConditionField, op: raw.op as ConditionOp, value };
}

export function normalizeAction(raw: unknown): Action | null {
  if (!isRecord(raw) || !ACTION_KINDS.includes(raw.kind as ActionKind)) return null;
  const source = (raw.source === "summary" ? "summary" : "text") as TextSource;
  switch (raw.kind as ActionKind) {
    case "transcribe":
    case "remove-fillers":
      return { kind: raw.kind as "transcribe" | "remove-fillers" };
    case "summarize": {
      const style = (["brief", "bullets", "actions"] as SummaryStyle[]).includes(raw.style as SummaryStyle)
        ? (raw.style as SummaryStyle)
        : "bullets";
      return { kind: "summarize", style };
    }
    case "save-text": {
      const format = (["md", "txt", "srt"] as SaveFormat[]).includes(raw.format as SaveFormat)
        ? (raw.format as SaveFormat)
        : "md";
      return { kind: "save-text", folder: str(raw.folder), name: str(raw.name, "{date} {title}"), format, source };
    }
    case "social-draft": {
      const action: Action = { kind: "social-draft", source };
      const channelIds = strList(raw.channelIds);
      if (channelIds.length) action.channelIds = channelIds;
      if (raw.queue === true) action.queue = true;
      if (str(raw.template).trim()) action.template = str(raw.template);
      return action;
    }
    case "add-task":
      return { kind: "add-task", source };
    case "copy-clipboard":
      return { kind: "copy-clipboard", source };
    case "notify":
      return { kind: "notify", title: str(raw.title, "owntools"), body: str(raw.body) };
    case "open":
      return { kind: "open", target: str(raw.target) };
  }
}

/** Folds whatever `rules.json` holds onto the current shape; `null` for anything that is not a rule. */
export function normalizeRule(raw: unknown): Rule | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id) return null;
  const trigger = normalizeTrigger(raw.trigger);
  if (!trigger) return null;
  const actions = Array.isArray(raw.actions) ? raw.actions.map(normalizeAction).filter((a): a is Action => a !== null) : [];
  const conditions = Array.isArray(raw.conditions)
    ? raw.conditions.map(normalizeCondition).filter((c): c is Condition => c !== null)
    : [];
  return newRule({
    id: raw.id,
    name: str(raw.name),
    enabled: raw.enabled !== false,
    trigger,
    conditions,
    actions,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    lastRunAt: typeof raw.lastRunAt === "number" ? raw.lastRunAt : undefined,
    runCount: typeof raw.runCount === "number" ? raw.runCount : 0,
    lastFiredDay: typeof raw.lastFiredDay === "string" ? raw.lastFiredDay : undefined,
  });
}

export function normalizeRules(raw: unknown): Rule[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeRule).filter((r): r is Rule => r !== null);
}

export function normalizeRun(raw: unknown): RunRecord | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.ruleId !== "string") return null;
  const status = (["ok", "skipped", "error"] as RunStatus[]).includes(raw.status as RunStatus)
    ? (raw.status as RunStatus)
    : "error";
  const run: RunRecord = {
    id: raw.id,
    ruleId: raw.ruleId,
    ruleName: str(raw.ruleName),
    startedAt: typeof raw.startedAt === "number" ? raw.startedAt : 0,
    ms: typeof raw.ms === "number" ? raw.ms : 0,
    status,
    notes: strList(raw.notes),
  };
  if (typeof raw.error === "string") run.error = raw.error;
  if (typeof raw.outputPath === "string") run.outputPath = raw.outputPath;
  return run;
}

export function normalizeRuns(raw: unknown): RunRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeRun)
    .filter((r): r is RunRecord => r !== null)
    .slice(0, RUNS_LIMIT);
}

/** Newest first, capped. */
export function pushRun(runs: RunRecord[], run: RunRecord): RunRecord[] {
  return [run, ...runs].slice(0, RUNS_LIMIT);
}

/* ------------------------------------------------------------------------- */
/* What a rule needs before it can be saved                                  */
/* ------------------------------------------------------------------------- */

/** Human-readable problems; an empty list means the rule is complete. */
export function validateRule(rule: Pick<Rule, "trigger" | "actions" | "conditions">): string[] {
  const problems: string[] = [];
  if (rule.trigger.kind === "file-added" && !rule.trigger.folder.trim()) problems.push("Pick the folder to watch.");
  if (rule.trigger.kind === "file-added" && rule.trigger.extensions.length === 0)
    problems.push("Say which file types to watch for.");
  if (rule.trigger.kind === "schedule" && !/^\d{2}:\d{2}$/.test(rule.trigger.time)) problems.push("Pick a time.");
  if (rule.actions.length === 0) problems.push("Add at least one action.");
  rule.actions.forEach((a, i) => {
    const n = i + 1;
    if (a.kind === "save-text" && !a.folder.trim() && a.folder !== "{folder}")
      problems.push(`Action ${n}: pick a folder to save into.`);
    if (a.kind === "save-text" && !a.name.trim()) problems.push(`Action ${n}: give the file a name.`);
    if (a.kind === "open" && !a.target.trim()) problems.push(`Action ${n}: say what to open.`);
    if (a.kind === "notify" && !a.title.trim() && !a.body.trim()) problems.push(`Action ${n}: write the notification.`);
  });
  rule.conditions.forEach((c, i) => {
    if (String(c.value).trim() === "") problems.push(`Condition ${i + 1}: give it a value.`);
    if (c.op === "matches") {
      try {
        new RegExp(String(c.value));
      } catch {
        problems.push(`Condition ${i + 1}: that is not a valid pattern.`);
      }
    }
  });
  return problems;
}

/* ------------------------------------------------------------------------- */
/* Templates — the four starters                                             */
/* ------------------------------------------------------------------------- */

export interface RuleTemplate {
  id: string;
  title: string;
  blurb: string;
  /** `folder` fields left empty are picked by the person before saving. */
  make: () => Pick<Rule, "name" | "trigger" | "conditions" | "actions">;
}

export const TEMPLATES: RuleTemplate[] = [
  {
    id: "meeting-note",
    title: "Every meeting → a Markdown note",
    blurb: "Summarize the transcript and file it in your Notes folder.",
    make: () => ({
      name: "Meeting → note",
      trigger: { kind: "meet-finished" },
      conditions: [],
      actions: [
        { kind: "summarize", style: "bullets" },
        { kind: "save-text", folder: "", name: "{date} {title}", format: "md", source: "summary" },
      ],
    }),
  },
  {
    id: "export-draft",
    title: "Every export → a draft post",
    blurb: "The rendered video lands in social as a draft, ready to caption.",
    make: () => ({
      name: "Export → draft post",
      trigger: { kind: "export-finished" },
      conditions: [],
      actions: [{ kind: "social-draft", source: "text", template: "New video: {title} ({duration})" }],
    }),
  },
  {
    id: "downloads-transcript",
    title: "Audio in Downloads → a transcript next to it",
    blurb: "Watch a folder for audio and video; every new file gets a .txt beside it.",
    make: () => ({
      name: "Downloads → transcript",
      trigger: { kind: "file-added", folder: "", extensions: ["mp3", "m4a", "wav", "ogg", "flac", "mp4", "webm"] },
      conditions: [],
      actions: [
        { kind: "transcribe" },
        { kind: "save-text", folder: "{folder}", name: "{name}", format: "txt", source: "text" },
      ],
    }),
  },
  {
    id: "daily-dictation",
    title: "Daily at 18:00 → today's dictation as a note",
    blurb: "Everything you dictated today, one Markdown file, every weekday evening.",
    make: () => ({
      name: "Daily dictation note",
      trigger: { kind: "schedule", time: "18:00", days: [1, 2, 3, 4, 5] },
      conditions: [],
      actions: [{ kind: "save-text", folder: "", name: "{date} dictation", format: "md", source: "text" }],
    }),
  },
];

/* ------------------------------------------------------------------------- */
/* Small pure helpers the actions lean on                                    */
/* ------------------------------------------------------------------------- */

const EXECUTABLE_EXT = new Set(["exe", "lnk", "url", "app", "bat", "cmd", "com"]);

/**
 * How the launcher should treat an `open` target: a program runs (`app`),
 * everything else — a web address, a document, a folder — goes through the
 * shell's open verb (`url`), which is what opens a .md in its editor and a
 * folder in Explorer or Finder.
 */
export function openKindFor(target: string): "app" | "url" {
  const t = target.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !/^[a-z]:[\\/]/i.test(t)) return "url";
  const ext = extOf(t);
  if (EXECUTABLE_EXT.has(ext)) return "app";
  if (!ext && !/[\\/]/.test(t)) return "app";
  return "url";
}

/**
 * Task titles out of a text: list lines (`- `, `* `, `• `, `1.`, `[ ]`) one
 * task each, otherwise the whole text as one. Capped at 20 tasks of 140
 * characters, blank and duplicate lines dropped.
 */
export function taskTitles(text: string, max = 20): string[] {
  const lines = text.split(/\r?\n/);
  const items: string[] = [];
  for (const line of lines) {
    const m = /^\s*(?:[-*•▪◦]|\d+[.)]|\[[ xX]?\])\s+(.*)$/.exec(line);
    if (m) items.push(m[1]);
  }
  const source = items.length ? items : [text.replace(/\s+/g, " ")];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of source) {
    const title = raw
      .replace(/^\[[ xX]?\]\s*/, "")
      .replace(/^\*\*(.*)\*\*$/, "$1")
      .replace(/[\s.;,:]+$/, "")
      .trim()
      .slice(0, 140);
    const key = title.toLowerCase();
    if (!title || seen.has(key)) continue;
    seen.add(key);
    out.push(title);
    if (out.length >= max) break;
  }
  return out;
}

/** `path` is `root` or inside it; separators and case do not matter (Windows, and macOS by default, ignore case). */
export function isUnder(path: string, root: string): boolean {
  const norm = (s: string) => s.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  const p = norm(path);
  const r = norm(root);
  return r.length > 0 && (p === r || p.startsWith(`${r}\\`));
}
