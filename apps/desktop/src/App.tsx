import { DialogHost } from "@ui/Dialog";
import { lazy, Suspense, useEffect, useState } from "react";
import { isTauri } from "@core/env";
import { OPEN_TOOL_EVENT } from "@core/handoff";
import { OPEN_SETTINGS_SECTION_EVENT } from "@core/llm";
import { unlockAudio } from "@feature-focus/lib/audio/engine";
import { VIEWS } from "@feature-focus/types";
import { useAppStore, type UsageTick } from "@feature-focus/store/useAppStore";
import { ShortcutsOverlay } from "@feature-focus/components/ShortcutsOverlay";
import { QuickCapture } from "@feature-focus/components/QuickCapture";
import { Hub } from "./shell/Hub";
import { FocusTool } from "./shell/FocusTool";
import { FocusTimerOverlay } from "./shell/FocusTimerOverlay";
import { SuiteTitleBar } from "./shell/SuiteTitleBar";
import { ToolRail } from "./shell/ToolRail";
import { Onboarding, isOnboarded } from "./shell/Onboarding";
import { SessionSheet } from "./shell/SessionSheet";
import { WorkspaceSetup } from "./shell/WorkspaceSetup";
import { useShellStore, type Tool } from "./shell/shellStore";
import { runLegacyImport } from "./shell/importLegacy";
import { UpdateBanner } from "./shell/UpdateBanner";
import { SUITE_NAME } from "@core/branding";
import { logError } from "@core/errors";
import { listenForDictation } from "@feature-dictation/insert";
import { initLicense } from "@licensing/license";

const TOOLS: readonly Tool[] = [
  "hub",
  "focus",
  "create",
  "capture",
  "launch",
  "dictate",
  "meet",
  "board",
  "social",
  "disk",
];

const CreateModule = lazy(() => import("./shell/CreateModule"));
const HubToolModals = lazy(() => import("./shell/HubToolModals"));
const LaunchModule = lazy(() => import("@feature-launch/LaunchView"));
const DictateModule = lazy(() => import("@feature-dictation/DictateView"));
const BoardModule = lazy(() => import("@feature-board/BoardView"));
const SocialModule = lazy(() => import("@feature-social/SocialView"));
const DiskModule = lazy(() => import("@feature-disk/DiskView"));
const MeetModule = lazy(() => import("@feature-meet/MeetView"));
const CaptureModule = lazy(() => import("@feature-capture/CaptureView"));

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
  const hubTool = useShellStore((s) => s.hubTool);
  const [showOnboarding, setShowOnboarding] = useState(() => !isOnboarded());

  useEffect(() => {
    void (async () => {
      // The license cache has to be warm before any module renders isPro().
      await initLicense().catch((err) => logError("main", "license init", err));
      await runLegacyImport();
      await hydrate();
    })();
  }, [hydrate]);

  // The social scheduler publishes from the tray whether or not its tool is
  // open: the runtime (30 s runner, catch-up, agent events) starts with the app.
  useEffect(() => {
    void import("@feature-social/runtime").then((m) => m.startSocialRuntime()).catch((err) => logError("main", "social runtime", err));
  }, []);

  useEffect(() => {
    const unlock = () => void unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  // The main window runs with Tauri's native drag-drop handler off
  // (tauri.conf.json `dragDropEnabled: false`) so HTML5 drops reach the board
  // and the transcribe drop zone. Without a handler, a file dropped anywhere
  // else would navigate the webview to it — swallow those here.
  useEffect(() => {
    const block = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
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
        await listen("tray-start-session", () => {
          const { workspaceId } = useAppStore.getState();
          useShellStore.getState().openSession(workspaceId);
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
      // The dictation pill sends users here when whisper is not installed yet.
      unsubs.push(
        await listen<{ tool?: string }>("open-tool", (event) => {
          const tool = event.payload?.tool;
          if (tool && (TOOLS as readonly string[]).includes(tool)) {
            useShellStore.getState().setTool(tool as Tool);
          }
        }),
      );
      // One tool handing its output to another (screeni → social) asks the
      // shell to switch with a DOM event: same window, no Tauri round trip,
      // and it works in the browser preview too.
      const onOpenTool = (e: Event) => {
        const tool = (e as CustomEvent<{ tool?: string }>).detail?.tool;
        if (tool && (TOOLS as readonly string[]).includes(tool)) useShellStore.getState().setTool(tool as Tool);
      };
      window.addEventListener(OPEN_TOOL_EVENT, onOpenTool);
      unsubs.push(() => window.removeEventListener(OPEN_TOOL_EVENT, onOpenTool));
      // "Set up a model" / "see the privacy log" links from any tool land on
      // the app-wide settings, which live in focus → Settings.
      const onOpenSettings = (e: Event) => {
        const section = (e as CustomEvent<{ section?: string }>).detail?.section;
        useShellStore.getState().setTool("focus");
        useShellStore.getState().setFocusOverview(false);
        useAppStore.getState().setView("settings");
        if (section) {
          window.setTimeout(() => {
            document.querySelector(`[data-settings-section="${section}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
          }, 120);
        }
      };
      window.addEventListener(OPEN_SETTINGS_SECTION_EVENT, onOpenSettings);
      unsubs.push(() => window.removeEventListener(OPEN_SETTINGS_SECTION_EVENT, onOpenSettings));
      // ...and hands the transcript over when this window is the one in front
      // (focused field, the board, or the clipboard — see feature-dictation/insert.ts).
      unsubs.push(await listenForDictation());
      // Time tracking stays off natively until the user has seen the consent
      // step: the onboarding pushes the choice itself when it finishes.
      if (isOnboarded()) {
        const enabled = useAppStore.getState().settings.usageTracking;
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("usage_set_enabled", { enabled });
        } catch (err) {
          logError("main", "usage_set_enabled", err);
        }
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
      {/* The rail is the app's navigation: always there, one click between
          tools. The pane beside it is whatever tool is open. */}
      <div className="app-body">
        <ToolRail />
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
        ) : tool === "board" ? (
          <main className="create-main mod-board">
            <Suspense fallback={<div className="board-loading">Loading board…</div>}>
              <BoardModule />
            </Suspense>
          </main>
        ) : tool === "social" ? (
          <main className="create-main">
            <Suspense fallback={<div className="grid flex-1 place-items-center text-sm">Loading social…</div>}>
              <SocialModule />
            </Suspense>
          </main>
        ) : tool === "meet" ? (
          <main className="create-main mod-meet">
            <Suspense fallback={<div className="grid flex-1 place-items-center text-sm">Loading meet…</div>}>
              <MeetModule />
            </Suspense>
          </main>
        ) : tool === "capture" ? (
          <main className="create-main mod-capture">
            <Suspense fallback={<div className="grid flex-1 place-items-center text-sm">Loading capture…</div>}>
              <CaptureModule />
            </Suspense>
          </main>
        ) : tool === "disk" ? (
          <main className="create-main mod-disk">
            <Suspense fallback={<div className="grid flex-1 place-items-center text-sm">Loading disk…</div>}>
              <DiskModule />
            </Suspense>
          </main>
        ) : (
          <LazyPane>
            <DictateModule />
          </LazyPane>
        )}
      </div>
      {hubTool !== null ? (
        <div className="mod-create">
          <Suspense fallback={null}>
            <HubToolModals />
          </Suspense>
        </div>
      ) : null}
      <SessionSheet />
      <WorkspaceSetup />
      <ShortcutsOverlay />
      <QuickCapture />
      <FocusTimerOverlay />
      <UpdateBanner />
      <DialogHost />
      {ready && showOnboarding ? <Onboarding onDone={() => setShowOnboarding(false)} /> : null}
    </div>
  );
}
