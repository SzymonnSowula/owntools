import type { NodeInfo } from "../api/types";
import { CATEGORY_COLORS, FOLDER_PALETTE } from "../lib/colors";
import { formatBytes, formatCount, formatPercent } from "../lib/format";
import type { ColorMode } from "../lib/colors";
import type { MenuState } from "./ContextMenu";
import { KindIcon } from "./primitives";

/** The current folder's children as horizontal bars — the fastest read of "what is big here". */
export function BarsView({
  items,
  total,
  colorMode,
  selectedId,
  onSelect,
  onDrill,
  onMenu,
}: {
  items: NodeInfo[];
  total: number;
  colorMode: ColorMode;
  selectedId: number | null;
  onSelect(id: number | null): void;
  onDrill(id: number): void;
  onMenu(menu: MenuState): void;
}) {
  const shown = items.slice(0, 60);
  const max = shown[0]?.size ?? 1;
  return (
    <div className="dk-bars">
      {shown.map((n, i) => {
        const color = colorMode === "type" ? CATEGORY_COLORS[n.cat] : FOLDER_PALETTE[i % FOLDER_PALETTE.length];
        return (
          <button
            key={n.id}
            className={`dk-bar-row${selectedId === n.id ? " selected" : ""}`}
            onClick={() => onSelect(n.id)}
            onDoubleClick={() => n.kind === "dir" && onDrill(n.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              onSelect(n.id);
              onMenu({ node: n, x: e.clientX, y: e.clientY });
            }}
          >
            <span className="dk-bar-label">
              <KindIcon node={n} />
              <span className="dk-name-text" title={n.path}>
                {n.name}
              </span>
              <span className="muted">{n.kind === "dir" ? `${formatCount(n.files)} files` : ""}</span>
            </span>
            <span className="dk-bar-track">
              <span className="dk-bar-fill" style={{ width: `${(n.size / max) * 100}%`, background: color }} />
            </span>
            <span className="dk-bar-size">
              <b>{formatBytes(n.size)}</b>
              <span className="muted">{formatPercent(n.size, total)}</span>
            </span>
          </button>
        );
      })}
      {items.length > shown.length ? <div className="dk-table-empty">…and {formatCount(items.length - shown.length)} smaller items</div> : null}
      {!items.length ? <div className="dk-table-empty">Empty folder</div> : null}
    </div>
  );
}
