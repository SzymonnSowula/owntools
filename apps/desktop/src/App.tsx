import { lazy, Suspense, useEffect, type ReactElement } from "react";
import { isTauri } from "@core/env";
import { SUITE_NAME } from "@core/branding";
import { unlockAudio } from "@feature-focus/lib/audio/engine";
import { VIEWS, type View } from "@feature-focus/types";
import { useAppStore, type UsageTick } from "@feature-focus/store/useAppStore";
import { TitleBar } from "@feature-focus/components/TitleBar";
import { ScrollGuardBanner } from "@feature-focus/components/ScrollGuardBanner";
import { ShortcutsOverlay } from "@feature-focus/components/ShortcutsOverlay";
import { QuickCapture } from "@feature-focus/components/QuickCapture";
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
import { SuiteSidebar } from "./shell/SuiteSidebar";
import { useShellStore } from "./shell/shellStore";
import { runLegacyImport } from "./shell/importLegacy";

const CreateModule = lazy(() => import("./shell/CreateModule"));

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

export default function App() {
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
  const section = useShellStore((s) => s.section);

  useEffect(() => {
    void (async () => {
      await runLegacyImport();
      await hydrate();
    })();
  }, [hydrate]);

  useEffect(() => {
    const unlock = () => void unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const unsubs: Array<() => void> = [];
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unsubs.push(
        await listen("tray-toggle-focus", () => {
          useAppStore.getState().toggleTimer();
        }),
      );
      unsubs.push(
        await listen("tray-quick-note", () => {
          useShellStore.getState().setSection("focus");
          useAppStore.getState().openQuickCapture("note");
        }),
      );
      unsubs.push(
        await listen<UsageTick>("usage-tick", (event) => {
          useAppStore.getState().applyUsageTick(event.payload);
        }),
      );
      // A finished recording is persisted by the overlay window; we just open it.
      unsubs.push(
        await listen<{ projectId: string }>("recording-finished", (event) => {
          void (async () => {
            const { showMainWindow } = await import("@core/recorderWindow");
            await showMainWindow();
            useShellStore.getState().setSection("create");
            const { useAppStore: useEditorStore } = await import(
              "@feature-editor/store/appStore"
            );
            await useEditorStore.getState().openRecent(event.payload.projectId);
          })();
        }),
      );
      unsubs.push(
        await listen("recorder-cancelled", () => {
          void import("@core/recorderWindow").then((m) => m.showMainWindow());
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
    if (section !== "focus") return;
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
    section,
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
    <div className="app mod-focus">
      <TitleBar />
      {!ready ? (
        <div className="loading">{SUITE_NAME}</div>
      ) : (
        <div className="shell">
          <SuiteSidebar />
          {section === "focus" ? (
            <main className="main">
              <ScrollGuardBanner />
              <Page />
            </main>
          ) : (
            <main className="create-main mod-create">
              <Suspense
                fallback={<div className="grid flex-1 place-items-center text-sm">Loading…</div>}
              >
                <CreateModule />
              </Suspense>
            </main>
          )}
        </div>
      )}
      <ShortcutsOverlay />
      <QuickCapture />
    </div>
  );
}
