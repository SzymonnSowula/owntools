import { describe, expect, it } from "vitest";
import { migrate } from "./persist";

/**
 * A dataset as the standalone focus app (v1) saved it: heatmap days carry
 * `minutes` only, there is no `usage`, and the settings predate usage tracking,
 * the scroll guard and close-to-tray.
 */
function v1Dataset() {
  return {
    version: 1,
    view: "today",
    settings: {
      theme: "light",
      timerFullscreen: false,
      pomodoroFocus: 25,
      pomodoroBreak: 5,
      notifications: true,
      heatmapGoalMinutes: 120,
      contributeOnTaskComplete: true,
      autostart: false,
      speechLang: "pl-PL",
    },
    lists: [{ id: "inbox", name: "Inbox", builtin: "inbox" }],
    tasks: [],
    notes: [],
    habits: [],
    heatmap: {
      "2026-08-30": { date: "2026-08-30", minutes: 90, sessions: 3 },
      "2026-08-31": { date: "2026-08-31", minutes: 12.5, sessions: 1, checkIn: true },
      "2026-09-01": { date: "2026-09-01", sessions: 0 },
    },
    heatmapYear: 2026,
    timer: {
      running: false,
      mode: "focus",
      remainingMs: 0,
      durationMs: 0,
      sessionName: "",
      preset: "25",
      endAt: null,
    },
    planner: [],
    journal: [],
    sounds: { playing: false, master: 0.5, layers: {} },
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("migrate", () => {
  it("upgrades a v1 dataset to the current version (a missing version counts as v1)", () => {
    expect(migrate(v1Dataset()).version).toBe(3);
    expect(migrate({ ...v1Dataset(), version: undefined }).version).toBe(3);
  });

  it("keeps every heatmap day and backfills seconds from minutes", () => {
    const data = migrate(v1Dataset());
    expect(Object.keys(data.heatmap).sort()).toEqual(["2026-08-30", "2026-08-31", "2026-09-01"]);
    expect(data.heatmap["2026-08-30"]).toMatchObject({
      date: "2026-08-30",
      minutes: 90,
      seconds: 5400,
      sessions: 3,
    });
    expect(data.heatmap["2026-08-31"]).toMatchObject({
      minutes: 12.5,
      seconds: 750,
      sessions: 1,
      checkIn: true,
    });
    // No minutes recorded at all → zero, never NaN.
    expect(data.heatmap["2026-09-01"].seconds).toBe(0);
  });

  it("defaults usage to an empty record", () => {
    expect(migrate(v1Dataset()).usage).toEqual({});
  });

  it("fills in the settings that arrived after v1 without touching the old ones", () => {
    const { settings } = migrate(v1Dataset());
    expect(settings).toMatchObject({
      theme: "light",
      pomodoroFocus: 25,
      pomodoroBreak: 5,
      heatmapGoalMinutes: 120,
      speechLang: "pl-PL",
      usageTracking: true,
      scrollGuardEnabled: false,
      scrollGuardTaskId: null,
      closeToTray: true,
    });
    expect(Array.isArray(settings.scrollGuardSites)).toBe(true);
    expect(settings.scrollGuardSites.length).toBeGreaterThan(0);
    for (const site of settings.scrollGuardSites) expect(typeof site).toBe("string");
  });

  it("preserves the rest of the dataset", () => {
    const data = migrate(v1Dataset());
    expect(data.view).toBe("today");
    expect(data.heatmapYear).toBe(2026);
    expect(data.lists).toEqual([{ id: "inbox", name: "Inbox", builtin: "inbox" }]);
    expect(data.timer).toMatchObject({ mode: "focus", preset: "25", endAt: null });
  });

  it("keeps everything a v2 dataset already had", () => {
    const v2 = {
      ...v1Dataset(),
      version: 2,
      usage: {
        "2026-08-31": { date: "2026-08-31", seconds: 1200, sessions: 2, apps: {}, sites: {} },
      },
      settings: {
        ...v1Dataset().settings,
        usageTracking: false,
        closeToTray: false,
        scrollGuardEnabled: true,
        scrollGuardSites: ["reddit.com"],
        scrollGuardTaskId: "task-1",
      },
      heatmap: {
        // Seconds already tracked — must not be recomputed from minutes.
        "2026-08-30": { date: "2026-08-30", minutes: 1, seconds: 90, sessions: 1 },
      },
    };
    const data = migrate(clone(v2));
    expect(data.version).toBe(3);
    expect(data.usage).toEqual(v2.usage);
    expect(data.settings).toMatchObject({
      usageTracking: false,
      closeToTray: false,
      scrollGuardEnabled: true,
      scrollGuardSites: ["reddit.com"],
      scrollGuardTaskId: "task-1",
    });
    expect(data.heatmap["2026-08-30"].seconds).toBe(90);
  });

  it("is idempotent", () => {
    const once = migrate(v1Dataset());
    const twice = migrate(clone(once) as unknown as Record<string, unknown>);
    expect(twice).toEqual(once);
  });
});
