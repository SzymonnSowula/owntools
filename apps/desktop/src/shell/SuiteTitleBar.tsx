import { useEffect, useRef, useState } from "react";
import { isTauri } from "@core/env";
import { SUITE_NAME } from "@core/branding";
import { BrandMark } from "@ui/BrandMark";
import { THEMES } from "@feature-focus/lib/themes";
import { useAppStore } from "@feature-focus/store/useAppStore";
import { useShellStore, type Tool } from "./shellStore";

function ThemeMenu() {
  const theme = useAppStore((s) => s.settings.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="theme-wrap no-drag" ref={wrapRef}>
      <button
        className="theme-btn"
        aria-label="Theme"
        aria-expanded={open}
        title="Theme"
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden>
          <circle cx="7" cy="7" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M7 1.6a5.4 5.4 0 010 10.8z" fill="currentColor" />
        </svg>
      </button>
      {open ? (
        <div className="theme-pop" role="menu">
          <div className="theme-pop-label">Theme</div>
          {THEMES.map((t) => (
            <button
              key={t.id}
              className={`theme-item${t.id === theme ? " active" : ""}`}
              role="menuitemradio"
              aria-checked={t.id === theme}
              onClick={() => {
                setTheme(t.id);
                setOpen(false);
              }}
            >
              <span className="theme-dots" aria-hidden>
                {t.swatch.map((c, i) => (
                  <span key={i} className="theme-dot" style={{ background: c }} />
                ))}
              </span>
              {t.label}
              {t.id === theme ? (
                <svg className="theme-item-check" width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path d="M2 6.4l2.6 2.6L10 3.4" />
                </svg>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const TOOL_LABEL: Record<Tool, string | null> = {
  hub: null,
  focus: "focus",
  create: "screeni",
  capture: "capture",
  launch: "launch",
  dictate: "dictate",
  meet: "meet",
  board: "board",
  social: "social",
  disk: "disk",
};

export function SuiteTitleBar() {
  const tool = useShellStore((s) => s.tool);
  const setTool = useShellStore((s) => s.setTool);
  const closeToTray = useAppStore((s) => s.settings.closeToTray ?? true);
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

  // Minimise really minimises (the taskbar entry stays); only Close goes to
  // the tray, and only while the user keeps that setting on.
  const act = async (kind: "min" | "max" | "close") => {
    if (!isTauri()) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    if (kind === "min") await win.minimize();
    if (kind === "max") await win.toggleMaximize();
    if (kind === "close") await win.close();
  };

  const label = TOOL_LABEL[tool];

  return (
    <header className="titlebar">
      <div className="titlebar-drag" data-tauri-drag-region>
        <button className="crumb no-drag" onClick={() => setTool("hub")} title="Back to the hub">
          <BrandMark size={12} />
          {SUITE_NAME}
        </button>
        {label ? (
          <span className="crumb" style={{ cursor: "default" }}>
            <span className="crumb-sep">›</span> {label}
          </span>
        ) : null}
      </div>
      <ThemeMenu />
      <div className="win-controls">
        <button className="win-btn" aria-label="Minimize" title="Minimize" onClick={() => void act("min")}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <rect x="1" y="5" width="8" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          className="win-btn"
          aria-label={maximized ? "Restore" : "Maximize"}
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
        <button
          className="win-btn close"
          aria-label={closeToTray ? "Close (keeps running in the tray)" : "Close"}
          title={closeToTray ? "Close (keeps running in the tray)" : "Close"}
          onClick={() => void act("close")}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </header>
  );
}
