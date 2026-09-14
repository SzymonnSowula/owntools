import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import { CATEGORY_LABELS } from "../api/types";
import { formatBytes, formatCount } from "../lib/format";
import { useChildren, useNode, useSearch, useSize, useSubtree, useTopFiles } from "../hooks";
import { useDiskStore } from "../store";
import { BarsView } from "../components/BarsView";
import { CleanupBar } from "../components/CleanupBar";
import { ContextMenu, type MenuState } from "../components/ContextMenu";
import { ExploreHeader } from "../components/ExploreHeader";
import { Inspector } from "../components/Inspector";
import { NodeTable } from "../components/NodeTable";
import { ScanHero, ScanProgressCard } from "../components/ScanHero";
import { Sidebar } from "../components/Sidebar";
import { Sunburst } from "../components/Sunburst";
import { Treemap } from "../components/Treemap";
import { Empty, Spinner } from "../components/primitives";

/** Sidebar · centre (tree views or a collection) · inspector. */
export function ExplorePage() {
  const summary = useDiskStore((s) => s.summary);
  const scanning = useDiskStore((s) => s.scanning);
  const inspectorOpen = useDiskStore((s) => s.inspectorOpen);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  return (
    <div className="dk-explore">
      <Sidebar />
      <section className="dk-center">
        {scanning ? <ScanProgressCard /> : summary ? <Center onMenu={setMenu} /> : <ScanHero />}
      </section>
      {summary && !scanning && inspectorOpen ? <Inspector /> : null}
      <ContextMenu menu={menu} onClose={closeMenu} />
      <CleanupBar />
    </div>
  );
}

function Center({ onMenu }: { onMenu(menu: MenuState): void }) {
  const currentId = useDiskStore((s) => s.currentId);
  const center = useDiskStore((s) => s.center);
  const node = useNode(currentId);
  if (!node) return <Spinner label="Loading…" />;
  return (
    <>
      <ExploreHeader node={node} />
      {center.kind === "tree" ? <TreeArea rootSize={node.size} onMenu={onMenu} /> : <Collection onMenu={onMenu} />}
    </>
  );
}

function TreeArea({ rootSize, onMenu }: { rootSize: number; onMenu(menu: MenuState): void }) {
  const currentId = useDiskStore((s) => s.currentId);
  const selectedId = useDiskStore((s) => s.selectedId);
  const view = useDiskStore((s) => s.view);
  const colorMode = useDiskStore((s) => s.colorMode);
  const depth = useDiskStore((s) => s.depth);
  const filter = useDiskStore((s) => s.filter);
  const { select, drill } = useDiskStore.getState();
  const [areaRef, area] = useSize<HTMLDivElement>();
  const visual = view === "treemap" || view === "sunburst";
  const { tree, loading } = useSubtree(currentId, visual ? Math.min(depth, view === "sunburst" ? 8 : 12) : 1, rootSize, visual ? area.w * area.h : 0);
  const children = useChildren(view === "bars" || view === "list" ? currentId : null);
  const files = useTopFiles(view === "files" ? currentId : null, { limit: 300 });

  // Keyboard: Backspace up, Enter drills into the selection, Delete toggles cleanup.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const s = useDiskStore.getState();
      if (e.key === "Backspace") {
        e.preventDefault();
        void s.goUp();
      } else if (e.key === "Escape") {
        s.select(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div ref={areaRef} className={`dk-view dk-view-${view}`}>
      {visual ? (
        tree && tree.ch?.length ? (
          view === "treemap" ? (
            <Treemap tree={tree} depth={depth} colorMode={colorMode} selectedId={selectedId} filter={filter} onSelect={select} onDrill={drill} onMenu={onMenu} />
          ) : (
            <Sunburst tree={tree} depth={Math.min(depth, 8)} colorMode={colorMode} selectedId={selectedId} filter={filter} onSelect={select} onDrill={drill} onMenu={onMenu} />
          )
        ) : loading ? (
          <Spinner label="Laying out…" />
        ) : (
          <Empty title="Nothing to draw" hint="This folder is empty or everything in it is too small." />
        )
      ) : view === "bars" ? (
        <BarsView items={children.items} total={rootSize} colorMode={colorMode} selectedId={selectedId} onSelect={select} onDrill={drill} onMenu={onMenu} />
      ) : view === "list" ? (
        <NodeTable items={children.items} total={rootSize} selectedId={selectedId} onSelect={select} onDrill={drill} onMenu={onMenu} emptyText={children.loading ? "Loading…" : "Empty folder"} footer={children.total > children.items.length ? <div className="dk-table-empty">Showing the {formatCount(children.items.length)} largest of {formatCount(children.total)}</div> : null} />
      ) : (
        <NodeTable items={files.items} total={rootSize} selectedId={selectedId} onSelect={select} onDrill={drill} onMenu={onMenu} showPath checkable emptyText={files.loading ? "Looking…" : "No files under here"} />
      )}
      {visual && loading && tree ? <div className="dk-view-loading">updating…</div> : null}
    </div>
  );
}

/** Quick-win items, one file type, or search hits — a table with cleanup checkboxes. */
function Collection({ onMenu }: { onMenu(menu: MenuState): void }) {
  const center = useDiskStore((s) => s.center);
  const currentId = useDiskStore((s) => s.currentId);
  const selectedId = useDiskStore((s) => s.selectedId);
  const quickWins = useDiskStore((s) => s.quickWins);
  const summary = useDiskStore((s) => s.summary);
  const { select, drill, setCenter, addToCleanup } = useDiskStore.getState();
  const win = center.kind === "quickwin" ? quickWins?.find((w) => w.id === center.id) ?? null : null;
  const cat = center.kind === "category" ? center.cat : null;
  const categoryFiles = useTopFiles(cat !== null ? currentId : null, { cat: cat ?? undefined, limit: 400 });
  const search = useSearch(center.kind === "search" ? center.query : "");

  const items = win ? win.items : cat !== null ? categoryFiles.items : search.items;
  const loading = cat !== null ? categoryFiles.loading : center.kind === "search" ? search.loading : false;
  const title = win ? win.label : cat !== null ? `${CATEGORY_LABELS[cat]} files` : `“${center.kind === "search" ? center.query : ""}”`;
  const subtitle = win
    ? `${win.hint} — ${formatCount(win.count)} item${win.count === 1 ? "" : "s"}, ${formatBytes(win.bytes)}${win.count > win.items.length ? ` (largest ${win.items.length} shown)` : ""}`
    : cat !== null
      ? `The largest ${CATEGORY_LABELS[cat].toLowerCase()} files under ${summary?.name ?? "this folder"}`
      : `${formatCount(items.length)} match${items.length === 1 ? "" : "es"} by name, biggest first`;

  return (
    <div className="dk-collection">
      <div className="dk-collection-head">
        <button className="dk-btn" onClick={() => setCenter({ kind: "tree" })}>
          <ArrowLeft size={13} /> Back to the tree
        </button>
        <div className="dk-collection-title">
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        {items.length ? (
          <button className="dk-btn" onClick={() => addToCleanup(items)} title="Queue everything listed here">
            <Trash2 size={13} /> Add all to cleanup
          </button>
        ) : null}
      </div>
      {win?.caution ? <div className="dk-caution">Check these before you clean: build output and disk images can be live work.</div> : null}
      {win?.admin ? <div className="dk-caution">Windows protects these folders. It asks for administrator permission during the cleanup, and they still go to the Recycle Bin.</div> : null}
      <NodeTable items={items} selectedId={selectedId} onSelect={select} onDrill={drill} onMenu={onMenu} checkable showPath emptyText={loading ? "Looking…" : "Nothing found"} />
    </div>
  );
}
