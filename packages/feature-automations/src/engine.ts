/**
 * The engine: subscribes to every trigger once per window, turns each event
 * into a context, runs the matching rules one at a time through the global
 * queue, records every run and keeps `rules.json` / `runs.json` in step.
 *
 * `startAutomations()` is called once from App.tsx in the main window. It is
 * idempotent, never throws out of a listener (everything ends up in a run
 * record or the log) and can be given a backend and action set for tests
 * and the browser demo.
 */

import {
  CAPTURE_SAVED_EVENT,
  DICTATION_TAKE_EVENT,
  EXPORT_FINISHED_EVENT,
  MEET_FINISHED_EVENT,
  emitToolEvent,
  onToolEvent,
  type MeetFinished,
} from "@core/events";
import { logError, logInfo } from "@core/errors";
import { realActions } from "./actions";
import { backend as defaultBackend, demoBackend } from "./api";
import type { AutomationsBackend, WatchFolder } from "./backend";
import {
  baseCtx,
  dayKey,
  describeTrigger,
  pushRun,
  scheduleDue,
  type Ctx,
  type Rule,
  type RunRecord,
  type TriggerKind,
} from "./rules";
import {
  ctxFromCapture,
  ctxFromDictation,
  ctxFromDictationDay,
  ctxFromExport,
  ctxFromFile,
  ctxFromMeet,
  ctxFromRecording,
  executeRule,
  RunQueue,
  type ActionImpls,
} from "./run";
import { useAutomationsStore } from "./store";

export interface StartOptions {
  backend?: AutomationsBackend;
  /** Replaces individual action implementations (the demo, tests). */
  actions?: Partial<ActionImpls>;
  /** How often schedules are checked; 30 s by default. */
  tickMs?: number;
  /** The clock, for tests. */
  now?: () => Date;
}

const SCHEDULE_TICK_MS = 30_000;

let started: Promise<void> | null = null;
let be: AutomationsBackend | null = null;
let impls: ActionImpls | null = null;
let now: () => Date = () => new Date();
const queue = new RunQueue();
let unsubs: (() => void)[] = [];
let timer: ReturnType<typeof setInterval> | null = null;

const rules = (): Rule[] => useAutomationsStore.getState().rules;

function ready(): { be: AutomationsBackend; impls: ActionImpls } {
  if (!be || !impls) throw new Error("automations have not started yet");
  return { be, impls };
}

export function startAutomations(options: StartOptions = {}): Promise<void> {
  if (started) return started;
  started = (async () => {
    const backend = options.backend ?? defaultBackend();
    be = backend;
    impls = { ...realActions(backend), ...(options.actions ?? {}) };
    if (options.now) now = options.now;

    const [loadedRules, loadedRuns] = await Promise.all([backend.loadRules(), backend.loadRuns()]);
    useAutomationsStore.setState({ rules: loadedRules, runs: loadedRuns, loaded: true });

    unsubs.push(queue.subscribe(() => useAutomationsStore.setState({ running: queue.active, queued: queue.size })));
    unsubs.push(onToolEvent(MEET_FINISHED_EVENT, (p) => void handleMeet(p)));
    unsubs.push(onToolEvent(EXPORT_FINISHED_EVENT, (p) => void fire("export-finished", ctxFromExport(p, now()))));
    unsubs.push(onToolEvent(CAPTURE_SAVED_EVENT, (p) => void fire("capture-saved", ctxFromCapture(p, now()))));
    unsubs.push(onToolEvent(DICTATION_TAKE_EVENT, (p) => void fire("dictation-take", ctxFromDictation(p, now()))));
    unsubs.push(backend.onRecordingFinished((id) => void handleRecording(id)));
    unsubs.push(backend.onFileAdded((e) => void fire("file-added", ctxFromFile(e.path, e.size, now()), e.ruleId)));

    await syncWatchers();
    timer = setInterval(() => void checkSchedules(), options.tickMs ?? SCHEDULE_TICK_MS);
    await checkSchedules();
    logInfo("automations", `${loadedRules.filter((r) => r.enabled).length} of ${loadedRules.length} rule(s) on`);
  })().catch((err) => {
    logError("automations", "start", err);
    started = null;
    throw err;
  });
  return started;
}

/** Undoes `startAutomations` (tests, hot reload). Runs already queued still finish. */
export function stopAutomations(): void {
  for (const un of unsubs) un();
  unsubs = [];
  if (timer) clearInterval(timer);
  timer = null;
  started = null;
  be = null;
  impls = null;
  now = () => new Date();
  useAutomationsStore.setState({ loaded: false, rules: [], runs: [], running: null, queued: 0 });
}

/** Resolves once every run queued so far has finished. */
export function automationsIdle(): Promise<void> {
  return queue.whenIdle();
}

/* ------------------------------------------------------------------------- */
/* Rules                                                                     */
/* ------------------------------------------------------------------------- */

async function persistRules(next: Rule[]): Promise<void> {
  useAutomationsStore.setState({ rules: next });
  try {
    await ready().be.saveRules(next);
  } catch (err) {
    logError("automations", "save rules", err);
  }
}

async function persistRuns(next: RunRecord[]): Promise<void> {
  useAutomationsStore.setState({ runs: next });
  try {
    await ready().be.saveRuns(next);
  } catch (err) {
    logError("automations", "save runs", err);
  }
}

export async function saveRule(rule: Rule): Promise<void> {
  const current = rules();
  const next = current.some((r) => r.id === rule.id) ? current.map((r) => (r.id === rule.id ? rule : r)) : [rule, ...current];
  await persistRules(next);
  await syncWatchers();
}

export async function deleteRule(id: string): Promise<void> {
  await persistRules(rules().filter((r) => r.id !== id));
  await syncWatchers();
}

export async function setRuleEnabled(id: string, enabled: boolean): Promise<void> {
  await persistRules(rules().map((r) => (r.id === id ? { ...r, enabled } : r)));
  await syncWatchers();
}

export async function clearRuns(): Promise<void> {
  await persistRuns([]);
}

/** Tells Rust which folders the enabled file-added rules want watched. */
async function syncWatchers(): Promise<void> {
  const folders: WatchFolder[] = [];
  for (const r of rules()) {
    if (!r.enabled || r.trigger.kind !== "file-added" || !r.trigger.folder.trim()) continue;
    folders.push({ ruleId: r.id, folder: r.trigger.folder, extensions: r.trigger.extensions });
  }
  try {
    await ready().be.watchSet(folders);
  } catch (err) {
    logError("automations", "watch folders", err);
  }
}

/* ------------------------------------------------------------------------- */
/* Running                                                                   */
/* ------------------------------------------------------------------------- */

function enqueue(ruleId: string, ctx: Ctx): Promise<RunRecord | null> {
  return queue.enqueue(ruleId, async () => {
    const rule = rules().find((r) => r.id === ruleId);
    if (!rule) return null;
    const { run } = await executeRule(rule, ctx, ready().impls, { now: () => now().getTime() });
    await record(ruleId, run);
    return run;
  });
}

async function record(ruleId: string, run: RunRecord): Promise<void> {
  await persistRules(rules().map((r) => (r.id === ruleId ? { ...r, runCount: r.runCount + 1, lastRunAt: run.startedAt } : r)));
  await persistRuns(pushRun(useAutomationsStore.getState().runs, run));
  const notes = run.notes.length ? ` — ${run.notes.join("; ")}` : "";
  if (run.status === "error") logError("automations", `run "${run.ruleName}"`, run.error ?? "failed");
  else logInfo("automations", `"${run.ruleName}" ${run.status} in ${run.ms} ms${notes}`);
}

/**
 * Queues every enabled rule with this trigger (or just `onlyRuleId`) against
 * the context. Returns how many were queued.
 */
export function fire(kind: TriggerKind, ctx: Ctx, onlyRuleId?: string): number {
  if (!be) return 0;
  const targets = rules().filter((r) => r.enabled && r.trigger.kind === kind && (!onlyRuleId || r.id === onlyRuleId));
  for (const rule of targets) void enqueue(rule.id, ctx);
  if (targets.length) logInfo("automations", `${describeTrigger(targets[0].trigger)}: ${targets.length} rule(s) queued`);
  return targets.length;
}

/**
 * Runs a rule by hand. A schedule rule gets what its tick would have given
 * it (today's dictation); anything else runs on `extra` plus the clock, so a
 * rule that needs a file or a transcript ends as "skipped" with the reason.
 */
export async function runRule(id: string, extra: Partial<Ctx> = {}): Promise<RunRecord | null> {
  const rule = rules().find((r) => r.id === id);
  if (!rule) return null;
  const base = rule.trigger.kind === "schedule" ? await dictationDayCtx(now()) : baseCtx(now());
  return enqueue(id, { ...base, ...extra });
}

/** "Test this rule on an existing file": a manual run with the file as the trigger's payload. */
export function runRuleOnFile(id: string, path: string, size?: number): Promise<RunRecord | null> {
  return enqueue(id, ctxFromFile(path, size, now()));
}

/* ------------------------------------------------------------------------- */
/* Triggers                                                                  */
/* ------------------------------------------------------------------------- */

async function handleMeet(p: MeetFinished): Promise<void> {
  let transcript: string | undefined;
  if (p.transcriptPath) {
    try {
      transcript = await ready().be.readText(p.transcriptPath);
    } catch (err) {
      logError("automations", "read transcript", err);
    }
  }
  fire("meet-finished", ctxFromMeet(p, transcript, now()));
}

async function handleRecording(projectId: string): Promise<void> {
  let ctx: Ctx;
  try {
    const info = await ready().be.recordingInfo(projectId);
    ctx = info ? ctxFromRecording(info, now()) : baseCtx(now());
  } catch (err) {
    logError("automations", "recording info", err);
    ctx = baseCtx(now());
  }
  fire("recording-finished", ctx);
}

async function dictationDayCtx(current: Date): Promise<Ctx> {
  try {
    const { getHistory } = await import("@feature-dictation/history");
    return ctxFromDictationDay(getHistory(), current);
  } catch {
    return baseCtx(current);
  }
}

/**
 * One pass over the schedule rules: a rule whose time has passed today and
 * that has not fired today is marked as fired *before* it runs, so a crash
 * mid-run cannot make it fire twice.
 */
export async function checkSchedules(): Promise<number> {
  if (!be) return 0;
  const current = now();
  const due = rules().filter(
    (r) => r.enabled && r.trigger.kind === "schedule" && scheduleDue(r.trigger, r.lastFiredDay, current) && !queue.has(r.id),
  );
  if (!due.length) return 0;
  const day = dayKey(current);
  await persistRules(rules().map((r) => (due.some((d) => d.id === r.id) ? { ...r, lastFiredDay: day } : r)));
  const ctx = await dictationDayCtx(current);
  for (const rule of due) void enqueue(rule.id, ctx);
  return due.length;
}

/* ------------------------------------------------------------------------- */
/* Dev: pretend a tool just did something                                    */
/* ------------------------------------------------------------------------- */

export type SimulatedTrigger = Exclude<TriggerKind, "manual" | "schedule">;

/** Fires a canned event of the given kind through the same path the real tool would use. */
export async function simulateTrigger(kind: SimulatedTrigger): Promise<void> {
  const appData = await ready().be.appDataDir();
  switch (kind) {
    case "meet-finished":
      emitToolEvent(MEET_FINISHED_EVENT, {
        id: "sim",
        dir: `${appData}\\meet\\sim`,
        title: "Weekly sync",
        durationMs: 1_845_000,
        transcriptPath: `${appData}\\meet\\sim\\transcript.md`,
      });
      return;
    case "export-finished":
      emitToolEvent(EXPORT_FINISHED_EVENT, {
        projectId: "sim",
        path: "C:\\Users\\demo\\Videos\\launch demo.mp4",
        mime: "video/mp4",
        durationMs: 30_000,
      });
      return;
    case "capture-saved":
      emitToolEvent(CAPTURE_SAVED_EVENT, {
        id: "sim",
        path: `${appData}\\capture\\sim.png`,
        width: 1280,
        height: 720,
        ocrText: "Invoice 2026/09/11 - total 1 240,00 PLN - due in 14 days",
      });
      return;
    case "dictation-take":
      emitToolEvent(DICTATION_TAKE_EVENT, {
        text: "Um, remind me to, uh, send the deck to Ana tomorrow morning.",
        ms: 3200,
        app: "Code.exe",
        target: "app",
        engine: "parakeet",
      });
      return;
    case "recording-finished":
      await handleRecording("sim-project");
      return;
    case "file-added": {
      const demo = demoBackend();
      if (demo) demo.simulateFileAdded("team call.mp3");
      else fire("file-added", ctxFromFile("C:\\Users\\demo\\Downloads\\team call.mp3", 18_400_000, now()));
      return;
    }
  }
}
