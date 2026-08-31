import { lazy, Suspense, useEffect } from "react";
import { isTauri } from "@core/env";
import { unlockAudio } from "@feature-focus/lib/audio/engine";
import { VIEWS } from "@feature-focus/types";
import { useAppStore, type UsageTick } from "@feature-focus/store/useAppStore";
import { ShortcutsOverlay } from "@feature-focus/components/ShortcutsOverlay";
import { QuickCapture } from "@feature-focus/components/QuickCapture";
import { Hub } from "./shell/Hub";
import { FocusTool } from "./shell/FocusTool";
import { FocusTimerOverlay } from "./shell/FocusTimerOverlay";
import { SuiteTitleBar } from "./shell/SuiteTitleBar";
import { useShellStore } from "./shell/shellStore";
import { runLegacyImport } from "./shell/importLegacy";
import { SUITE_NAME } from "@core/branding";

const CreateModule = lazy(() => import("./shell/CreateModule"));
const LaunchModule = lazy(() => import("@feature-launch/LaunchView"));
const DictateModule = lazy(() => import("@feature-dictation/DictateView"));

function LazyPane({ children }: { children: React.ReactNode }) {
  return (
    <main className="create-main mod-create">
      <Suspense fallback={<div className="grid flex-1 place-items-center text-sm">Loading…</div>}>
        {children}
      </Suspense>
    </main>
  );
}

export default function App() {
  const ready = useAppStore((s) => s.ready);
  const hydrate = useAppStore((s) => s.hydrate);
  const setView = useAppStore((s) => s.setView);
  const setShortcutsOpen = useAppStore((s) => s.setShortcutsOpen);
  const openQuickCapture = useAppStore((s) => s.openQuickCapture);
  const closeQuickCapture = useAppStore((s) => s.closeQuickCapture);
  const shortcutsOpen = useAppStore((s) => s.shortcutsOpen);
  const quickOpen = useAppStore((s) => s.quickOpen);
  const toggleTimer = useAppStore((s) => s.toggleTimer);
  const tool = useShellStore((s) => s.tool);

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
          useShellStore.getState().setTool("focus");
          useShellStore.getState().setFocusOverview(false);
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
            useShellStore.getState().setTool("create");
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
    if (tool !== "focus") return;
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
          if (id) {
            setView(id);
            useShellStore.getState().setFocusOverview(false);
          }
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    tool,
    closeQuickCapture,
    openQuickCapture,
    quickOpen,
    setShortcutsOpen,
    setView,
    shortcutsOpen,
    toggleTimer,
  ]);

  return (
    <div className="app mod-focus">
      <SuiteTitleBar />
      {!ready ? (
        <div className="loading">{SUITE_NAME}</div>
      ) : tool === "hub" ? (
        <Hub />
      ) : tool === "focus" ? (
        <FocusTool />
      ) : tool === "create" ? (
        <LazyPane>
          <CreateModule />
        </LazyPane>
      ) : tool === "launch" ? (
        <LazyPane>
          <LaunchModule />
        </LazyPane>
      ) : (
        <LazyPane>
          <DictateModule />
        </LazyPane>
      )}
      <ShortcutsOverlay />
      <QuickCapture />
      <FocusTimerOverlay />
    </div>
  );
}
