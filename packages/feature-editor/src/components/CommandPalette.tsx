import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../store/appStore";

export interface PaletteCommand {
  id: string;
  label: string;
  group: string;
  /** Shortcut label, e.g. "S" or "Ctrl+Z". */
  keys?: string;
  hint?: string;
  disabled?: boolean;
  run: () => void;
}

/**
 * Everything the editor can do, one keystroke away. The toolbar keeps the
 * handful of actions you reach for constantly; this is where the rest lives,
 * with its shortcut spelled out next to it so the palette teaches them.
 */
export function CommandPalette({ commands }: { commands: PaletteCommand[] }) {
  const open = useAppStore((s) => s.paletteOpen);
  const setOpen = useAppStore((s) => s.setPaletteOpen);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const usable = commands.filter((c) => !c.disabled);
    if (!q) return usable;
    // Every letter of the query in order — "zi" finds "Zoom in".
    return usable.filter((c) => {
      const haystack = `${c.label} ${c.group} ${c.hint ?? ""}`.toLowerCase();
      if (haystack.includes(q)) return true;
      let i = 0;
      for (const ch of haystack) {
        if (ch === q[i]) i++;
        if (i === q.length) return true;
      }
      return false;
    });
  }, [commands, query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    setActive((i) => Math.min(i, Math.max(0, matches.length - 1)));
  }, [matches.length]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  function runAt(index: number) {
    const command = matches[index];
    if (!command) return;
    setOpen(false);
    command.run();
  }

  let lastGroup = "";

  return (
    <div
      className="absolute inset-0 z-[60] flex items-start justify-center bg-[#17151f]/40 p-6 pt-[12vh]"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-[16px] border border-line bg-card shadow-[0_30px_80px_rgba(23,21,31,0.28)]">
        <input
          autoFocus
          className="w-full border-b border-line bg-transparent px-4 py-3.5 text-sm text-ink outline-none placeholder:text-muted"
          placeholder="Search actions — split, zoom, caption, export…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(matches.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              runAt(active);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
            }
          }}
        />
        <div ref={listRef} className="scroll-thin max-h-[46vh] overflow-y-auto py-1.5">
          {matches.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">Nothing matches “{query}”.</p>
          ) : (
            matches.map((command, index) => {
              const header = command.group !== lastGroup ? command.group : null;
              lastGroup = command.group;
              return (
                <div key={command.id}>
                  {header ? (
                    <p className="px-4 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                      {header}
                    </p>
                  ) : null}
                  <button
                    data-index={index}
                    className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm ${
                      index === active ? "bg-teal/10 text-teal-2" : "text-ink hover:bg-paper"
                    }`}
                    onPointerEnter={() => setActive(index)}
                    onClick={() => runAt(index)}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {command.label}
                      {command.hint ? <span className="ml-2 text-xs text-muted">{command.hint}</span> : null}
                    </span>
                    {command.keys ? (
                      <kbd className="shrink-0 rounded-[6px] border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted">
                        {command.keys}
                      </kbd>
                    ) : null}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
