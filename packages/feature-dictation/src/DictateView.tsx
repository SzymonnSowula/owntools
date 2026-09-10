import "./dictate.css";
import { BookA, Cpu, History, Home, SlidersHorizontal } from "lucide-react";
import { ToolMark } from "@ui/ToolMark";
import { useEffect, useState, type ReactElement } from "react";
import { isTauri } from "@core/env";
import { DICTATION_HOTKEY_LABEL } from "@core/hotkeys";
import { Kbd } from "./components";
import { dictationHotkeyRegistered, dictationReady, dictationStatus, type EngineStatus } from "./engine";
import { useInstallSession } from "./install";
import { HistoryPage } from "./pages/HistoryPage";
import { ModelsPage } from "./pages/ModelsPage";
import { OverviewPage } from "./pages/OverviewPage";
import { SettingsPage } from "./pages/SettingsPage";
import { VocabularyPage } from "./pages/VocabularyPage";
import { useDictationSettings } from "./useSettings";

export type Page = "overview" | "vocabulary" | "models" | "settings" | "history";

const NAV: { id: Page; label: string; icon: ReactElement }[] = [
  { id: "overview", label: "Overview", icon: <Home /> },
  { id: "vocabulary", label: "Vocabulary", icon: <BookA /> },
  { id: "models", label: "Models", icon: <Cpu /> },
  { id: "settings", label: "Settings", icon: <SlidersHorizontal /> },
  { id: "history", label: "History", icon: <History /> },
];

/** Survives leaving the tool and coming back within a session. */
let lastPage: Page = "overview";

/**
 * dictate — the tool's home: a sidebar of pages (overview, vocabulary, models,
 * settings, history) over one shared settings store. The install session and
 * the whisper status are owned here and handed down.
 */
export default function DictateView() {
  const [page, setPage] = useState<Page>(lastPage);
  const [status, setStatus] = useState<EngineStatus | null>(null);
  /** null = unknown / not Tauri; false = another app owns the hotkey. */
  const [hotkeyOk, setHotkeyOk] = useState<boolean | null>(null);
  const [settings] = useDictationSettings();
  const { installing, generation } = useInstallSession();

  const refresh = () => void dictationStatus().then(setStatus).catch(() => setStatus(null));

  // On mount and after every finished install attempt.
  useEffect(() => {
    refresh();
  }, [generation]);

  useEffect(() => {
    let alive = true;
    void dictationHotkeyRegistered().then((ok) => {
      if (alive) setHotkeyOk(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

  function go(next: Page) {
    lastPage = next;
    setPage(next);
  }

  const ready = dictationReady(status);
  const statusClass = installing ? "busy" : ready ? "ok" : "";
  const statusText = !isTauri()
    ? "browser preview"
    : installing
      ? "installing…"
      : ready
        ? "ready"
        : "not set up";

  return (
    <div className="dt">
      <aside className="dt-side">
        <div className="dt-side-brand">
          <span className="dt-side-icon" aria-hidden>
            <ToolMark tool="dictate" size={32} />
          </span>
          <div>
            <div className="dt-side-name">dictate</div>
            <div className={`dt-side-status ${statusClass}`}>
              <i aria-hidden />
              {statusText}
            </div>
          </div>
        </div>
        <nav className="dt-nav" aria-label="Dictate">
          {NAV.map((item) => (
            <button
              key={item.id}
              className={`dt-nav-item${page === item.id ? " active" : ""}`}
              aria-current={page === item.id ? "page" : undefined}
              onClick={() => go(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.id === "vocabulary" && settings.entries.length ? (
                <span className="dt-nav-count">{settings.entries.length}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="dt-side-foot">
          <Kbd>{DICTATION_HOTKEY_LABEL}</Kbd>
          <div>starts and stops a take in any app.</div>
        </div>
      </aside>
      <main className="dt-main">
        {page === "overview" ? (
          <OverviewPage status={status} hotkeyOk={hotkeyOk} onNavigate={go} />
        ) : page === "vocabulary" ? (
          <VocabularyPage />
        ) : page === "models" ? (
          <ModelsPage status={status} refresh={refresh} />
        ) : page === "settings" ? (
          <SettingsPage hotkeyOk={hotkeyOk} status={status} />
        ) : (
          <HistoryPage onNavigate={go} />
        )}
      </main>
    </div>
  );
}
