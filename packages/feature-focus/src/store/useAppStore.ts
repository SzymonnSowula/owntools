import { create } from "zustand";
import { applyMix, setAmbientParams, startMixer, stopMixer } from "../lib/audio/engine";
import { addDays, todayIso } from "../lib/dates";
import { notify } from "../lib/notify";
import { uid } from "../lib/ids";
import type {
  AppData,
  CaptureMode,
  Habit,
  HeatmapDay,
  NbBlock,
  Note,
  NoteColor,
  NotebookPage,
  PianoSettings,
  PlannerBlock,
  Settings,
  SoundMix,
  Task,
  TimerPreset,
  UsageDay,
  UsageNow,
  View,
} from "../types";
import { loadPersisted, savePersisted } from "./persist";
import { seedState } from "./seed";
import { createBlock, createPage, emptyNotebook } from "../lib/notebook";
import type { DictationCommand } from "../lib/speech";

export interface UiState {
  ready: boolean;
  shortcutsOpen: boolean;
  quickOpen: boolean;
  quickMode: CaptureMode;
  usageNow: UsageNow | null;
}

export interface AppState extends AppData, UiState {
  hydrate: () => Promise<void>;
  setView: (view: View) => void;
  setShortcutsOpen: (open: boolean) => void;
  openQuickCapture: (mode?: CaptureMode) => void;
  closeQuickCapture: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
  setTheme: (theme: Settings["theme"]) => void;
  addTask: (title: string, listId?: string, extra?: Partial<Task>) => void;
  updateTask: (id: string, patch: Partial<Task>) => void;
  toggleTask: (id: string) => void;
  deleteTask: (id: string) => void;
  setMit: (id: string) => void;
  addList: (name: string) => void;
  addSubtask: (taskId: string, title: string) => void;
  toggleSubtask: (taskId: string, subId: string) => void;
  addNote: (content?: string, color?: NoteColor) => void;
  updateNote: (id: string, patch: Partial<Note>) => void;
  moveNote: (id: string, x: number, y: number) => void;
  bringNote: (id: string) => void;
  addHabit: (name: string) => void;
  removeHabit: (id: string) => void;
  toggleHabit: (id: string, date?: string) => void;
  addFocusMinutes: (minutes: number, sessions?: number, date?: string) => void;
  applyUsageTick: (tick: UsageTick) => void;
  setUsageTracking: (on: boolean) => void;
  setScrollGuard: (patch: {
    enabled?: boolean;
    sites?: string[];
    taskId?: string | null;
  }) => void;
  checkInDay: (date?: string) => void;
  setHeatmapYear: (year: number) => void;
  startTimer: () => void;
  pauseTimer: () => void;
  toggleTimer: () => void;
  resetTimer: () => void;
  setTimerPreset: (preset: TimerPreset) => void;
  setSessionName: (name: string) => void;
  setCustomMinutes: (minutes: number) => void;
  tickTimer: () => void;
  addBlock: (block: Omit<PlannerBlock, "id" | "date" | "done"> & { date?: string }) => void;
  updateBlock: (id: string, patch: Partial<PlannerBlock>) => void;
  toggleBlock: (id: string) => void;
  removeBlock: (id: string) => void;
  saveJournal: (entry: Omit<JournalEntryFields, "id">) => void;
  setSoundPlaying: (playing: boolean) => void;
  setMasterVolume: (v: number) => void;
  setLayerVolume: (id: keyof SoundMix["layers"], v: number) => void;
  setPiano: (patch: Partial<PianoSettings>) => void;
  createNotebookPage: (title?: string, parentId?: string | null, blocks?: NbBlock[]) => string;
  addNotebookPageObject: (page: NotebookPage) => void;
  updateNotebookPage: (id: string, patch: Partial<NotebookPage>) => void;
  setActiveNotebookPage: (id: string | null) => void;
  archiveNotebookPage: (id: string) => void;
  restoreNotebookPage: (id: string) => void;
  deleteNotebookPage: (id: string) => void;
  toggleNotebookFavorite: (id: string) => void;
  setNotebookBlocks: (id: string, blocks: NbBlock[]) => void;
  applyNotebookDictation: (text: string, command: DictationCommand | null) => void;
  appendToNotebook: (text: string) => void;
  createPageFromTask: (taskId: string) => void;
}

type JournalEntryFields = {
  date: string;
  done: string;
  tomorrow: string;
  rating: 1 | 2 | 3 | 4 | 5;
};

export interface UsageTick {
  date: string;
  seconds: number;
  idle: boolean;
  sessionStart: boolean;
  appId: string;
  appName: string;
  title: string;
  site: string | null;
  scrollLocked?: boolean;
}

const DATA_KEYS: (keyof AppData)[] = [
  "version",
  "view",
  "settings",
  "lists",
  "tasks",
  "notes",
  "habits",
  "heatmap",
  "heatmapYear",
  "usage",
  "timer",
  "planner",
  "journal",
  "sounds",
  "piano",
  "notebook",
];

function pickData(state: AppData): AppData {
  const data = {} as AppData;
  for (const key of DATA_KEYS) {
    (data as unknown as Record<string, unknown>)[key] = state[key];
  }
  return data;
}

let saveTimer: number | null = null;
let loopTimer: number | null = null;

function scheduleSave(get: () => AppState) {
  if (saveTimer != null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const s = get();
    if (!s.ready) return;
    void savePersisted(pickData(s));
  }, 280);
}

function bumpDay(
  heatmap: Record<string, HeatmapDay>,
  date: string,
  minutes: number,
  sessions: number,
  extraSeconds = 0,
): Record<string, HeatmapDay> {
  const prev = heatmap[date] ?? { date, minutes: 0, seconds: 0, sessions: 0 };
  const seconds = (prev.seconds ?? prev.minutes * 60) + extraSeconds + Math.round(minutes * 60);
  return {
    ...heatmap,
    [date]: {
      ...prev,
      seconds,
      minutes: Math.floor(seconds / 60),
      sessions: prev.sessions + sessions,
    },
  };
}

function focusMs(settings: Settings, preset: TimerPreset, current: number): number {
  if (preset === "25") return 25 * 60 * 1000;
  if (preset === "50") return 50 * 60 * 1000;
  return current || settings.pomodoroFocus * 60 * 1000;
}

function breakMs(settings: Settings, preset: TimerPreset): number {
  if (preset === "25") return 5 * 60 * 1000;
  if (preset === "50") return 10 * 60 * 1000;
  return settings.pomodoroBreak * 60 * 1000;
}

export const useAppStore = create<AppState>((set, get) => ({
  ...seedState(),
  ready: false,
  shortcutsOpen: false,
  quickOpen: false,
  quickMode: "task",
  usageNow: null,

  hydrate: async () => {
    const loaded = await loadPersisted();
    if (loaded) {
      const base = seedState();
      set({
        ...base,
        ...loaded,
        settings: { ...base.settings, ...loaded.settings },
        usage: loaded.usage ?? {},
        notebook: loaded.notebook ?? emptyNotebook(),
        ready: true,
        shortcutsOpen: false,
        quickOpen: false,
        timer: { ...loaded.timer, running: false, endAt: null },
      });
    } else {
      set({ ready: true });
      scheduleSave(get);
    }
    if (loopTimer == null) {
      loopTimer = window.setInterval(() => get().tickTimer(), 250);
    }
    document.documentElement.dataset.theme = get().settings.theme;
    nativeScrollGuard(get);
    if (get().piano.ambient) {
      setAmbientParams(get().piano.tempo, get().piano.volume, true);
    }
  },

  setView: (view) => {
    set({ view });
    scheduleSave(get);
  },
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  openQuickCapture: (mode = "task") => set({ quickOpen: true, quickMode: mode }),
  closeQuickCapture: () => set({ quickOpen: false }),

  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    if (patch.theme) document.documentElement.dataset.theme = patch.theme;
    if (patch.pomodoroFocus && get().timer.preset === "custom" && !get().timer.running) {
      const ms = patch.pomodoroFocus * 60 * 1000;
      set({
        timer: { ...get().timer, durationMs: ms, remainingMs: ms },
      });
    }
    scheduleSave(get);
  },
  setTheme: (theme) => get().updateSettings({ theme }),

  addTask: (title, listId = "inbox", extra) => {
    const task: Task = {
      id: uid(),
      title: title.trim(),
      listId,
      priority: 0,
      done: false,
      subtasks: [],
      createdAt: new Date().toISOString(),
      mit: false,
      ...extra,
    };
    if (!task.title) return;
    set({ tasks: [task, ...get().tasks] });
    scheduleSave(get);
  },
  updateTask: (id, patch) => {
    set({ tasks: get().tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
    scheduleSave(get);
  },
  toggleTask: (id) => {
    const tasks = get().tasks.map((t) => {
      if (t.id !== id) return t;
      const done = !t.done;
      return { ...t, done, doneAt: done ? new Date().toISOString() : undefined };
    });
    const toggled = tasks.find((t) => t.id === id);
    let heatmap = get().heatmap;
    if (toggled?.done && get().settings.contributeOnTaskComplete) {
      heatmap = bumpDay(heatmap, todayIso(), 5, 0);
    }
    set({ tasks, heatmap });
    scheduleSave(get);
    nativeScrollGuard(get);
  },
  deleteTask: (id) => {
    const settings = get().settings;
    const next = {
      ...settings,
      scrollGuardTaskId: settings.scrollGuardTaskId === id ? null : settings.scrollGuardTaskId,
    };
    set({ tasks: get().tasks.filter((t) => t.id !== id), settings: next });
    scheduleSave(get);
    nativeScrollGuard(get);
  },
  setMit: (id) => {
    set({
      tasks: get().tasks.map((t) => ({ ...t, mit: t.id === id })),
    });
    scheduleSave(get);
  },
  addList: (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    set({ lists: [...get().lists, { id: uid(), name: trimmed }] });
    scheduleSave(get);
  },
  addSubtask: (taskId, title) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    set({
      tasks: get().tasks.map((t) =>
        t.id === taskId
          ? { ...t, subtasks: [...t.subtasks, { id: uid(), title: trimmed, done: false }] }
          : t,
      ),
    });
    scheduleSave(get);
  },
  toggleSubtask: (taskId, subId) => {
    set({
      tasks: get().tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              subtasks: t.subtasks.map((s) => (s.id === subId ? { ...s, done: !s.done } : s)),
            }
          : t,
      ),
    });
    scheduleSave(get);
  },

  addNote: (content = "", color = "paper") => {
    const notes = get().notes;
    const z = notes.reduce((m, n) => Math.max(m, n.z), 0) + 1;
    const note: Note = {
      id: uid(),
      content,
      color,
      x: 24 + (notes.length % 5) * 36,
      y: 24 + (notes.length % 4) * 28,
      z,
      pinned: false,
      archived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    set({ notes: [...notes, note] });
    scheduleSave(get);
  },
  updateNote: (id, patch) => {
    set({
      notes: get().notes.map((n) =>
        n.id === id ? { ...n, ...patch, updatedAt: new Date().toISOString() } : n,
      ),
    });
    scheduleSave(get);
  },
  moveNote: (id, x, y) => {
    set({
      notes: get().notes.map((n) => (n.id === id ? { ...n, x, y } : n)),
    });
    scheduleSave(get);
  },
  bringNote: (id) => {
    const z = get().notes.reduce((m, n) => Math.max(m, n.z), 0) + 1;
    set({ notes: get().notes.map((n) => (n.id === id ? { ...n, z } : n)) });
  },

  addHabit: (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const habit: Habit = { id: uid(), name: trimmed, checks: {}, createdAt: new Date().toISOString() };
    set({ habits: [...get().habits, habit] });
    scheduleSave(get);
  },
  removeHabit: (id) => {
    set({ habits: get().habits.filter((h) => h.id !== id) });
    scheduleSave(get);
  },
  toggleHabit: (id, date = todayIso()) => {
    set({
      habits: get().habits.map((h) => {
        if (h.id !== id) return h;
        const checks = { ...h.checks, [date]: !h.checks[date] };
        return { ...h, checks };
      }),
    });
    scheduleSave(get);
  },

  addFocusMinutes: (minutes, sessions = 1, date = todayIso()) => {
    const heatmap = bumpDay(get().heatmap, date, minutes, sessions);
    const prev = get().usage[date] ?? { date, seconds: 0, sessions: 0, apps: {}, sites: {} };
    const extra = Math.round(minutes * 60);
    const cur = prev.apps.manual ?? { id: "manual", name: "Dodane ręcznie", seconds: 0 };
    set({
      heatmap,
      usage: {
        ...get().usage,
        [date]: {
          ...prev,
          seconds: prev.seconds + extra,
          sessions: prev.sessions + sessions,
          apps: { ...prev.apps, manual: { ...cur, seconds: cur.seconds + extra } },
        },
      },
    });
    scheduleSave(get);
  },
  checkInDay: (date = todayIso()) => {
    const prev = get().heatmap[date] ?? { date, minutes: 0, seconds: 0, sessions: 0 };
    set({
      heatmap: {
        ...get().heatmap,
        [date]: { ...prev, checkIn: true },
      },
    });
    scheduleSave(get);
  },
  applyUsageTick: (tick) => {
    const usageNow: UsageNow = {
      idle: tick.idle,
      tracking: get().settings.usageTracking,
      appId: tick.appId,
      appName: tick.appName,
      title: tick.title,
      site: tick.site,
      scrollLocked: !!tick.scrollLocked,
      at: Date.now(),
    };
    if (tick.idle || tick.seconds <= 0 || !get().settings.usageTracking) {
      set({ usageNow });
      return;
    }
    const date = tick.date || todayIso();
    const heatmap = bumpDay(get().heatmap, date, 0, tick.sessionStart ? 1 : 0, tick.seconds);
    const prev = get().usage[date] ?? {
      date,
      seconds: 0,
      sessions: 0,
      apps: {},
      sites: {},
    };
    const apps = { ...prev.apps };
    if (tick.appId) {
      const cur = apps[tick.appId] ?? { id: tick.appId, name: tick.appName || tick.appId, seconds: 0 };
      apps[tick.appId] = {
        ...cur,
        name: tick.appName || cur.name,
        seconds: cur.seconds + tick.seconds,
      };
    }
    const sites = { ...prev.sites };
    if (tick.site) {
      const cur = sites[tick.site] ?? { id: tick.site, name: tick.site, seconds: 0 };
      sites[tick.site] = { ...cur, seconds: cur.seconds + tick.seconds };
    }
    const usage: Record<string, UsageDay> = {
      ...get().usage,
      [date]: {
        date,
        seconds: prev.seconds + tick.seconds,
        sessions: prev.sessions + (tick.sessionStart ? 1 : 0),
        apps,
        sites,
      },
    };
    set({ heatmap, usage, usageNow });
    scheduleSave(get);
  },
  setUsageTracking: (on) => {
    const settings = { ...get().settings, usageTracking: on };
    set({ settings, usageNow: get().usageNow ? { ...get().usageNow!, tracking: on } : get().usageNow });
    scheduleSave(get);
    if (typeof window !== "undefined") {
      void (async () => {
        try {
          const { isTauri } = await import("../lib/env");
          if (!isTauri()) return;
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("usage_set_enabled", { enabled: on });
        } catch {
          /* podgląd w przeglądarce */
        }
      })();
    }
  },
  setScrollGuard: (patch) => {
    const settings = {
      ...get().settings,
      scrollGuardEnabled: patch.enabled ?? get().settings.scrollGuardEnabled,
      scrollGuardSites: patch.sites ?? get().settings.scrollGuardSites,
      scrollGuardTaskId:
        patch.taskId === undefined ? get().settings.scrollGuardTaskId : patch.taskId,
    };
    set({ settings });
    scheduleSave(get);
    nativeScrollGuard(get);
  },
  setHeatmapYear: (heatmapYear) => {
    set({ heatmapYear });
    scheduleSave(get);
  },

  startTimer: () => {
    const timer = get().timer;
    const remaining = Math.max(1000, timer.remainingMs);
    set({
      timer: {
        ...timer,
        running: true,
        remainingMs: remaining,
        endAt: Date.now() + remaining,
      },
    });
    scheduleSave(get);
  },
  pauseTimer: () => {
    const timer = get().timer;
    const remaining = timer.endAt ? Math.max(0, timer.endAt - Date.now()) : timer.remainingMs;
    set({ timer: { ...timer, running: false, remainingMs: remaining, endAt: null } });
    scheduleSave(get);
  },
  toggleTimer: () => {
    if (get().timer.running) get().pauseTimer();
    else get().startTimer();
  },
  resetTimer: () => {
    const { settings, timer } = get();
    const durationMs =
      timer.mode === "break"
        ? breakMs(settings, timer.preset)
        : focusMs(settings, timer.preset, timer.durationMs);
    set({
      timer: { ...timer, running: false, remainingMs: durationMs, durationMs, endAt: null },
    });
    scheduleSave(get);
  },
  setTimerPreset: (preset) => {
    const { settings } = get();
    const durationMs =
      preset === "25"
        ? 25 * 60 * 1000
        : preset === "50"
          ? 50 * 60 * 1000
          : settings.pomodoroFocus * 60 * 1000;
    set({
      timer: {
        ...get().timer,
        preset,
        mode: "focus",
        running: false,
        durationMs,
        remainingMs: durationMs,
        endAt: null,
      },
    });
    scheduleSave(get);
  },
  setSessionName: (sessionName) => {
    set({ timer: { ...get().timer, sessionName } });
    scheduleSave(get);
  },
  setCustomMinutes: (minutes) => {
    const durationMs = Math.max(1, minutes) * 60 * 1000;
    set({
      timer: {
        ...get().timer,
        preset: "custom",
        mode: "focus",
        running: false,
        durationMs,
        remainingMs: durationMs,
        endAt: null,
      },
    });
    scheduleSave(get);
  },
  tickTimer: () => {
    const timer = get().timer;
    if (!timer.running || !timer.endAt) return;
    const remainingMs = timer.endAt - Date.now();
    if (remainingMs > 0) {
      set({ timer: { ...timer, remainingMs } });
      return;
    }
    const { settings } = get();
    if (timer.mode === "focus") {
      const pause = breakMs(settings, timer.preset);
      set({
        timer: {
          ...timer,
          mode: "break",
          running: true,
          durationMs: pause,
          remainingMs: pause,
          endAt: Date.now() + pause,
        },
      });
      if (settings.notifications) {
        void notify(
          "Sesja zakończona",
          `Przerwa: ${Math.round(pause / 60000)} min. Dobrze zrobione.`,
        );
      }
    } else {
      const durationMs = focusMs(settings, timer.preset, timer.durationMs);
      set({
        timer: {
          ...timer,
          mode: "focus",
          running: false,
          durationMs,
          remainingMs: durationMs,
          endAt: null,
        },
      });
      if (settings.notifications) {
        void notify("Koniec przerwy", "Gdy będziesz gotowy, wróć do focusu.");
      }
    }
    scheduleSave(get);
  },

  addBlock: (block) => {
    set({
      planner: [
        ...get().planner,
        {
          id: uid(),
          date: block.date ?? todayIso(),
          start: block.start,
          end: block.end,
          title: block.title,
          done: false,
        },
      ],
    });
    scheduleSave(get);
  },
  updateBlock: (id, patch) => {
    set({ planner: get().planner.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
    scheduleSave(get);
  },
  toggleBlock: (id) => {
    set({
      planner: get().planner.map((b) => (b.id === id ? { ...b, done: !b.done } : b)),
    });
    scheduleSave(get);
  },
  removeBlock: (id) => {
    set({ planner: get().planner.filter((b) => b.id !== id) });
    scheduleSave(get);
  },

  saveJournal: (entry) => {
    const rest = get().journal.filter((j) => j.date !== entry.date);
    set({ journal: [{ id: uid(), ...entry }, ...rest] });
    scheduleSave(get);
  },

  setSoundPlaying: (playing) => {
    const sounds = { ...get().sounds, playing };
    set({ sounds });
    if (playing) void startMixer(sounds);
    else stopMixer();
    scheduleSave(get);
  },
  setMasterVolume: (master) => {
    const sounds = { ...get().sounds, master };
    set({ sounds });
    applyMix(sounds);
    scheduleSave(get);
  },
  setLayerVolume: (id, v) => {
    const sounds = {
      ...get().sounds,
      layers: { ...get().sounds.layers, [id]: v },
    };
    set({ sounds });
    applyMix(sounds);
    scheduleSave(get);
  },
  setPiano: (patch) => {
    const piano = { ...get().piano, ...patch };
    set({ piano });
    setAmbientParams(piano.tempo, piano.volume, piano.ambient);
    scheduleSave(get);
  },

  createNotebookPage: (title = "Bez tytułu", parentId = null, blocks) => {
    const page = createPage(title, parentId, blocks);
    set({
      view: "notebook",
      notebook: {
        pages: [...get().notebook.pages, page],
        activePageId: page.id,
      },
    });
    scheduleSave(get);
    return page.id;
  },
  addNotebookPageObject: (page) => {
    set({
      notebook: {
        pages: [...get().notebook.pages, page],
        activePageId: get().notebook.activePageId,
      },
    });
    scheduleSave(get);
  },
  updateNotebookPage: (id, patch) => {
    set({
      notebook: {
        ...get().notebook,
        pages: get().notebook.pages.map((p) =>
          p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p,
        ),
      },
    });
    scheduleSave(get);
  },
  setActiveNotebookPage: (id) => {
    set({ notebook: { ...get().notebook, activePageId: id } });
    scheduleSave(get);
  },
  archiveNotebookPage: (id) => {
    const notebook = get().notebook;
    const pages = notebook.pages.map((p) => (p.id === id ? { ...p, archived: true } : p));
    const activePageId = notebook.activePageId === id ? null : notebook.activePageId;
    set({ notebook: { pages, activePageId } });
    scheduleSave(get);
  },
  restoreNotebookPage: (id) => {
    set({
      notebook: {
        ...get().notebook,
        pages: get().notebook.pages.map((p) => (p.id === id ? { ...p, archived: false } : p)),
        activePageId: id,
      },
    });
    scheduleSave(get);
  },
  deleteNotebookPage: (id) => {
    const pages = get().notebook.pages.filter((p) => p.id !== id && p.parentId !== id);
    set({
      notebook: {
        pages,
        activePageId: get().notebook.activePageId === id ? null : get().notebook.activePageId,
      },
    });
    scheduleSave(get);
  },
  toggleNotebookFavorite: (id) => {
    set({
      notebook: {
        ...get().notebook,
        pages: get().notebook.pages.map((p) => (p.id === id ? { ...p, favorite: !p.favorite } : p)),
      },
    });
    scheduleSave(get);
  },
  setNotebookBlocks: (id, blocks) => {
    set({
      notebook: {
        ...get().notebook,
        pages: get().notebook.pages.map((p) =>
          p.id === id ? { ...p, blocks, updatedAt: new Date().toISOString() } : p,
        ),
      },
    });
    scheduleSave(get);
  },
  applyNotebookDictation: (text, command) => {
    const writable = ["paragraph", "heading1", "heading2", "heading3", "bullet", "numbered", "todo", "quote", "callout"];
    let notebook = get().notebook;
    let page = notebook.pages.find((p) => p.id === notebook.activePageId && !p.archived);
    if (!page) {
      page = createPage("Dyktando");
      notebook = { pages: [...notebook.pages, page], activePageId: page.id };
    }
    const blocks = page.blocks.map((b) => ({ ...b }));
    if (command === "heading") blocks.push(createBlock("heading1"));
    else if (command === "list") blocks.push(createBlock("bullet"));
    else if (command === "todo") blocks.push(createBlock("todo"));
    else if (command === "paragraph") blocks.push(createBlock("paragraph"));
    if (text) {
      const last = blocks[blocks.length - 1];
      if (last && writable.includes(last.type)) {
        const sep = last.text && !last.text.endsWith(" ") ? " " : "";
        last.text = `${last.text}${sep}${text}`;
      } else {
        blocks.push(createBlock("paragraph", { text }));
      }
    }
    set({
      view: "notebook",
      notebook: {
        pages: notebook.pages.map((p) =>
          p.id === page!.id ? { ...p, blocks, updatedAt: new Date().toISOString() } : p,
        ),
        activePageId: page.id,
      },
    });
    scheduleSave(get);
  },
  appendToNotebook: (text) => {
    const notebook = get().notebook;
    let page = notebook.pages.find((p) => p.id === notebook.activePageId && !p.archived);
    if (!page) page = notebook.pages.find((p) => !p.archived);
    if (!page) {
      get().createNotebookPage(text.slice(0, 48) || "Szybka notatka");
      get().setNotebookBlocks(get().notebook.activePageId!, [
        createBlock("paragraph", { text }),
      ]);
      return;
    }
    get().setNotebookBlocks(page.id, [...page.blocks, createBlock("paragraph", { text })]);
    set({
      view: "notebook",
      notebook: { ...get().notebook, activePageId: page.id },
    });
    scheduleSave(get);
  },
  createPageFromTask: (taskId) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (!task) return;
    const blocks = [
      createBlock("paragraph", { text: "Ze skrzynki zadań." }),
      ...task.subtasks.map((s) => createBlock("todo", { text: s.title, checked: s.done })),
    ];
    const id = get().createNotebookPage(task.title, null, blocks);
    get().updateTask(taskId, { pageId: id });
  },
}));

function nativeScrollGuard(get: () => AppState) {
  const s = get();
  const task = s.tasks.find((t) => t.id === s.settings.scrollGuardTaskId);
  const armed = !!s.settings.scrollGuardEnabled && !!task && !task.done;
  if (typeof window === "undefined") return;
  void (async () => {
    try {
      const { isTauri } = await import("../lib/env");
      if (!isTauri()) return;
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("scroll_guard_sync", {
        armed,
        sites: s.settings.scrollGuardSites,
      });
      await invoke("scroll_guard_note", { site: s.usageNow?.site ?? null });
    } catch {
      /* podgląd */
    }
  })();
}

export function weekStartIso(): string {
  const d = new Date();
  const day = d.getDay() || 7;
  return addDays(todayIso(d), -(day - 1));
}
