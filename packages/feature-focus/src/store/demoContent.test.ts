import { describe, expect, it } from "vitest";
import type { AppData } from "../types";
import { stripDemoContent } from "./demoContent";
import { migrate } from "./persist";
import { seedState } from "./seed";

/** What the Polish seed (before 2026-08-31) left in a first workspace, plus the person's own things. */
function polishSeededWorkspace(): AppData {
  const base = seedState();
  return {
    ...base,
    version: 2 as unknown as 3,
    lists: [
      { id: "inbox", name: "Skrzynka", builtin: "inbox" },
      { id: "today", name: "Dziś", builtin: "today" },
      { id: "later", name: "Później", builtin: "later" },
      { id: "l-own", name: "Dziś wieczorem" },
    ],
    tasks: [
      {
        id: "t-demo",
        title: "Dokończyć plan tygodnia i wybrać jedno MIT",
        listId: "today",
        priority: 3,
        done: false,
        subtasks: [{ id: "s1", title: "Przejrzeć kalendarz", done: true }],
        createdAt: "2026-08-22T08:00:00.000Z",
        mit: true,
      },
      {
        id: "t-own",
        title: "Zadzwonić do księgowej",
        listId: "inbox",
        priority: 1,
        done: false,
        subtasks: [],
        createdAt: "2026-09-01T08:00:00.000Z",
        mit: false,
      },
    ],
    notes: [
      {
        id: "n-demo",
        content: "Telefon w drugim pokoju. Szum deszczu. Timer 50/10. Po sesji — krótki spacer.",
        color: "mist",
        x: 0,
        y: 0,
        z: 1,
        pinned: false,
        archived: false,
        createdAt: "2026-08-22T08:00:00.000Z",
        updatedAt: "2026-08-22T08:00:00.000Z",
      },
    ],
    habits: [
      { id: "h1", name: "Ruch", checks: {}, createdAt: "2026-08-22T08:00:00.000Z" },
      { id: "h2", name: "Czytanie", checks: {}, createdAt: "2026-08-22T08:00:00.000Z" },
      { id: "h3", name: "Woda", checks: {}, createdAt: "2026-08-22T08:00:00.000Z" },
      { id: "h4", name: "Medytacja", checks: {}, createdAt: "2026-09-01T08:00:00.000Z" },
    ],
    planner: [
      { id: "p-demo", date: "2026-08-22", start: "09:00", end: "11:00", title: "Głęboka praca", done: false },
      { id: "p-own", date: "2026-09-02", start: "10:00", end: "11:00", title: "Głęboka praca", done: false },
    ],
    timer: { ...base.timer, sessionName: "Głęboka praca" },
    settings: { ...base.settings, scrollGuardEnabled: true, scrollGuardTaskId: "t-demo" },
  };
}

describe("stripDemoContent", () => {
  it("takes out the seeded tasks, notes, habits and plan blocks, and nothing of the person's", () => {
    const data = stripDemoContent(polishSeededWorkspace());
    expect(data.tasks.map((t) => t.id)).toEqual(["t-own"]);
    expect(data.notes).toEqual([]);
    expect(data.habits.map((h) => h.name)).toEqual(["Medytacja"]);
    // the same title at other times is somebody's own plan
    expect(data.planner.map((b) => b.id)).toEqual(["p-own"]);
  });

  it("renames the built-in lists to English but leaves a list the person named", () => {
    const data = stripDemoContent(polishSeededWorkspace());
    expect(data.lists.map((l) => l.name)).toEqual(["Inbox", "Today", "Later", "Dziś wieczorem"]);
  });

  it("disarms a scroll guard that was waiting on a demo task", () => {
    const data = stripDemoContent(polishSeededWorkspace());
    expect(data.settings).toMatchObject({ scrollGuardTaskId: null, scrollGuardEnabled: false });
    expect(data.timer.sessionName).toBe("Deep work");
  });

  it("keeps habits that only share a name with one of the demo ones", () => {
    const own = { ...polishSeededWorkspace(), habits: [{ id: "h3", name: "Woda", checks: {}, createdAt: "2026-09-01T08:00:00.000Z" }] };
    expect(stripDemoContent(own).habits.map((h) => h.name)).toEqual(["Woda"]);
  });

  it("also clears the English demo set", () => {
    const english: AppData = {
      ...seedState(),
      tasks: [
        {
          id: "t",
          title: "Finish the weekly plan and pick one MIT",
          listId: "today",
          priority: 3,
          done: false,
          subtasks: [],
          createdAt: "2026-09-01T08:00:00.000Z",
          mit: true,
        },
      ],
      habits: ["Movement", "Reading", "Water"].map((name, i) => ({ id: `h${i}`, name, checks: {}, createdAt: "x" })),
    };
    const data = stripDemoContent(english);
    expect(data.tasks).toEqual([]);
    expect(data.habits).toEqual([]);
  });
});

describe("migrate and the demo content", () => {
  it("runs the clean-up for data saved before version 3", () => {
    const data = migrate(JSON.parse(JSON.stringify(polishSeededWorkspace())) as Record<string, unknown>);
    expect(data.version).toBe(3);
    expect(data.tasks.map((t) => t.id)).toEqual(["t-own"]);
  });

  it("never touches version 3 data, where a task with that title is the person's own", () => {
    const v3 = { ...polishSeededWorkspace(), version: 3 };
    const data = migrate(JSON.parse(JSON.stringify(v3)) as Record<string, unknown>);
    expect(data.tasks.map((t) => t.id)).toEqual(["t-demo", "t-own"]);
  });

  it("starts a first workspace empty", () => {
    const fresh = seedState();
    expect([fresh.tasks, fresh.notes, fresh.habits, fresh.planner, fresh.journal]).toEqual([[], [], [], [], []]);
  });
});
