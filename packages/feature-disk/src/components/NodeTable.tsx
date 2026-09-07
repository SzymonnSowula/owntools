import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Check } from "lucide-react";
import type { NodeInfo } from "../api/types";
import { CATEGORY_COLORS } from "../lib/colors";
import { formatBytes, formatCount, formatPercent, formatRelative } from "../lib/format";
import { fetchNode } from "../hooks";
import { useDiskStore } from "../store";
import type { MenuState } from "./ContextMenu";
import { categoryLabel, KindIcon, SizeBar } from "./primitives";

/**
 * The sortable node table: list view, files view, quick-win and category
 * collections, search results. Rows select (click), drill (double-click on
 * a folder), open the context menu (right-click) and, when `checkable`,
 * toggle their cleanup membership.
 */
export type SortKey = "size" | "name" | "mtime" | "files" | "cat" | "path";

export interface NodeTableProps {
  items: NodeInfo[];
  /** Total for the percentage column; defaults to the sum of the rows. */
  total?: number;
  selectedId: number | null;
  onSelect(id: number | null): void;
  onDrill(id: number): void;
  onMenu(menu: MenuState): void;
  checkable?: boolean;
  showPath?: boolean;
  showType?: boolean;
  emptyText?: string;
  footer?: ReactNode;
  defaultSort?: SortKey;
  /** Rows beyond this are behind a "show more" button. */
  pageSize?: number;
}

const HEADERS: { key: SortKey; label: string; className?: string }[] = [
  { key: "name", label: "Name", className: "name" },
  { key: "size", label: "Size", className: "num" },
  { key: "files", label: "Items", className: "num items" },
  { key: "cat", label: "Type", className: "type" },
  { key: "mtime", label: "Modified", className: "mtime" },
];

export function NodeTable({
  items,
  total,
  selectedId,
  onSelect,
  onDrill,
  onMenu,
  checkable,
  showPath,
  showType = true,
  emptyText = "Nothing here",
  footer,
  defaultSort = "size",
  pageSize = 400,
}: NodeTableProps) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: defaultSort, dir: defaultSort === "name" ? 1 : -1 });
  const [limit, setLimit] = useState(pageSize);
  const cleanup = useDiskStore((s) => s.cleanup);
  const toggleCleanup = useDiskStore((s) => s.toggleCleanup);
  const inCleanup = useMemo(() => new Set(cleanup.map((c) => c.id)), [cleanup]);
  const sum = total ?? items.reduce((a, i) => a + i.size, 0);
  const max = items.reduce((a, i) => Math.max(a, i.size), 0);

  const sorted = useMemo(() => {
    const list = items.slice();
    const cmp = (a: NodeInfo, b: NodeInfo): number => {
      switch (sort.key) {
        case "name":
          return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
        case "mtime":
          return a.mtime - b.mtime;
        case "files":
          return (a.kind === "dir" ? a.files + a.dirs : 0) - (b.kind === "dir" ? b.files + b.dirs : 0);
        case "cat":
          return categoryLabel(a.cat).localeCompare(categoryLabel(b.cat)) || b.size - a.size;
        case "path":
          return a.path.localeCompare(b.path);
        default:
          return a.size - b.size;
      }
    };
    list.sort((a, b) => cmp(a, b) * sort.dir || b.size - a.size);
    return list;
  }, [items, sort]);

  const shown = sorted.slice(0, limit);
  const head = (h: { key: SortKey; label: string; className?: string }) => (
    <th key={h.key} className={h.className}>
      <button
        className={`dk-th${sort.key === h.key ? " active" : ""}`}
        onClick={() => setSort((s) => ({ key: h.key, dir: s.key === h.key ? ((s.dir * -1) as 1 | -1) : h.key === "name" || h.key === "path" ? 1 : -1 }))}
      >
        {h.label}
        {sort.key === h.key ? sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} /> : null}
      </button>
    </th>
  );

  const headers = HEADERS.filter((h) => (h.key === "cat" ? showType : true));

  return (
    <div className="dk-table-wrap">
      <table className="dk-table">
        <thead>
          <tr>
            {checkable ? <th className="check" /> : null}
            {headers.map(head)}
            {showPath ? head({ key: "path", label: "Location", className: "path" }) : null}
          </tr>
        </thead>
        <tbody>
          {shown.map((n) => {
            const checked = inCleanup.has(n.id);
            return (
              <tr
                key={n.id}
                className={`${selectedId === n.id ? "selected" : ""}${checked ? " checked" : ""}${n.hidden ? " hidden-item" : ""}`}
                onClick={() => onSelect(n.id)}
                onDoubleClick={() => n.kind === "dir" && onDrill(n.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onSelect(n.id);
                  onMenu({ node: n, x: e.clientX, y: e.clientY });
                }}
              >
                {checkable ? (
                  <td className="check">
                    <button
                      className={`dk-check${checked ? " on" : ""}`}
                      aria-pressed={checked}
                      aria-label={checked ? "Remove from cleanup" : "Add to cleanup"}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCleanup(n);
                      }}
                    >
                      {checked ? <Check size={11} /> : null}
                    </button>
                  </td>
                ) : null}
                <td className="name">
                  <span className="dk-name">
                    <KindIcon node={n} />
                    <span className="dk-name-text" title={n.path}>
                      {n.name}
                    </span>
                    {n.error ? <span className="dk-flag" title="Some of it could not be read">!</span> : null}
                  </span>
                </td>
                <td className="num">
                  <span className="dk-size-cell">
                    <SizeBar value={n.size} max={max} color={CATEGORY_COLORS[n.cat]} />
                    <span className="dk-size-text">{formatBytes(n.size)}</span>
                    <span className="dk-size-pct">{formatPercent(n.size, sum)}</span>
                  </span>
                </td>
                <td className="num items muted">{n.kind === "dir" ? formatCount(n.files + n.dirs) : "—"}</td>
                {showType ? (
                  <td className="muted type">
                    <span className="dk-type">
                      <i className="dk-dot" style={{ background: CATEGORY_COLORS[n.cat] }} />
                      {n.kind === "dir" ? "Folder" : categoryLabel(n.cat)}
                    </span>
                  </td>
                ) : null}
                <td className="muted mtime" title={n.path}>
                  {formatRelative(n.kind === "dir" ? n.newest : n.mtime)}
                </td>
                {showPath ? (
                  <td className="muted path" title={n.path}>
                    {n.path}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!items.length ? <div className="dk-table-empty">{emptyText}</div> : null}
      {sorted.length > limit ? (
        <button className="dk-more" onClick={() => setLimit((l) => l + pageSize)}>
          Show {Math.min(pageSize, sorted.length - limit)} more of {formatCount(sorted.length - limit)}
        </button>
      ) : null}
      {footer}
    </div>
  );
}

/** Loads the full NodeInfo for a TreeNode id before opening the menu. */
export async function menuFor(id: number, x: number, y: number): Promise<MenuState | null> {
  const node = await fetchNode(id);
  return node ? { node, x, y } : null;
}
