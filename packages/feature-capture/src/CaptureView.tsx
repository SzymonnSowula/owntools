import "./capture.css";
import { Camera, Images, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { isTauri } from "@core/env";
import { CAPTURE_HOTKEY_LABEL } from "@core/hotkeys";
import { takeToolPage } from "@core/navigation";
import { ToolMark } from "@ui/ToolMark";
import { getCaptureBackend } from "./api";
import { Kbd } from "./components";
import { LibraryPage } from "./pages/LibraryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { useLibrary } from "./store";

export type Page = "library" | "settings";

const NAV: { id: Page; label: string; icon: ReactElement }[] = [
  { id: "library", label: "Library", icon: <Images /> },
  { id: "settings", label: "Settings", icon: <SlidersHorizontal /> },
];

/** Survives leaving the tool and coming back within a session. */
let lastPage: Page = "library";

/**
 * capture — the tool's home in the main window: the library of past captures
 * (searchable by the text recognised in them) and the settings. The taking
 * itself happens in the `capture` overlay window, on the shortcut.
 */
export default function CaptureView() {
  const backend = useMemo(() => getCaptureBackend(), []);
  // A jump from the Settings screen ("capture settings") names the page to open on.
  const [page, setPage] = useState<Page>(() => (lastPage = takeToolPage<Page>("capture") ?? lastPage));
  const { items } = useLibrary();
  /** null = unknown / not Tauri; false = another app owns the shortcut. */
  const [hotkeyOk, setHotkeyOk] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void backend.hotkeyRegistered().then((ok) => {
      if (alive) setHotkeyOk(ok);
    });
    return () => {
      alive = false;
    };
  }, [backend]);

  function go(next: Page) {
    lastPage = next;
    setPage(next);
  }

  const statusClass = hotkeyOk === false ? "warn" : isTauri() ? "ok" : "";
  const statusText = !isTauri() ? "browser preview" : hotkeyOk === false ? "shortcut taken" : "ready";

  return (
    <div className="cp">
      <aside className="cp-side">
        <div className="cp-side-brand">
          <span className="cp-side-icon" aria-hidden>
            <ToolMark tool="capture" size={32} />
          </span>
          <div>
            <div className="cp-side-name">capture</div>
            <div className={`cp-side-status ${statusClass}`}>
              <i aria-hidden />
              {statusText}
            </div>
          </div>
        </div>
        <nav className="cp-nav" aria-label="Capture">
          {NAV.map((item) => (
            <button
              key={item.id}
              className={`cp-nav-item${page === item.id ? " active" : ""}`}
              aria-current={page === item.id ? "page" : undefined}
              onClick={() => go(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.id === "library" && items.length ? <span className="cp-nav-count">{items.length}</span> : null}
            </button>
          ))}
        </nav>
        <div className="cp-side-foot">
          {isTauri() ? (
            <button type="button" className="cp-btn cp-side-grab" onClick={() => void backend.grab()} title="Screenshot the monitor under the pointer">
              <Camera />
              <span>Capture now</span>
            </button>
          ) : null}
          <div className="cp-side-hint">
            <Kbd>{CAPTURE_HOTKEY_LABEL}</Kbd>
            <div>freezes the screen under the pointer, in any app.</div>
          </div>
        </div>
      </aside>
      <main className="cp-main">{page === "library" ? <LibraryPage /> : <SettingsPage hotkeyOk={hotkeyOk} />}</main>
    </div>
  );
}
