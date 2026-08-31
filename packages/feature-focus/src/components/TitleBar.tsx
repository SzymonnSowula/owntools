import { useEffect, useState } from "react";
import { isTauri } from "../lib/env";

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      setMaximized(await win.isMaximized());
      unlisten = await win.onResized(async () => {
        setMaximized(await win.isMaximized());
      });
    })();
    return () => unlisten?.();
  }, []);

  const act = async (kind: "hide" | "max" | "close") => {
    if (!isTauri()) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    if (kind === "hide") await win.hide();
    if (kind === "max") await win.toggleMaximize();
    if (kind === "close") await win.close();
  };

  return (
    <header className="titlebar">
      <div className="titlebar-drag" data-tauri-drag-region>
        <span className="titlebar-hint">focus</span>
      </div>
      <div className="win-controls">
        <button className="win-btn" aria-label="Ukryj do zasobnika" onClick={() => void act("hide")}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <rect x="1" y="5" width="8" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          className="win-btn"
          aria-label={maximized ? "Przywróć" : "Maksymalizuj"}
          onClick={() => void act("max")}
        >
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <rect x="2" y="3" width="5" height="5" fill="none" stroke="currentColor" />
              <path d="M3 3V2h5v5H7" fill="none" stroke="currentColor" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <rect x="2" y="2" width="6" height="6" fill="none" stroke="currentColor" />
            </svg>
          )}
        </button>
        <button className="win-btn close" aria-label="Ukryj (wyjście z zasobnika)" onClick={() => void act("close")}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </header>
  );
}
