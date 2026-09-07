import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Copy, Crosshair, ExternalLink, Eye, Trash2, X } from "lucide-react";
import type { NodeInfo } from "../api/types";
import { useDiskStore } from "../store";

export interface MenuState {
  node: NodeInfo;
  x: number;
  y: number;
}

/**
 * Right-click menu for a node: open, reveal, copy path, focus (make it the
 * view root) and the cleanup toggle. One instance per page; positioned in
 * the page's own coordinates.
 */
export function ContextMenu({ menu, onClose }: { menu: MenuState | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const inCleanup = useDiskStore((s) => (menu ? s.cleanup.some((c) => c.id === menu.node.id) : false));
  const { drill, toggleCleanup, reveal, open, copyPath } = useDiskStore.getState();

  useLayoutEffect(() => {
    if (!menu || !ref.current) {
      setPos(null);
      return;
    }
    const r = ref.current.getBoundingClientRect();
    const left = Math.min(menu.x, window.innerWidth - r.width - 8);
    const top = Math.min(menu.y, window.innerHeight - r.height - 8);
    setPos({ left, top });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", onClose);
    };
  }, [menu, onClose]);

  if (!menu) return null;
  const n = menu.node;
  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };
  return (
    <div ref={ref} className="dk-menu" role="menu" style={{ left: pos?.left ?? menu.x, top: pos?.top ?? menu.y, visibility: pos ? "visible" : "hidden" }}>
      <div className="dk-menu-title" title={n.path}>
        {n.name}
      </div>
      {n.kind === "dir" ? (
        <button role="menuitem" onClick={run(() => drill(n.id))}>
          <Crosshair size={13} /> Focus here
        </button>
      ) : null}
      <button role="menuitem" onClick={run(() => open(n.path))}>
        <ExternalLink size={13} /> Open
      </button>
      <button role="menuitem" onClick={run(() => reveal(n.path))}>
        <Eye size={13} /> Reveal in Explorer
      </button>
      <button role="menuitem" onClick={run(() => copyPath(n.path))}>
        <Copy size={13} /> Copy path
      </button>
      <hr />
      <button role="menuitem" className={inCleanup ? "" : "danger"} onClick={run(() => toggleCleanup(n))}>
        {inCleanup ? <X size={13} /> : <Trash2 size={13} />} {inCleanup ? "Remove from cleanup" : "Add to cleanup"}
      </button>
    </div>
  );
}
