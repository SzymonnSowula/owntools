import { systemSpeechLang } from "@core/env";
import type { AppData, SoundMix } from "../types";

export function defaultSounds(): SoundMix {
  return {
    playing: false,
    master: 0.45,
    layers: {
      white: 0,
      pink: 0.2,
      brown: 0,
      rain: 0.35,
      fan: 0,
      cafe: 0,
      ocean: 0.15,
    },
  };
}

/**
 * The dataset a first start (or a missing file) begins with: preferences and
 * the three built-in lists, and nothing else. There used to be demo tasks,
 * notes, habits with invented streaks and a day plan here - first in Polish,
 * later in English - and they read as somebody else's data sitting in your
 * app. The empty states in each view say what goes there instead.
 * `demoContent.ts` takes the old demo items back out of existing workspaces.
 */
export function seedState(): AppData {
  return {
    version: 3,
    view: "today",
    settings: {
      theme: "light",
      timerFullscreen: true,
      pomodoroFocus: 25,
      pomodoroBreak: 5,
      notifications: true,
      heatmapGoalMinutes: 180,
      contributeOnTaskComplete: false,
      autostart: false,
      speechLang: systemSpeechLang(),
      usageTracking: true,
      closeToTray: true,
      scrollGuardEnabled: false,
      scrollGuardSites: ["x.com", "twitter.com", "tiktok.com", "instagram.com"],
      scrollGuardTaskId: null,
    },
    lists: [
      { id: "inbox", name: "Inbox", builtin: "inbox" },
      { id: "today", name: "Today", builtin: "today" },
      { id: "later", name: "Later", builtin: "later" },
    ],
    tasks: [],
    notes: [],
    habits: [],
    heatmap: {},
    heatmapYear: new Date().getFullYear(),
    usage: {},
    timer: {
      running: false,
      mode: "focus",
      remainingMs: 25 * 60 * 1000,
      durationMs: 25 * 60 * 1000,
      sessionName: "Deep work",
      preset: "25",
      endAt: null,
    },
    planner: [],
    journal: [],
    sounds: defaultSounds(),
    record: { id: null, playing: false, volume: 0.5 },
    piano: { volume: 0.4, ambient: false, tempo: 36 },
    notebook: { pages: [], activePageId: null },
  };
}

/** A freshly created workspace: empty, with the current preferences carried over. */
export function blankState(settings?: AppData["settings"]): AppData {
  const base = seedState();
  return { ...base, settings: settings ? { ...settings } : base.settings };
}
