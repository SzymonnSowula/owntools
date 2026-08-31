import { uid } from "../lib/ids";
import { addDays, todayIso } from "../lib/dates";
import type {
  AppData,
  Habit,
  Note,
  SoundMix,
  Task,
} from "../types";

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

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

export function seedState(): AppData {
  const now = new Date().toISOString();
  const today = todayIso();
  const year = new Date().getFullYear();

  const tasks: Task[] = [
    {
      id: uid(),
      title: "Finish the weekly plan and pick one MIT",
      listId: "today",
      priority: 3,
      due: today,
      done: false,
      subtasks: [
        { id: uid(), title: "Review the calendar", done: true },
        { id: uid(), title: "Cross out what doesn't matter", done: false },
      ],
      createdAt: now,
      mit: true,
    },
    {
      id: uid(),
      title: "90 minutes of deep work, inbox closed",
      listId: "today",
      priority: 2,
      due: today,
      done: false,
      subtasks: [],
      createdAt: now,
      mit: false,
    },
    {
      id: uid(),
      title: "Reply to two postponed threads",
      listId: "inbox",
      priority: 1,
      done: false,
      subtasks: [],
      createdAt: now,
      mit: false,
    },
    {
      id: uid(),
      title: "Prepare notes for the Friday review",
      listId: "later",
      priority: 1,
      done: false,
      subtasks: [],
      createdAt: now,
      mit: false,
    },
  ];

  const notes: Note[] = [
    {
      id: uid(),
      content:
        "Rule of the day: one thing that, once done, makes everything else matter less.",
      color: "sage",
      x: 32,
      y: 28,
      z: 2,
      pinned: true,
      archived: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid(),
      content:
        "Phone in the other room. Rain noise. 50/10 timer. After the session — a short walk.",
      color: "mist",
      x: 280,
      y: 120,
      z: 1,
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const habits: Habit[] = [
    { id: uid(), name: "Movement", checks: seedHabitChecks("Movement"), createdAt: now },
    {
      id: uid(),
      name: "Reading",
      checks: seedHabitChecks("Reading"),
      createdAt: now,
    },
    { id: uid(), name: "Water", checks: seedHabitChecks("Water"), createdAt: now },
  ];

  return {
    version: 2,
    view: "today",
    settings: {
      theme: "light",
      pomodoroFocus: 25,
      pomodoroBreak: 5,
      notifications: true,
      heatmapGoalMinutes: 180,
      contributeOnTaskComplete: false,
      autostart: false,
      speechLang: "pl-PL",
      usageTracking: true,
      scrollGuardEnabled: false,
      scrollGuardSites: ["x.com", "twitter.com", "tiktok.com", "instagram.com"],
      scrollGuardTaskId: null,
    },
    lists: [
      { id: "inbox", name: "Inbox", builtin: "inbox" },
      { id: "today", name: "Today", builtin: "today" },
      { id: "later", name: "Later", builtin: "later" },
    ],
    tasks,
    notes,
    habits,
    heatmap: {},
    heatmapYear: year,
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
    planner: [
      {
        id: uid(),
        date: today,
        start: "08:30",
        end: "09:00",
        title: "Warm-up and MIT",
        done: false,
      },
      {
        id: uid(),
        date: today,
        start: "09:00",
        end: "11:00",
        title: "Deep work",
        done: false,
      },
      {
        id: uid(),
        date: today,
        start: "14:00",
        end: "14:50",
        title: "Inbox and admin",
        done: false,
      },
    ],
    journal: [],
    sounds: defaultSounds(),
    piano: { volume: 0.4, ambient: false, tempo: 36 },
    notebook: { pages: [], activePageId: null },
  };
}

function seedHabitChecks(name: string): Record<string, boolean> {
  const checks: Record<string, boolean> = {};
  const end = todayIso();
  for (let i = 0; i < 18; i++) {
    const iso = addDays(end, -i);
    checks[iso] = hash01(`habit-${name}-${iso}`) > 0.28;
  }
  return checks;
}
