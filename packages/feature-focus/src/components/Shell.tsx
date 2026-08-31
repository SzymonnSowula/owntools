import { useEffect, type ReactElement } from "react";
import { isTauri } from "../lib/env";
import { unlockAudio } from "../lib/audio/engine";
import { VIEWS, type View } from "../types";
import { useAppStore, type UsageTick } from "../store/useAppStore";
import { TitleBar } from "./TitleBar";
import { ScrollGuardBanner } from "./ScrollGuardBanner";
import { Sidebar } from "./Sidebar";
import { ShortcutsOverlay } from "./ShortcutsOverlay";
import { QuickCapture } from "./QuickCapture";
import { TodayView } from "../features/today/TodayView";
import { HeatmapView } from "../features/heatmap/HeatmapView";
import { TasksView } from "../features/tasks/TasksView";
import { NotesView } from "../features/notes/NotesView";
import { NotebookView } from "../features/notebook/NotebookView";
import { HabitsView } from "../features/habits/HabitsView";
import { SoundsView } from "../features/sounds/SoundsView";
import { PianoView } from "../features/piano/PianoView";
import { PlannerView } from "../features/planner/PlannerView";
import { JournalView } from "../features/journal/JournalView";
import { StatsView } from "../features/stats/StatsView";
import { SettingsView } from "../features/settings/SettingsView";

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

export function Shell() {
  const ready = useAppStore((s) => s.ready);
  const view = useAppStore((s) => s.view);
  const hydrate = useAppStore((s) => s.hydrate);
  const setView = useAppStore((s) => s.setView);
  const setShortcutsOpen = useAppStore((s) => s.setShortcutsOpen);
  const openQuickCapture = useAppStore((s) => s.openQuickCapture);
  const closeQuickCapture = useAppStore((s) => s.closeQuickCapture);
  const shortcutsOpen = useAppStore((s) => s.shortcutsOpen);
  const quickOpen = useAppStore((s) => s.quickOpen);
  const toggleTimer = useAppStore((s) => s.toggleTimer);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    const unlock = () => void unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let unsubs: Array<() => void> = [];
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unsubs.push(
        await listen("tray-toggle-focus", () => {
          useAppStore.getState().toggleTimer();
        }),
      );
      unsubs.push(
        await listen("tray-quick-note", () => {
          useAppStore.getState().openQuickCapture("note");
        }),
      );
      unsubs.push(
        await listen<UsageTick>("usage-tick", (event) => {
          useAppStore.getState().applyUsageTick(event.payload);
        }),
      );
      const enabled = useAppStore.getState().settings.usageTracking;
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("usage_set_enabled", { enabled });
      } catch {
        /* */
      }
    })();
    return () => unsubs.forEach((u) => u());
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openQuickCapture();
        return;
      }
      if (e.key === "?" || ((e.ctrlKey || e.metaKey) && e.key === "/")) {
        e.preventDefault();
        setShortcutsOpen(!shortcutsOpen);
        return;
      }
      if (e.key === "Escape") {
        closeQuickCapture();
        setShortcutsOpen(false);
        return;
      }
      if (typing && !((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n")) {
        /* allow Ctrl+N even in fields except capture */
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        if (useAppStore.getState().view === "notebook" && !quickOpen) {
          e.preventDefault();
          useAppStore.getState().createNotebookPage();
          return;
        }
      }
      if (typing) return;
      if (e.key === " " && !quickOpen && !shortcutsOpen) {
        e.preventDefault();
        toggleTimer();
      }
      if (e.ctrlKey || e.metaKey) {
        const n = Number(e.key);
        if (n >= 1 && n <= 9) {
          e.preventDefault();
          const id = VIEWS[n - 1]?.id;
          if (id) setView(id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    closeQuickCapture,
    openQuickCapture,
    quickOpen,
    setShortcutsOpen,
    setView,
    shortcutsOpen,
    toggleTimer,
  ]);

  const Page = VIEW_MAP[view];

  return (
    <div className="app">
      <TitleBar />
      {!ready ? (
        <div className="loading">focus</div>
      ) : (
        <div className="shell">
          <Sidebar />
          <main className="main">
            <ScrollGuardBanner />
            <Page />
          </main>
        </div>
      )}
      <ShortcutsOverlay />
      <QuickCapture />
    </div>
  );
}
