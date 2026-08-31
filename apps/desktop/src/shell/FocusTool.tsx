import type { ReactElement } from "react";
import { VIEWS, type View } from "@feature-focus/types";
import { formatMs } from "@feature-focus/lib/dates";
import { useAppStore } from "@feature-focus/store/useAppStore";
import { ScrollGuardBanner } from "@feature-focus/components/ScrollGuardBanner";
import { TodayView } from "@feature-focus/features/today/TodayView";
import { HeatmapView } from "@feature-focus/features/heatmap/HeatmapView";
import { TasksView } from "@feature-focus/features/tasks/TasksView";
import { NotesView } from "@feature-focus/features/notes/NotesView";
import { NotebookView } from "@feature-focus/features/notebook/NotebookView";
import { HabitsView } from "@feature-focus/features/habits/HabitsView";
import { SoundsView } from "@feature-focus/features/sounds/SoundsView";
import { PianoView } from "@feature-focus/features/piano/PianoView";
import { PlannerView } from "@feature-focus/features/planner/PlannerView";
import { JournalView } from "@feature-focus/features/journal/JournalView";
import { StatsView } from "@feature-focus/features/stats/StatsView";
import { SettingsView } from "@feature-focus/features/settings/SettingsView";
import { useShellStore } from "./shellStore";

const VIEW_MAP: Record<View, () => ReactElement> = {
  today: TodayView,
  heatmap: HeatmapView,
  tasks: TasksView,
  notes: NotesView,
  notebook: NotebookView,
  habits: HabitsView,
  sounds: SoundsView,
  piano: PianoView,
  planner: PlannerView,
  journal: JournalView,
  stats: StatsView,
  settings: SettingsView,
};

export const FOCUS_ICONS: Record<View, ReactElement> = {
  today: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
      <rect x="2" y="3" width="10" height="9" rx="1.5" />
      <path d="M2 6h10M5 3V2M9 3V2" />
    </svg>
  ),
  heatmap: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <rect x="1" y="1" width="3" height="3" rx="0.6" opacity="0.35" />
      <rect x="5.5" y="1" width="3" height="3" rx="0.6" />
      <rect x="10" y="1" width="3" height="3" rx="0.6" opacity="0.6" />
      <rect x="1" y="5.5" width="3" height="3" rx="0.6" />
      <rect x="5.5" y="5.5" width="3" height="3" rx="0.6" opacity="0.4" />
      <rect x="10" y="5.5" width="3" height="3" rx="0.6" />
      <rect x="1" y="10" width="3" height="3" rx="0.6" opacity="0.5" />
      <rect x="5.5" y="10" width="3" height="3" rx="0.6" />
      <rect x="10" y="10" width="3" height="3" rx="0.6" opacity="0.3" />
    </svg>
  ),
  tasks: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M3 7l2 2 6-6" />
      <path d="M3 11.5h8" />
    </svg>
  ),
  notes: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M3 2.5h6l2 2V12H3V2.5z" />
      <path d="M9 2.5V5h2" />
    </svg>
  ),
  notebook: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
      <rect x="3" y="2" width="8" height="10" rx="1" />
      <path d="M5 5h4M5 7.5h4M5 10h2" />
    </svg>
  ),
  habits: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
      <circle cx="7" cy="7" r="5" />
      <path d="M7 4v3l2 1" />
    </svg>
  ),
  sounds: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M3 6v2M5.5 4.5v5M8 3v8M10.5 5v4" />
    </svg>
  ),
  piano: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
      <rect x="2" y="3" width="10" height="8" rx="1" />
      <path d="M5 3v5M9 3v5" />
    </svg>
  ),
  planner: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M2 4h10M4 2v2M10 2v2M3 4v8h8V4" />
    </svg>
  ),
  journal: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M4 2.5h7v9H4a1.5 1.5 0 010-3H11" />
    </svg>
  ),
  stats: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M3 11V7M7 11V3M11 11V6" />
    </svg>
  ),
  settings: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
      <circle cx="7" cy="7" r="2" />
      <path d="M7 1.5v2M7 10.5v2M1.5 7h2M10.5 7h2M3.1 3.1l1.4 1.4M9.5 9.5l1.4 1.4M3.1 10.9l1.4-1.4M9.5 4.5l1.4-1.4" />
    </svg>
  ),
};

function FocusOverview() {
  const setView = useAppStore((s) => s.setView);
  const setFocusOverview = useShellStore((s) => s.setFocusOverview);
  return (
    <div className="desktop-bg" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 24 }}>
      <div className="tiles" style={{ maxWidth: 920, margin: "0 auto" }}>
        {VIEWS.map((item, i) => (
          <button
            key={item.id}
            className="wincard"
            style={{ transform: `rotate(${i % 2 === 0 ? -0.7 : 0.7}deg)` }}
            onClick={() => {
              setView(item.id);
              setFocusOverview(false);
            }}
          >
            <div className="wincard-bar">
              <span className="wincard-dot r" />
              <span className="wincard-dot y" />
              <span className="wincard-dot g" />
              <span className="wincard-title">{item.id}</span>
            </div>
            <div className="wincard-body">
              <div style={{ color: "var(--text, #111)", marginBottom: 8 }}>{FOCUS_ICONS[item.id]}</div>
              <div className="tile-label">{item.label}</div>
              <div className="tile-hint">{item.hint}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function FocusTool() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const timer = useAppStore((s) => s.timer);
  const toggleTimer = useAppStore((s) => s.toggleTimer);
  const overview = useShellStore((s) => s.focusOverview);
  const setFocusOverview = useShellStore((s) => s.setFocusOverview);

  const Page = VIEW_MAP[view];

  return (
    <div className="shell">
      <aside className="sidebar">
        <nav className="nav" aria-label="Focus">
          <button
            className={`nav-item${overview ? " active" : ""}`}
            onClick={() => setFocusOverview(true)}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="1.5" y="1.5" width="4.5" height="4.5" rx="1" />
              <rect x="8" y="1.5" width="4.5" height="4.5" rx="1" />
              <rect x="1.5" y="8" width="4.5" height="4.5" rx="1" />
              <rect x="8" y="8" width="4.5" height="4.5" rx="1" />
            </svg>
            Overview
          </button>
          {VIEWS.map((item) => (
            <button
              key={item.id}
              className={`nav-item${!overview && view === item.id ? " active" : ""}`}
              onClick={() => {
                setView(item.id);
                setFocusOverview(false);
              }}
            >
              {FOCUS_ICONS[item.id]}
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="sidebar-timer">
            <span>
              {timer.mode === "break" ? "Break" : "Focus"} ·{" "}
              <strong>{formatMs(timer.remainingMs)}</strong>
            </span>
            <button className="btn small ghost" onClick={toggleTimer}>
              {timer.running ? "Pause" : "Start"}
            </button>
          </div>
        </div>
      </aside>
      {overview ? (
        <FocusOverview />
      ) : (
        <main className="main">
          <ScrollGuardBanner />
          <Page />
        </main>
      )}
    </div>
  );
}
