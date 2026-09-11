/**
 * Running one rule: conditions → actions in order, each reading from and
 * writing into the shared `Ctx`, the outcome folded into a `RunRecord` that
 * `runs.json` keeps. Action *implementations* are injected (`ActionImpls`),
 * so this file is pure and the tests drive a whole rule with fakes; the real
 * set lives in `actions.ts`.
 *
 * Also here: the global run queue (one run at a time — a transcription is
 * heavy and two at once are slower than two in a row) and the pure part of
 * turning each tool event into a context.
 */

import type {
  CaptureSaved,
  DictationTake,
  ExportFinished,
  MeetFinished,
} from "@core/events";
import {
  baseCtx,
  describeAction,
  extOf,
  fileStem,
  matchesAll,
  uid,
  type Action,
  type ActionKind,
  type Ctx,
  type Rule,
  type RunRecord,
} from "./rules";

export type ActionOf<K extends ActionKind> = Extract<Action, { kind: K }>;

export interface RunTools {
  /** Adds a line to the run's notes ("summary skipped: no model"). */
  note(message: string): void;
  rule: Rule;
}

/** An action reads `ctx`, does its thing, and returns what it adds to the context. */
export type ActionImpl<K extends ActionKind> = (
  action: ActionOf<K>,
  ctx: Ctx,
  tools: RunTools,
) => Promise<Partial<Ctx> | void>;

export type ActionImpls = { [K in ActionKind]: ActionImpl<K> };

/**
 * Thrown by an action when there is nothing to work on (no text to save, no
 * file to transcribe). The run ends as `skipped` with the reason in its
 * notes — not an error, nothing went wrong, the moment just carried nothing.
 */
export class SkipRun extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SkipRun";
  }
}

function runAction(impls: ActionImpls, action: Action, ctx: Ctx, tools: RunTools): Promise<Partial<Ctx> | void> {
  switch (action.kind) {
    case "transcribe":
      return impls.transcribe(action, ctx, tools);
    case "summarize":
      return impls.summarize(action, ctx, tools);
    case "save-text":
      return impls["save-text"](action, ctx, tools);
    case "social-draft":
      return impls["social-draft"](action, ctx, tools);
    case "add-task":
      return impls["add-task"](action, ctx, tools);
    case "copy-clipboard":
      return impls["copy-clipboard"](action, ctx, tools);
    case "notify":
      return impls.notify(action, ctx, tools);
    case "open":
      return impls.open(action, ctx, tools);
    case "remove-fillers":
      return impls["remove-fillers"](action, ctx, tools);
  }
}

export interface ExecuteOptions {
  /** Clock, for tests. */
  now?: () => number;
}

/**
 * Runs the rule against a context and returns the record. Never throws: an
 * action's error becomes `status: "error"` with the action named in the
 * message, `SkipRun` becomes `status: "skipped"`.
 */
export async function executeRule(
  rule: Rule,
  input: Ctx,
  impls: ActionImpls,
  options: ExecuteOptions = {},
): Promise<{ run: RunRecord; ctx: Ctx }> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const notes: string[] = [];
  const tools: RunTools = { note: (m) => notes.push(m), rule };
  let ctx: Ctx = { ...input };
  const finish = (status: RunRecord["status"], error?: string): { run: RunRecord; ctx: Ctx } => {
    const run: RunRecord = {
      id: uid("run"),
      ruleId: rule.id,
      ruleName: rule.name,
      startedAt,
      ms: Math.max(0, now() - startedAt),
      status,
      notes,
    };
    if (error) run.error = error;
    const output = ctx.savedPath ?? ctx.path;
    if (output) run.outputPath = output;
    return { run, ctx };
  };

  if (!matchesAll(rule.conditions, ctx)) {
    notes.push("Conditions did not match.");
    return finish("skipped");
  }
  if (rule.actions.length === 0) {
    notes.push("The rule has no actions.");
    return finish("skipped");
  }

  for (const action of rule.actions) {
    try {
      const patch = await runAction(impls, action, ctx, tools);
      if (patch) ctx = { ...ctx, ...patch };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof SkipRun) {
        notes.push(`${describeAction(action)}: ${message}`);
        return finish("skipped");
      }
      return finish("error", `${describeAction(action)}: ${message}`);
    }
  }
  return finish("ok");
}

/* ------------------------------------------------------------------------- */
/* The queue                                                                 */
/* ------------------------------------------------------------------------- */

/**
 * Runs jobs one after another, in arrival order, and never lets one job's
 * failure stop the next. `has(ruleId)` says whether a rule is queued or
 * running, so a 30-second schedule tick does not pile the same rule up.
 */
export class RunQueue {
  private chain: Promise<void> = Promise.resolve();
  private waiting = new Map<string, number>();
  private current: string | null = null;
  private listeners = new Set<() => void>();

  get active(): string | null {
    return this.current;
  }

  get size(): number {
    let n = this.current ? 1 : 0;
    for (const count of this.waiting.values()) n += count;
    return n;
  }

  has(ruleId: string): boolean {
    return this.current === ruleId || (this.waiting.get(ruleId) ?? 0) > 0;
  }

  /** Fires when the active job changes. */
  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  enqueue<T>(ruleId: string, job: () => Promise<T>): Promise<T> {
    this.waiting.set(ruleId, (this.waiting.get(ruleId) ?? 0) + 1);
    const next = this.chain.then(async () => {
      const left = (this.waiting.get(ruleId) ?? 1) - 1;
      if (left > 0) this.waiting.set(ruleId, left);
      else this.waiting.delete(ruleId);
      this.current = ruleId;
      this.emit();
      try {
        return await job();
      } finally {
        this.current = null;
        this.emit();
      }
    });
    // The chain itself must never reject, or every later job would be skipped.
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /** Resolves once everything queued so far has finished (failed or not). */
  whenIdle(): Promise<void> {
    return this.chain;
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }
}

/* ------------------------------------------------------------------------- */
/* Contexts from tool events (the pure part)                                 */
/* ------------------------------------------------------------------------- */

export function ctxFromMeet(p: MeetFinished, transcript: string | undefined, now?: Date): Ctx {
  const ctx = baseCtx(now);
  ctx.title = p.title || "Meeting";
  ctx.durationMs = p.durationMs;
  if (p.transcriptPath) {
    ctx.path = p.transcriptPath;
    ctx.ext = extOf(p.transcriptPath);
  }
  if (transcript?.trim()) ctx.text = transcript;
  return ctx;
}

export function ctxFromExport(p: ExportFinished, now?: Date): Ctx {
  const ctx = baseCtx(now);
  ctx.path = p.path;
  ctx.ext = extOf(p.path);
  ctx.title = fileStem(p.path);
  ctx.durationMs = p.durationMs;
  return ctx;
}

export function ctxFromCapture(p: CaptureSaved, now?: Date): Ctx {
  const ctx = baseCtx(now);
  ctx.path = p.path;
  ctx.ext = extOf(p.path);
  ctx.title = fileStem(p.path);
  if (p.ocrText?.trim()) ctx.text = p.ocrText;
  return ctx;
}

export function ctxFromDictation(p: DictationTake, now?: Date): Ctx {
  const ctx = baseCtx(now);
  ctx.text = p.text;
  ctx.durationMs = p.ms;
  if (p.app) ctx.app = p.app;
  ctx.title = "Dictation";
  return ctx;
}

export function ctxFromFile(path: string, size?: number, now?: Date): Ctx {
  const ctx = baseCtx(now);
  ctx.path = path;
  ctx.ext = extOf(path);
  ctx.title = fileStem(path);
  if (typeof size === "number") ctx.size = size;
  return ctx;
}

export function ctxFromRecording(
  info: { title: string; durationMs: number; path?: string },
  now?: Date,
): Ctx {
  const ctx = baseCtx(now);
  ctx.title = info.title || "Recording";
  ctx.durationMs = info.durationMs;
  if (info.path) {
    ctx.path = info.path;
    ctx.ext = extOf(info.path);
  }
  return ctx;
}

/** Today's dictation takes as one text, newest last, each on its own paragraph. */
export function ctxFromDictationDay(takes: { at: number; text: string }[], now: Date = new Date()): Ctx {
  const ctx = baseCtx(now);
  const day = ctx.date;
  const todays = takes
    .filter((t) => baseCtx(new Date(t.at)).date === day && t.text.trim())
    .sort((a, b) => a.at - b.at);
  if (todays.length) {
    ctx.text = todays.map((t) => `${baseCtx(new Date(t.at)).time}  ${t.text.trim()}`).join("\n\n");
    ctx.durationMs = 0;
  }
  ctx.title = "Dictation";
  return ctx;
}
