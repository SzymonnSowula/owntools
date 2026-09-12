import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@ui/BrandMark";
import { ToolGlyph, TOOL_TINT } from "@ui/ToolMark";
import { QUICK_TOOLS } from "@feature-tools/catalogue";
import { useShellStore } from "./shellStore";
import { TOOL_CARDS, openQuickTool } from "./toolCatalogue";

/** Tile height + gap, in px. The active marker slides by a multiple of this. */
const STEP = 52;

export function ToolRail() {
  const tool = useShellStore((s) => s.tool);
  const setTool = useShellStore((s) => s.setTool);
  const [quickOpen, setQuickOpen] = useState(false);
  const quickRef = useRef<HTMLDivElement | null>(null);

  const activeIndex = TOOL_CARDS.findIndex((c) => c.tool === tool);

  // Alt+1..7 jumps between tools, Alt+0 goes back to the hub. Ctrl+digit is
  // already focus's view switcher, so the rail deliberately stays off it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const n = Number(e.key);
      if (!Number.isInteger(n)) return;
      if (n === 0) {
        e.preventDefault();
        setTool("hub");
        return;
      }
      const card = TOOL_CARDS[n - 1];
      if (card) {
        e.preventDefault();
        setTool(card.tool);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTool]);

  // The popover is the only thing here that can swallow a click, so it closes
  // on anything outside it and on Escape.
  useEffect(() => {
    if (!quickOpen) return;
    function onDown(e: PointerEvent) {
      if (!quickRef.current?.contains(e.target as Node)) setQuickOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setQuickOpen(false);
    }
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [quickOpen]);

  return (
    <nav className="rail" aria-label="Tools">
      <button
        type="button"
        className={`rail-home${tool === "hub" ? " active" : ""}`}
        onClick={() => setTool("hub")}
        aria-current={tool === "hub" ? "page" : undefined}
      >
        <BrandMark size={20} />
        <span className="rail-tip">
          <b>hub</b>
          <i>alt 0</i>
        </span>
      </button>

      <div className="rail-sep" aria-hidden />

      <div className="rail-tools">
        <span
          className="rail-marker"
          data-on={activeIndex >= 0 ? "1" : "0"}
          style={{ transform: `translateY(${Math.max(activeIndex, 0) * STEP}px)` }}
          aria-hidden
        />
        {TOOL_CARDS.map((card, i) => (
          <button
            type="button"
            key={card.tool}
            className={`rail-tool${card.tool === tool ? " active" : ""}`}
            style={{ ["--tint" as string]: TOOL_TINT[card.mark] }}
            onClick={() => setTool(card.tool)}
            aria-current={card.tool === tool ? "page" : undefined}
          >
            <ToolGlyph tool={card.mark} size={23} />
            <span className="rail-tip">
              <b>{card.name}</b>
              <em>{card.blurb}</em>
              <i>alt {i + 1}</i>
            </span>
          </button>
        ))}
      </div>

      <div className="rail-grow" aria-hidden />

      <div className="rail-quick-wrap" ref={quickRef}>
        <button
          type="button"
          className={`rail-quick${quickOpen ? " active" : ""}`}
          onClick={() => setQuickOpen((v) => !v)}
          aria-expanded={quickOpen}
          aria-label="Quick tools"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <rect x="1.5" y="1.5" width="5" height="5" rx="1.6" />
            <rect x="9.5" y="1.5" width="5" height="5" rx="1.6" />
            <rect x="1.5" y="9.5" width="5" height="5" rx="1.6" />
            <rect x="9.5" y="9.5" width="5" height="5" rx="1.6" />
          </svg>
          {!quickOpen ? (
            <span className="rail-tip">
              <b>quick tools</b>
              <em>{QUICK_TOOLS.length} one-off jobs</em>
            </span>
          ) : null}
        </button>
        {quickOpen ? (
          <div className="rail-pop" role="menu">
            <div className="rail-pop-label">quick tools</div>
            {QUICK_TOOLS.map((q) => (
              <button
                type="button"
                key={q.key}
                className="rail-pop-item"
                role="menuitem"
                onClick={() => {
                  setQuickOpen(false);
                  openQuickTool(q.key);
                }}
              >
                <span className="rail-pop-icon">{q.icon}</span>
                <span>
                  <b>{q.name}</b>
                  <i>{q.desc}</i>
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </nav>
  );
}
