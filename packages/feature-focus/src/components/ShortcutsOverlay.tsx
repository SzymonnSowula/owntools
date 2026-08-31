import { VIEWS } from "../types";
import { useAppStore } from "../store/useAppStore";

const ROWS = [
  { keys: "Ctrl + K", label: "Quick capture" },
  { keys: "?  or  Ctrl + /", label: "Keyboard shortcuts" },
  { keys: "Ctrl + 1…9", label: "Switch view" },
  { keys: "Space", label: "Start / pause timer" },
  { keys: "Esc", label: "Close panel" },
  { keys: "Ctrl + N", label: "New page (in notebook)" },
  { keys: "/  in a block", label: "Block menu" },
  { keys: "Ctrl + B / I", label: "Bold / italic in notebook" },
];

export function ShortcutsOverlay() {
  const open = useAppStore((s) => s.shortcutsOpen);
  const setOpen = useAppStore((s) => s.setShortcutsOpen);
  if (!open) return null;
  return (
    <div className="overlay" onClick={() => setOpen(false)} role="presentation">
      <div className="modal" role="dialog" aria-label="Shortcuts" onClick={(e) => e.stopPropagation()}>
        <p className="kicker">Keyboard</p>
        <h2 className="page-title" style={{ fontSize: 24, marginBottom: 16 }}>
          Shortcuts
        </h2>
        {ROWS.map((row) => (
          <div className="shortcut-row" key={row.keys}>
            <span>{row.label}</span>
            <kbd>{row.keys}</kbd>
          </div>
        ))}
        <div className="shortcut-row">
          <span>Views</span>
          <span className="muted" style={{ fontSize: 12 }}>
            {VIEWS.slice(0, 9).map((v, i) => `${i + 1} ${v.label}`).join(" · ")}
          </span>
        </div>
        <div style={{ marginTop: 16, textAlign: "right" }}>
          <button className="btn" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
