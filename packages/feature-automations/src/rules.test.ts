import { describe, expect, it } from "vitest";
import {
  baseCtx,
  dayKey,
  describeAction,
  describeTrigger,
  extOf,
  fileStem,
  fillTemplate,
  isUnder,
  matchesAll,
  matchesCondition,
  newRule,
  normalizeExtensions,
  normalizeRule,
  normalizeRules,
  normalizeRuns,
  openKindFor,
  pickSource,
  pushRun,
  RUNS_LIMIT,
  safeFileName,
  scheduleDue,
  suggestName,
  taskTitles,
  TEMPLATES,
  validateRule,
  type Ctx,
  type RunRecord,
} from "./rules";

const ctx = (extra: Partial<Ctx> = {}): Ctx => ({ date: "2026-09-11", time: "14:02", ...extra });

describe("templates", () => {
  it("fills every variable from the context", () => {
    const c = ctx({
      title: "Standup",
      app: "slack.exe",
      path: "C:\\Users\\me\\Downloads\\call recording.mp3",
      durationMs: 65_000,
      text: "hello",
      summary: "hi",
    });
    expect(fillTemplate("{date} {time} {title} {app}", c)).toBe("2026-09-11 14:02 Standup slack.exe");
    expect(fillTemplate("{name}.{ext}", c)).toBe("call recording.mp3");
    expect(fillTemplate("{folder}", c)).toBe("C:\\Users\\me\\Downloads");
    expect(fillTemplate("{duration}", c)).toBe("1:05");
    expect(fillTemplate("{text}/{summary}", c)).toBe("hello/hi");
  });

  it("drops empty variables and the whitespace around them", () => {
    expect(fillTemplate("{date} {title}", ctx())).toBe("2026-09-11");
    expect(fillTemplate("{date}  -  {title}", ctx())).toBe("2026-09-11 -");
  });

  it("leaves unknown placeholders alone", () => {
    expect(fillTemplate("{date} {nope}", ctx())).toBe("2026-09-11 {nope}");
  });

  it("makes file names safe without touching spaces", () => {
    expect(safeFileName("2026-09-11 14:02 Standup")).toBe("2026-09-11 14-02 Standup");
    expect(safeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe("a-b-c-d-e-f-g-h-i-j");
    expect(safeFileName("  ...dots and spaces...  ")).toBe("dots and spaces");
    expect(safeFileName("")).toBe("untitled");
    expect(safeFileName("x".repeat(300)).length).toBe(120);
  });

  it("picks the summary when asked and present, else falls back to the text", () => {
    expect(pickSource(ctx({ text: "t", summary: "s" }), "summary")).toEqual({ text: "s", fellBack: false });
    expect(pickSource(ctx({ text: "t" }), "summary")).toEqual({ text: "t", fellBack: true });
    expect(pickSource(ctx({ text: "t", summary: "s" }), "text")).toEqual({ text: "t", fellBack: false });
    expect(pickSource(ctx(), "summary")).toEqual({ text: "", fellBack: false });
  });

  it("splits paths on either separator", () => {
    expect(fileStem("/home/me/a.b.mp3")).toBe("a.b");
    expect(extOf("C:\\x\\Y.MP3")).toBe("mp3");
    expect(extOf("noext")).toBe("");
    expect(fileStem(".hidden")).toBe(".hidden");
  });
});

describe("conditions", () => {
  const c = ctx({ app: "Slack.exe", title: "Weekly sync", path: "C:\\Downloads\\call.MP3", durationMs: 90_000 });

  it("contains is case-insensitive", () => {
    expect(matchesCondition({ field: "app", op: "contains", value: "slack" }, c)).toBe(true);
    expect(matchesCondition({ field: "title", op: "contains", value: "monthly" }, c)).toBe(false);
  });

  it("matches takes a regular expression and never throws", () => {
    expect(matchesCondition({ field: "title", op: "matches", value: "^weekly" }, c)).toBe(true);
    expect(matchesCondition({ field: "title", op: "matches", value: "(" }, c)).toBe(false);
  });

  it("gt / lt compare numbers, in ms", () => {
    expect(matchesCondition({ field: "durationMs", op: "gt", value: 60_000 }, c)).toBe(true);
    expect(matchesCondition({ field: "durationMs", op: "lt", value: "60000" }, c)).toBe(false);
    expect(matchesCondition({ field: "durationMs", op: "gt", value: "abc" }, c)).toBe(false);
  });

  it("ext is derived from the path and compared without case", () => {
    expect(matchesCondition({ field: "ext", op: "eq", value: "mp3" }, c)).toBe(true);
    expect(matchesCondition({ field: "ext", op: "eq", value: ".wav" }, c)).toBe(false);
  });

  it("a missing field never matches", () => {
    expect(matchesCondition({ field: "text", op: "contains", value: "" }, c)).toBe(false);
    expect(matchesCondition({ field: "text", op: "eq", value: "" }, c)).toBe(false);
  });

  it("no conditions means always", () => {
    expect(matchesAll([], c)).toBe(true);
    expect(
      matchesAll(
        [
          { field: "app", op: "contains", value: "slack" },
          { field: "durationMs", op: "gt", value: 100_000 },
        ],
        c,
      ),
    ).toBe(false);
  });
});

describe("schedules", () => {
  const trigger = { kind: "schedule" as const, time: "18:00", days: [1, 2, 3, 4, 5] };
  // 2026-09-11 is a Friday.
  const at = (h: number, m: number) => new Date(2026, 8, 11, h, m, 0);

  it("is not due before the time", () => {
    expect(scheduleDue(trigger, undefined, at(17, 59))).toBe(false);
  });

  it("is due at and after the time, once per day", () => {
    expect(scheduleDue(trigger, undefined, at(18, 0))).toBe(true);
    expect(scheduleDue(trigger, undefined, at(20, 30))).toBe(true);
    expect(scheduleDue(trigger, "2026-09-11", at(20, 30))).toBe(false);
    expect(scheduleDue(trigger, "2026-09-10", at(18, 0))).toBe(true);
  });

  it("respects the days", () => {
    const saturday = new Date(2026, 8, 12, 19, 0, 0);
    expect(scheduleDue(trigger, undefined, saturday)).toBe(false);
    expect(scheduleDue({ ...trigger, days: [] }, undefined, saturday)).toBe(true);
  });

  it("dayKey is local and zero-padded", () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(baseCtx(new Date(2026, 8, 11, 9, 7)).time).toBe("09:07");
  });
});

describe("describing and naming", () => {
  it("names a rule from its parts", () => {
    const rule = newRule({
      trigger: { kind: "meet-finished" },
      actions: [
        { kind: "summarize", style: "bullets" },
        { kind: "save-text", folder: "C:\\Users\\me\\Notes", name: "{date}", format: "md", source: "summary" },
      ],
    });
    expect(rule.name).toBe("When a meeting finishes → summarize as bullets, save .md in Notes");
    expect(suggestName({ trigger: { kind: "manual" }, actions: [] })).toBe("When you run it");
  });

  it("describes triggers and actions in one line", () => {
    expect(describeTrigger({ kind: "file-added", folder: "C:\\Users\\me\\Downloads", extensions: ["mp3", "wav"] })).toBe(
      "When a file lands in Downloads (mp3, wav)",
    );
    expect(describeTrigger({ kind: "schedule", time: "18:00", days: [1, 2, 3, 4, 5] })).toBe("At 18:00, weekdays");
    expect(describeTrigger({ kind: "schedule", time: "09:00", days: [0, 6] })).toBe("At 09:00, weekends");
    expect(describeTrigger({ kind: "schedule", time: "09:00", days: [1, 3] })).toBe("At 09:00, Mon, Wed");
    expect(describeAction({ kind: "social-draft", source: "text", queue: true })).toBe("queue a post");
    expect(describeAction({ kind: "open", target: "https://example.com/x" })).toBe("open x");
  });
});

describe("normalising stored rules", () => {
  it("folds a partial or old file onto the current shape", () => {
    const rules = normalizeRules([
      {
        id: "a",
        trigger: { kind: "file-added", folder: "D:\\in", extensions: ["MP3", ".wav, ogg"] },
        actions: [{ kind: "save-text", folder: "D:\\out" }, { kind: "nonsense" }, { kind: "summarize", style: "weird" }],
        conditions: [{ field: "app", op: "contains", value: "x" }, { field: "bogus", op: "eq", value: 1 }],
        runCount: "7",
      },
      { id: "", trigger: { kind: "manual" } },
      { id: "b", trigger: { kind: "schedule", time: "7:00" } },
      "garbage",
    ]);
    expect(rules).toHaveLength(2);
    const [a, b] = rules;
    expect(a.trigger).toEqual({ kind: "file-added", folder: "D:\\in", extensions: ["mp3", "wav", "ogg"] });
    expect(a.actions).toEqual([
      { kind: "save-text", folder: "D:\\out", name: "{date} {title}", format: "md", source: "text" },
      { kind: "summarize", style: "bullets" },
    ]);
    expect(a.conditions).toEqual([{ field: "app", op: "contains", value: "x" }]);
    expect(a.runCount).toBe(0);
    expect(a.enabled).toBe(true);
    expect(a.name).toContain("When a file lands in in");
    expect(b.trigger).toEqual({ kind: "schedule", time: "18:00", days: [1, 2, 3, 4, 5] });
  });

  it("round-trips a complete rule", () => {
    const rule = newRule({
      id: "z",
      name: "Mine",
      enabled: false,
      trigger: { kind: "schedule", time: "07:30", days: [0, 6] },
      conditions: [{ field: "durationMs", op: "gt", value: 5 }],
      actions: [{ kind: "notify", title: "t", body: "b" }],
      createdAt: 5,
      lastRunAt: 9,
      runCount: 3,
      lastFiredDay: "2026-09-10",
    });
    expect(normalizeRule(JSON.parse(JSON.stringify(rule)))).toEqual(rule);
  });

  it("normalises extensions from free text", () => {
    expect(normalizeExtensions(["MP3, .m4a; wav", "  ", "..ogg"])).toEqual(["mp3", "m4a", "wav", "ogg"]);
  });

  it("caps runs and drops broken records", () => {
    const run = (i: number): RunRecord => ({
      id: `run${i}`,
      ruleId: "r",
      ruleName: "R",
      startedAt: i,
      ms: 1,
      status: "ok",
      notes: [],
    });
    let runs: RunRecord[] = [];
    for (let i = 0; i < RUNS_LIMIT + 20; i++) runs = pushRun(runs, run(i));
    expect(runs).toHaveLength(RUNS_LIMIT);
    expect(runs[0].id).toBe(`run${RUNS_LIMIT + 19}`);
    expect(normalizeRuns([run(1), { id: "x" }, null, { ...run(2), status: "odd" }])).toMatchObject([
      { id: "run1" },
      { id: "run2", status: "error" },
    ]);
  });
});

describe("validation and templates", () => {
  it("lists what a rule still needs", () => {
    expect(
      validateRule({
        trigger: { kind: "file-added", folder: "", extensions: [] },
        conditions: [{ field: "title", op: "matches", value: "(" }],
        actions: [],
      }),
    ).toEqual([
      "Pick the folder to watch.",
      "Say which file types to watch for.",
      "Add at least one action.",
      "Condition 1: that is not a valid pattern.",
    ]);
    expect(
      validateRule({
        trigger: { kind: "manual" },
        conditions: [],
        actions: [{ kind: "save-text", folder: "{folder}", name: "{name}", format: "txt", source: "text" }],
      }),
    ).toEqual([]);
  });

  it("the four starters are complete except for the folders the person picks", () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(["meeting-note", "export-draft", "downloads-transcript", "daily-dictation"]);
    for (const t of TEMPLATES) {
      const problems = validateRule(t.make());
      for (const p of problems) expect(p).toMatch(/pick (the|a) folder/i);
    }
  });
});

describe("helpers the actions lean on", () => {
  it("sends programs to the launcher and everything else through the shell's open verb", () => {
    expect(openKindFor("https://example.com/x")).toBe("url");
    expect(openKindFor("mailto:me@example.com")).toBe("url");
    expect(openKindFor("C:\\Users\\me\\Notes\\2026-09-11.md")).toBe("url");
    expect(openKindFor("C:\\Users\\me\\Notes")).toBe("url");
    expect(openKindFor("C:\\Program Files\\Obsidian\\Obsidian.exe")).toBe("app");
    expect(openKindFor("C:\\Users\\me\\Desktop\\Slack.lnk")).toBe("app");
    expect(openKindFor("/Applications/Notes.app")).toBe("app");
    expect(openKindFor("code")).toBe("app");
  });

  it("turns list lines into task titles, or the whole text into one", () => {
    expect(
      taskTitles("Action items:\n- Send the deck to Ana.\n* Book the room\n1. Follow up with legal;\n[ ] Ship it\n- send the deck to ana\n\n"),
    ).toEqual(["Send the deck to Ana", "Book the room", "Follow up with legal", "Ship it"]);
    expect(taskTitles("Call the dentist\ntomorrow morning.")).toEqual(["Call the dentist tomorrow morning"]);
    expect(taskTitles("   ")).toEqual([]);
    expect(taskTitles(Array.from({ length: 30 }, (_, i) => `- item ${i}`).join("\n"))).toHaveLength(20);
    expect(taskTitles(`- ${"x".repeat(300)}`)[0]).toHaveLength(140);
  });

  it("isUnder ignores separators and case and refuses siblings", () => {
    expect(isUnder("C:/Users/me/AppData/Roaming/app/automations/tmp/a.mp3", "c:\\users\\ME\\AppData\\Roaming\\app\\")).toBe(true);
    expect(isUnder("C:\\Users\\me\\AppData", "C:\\Users\\me\\AppData")).toBe(true);
    expect(isUnder("C:\\Users\\me\\AppData2\\x", "C:\\Users\\me\\AppData")).toBe(false);
    expect(isUnder("D:\\x", "")).toBe(false);
  });
});
