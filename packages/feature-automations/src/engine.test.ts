import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DICTATION_TAKE_EVENT,
  EXPORT_FINISHED_EVENT,
  MEET_FINISHED_EVENT,
  emitToolEvent,
} from "@core/events";
import type { AutomationsBackend, FileAdded, WatchFolder } from "./backend";
import {
  automationsIdle,
  checkSchedules,
  deleteRule,
  runRule,
  runRuleOnFile,
  saveRule,
  setRuleEnabled,
  startAutomations,
  stopAutomations,
} from "./engine";
import { newRule, type Rule, type RunRecord } from "./rules";
import { SkipRun, type ActionImpls } from "./run";
import { useAutomationsStore } from "./store";

function fakeBackend(rules: Rule[]) {
  const saved = { rules, runs: [] as RunRecord[], watch: [] as WatchFolder[][], written: [] as string[] };
  const listeners = new Set<(e: FileAdded) => void>();
  const backend: AutomationsBackend = {
    loadRules: async () => saved.rules,
    saveRules: async (r) => {
      saved.rules = r;
    },
    loadRuns: async () => saved.runs,
    saveRuns: async (r) => {
      saved.runs = r;
    },
    watchSet: async (f) => {
      saved.watch.push(f);
    },
    onFileAdded: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    onRecordingFinished: () => () => {},
    recordingInfo: async () => null,
    pickFolder: async () => null,
    allowFolder: async () => {},
    writeText: async (folder, name) => {
      saved.written.push(`${folder}\\${name}`);
      return { path: `${folder}\\${name}`, name };
    },
    importFile: async (path) => ({ path, size: 1 }),
    removeTemp: async () => {},
    listFolder: async () => [],
    readText: async () => "the transcript",
    readBytes: async () => new Uint8Array(),
    appDataDir: async () => "C:\\AppData",
    revealPath: async () => {},
  };
  return { backend, saved, fileAdded: (e: FileAdded) => listeners.forEach((cb) => cb(e)) };
}

function fakeActions(log: string[]): Partial<ActionImpls> {
  return {
    notify: async (a, ctx, tools) => {
      log.push(`notify:${a.title}:${ctx.title ?? ""}`);
      tools.note("notified");
    },
    transcribe: async (_a, ctx) => {
      if (!ctx.path) throw new SkipRun("no file");
      return { text: `t:${ctx.path}` };
    },
    "save-text": async (a, ctx, tools) => {
      if (!ctx.text) throw new SkipRun("no text");
      log.push(`save:${ctx.text}`);
      tools.note(`saved ${a.name}`);
      return { savedPath: `${a.folder}\\${a.name}.${a.format}` };
    },
  };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi);

beforeEach(() => stopAutomations());
afterEach(() => stopAutomations());

describe("engine", () => {
  it("runs the enabled rules for an event, records the run and counts it", async () => {
    const rules = [
      newRule({ id: "exp", trigger: { kind: "export-finished" }, actions: [{ kind: "notify", title: "Exported", body: "{title}" }] }),
      newRule({ id: "off", enabled: false, trigger: { kind: "export-finished" }, actions: [{ kind: "notify", title: "never", body: "" }] }),
      newRule({ id: "dict", trigger: { kind: "dictation-take" }, actions: [{ kind: "notify", title: "Dictated", body: "" }] }),
    ];
    const { backend, saved } = fakeBackend(rules);
    const log: string[] = [];
    let clock = at(2026, 9, 11, 14, 2).getTime();
    await startAutomations({ backend, actions: fakeActions(log), tickMs: 1e9, now: () => new Date(clock) });
    expect(useAutomationsStore.getState().loaded).toBe(true);

    emitToolEvent(EXPORT_FINISHED_EVENT, { projectId: "p", path: "C:\\out\\launch demo.mp4", mime: "video/mp4", durationMs: 30_000 });
    clock += 250;
    await automationsIdle();

    expect(log).toEqual(["notify:Exported:launch demo"]);
    const { runs, rules: after } = useAutomationsStore.getState();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ ruleId: "exp", status: "ok", notes: ["notified"], outputPath: "C:\\out\\launch demo.mp4" });
    expect(after.find((r) => r.id === "exp")).toMatchObject({ runCount: 1, lastRunAt: runs[0].startedAt });
    expect(after.find((r) => r.id === "off")?.runCount).toBe(0);
    expect(saved.runs).toHaveLength(1);
    expect(saved.rules.find((r) => r.id === "exp")?.runCount).toBe(1);

    emitToolEvent(DICTATION_TAKE_EVENT, { text: "hello", ms: 900, app: "Code.exe", target: "app", engine: "parakeet" });
    await automationsIdle();
    expect(log).toEqual(["notify:Exported:launch demo", "notify:Dictated:Dictation"]);
    expect(useAutomationsStore.getState().runs[0].ruleId).toBe("dict");
  });

  it("reads a meeting's transcript before running", async () => {
    const rules = [
      newRule({
        id: "meet",
        trigger: { kind: "meet-finished" },
        actions: [{ kind: "save-text", folder: "N", name: "{date} {title}", format: "md", source: "text" }],
      }),
    ];
    const { backend } = fakeBackend(rules);
    const log: string[] = [];
    await startAutomations({ backend, actions: fakeActions(log), tickMs: 1e9 });
    emitToolEvent(MEET_FINISHED_EVENT, { id: "m", dir: "D", title: "Sync", durationMs: 5, transcriptPath: "D\\transcript.md" });
    await flush();
    await automationsIdle();
    expect(log).toEqual(["save:the transcript"]);
    expect(useAutomationsStore.getState().runs[0]).toMatchObject({ status: "ok", outputPath: "N\\{date} {title}.md" });
  });

  it("fires a schedule once per day, and again the next day", async () => {
    const rules = [
      newRule({
        id: "daily",
        trigger: { kind: "schedule", time: "14:00", days: [1, 2, 3, 4, 5] },
        actions: [{ kind: "notify", title: "Daily", body: "" }],
      }),
    ];
    const { backend, saved } = fakeBackend(rules);
    const log: string[] = [];
    let clock = at(2026, 9, 11, 14, 2); // Friday
    await startAutomations({ backend, actions: fakeActions(log), tickMs: 1e9, now: () => clock });
    await automationsIdle();
    expect(log).toEqual(["notify:Daily:Dictation"]);
    expect(saved.rules[0].lastFiredDay).toBe("2026-09-11");

    clock = at(2026, 9, 11, 18, 30);
    expect(await checkSchedules()).toBe(0);
    clock = at(2026, 9, 12, 15, 0); // Saturday: not one of its days
    expect(await checkSchedules()).toBe(0);
    clock = at(2026, 9, 14, 13, 59); // Monday, too early
    expect(await checkSchedules()).toBe(0);
    clock = at(2026, 9, 14, 14, 5);
    expect(await checkSchedules()).toBe(1);
    await automationsIdle();
    expect(log).toHaveLength(2);
    expect(useAutomationsStore.getState().rules[0].lastFiredDay).toBe("2026-09-14");
    expect(useAutomationsStore.getState().rules[0].runCount).toBe(2);
  });

  it("a watched file reaches only the rule the watcher named, and flows through two actions", async () => {
    const rules = [
      newRule({
        id: "a",
        trigger: { kind: "file-added", folder: "D:\\a", extensions: ["mp3"] },
        actions: [{ kind: "transcribe" }, { kind: "save-text", folder: "{folder}", name: "{name}", format: "txt", source: "text" }],
      }),
      newRule({
        id: "b",
        trigger: { kind: "file-added", folder: "D:\\b", extensions: [] },
        actions: [{ kind: "notify", title: "B", body: "" }],
      }),
    ];
    const { backend, saved, fileAdded } = fakeBackend(rules);
    const log: string[] = [];
    await startAutomations({ backend, actions: fakeActions(log), tickMs: 1e9 });
    expect(saved.watch.at(-1)).toEqual([
      { ruleId: "a", folder: "D:\\a", extensions: ["mp3"] },
      { ruleId: "b", folder: "D:\\b", extensions: [] },
    ]);

    fileAdded({ ruleId: "a", path: "D:\\a\\call.mp3", size: 10 });
    await automationsIdle();
    expect(log).toEqual(["save:t:D:\\a\\call.mp3"]);
    const run = useAutomationsStore.getState().runs[0];
    expect(run).toMatchObject({ ruleId: "a", status: "ok", outputPath: "{folder}\\{name}.txt" });
    expect(useAutomationsStore.getState().rules.find((r) => r.id === "b")?.runCount).toBe(0);
  });

  it("saving, disabling and deleting a rule re-syncs the watched folders", async () => {
    const { backend, saved } = fakeBackend([]);
    await startAutomations({ backend, actions: fakeActions([]), tickMs: 1e9 });
    expect(saved.watch.at(-1)).toEqual([]);

    const rule = newRule({
      id: "w",
      trigger: { kind: "file-added", folder: "D:\\in", extensions: ["wav"] },
      actions: [{ kind: "transcribe" }],
    });
    await saveRule(rule);
    expect(saved.rules.map((r) => r.id)).toEqual(["w"]);
    expect(saved.watch.at(-1)).toEqual([{ ruleId: "w", folder: "D:\\in", extensions: ["wav"] }]);

    await setRuleEnabled("w", false);
    expect(saved.watch.at(-1)).toEqual([]);
    await setRuleEnabled("w", true);
    expect(saved.watch.at(-1)).toHaveLength(1);

    await saveRule({ ...rule, name: "Renamed" });
    expect(saved.rules).toHaveLength(1);
    expect(saved.rules[0].name).toBe("Renamed");

    await deleteRule("w");
    expect(saved.rules).toEqual([]);
    expect(saved.watch.at(-1)).toEqual([]);
  });

  it("running by hand returns the record, honestly skipped when the moment carries nothing", async () => {
    const rules = [
      newRule({
        id: "m",
        trigger: { kind: "meet-finished" },
        actions: [{ kind: "save-text", folder: "N", name: "x", format: "md", source: "text" }],
      }),
      newRule({
        id: "f",
        trigger: { kind: "file-added", folder: "D:\\in", extensions: ["mp3"] },
        actions: [{ kind: "transcribe" }, { kind: "save-text", folder: "N", name: "{name}", format: "txt", source: "text" }],
      }),
    ];
    const { backend } = fakeBackend(rules);
    const log: string[] = [];
    await startAutomations({ backend, actions: fakeActions(log), tickMs: 1e9 });

    const skipped = await runRule("m");
    expect(skipped?.status).toBe("skipped");
    expect(skipped?.notes[0]).toMatch(/no text$/);

    const ok = await runRuleOnFile("f", "D:\\in\\old take.mp3", 99);
    expect(ok).toMatchObject({ status: "ok", outputPath: "N\\{name}.txt" });
    expect(log).toEqual(["save:t:D:\\in\\old take.mp3"]);
    expect(await runRule("nope")).toBeNull();
  });
});
