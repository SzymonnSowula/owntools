import { VIEWS } from "../types";
import { useAppStore } from "../store/useAppStore";

const ROWS = [
  { keys: "Ctrl + K", label: "Szybkie dodawanie" },
  { keys: "?  lub  Ctrl + /", label: "Skróty klawiszowe" },
  { keys: "Ctrl + 1…9", label: "Przełącz widok" },
  { keys: "Spacja", label: "Start / pauza timera" },
  { keys: "Esc", label: "Zamknij panel" },
  { keys: "Ctrl + N", label: "Nowa strona (w notatniku)" },
  { keys: "/  w bloku", label: "Menu bloków" },
  { keys: "Ctrl + B / I", label: "Pogrubienie / kursywa w notatniku" },
];

export function ShortcutsOverlay() {
  const open = useAppStore((s) => s.shortcutsOpen);
  const setOpen = useAppStore((s) => s.setShortcutsOpen);
  if (!open) return null;
  return (
    <div className="overlay" onClick={() => setOpen(false)} role="presentation">
      <div className="modal" role="dialog" aria-label="Skróty" onClick={(e) => e.stopPropagation()}>
        <p className="kicker">Klawiatura</p>
        <h2 className="page-title" style={{ fontSize: 24, marginBottom: 16 }}>
          Skróty
        </h2>
        {ROWS.map((row) => (
          <div className="shortcut-row" key={row.keys}>
            <span>{row.label}</span>
            <kbd>{row.keys}</kbd>
          </div>
        ))}
        <div className="shortcut-row">
          <span>Widoki</span>
          <span className="muted" style={{ fontSize: 12 }}>
            {VIEWS.slice(0, 9).map((v, i) => `${i + 1} ${v.label}`).join(" · ")}
          </span>
        </div>
        <div style={{ marginTop: 16, textAlign: "right" }}>
          <button className="btn" onClick={() => setOpen(false)}>
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
}
