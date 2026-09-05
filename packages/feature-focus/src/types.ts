export type View =
  | "today"
  | "heatmap"
  | "tasks"
  | "notes"
  | "notebook"
  | "habits"
  | "sounds"
  | "piano"
  | "planner"
  | "journal"
  | "stats"
  | "settings";

export type Priority = 0 | 1 | 2 | 3;
export type Theme = "light" | "dark" | "nature" | "ocean" | "sunset";
export type TimerMode = "focus" | "break";
export type TimerPreset = "25" | "50" | "custom" | "stopwatch";
export type CaptureMode = "task" | "note" | "habit" | "page" | "append";
export type SpeechLang = "pl-PL" | "en-US";
/** Structural voice commands the notebook understands alongside dictated text. */
export type DictationCommand = "paragraph" | "heading" | "list" | "todo" | "stop";
export type BlockType =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bullet"
  | "numbered"
  | "todo"
  | "toggle"
  | "quote"
  | "divider"
  | "callout"
  | "code"
  | "table"
  | "image"
  | "pageLink";
export type NoiseId = "white" | "pink" | "brown" | "rain" | "fan" | "cafe" | "ocean";

export interface TaskList {
  id: string;
  name: string;
  builtin?: "inbox" | "today" | "later";
}

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  listId: string;
  priority: Priority;
  due?: string;
  done: boolean;
  doneAt?: string;
  subtasks: Subtask[];
  createdAt: string;
  mit: boolean;
  pageId?: string;
}

export interface Note {
  id: string;
  content: string;
  color: NoteColor;
  x: number;
  y: number;
  z: number;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export type NoteColor = "paper" | "mist" | "sage" | "blush" | "lilac" | "sand";

export interface Habit {
  id: string;
  name: string;
  checks: Record<string, boolean>;
  createdAt: string;
}

export interface HeatmapDay {
  date: string;
  minutes: number;
  seconds: number;
  sessions: number;
  checkIn?: boolean;
}

export interface UsageBucket {
  id: string;
  name: string;
  seconds: number;
}

export interface UsageDay {
  date: string;
  seconds: number;
  sessions: number;
  apps: Record<string, UsageBucket>;
  sites: Record<string, UsageBucket>;
}

export interface UsageNow {
  idle: boolean;
  tracking: boolean;
  appId: string;
  appName: string;
  title: string;
  site: string | null;
  scrollLocked: boolean;
  at: number;
}

export interface TimerState {
  running: boolean;
  mode: TimerMode;
  remainingMs: number;
  durationMs: number;
  sessionName: string;
  preset: TimerPreset;
  endAt: number | null;
  /** Stopwatch only: epoch ms anchor such that elapsed = now - startedAt. */
  startedAt?: number | null;
}

export interface PlannerBlock {
  id: string;
  date: string;
  start: string;
  end: string;
  title: string;
  done: boolean;
}

export interface JournalEntry {
  id: string;
  date: string;
  done: string;
  tomorrow: string;
  rating: 1 | 2 | 3 | 4 | 5;
}

export interface SoundMix {
  playing: boolean;
  master: number;
  layers: Record<NoiseId, number>;
}

/**
 * The turntable. `id` is the record on the platter — it survives a restart so
 * the crate remembers what you last put on — while `playing` never does: audio
 * needs a gesture, and nothing should start making noise on its own.
 */
export interface RecordPlayer {
  id: string | null;
  playing: boolean;
  volume: number;
}

export interface PianoSettings {
  volume: number;
  ambient: boolean;
  tempo: number;
}

export interface Settings {
  theme: Theme;
  timerFullscreen: boolean;
  pomodoroFocus: number;
  pomodoroBreak: number;
  notifications: boolean;
  heatmapGoalMinutes: number;
  contributeOnTaskComplete: boolean;
  autostart: boolean;
  speechLang: SpeechLang;
  usageTracking: boolean;
  /** Closing the main window hides it in the tray (true) or quits (false). */
  closeToTray: boolean;
  scrollGuardEnabled: boolean;
  scrollGuardSites: string[];
  scrollGuardTaskId: string | null;
}

export interface NbBlock {
  id: string;
  type: BlockType;
  text: string;
  indent?: number;
  checked?: boolean;
  collapsed?: boolean;
  lang?: string;
  url?: string;
  pageId?: string;
  rows?: string[][];
  callout?: string;
  children?: NbBlock[];
}

export interface NotebookPage {
  id: string;
  parentId: string | null;
  title: string;
  icon: string;
  cover: string;
  favorite: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  blocks: NbBlock[];
}

export interface NotebookState {
  pages: NotebookPage[];
  activePageId: string | null;
}

export interface AppData {
  version: 2;
  view: View;
  settings: Settings;
  lists: TaskList[];
  tasks: Task[];
  notes: Note[];
  habits: Habit[];
  heatmap: Record<string, HeatmapDay>;
  heatmapYear: number;
  usage: Record<string, UsageDay>;
  timer: TimerState;
  planner: PlannerBlock[];
  journal: JournalEntry[];
  sounds: SoundMix;
  record: RecordPlayer;
  piano: PianoSettings;
  notebook: NotebookState;
}

export const NOTE_COLORS: NoteColor[] = [
  "paper",
  "mist",
  "sage",
  "blush",
  "lilac",
  "sand",
];

export const NOISE_LAYERS: { id: NoiseId; label: string }[] = [
  { id: "white", label: "White noise" },
  { id: "pink", label: "Pink noise" },
  { id: "brown", label: "Brown noise" },
  { id: "rain", label: "Rain" },
  { id: "fan", label: "Fan" },
  { id: "cafe", label: "Café" },
  { id: "ocean", label: "Ocean" },
];

export const VIEWS: { id: View; label: string; hint: string }[] = [
  { id: "today", label: "Today", hint: "Daily dashboard" },
  { id: "tasks", label: "Tasks", hint: "Lists & day plan" },
  { id: "notes", label: "Notes", hint: "Pages, board & journal" },
  { id: "habits", label: "Habits", hint: "Daily rituals" },
  { id: "stats", label: "Stats", hint: "Numbers & heatmap" },
  { id: "sounds", label: "Sounds", hint: "Records, mixer & piano" },
  { id: "settings", label: "Settings", hint: "Preferences" },
];
