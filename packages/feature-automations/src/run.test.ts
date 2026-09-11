import { describe, expect, it } from "vitest";
import { newRule, type Ctx, type Rule } from "./rules";
import {
  ctxFromDictation,
  ctxFromDictationDay,
  ctxFromExport,
  ctxFromMeet,
  executeRule,
  RunQueue,
  SkipRun,
  type ActionImpls,
} from "./run";

const ctx = (extra: Partial<Ctx> = {}): Ctx => ({ date: "2026-09-11", time: "14:02", ...extra });

/** Fakes that record what they were handed and add predictable things to the context. */
function fakes(log: string[]): ActionImpls {
  return {
    transcribe: async (_a, c) => {
      log.push(`transcribe ${c.path ?? "-"}`);
      if (!c.path) throw new SkipRun("nothing to transcribe");
      return { text: `transcript of ${c.path}` };
    },
    summarize: async (a, c, tools) => {
      log.push(`summarize ${a.style} <${c.text ?? ""}>`);
      if (a.style === "actions") {
        tools.note("summary skipped: no model");
        return;
      }
      return { summary: `summary(${c.text ?? ""})` };
    },
    "save-text": async (a, c) => {
      const text = a.source === "summary" ? c.summary ?? c.text : c.text;
      log.push(`save ${a.name} <${text ?? ""}>`);
      if (!text) throw new SkipRun("no text to save");
      return { savedPath: `${a.folder}\\${a.name}.${a.format}` };
    },
    "social-draft": async () => {
      throw new Error("social is not wired up yet.");
    },
    "add-task": async (_a, c) => {
      log.push(`task <${c.summary ?? c.text ?? ""}>`);
    },
    "copy-clipboard": async () => {
      log.push("clipboard");
    },
    notify: async (a) => {
      log.push(`notify ${a.title}`);
    },
    open: async (a) => {
      log.push(`open ${a.target}`);
    },
    "remove-fillers": async (_a, c) => ({ text: (c.text ?? "").replace(/\bum\b ?/g, "") }),
  };
}

const twoStep: Rule = newRule({
  id: "two",
  trigger: { kind: "file-added", folder: "D:\\in", extensions: ["mp3"] },
  actions: [
    { kind: "transcribe" },
    { kind: "save-text", folder: "D:\\out", name: "{name}", format: "txt", source: "text" },
  ],
});

describe("executeRule", () => {
  it("passes the context from one action to the next and records the output", async () => {
    const log: string[] = [];
    const clock = [1000, 1250];
    const { run, ctx: out } = await executeRule(twoStep, ctx({ path: "D:\\in\\call.mp3" }), fakes(log), {
      now: () => clock.shift() ?? 1250,
    });
    expect(log).toEqual(["transcribe D:\\in\\call.mp3", "save {name} <transcript of D:\\in\\call.mp3>"]);
    expect(out.text).toBe("transcript of D:\\in\\call.mp3");
    expect(run).toMatchObject({
      ruleId: "two",
      ruleName: twoStep.name,
      status: "ok",
      startedAt: 1000,
      ms: 250,
      outputPath: "D:\\out\\{name}.txt",
      notes: [],
    });
  });

  it("skips when the conditions do not match, without running anything", async () => {
    const log: string[] = [];
    const rule = newRule({ ...twoStep, id: "cond", conditions: [{ field: "ext", op: "eq", value: "wav" }] });
    const { run } = await executeRule(rule, ctx({ path: "D:\\in\\call.mp3" }), fakes(log));
    expect(log).toEqual([]);
    expect(run.status).toBe("skipped");
    expect(run.notes).toEqual(["Conditions did not match."]);
  });

  it("turns SkipRun into a skipped run with the action named", async () => {
    const log: string[] = [];
    const { run } = await executeRule(twoStep, ctx(), fakes(log));
    expect(run.status).toBe("skipped");
    expect(run.notes).toEqual(["transcribe: nothing to transcribe"]);
    expect(log).toEqual(["transcribe -"]);
  });

  it("turns a thrown error into an error run and stops the chain", async () => {
    const log: string[] = [];
    const rule = newRule({
      id: "err",
      trigger: { kind: "export-finished" },
      actions: [
        { kind: "social-draft", source: "text" },
        { kind: "notify", title: "never", body: "" },
      ],
    });
    const { run } = await executeRule(rule, ctx({ path: "C:\\v.mp4" }), fakes(log));
    expect(run.status).toBe("error");
    expect(run.error).toBe("draft a post: social is not wired up yet.");
    expect(run.outputPath).toBe("C:\\v.mp4");
    expect(log).toEqual([]);
  });

  it("lets an action degrade gracefully with a note and a fallback source", async () => {
    const log: string[] = [];
    const rule = newRule({
      id: "meet",
      trigger: { kind: "meet-finished" },
      actions: [
        { kind: "summarize", style: "actions" },
        { kind: "save-text", folder: "N", name: "{date} {title}", format: "md", source: "summary" },
      ],
    });
    const { run } = await executeRule(rule, ctx({ text: "we talked", title: "Sync" }), fakes(log));
    expect(run.status).toBe("ok");
    expect(run.notes).toEqual(["summary skipped: no model"]);
    expect(log[1]).toBe("save {date} {title} <we talked>");
  });

  it("a rule without actions is skipped", async () => {
    const rule = newRule({ id: "empty", trigger: { kind: "manual" }, actions: [] });
    const { run } = await executeRule(rule, ctx(), fakes([]));
    expect(run.status).toBe("skipped");
  });
});

describe("RunQueue", () => {
  const tick = () => new Promise<void>((r) => setTimeout(r, 0));

  it("runs jobs one at a time in arrival order and survives a failure", async () => {
    const q = new RunQueue();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = q.enqueue("a", async () => {
      order.push("a:start");
      await gate;
      order.push("a:end");
    });
    const second = q.enqueue("b", async () => {
      order.push("b");
      throw new Error("boom");
    });
    const third = q.enqueue("a", async () => {
      order.push("a2");
    });
    await tick();
    expect(q.active).toBe("a");
    expect(q.has("a")).toBe(true);
    expect(q.has("b")).toBe(true);
    expect(q.has("zzz")).toBe(false);
    expect(q.size).toBe(3);
    expect(order).toEqual(["a:start"]);
    release();
    await first;
    await expect(second).rejects.toThrow("boom");
    await third;
    expect(order).toEqual(["a:start", "a:end", "b", "a2"]);
    expect(q.active).toBeNull();
    expect(q.size).toBe(0);
    expect(q.has("a")).toBe(false);
  });

  it("tells subscribers when the active job changes", async () => {
    const q = new RunQueue();
    const seen: (string | null)[] = [];
    q.subscribe(() => seen.push(q.active));
    await q.enqueue("x", async () => {});
    expect(seen).toEqual(["x", null]);
  });
});

describe("contexts from events", () => {
  const now = new Date(2026, 8, 11, 14, 2);

  it("meet: title, duration, transcript path and text", () => {
    const c = ctxFromMeet(
      { id: "m1", dir: "C:\\AppData\\meet\\m1", title: "Sync", durationMs: 1000, transcriptPath: "C:\\AppData\\meet\\m1\\transcript.md" },
      "hello there",
      now,
    );
    expect(c).toMatchObject({ date: "2026-09-11", time: "14:02", title: "Sync", durationMs: 1000, ext: "md", text: "hello there" });
    expect(ctxFromMeet({ id: "m", dir: "", title: "", durationMs: 0 }, "   ", now).text).toBeUndefined();
  });

  it("export: the file's stem is the title", () => {
    const c = ctxFromExport({ projectId: "p", path: "C:\\out\\launch demo.mp4", mime: "video/mp4", durationMs: 30_000 }, now);
    expect(c).toMatchObject({ path: "C:\\out\\launch demo.mp4", ext: "mp4", title: "launch demo", durationMs: 30_000 });
  });

  it("dictation: text, app and length", () => {
    const c = ctxFromDictation({ text: "note to self", ms: 2500, app: "Code.exe", target: "app", engine: "parakeet" }, now);
    expect(c).toMatchObject({ text: "note to self", durationMs: 2500, app: "Code.exe", title: "Dictation" });
  });

  it("a day's dictation: only today's takes, in order, timestamped", () => {
    const at = (h: number, m: number) => new Date(2026, 8, 11, h, m).getTime();
    const c = ctxFromDictationDay(
      [
        { at: at(11, 5), text: "second" },
        { at: at(9, 30), text: "first" },
        { at: new Date(2026, 8, 10, 12, 0).getTime(), text: "yesterday" },
        { at: at(12, 0), text: "   " },
      ],
      now,
    );
    expect(c.text).toBe("09:30  first\n\n11:05  second");
    expect(ctxFromDictationDay([], now).text).toBeUndefined();
  });
});
