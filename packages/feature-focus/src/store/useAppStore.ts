import { create } from "zustand";
import {
  applyMix,
  playRecord as dropNeedle,
  setAmbientParams,
  setRecordVolume as setNeedleVolume,
  startMixer,
  stopMixer,
  stopRecord as liftNeedle,
} from "../lib/audio/engine";
import { addDays, todayIso } from "../lib/dates";
import { notify } from "../lib/notify";
import { uid } from "../lib/ids";
import type {
  AppData,
  CaptureMode,
  DictationCommand,
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
import { applyTheme } from "../lib/themes";
import {
  DEFAULT_WORKSPACE_ID,
  deletePersisted,
  loadPersisted,
  loadWorkspacesMeta,
  migrate,
  savePersisted,
  saveWorkspacesMeta,
  type WorkspaceMeta,
  type WorkspaceRitual,
} from "./persist";
import { blankState, seedState } from "./seed";
import { createBlock, createPage, emptyNotebook } from "../lib/notebook";

export interface UiState {
  ready: boolean;
  shortcutsOpen: boolean;
  quickOpen: boolean;
  quickMode: CaptureMode;
  usageNow: UsageNow | null;
  workspaces: WorkspaceMeta[];
  workspaceId: string;
}

export interface AppState extends AppData, UiState {
  hydrate: () => Promise<void>;
  setView: (view: View) => void;
  setShortcutsOpen: (open: boolean) => void;
  openQuickCapture: (mode?: CaptureMode) => void;
  closeQuickCapture: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
  setTheme: (theme: Settings["theme"]) => void;
  switchWorkspace: (id: string) => Promise<void>;
  /** Snapshot of the current workspace dataset (for exports). */
  exportWorkspaceData: () => AppData;
  /**
   * Replace the current workspace with a validated JSON backup (see
   * `validateBackup`). Migrates, installs it like a workspace switch would,
   * and writes it to disk before resolving. Rejects if the backup is malformed.
   */
  importWorkspaceData: (raw: Record<string, unknown>) => Promise<void>;
  createWorkspace: (name: string, emoji?: string) => Promise<void>;
  renameWorkspace: (id: string, name: string, emoji?: string) => void;
  /** Replace a workspace's session ritual (apps/links/timer it launches). */
  setWorkspaceRitual: (id: string, ritual: WorkspaceRitual) => void;
  deleteWorkspace: (id: string) => Promise<void>;
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
  /** Drops the needle on a record; passing the one already spinning lifts it. */
  playRecord: (id: string) => void;
  stopRecord: () => void;
  setRecordVolume: (v: number) => void;
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
  "record",
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
let usageSaveTimer: number | null = null;
let switchingWorkspace = false;

/**
 * Usage ticks arrive every two seconds while time tracking is on, and each one
 * used to schedule a full save — the whole dataset stringified into
 * localStorage and focus.json rewritten — thirty times a minute for someone at
 * their desk. A tick still lands in the state at once (the stats stay live);
 * it reaches the disk at most this often, when the window is hidden, or with
 * the next ordinary save, whichever comes first.
 */
const USAGE_SAVE_MS = 30_000;

function scheduleUsageSave(get: () => AppState) {
  if (usageSaveTimer != null) return;
  usageSaveTimer = window.setTimeout(() => {
    usageSaveTimer = null;
    scheduleSave(get);
  }, USAGE_SAVE_MS);
}

function flushUsageSave(get: () => AppState) {
  if (usageSaveTimer == null) return;
  window.clearTimeout(usageSaveTimer);
  usageSaveTimer = null;
  scheduleSave(get);
}

/**
 * The timer's 250 ms tick runs while a timer runs. It used to run from start-up
 * to quit, waking the page four times a second to find nothing to do.
 */
function syncTimerLoop(get: () => AppState) {
  const running = get().timer.running;
  if (running && loopTimer == null) {
    loopTimer = window.setInterval(() => get().tickTimer(), 250);
  } else if (!running && loopTimer != null) {
    window.clearInterval(loopTimer);
    loopTimer = null;
  }
}

function scheduleSave(get: () => AppState) {
  if (saveTimer != null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const s = get();
    if (!s.ready) return;
    void savePersisted(pickData(s), s.workspaceId);
  }, 280);
}

/** Write the current workspace out immediately (before switching away). */
async function flushSave(get: () => AppState) {
  if (saveTimer != null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  const s = get();
  if (!s.ready) return;
  await savePersisted(pickData(s), s.workspaceId);
}

/** State patch that installs a workspace dataset (or a fresh one). */
function datasetPatch(loaded: AppData | null, fallback: AppData): Partial<AppState> {
  const base = seedState();
  if (!loaded) {
    return { ...fallback, shortcutsOpen: false, quickOpen: false };
  }
  return {
    ...base,
    ...loaded,
    settings: { ...base.settings, ...loaded.settings },
    usage: loaded.usage ?? {},
    notebook: loaded.notebook ?? emptyNotebook(),
    shortcutsOpen: false,
    quickOpen: false,
    timer: { ...loaded.timer, running: false, endAt: null, startedAt: null },
    // Neither the mixer nor the turntable survives a dataset swap — the crate
    // remembers which record was on, but nothing resumes without a gesture.
    sounds: { ...(loaded.sounds ?? base.sounds), playing: false },
    record: { ...(loaded.record ?? base.record), playing: false },
  };
}

/** Native side-effects that depend on the loaded settings (no-ops in browser). */
function syncNativeUsage(enabled: boolean) {
  void (async () => {
    try {
      const { isTauri } = await import("../lib/env");
      if (!isTauri()) return;
      const { invoke } = await import("@tauri-apps/api/core");
      // Time tracking is focus's feature: while focus is locked the choice is
      // kept, but nothing is sampled (App.tsx pushes again when a key arrives).
      const { toolLocked } = await import("@licensing/plan");
      await invoke("usage_set_enabled", { enabled: enabled && !toolLocked("focus") });
    } catch {
      /* browser preview */
    }
  })();
}

/**
 * Window behaviour is decided in Rust (the close event never reaches JS when
 * the window hides to the tray), so the preference is mirrored there on
 * hydrate, on workspace switch/restore, and whenever it changes.
 */
function syncNativeWindowPrefs(settings: Settings) {
  void (async () => {
    try {
      const { isTauri } = await import("../lib/env");
      if (!isTauri()) return;
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_close_to_tray", { enabled: settings.closeToTray !== false });
    } catch {
      /* browser preview */
    }
  })();
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
  if (preset === "stopwatch") return 0;
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
  workspaces: [],
  workspaceId: DEFAULT_WORKSPACE_ID,
  usageNow: null,

  hydrate: async () => {
    const meta = await loadWorkspacesMeta();
    const active = meta.list.some((w) => w.id === meta.active)
      ? meta.active
      : meta.list[0].id;
    const loaded = await loadPersisted(active);
    set({
      ...datasetPatch(loaded, pickData(get())),
      workspaces: meta.list,
      workspaceId: active,
      ready: true,
    });
    // Also when something was loaded: `migrate` may have brought it up to the
    // current version (and taken the old demo content out), and that should be
    // what is on disk from now on, not only in memory.
    scheduleSave(get);
    syncTimerLoop(get);
    applyTheme(get().settings.theme);
    nativeScrollGuard(get);
    syncNativeWindowPrefs(get().settings);
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
    if (patch.theme) applyTheme(patch.theme);
    if (patch.closeToTray !== undefined) syncNativeWindowPrefs(settings);
    if (patch.pomodoroFocus && get().timer.preset === "custom" && !get().timer.running) {
      const ms = patch.pomodoroFocus * 60 * 1000;
      set({
        timer: { ...get().timer, durationMs: ms, remainingMs: ms },
      });
    }
    scheduleSave(get);
  },
  setTheme: (theme) => get().updateSettings({ theme }),

  switchWorkspace: async (id) => {
    const s = get();
    if (switchingWorkspace || id === s.workspaceId || !s.workspaces.some((w) => w.id === id)) return;
    switchingWorkspace = true;
    try {
      stopMixer();
      liftNeedle();
      setAmbientParams(s.piano.tempo, s.piano.volume, false);
      await flushSave(get);
      const loaded = await loadPersisted(id);
      set({
        ...datasetPatch(loaded, blankState(s.settings)),
        workspaceId: id,
      });
      const next = get();
      applyTheme(next.settings.theme);
      nativeScrollGuard(get);
      syncNativeUsage(next.settings.usageTracking);
      syncNativeWindowPrefs(next.settings);
      if (next.piano.ambient) {
        setAmbientParams(next.piano.tempo, next.piano.volume, true);
      }
      // saved either way, so a dataset migrate() just upgraded lands on disk too
      scheduleSave(get);
      void saveWorkspacesMeta({ version: 1, active: id, list: next.workspaces });
    } finally {
      switchingWorkspace = false;
    }
  },

  exportWorkspaceData: () => pickData(get()),

  importWorkspaceData: async (raw) => {
    if (switchingWorkspace) throw new Error("A workspace switch is still in progress.");
    // Migrate before touching anything so a malformed file leaves the current
    // dataset (and the record on the platter) exactly as it was.
    const loaded = migrate(raw);
    switchingWorkspace = true;
    try {
      const s = get();
      stopMixer();
      liftNeedle();
      setAmbientParams(s.piano.tempo, s.piano.volume, false);
      set(datasetPatch(loaded, blankState(s.settings)));
      const next = get();
      applyTheme(next.settings.theme);
      nativeScrollGuard(get);
      syncNativeUsage(next.settings.usageTracking);
      syncNativeWindowPrefs(next.settings);
      if (next.piano.ambient) {
        setAmbientParams(next.piano.tempo, next.piano.volume, true);
      }
      await flushSave(get);
    } finally {
      switchingWorkspace = false;
    }
  },

  createWorkspace: async (name, emoji = "📁") => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const s = get();
    const ws: WorkspaceMeta = {
      id: uid(),
      name: trimmed,
      emoji,
      createdAt: new Date().toISOString(),
    };
    const workspaces = [...s.workspaces, ws];
    set({ workspaces });
    await savePersisted(blankState(s.settings), ws.id);
    await get().switchWorkspace(ws.id);
  },

  setWorkspaceRitual: (id, ritual) => {
    const workspaces = get().workspaces.map((w) => (w.id === id ? { ...w, ritual } : w));
    set({ workspaces });
    void saveWorkspacesMeta({ version: 1, active: get().workspaceId, list: workspaces });
  },

  renameWorkspace: (id, name, emoji) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const workspaces = get().workspaces.map((w) =>
      w.id === id ? { ...w, name: trimmed, emoji: emoji ?? w.emoji } : w,
    );
    set({ workspaces });
    void saveWorkspacesMeta({ version: 1, active: get().workspaceId, list: workspaces });
  },

  deleteWorkspace: async (id) => {
    const s = get();
    if (id === s.workspaceId || s.workspaces.length <= 1) return;
    const workspaces = s.workspaces.filter((w) => w.id !== id);
    set({ workspaces });
    await deletePersisted(id);
    void saveWorkspacesMeta({ version: 1, active: s.workspaceId, list: workspaces });
  },

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
    const cur = prev.apps.manual ?? { id: "manual", name: "Added manually", seconds: 0 };
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
    scheduleUsageSave(get);
  },
  setUsageTracking: (on) => {
    const settings = { ...get().settings, usageTracking: on };
    // Off (and with the scroll guard off) the sampler sends no more ticks —
    // usage.rs parks it — so the last one would stay as the "now" line for good.
    const usageNow = on && get().usageNow ? { ...get().usageNow!, tracking: on } : null;
    set({ settings, usageNow });
    scheduleSave(get);
    syncNativeUsage(on);
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
    if (timer.preset === "stopwatch") {
      set({
        timer: {
          ...timer,
          running: true,
          endAt: null,
          startedAt: Date.now() - timer.remainingMs,
        },
      });
      scheduleSave(get);
      return;
    }
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
    if (timer.preset === "stopwatch") {
      const elapsed = timer.startedAt ? Math.max(0, Date.now() - timer.startedAt) : timer.remainingMs;
      set({ timer: { ...timer, running: false, remainingMs: elapsed, startedAt: null, endAt: null } });
      scheduleSave(get);
      return;
    }
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
    if (timer.preset === "stopwatch") {
      set({
        timer: { ...timer, running: false, remainingMs: 0, durationMs: 0, endAt: null, startedAt: null },
      });
      scheduleSave(get);
      return;
    }
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
      preset === "stopwatch"
        ? 0
        : preset === "25"
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
        startedAt: null,
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
    if (timer.preset === "stopwatch") {
      if (timer.running && timer.startedAt) {
        set({ timer: { ...timer, remainingMs: Math.max(0, Date.now() - timer.startedAt) } });
      }
      return;
    }
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
          "Session finished",
          `Break: ${Math.round(pause / 60000)} min. Well done.`,
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
        void notify("Break over", "When you're ready, get back to focus.");
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

  playRecord: (id) => {
    const current = get().record;
    if (current.playing && current.id === id) {
      get().stopRecord();
      return;
    }
    set({ record: { ...current, id, playing: true } });
    // A record and the piano's ambient mode fight for the same ears.
    const piano = get().piano;
    if (piano.ambient) {
      set({ piano: { ...piano, ambient: false } });
      setAmbientParams(piano.tempo, piano.volume, false);
    }
    void dropNeedle(id, current.volume);
    scheduleSave(get);
  },
  stopRecord: () => {
    set({ record: { ...get().record, playing: false } });
    liftNeedle();
    scheduleSave(get);
  },
  setRecordVolume: (volume) => {
    set({ record: { ...get().record, volume } });
    setNeedleVolume(volume);
    scheduleSave(get);
  },

  createNotebookPage: (title = "Untitled", parentId = null, blocks) => {
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
      page = createPage("Dictation");
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
      get().createNotebookPage(text.slice(0, 48) || "Quick note");
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
      createBlock("paragraph", { text: "From the task inbox." }),
      ...task.subtasks.map((s) => createBlock("todo", { text: s.title, checked: s.done })),
    ];
    const id = get().createNotebookPage(task.title, null, blocks);
    get().updateTask(taskId, { pageId: id });
  },
}));

// Every path that starts or stops a timer (the store's actions, the tray, the
// overlay) goes through the state, so the loop follows the state.
useAppStore.subscribe((state, prev) => {
  if (state.timer.running !== prev.timer.running) syncTimerLoop(useAppStore.getState);
});

// Hidden to the tray, or about to be: put the pending usage on disk now.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushUsageSave(useAppStore.getState);
  });
}

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
      // A guard armed before focus needed a key must not keep its hooks: the
      // only switch that disarms it sits inside the locked tool.
      const { toolLocked } = await import("@licensing/plan");
      await invoke("scroll_guard_sync", {
        armed: armed && !toolLocked("focus"),
        sites: s.settings.scrollGuardSites,
      });
      await invoke("scroll_guard_note", { site: s.usageNow?.site ?? null });
    } catch {
      /* preview */
    }
  })();
}

export function weekStartIso(): string {
  const d = new Date();
  const day = d.getDay() || 7;
  return addDays(todayIso(d), -(day - 1));
}
