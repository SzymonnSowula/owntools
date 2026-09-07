import { Copy, Crosshair, ExternalLink, Eye, Trash2, X } from "lucide-react";
import { useDiskStore } from "../store";
import { useChildren, useNode } from "../hooks";
import { CATEGORY_COLORS } from "../lib/colors";
import { extOf, formatBytes, formatCount, formatDateTime, formatPercent, formatRelative, knownTime } from "../lib/format";
import { categoryLabel, KindIcon, SizeBar } from "./primitives";

/** The right panel: the selected node (or the current folder) in detail. */
export function Inspector() {
  const selectedId = useDiskStore((s) => s.selectedId);
  const currentId = useDiskStore((s) => s.currentId);
  const summary = useDiskStore((s) => s.summary);
  const cleanup = useDiskStore((s) => s.cleanup);
  const { drill, select, toggleCleanup, reveal, open, copyPath } = useDiskStore.getState();
  const id = selectedId ?? currentId;
  const node = useNode(id);
  const largest = useChildren(node?.kind === "dir" ? id : null, 8);

  if (!node) return <aside className="dk-inspector" />;
  const total = summary?.size ?? 0;
  const inCleanup = cleanup.some((c) => c.id === node.id);
  const isRoot = node.parent === null;
  const compressed = node.size - node.alloc;
  const ext = node.kind === "file" ? extOf(node.name) : "";

  return (
    <aside className="dk-inspector">
      <div className="dk-insp-head">
        <span className="dk-insp-icon">
          <KindIcon node={node} size={18} />
        </span>
        <div className="dk-insp-title">
          <div className="dk-insp-name" title={node.name}>
            {node.name}
          </div>
          <div className="dk-insp-chips">
            <span className="dk-chip">{node.kind === "dir" ? "Folder" : node.kind === "link" ? "Link" : ext ? `.${ext}` : "File"}</span>
            {node.kind !== "dir" ? (
              <span className="dk-chip">
                <i className="dk-dot" style={{ background: CATEGORY_COLORS[node.cat] }} /> {categoryLabel(node.cat)}
              </span>
            ) : null}
            {node.hidden ? <span className="dk-chip">Hidden</span> : null}
            {node.error ? <span className="dk-chip warn">Partly unreadable</span> : null}
          </div>
        </div>
      </div>
      <button className="dk-insp-path" title="Copy path" onClick={() => copyPath(node.path)}>
        {node.path}
      </button>
      <div className="dk-insp-size">
        <div className="dk-insp-size-big">{formatBytes(node.size)}</div>
        <div className="dk-insp-size-sub">{formatPercent(node.size, total)} of scan</div>
      </div>

      <div className="dk-insp-card">
        <div className="dk-insp-card-title">Details</div>
        <dl className="dk-insp-rows">
          <dt>Size on disk</dt>
          <dd>{formatBytes(node.alloc)}</dd>
          <dt>Logical size</dt>
          <dd>{formatBytes(node.size)}</dd>
          {compressed > 1024 ? (
            <>
              <dt>Compressed by</dt>
              <dd>{formatBytes(compressed)}</dd>
            </>
          ) : compressed < -1024 ? (
            <>
              <dt>Cluster overhead</dt>
              <dd>{formatBytes(-compressed)}</dd>
            </>
          ) : null}
          {node.kind === "dir" ? (
            <>
              <dt>Files</dt>
              <dd>{formatCount(node.files)}</dd>
              <dt>Folders</dt>
              <dd>{formatCount(node.dirs)}</dd>
            </>
          ) : null}
          <dt>Modified</dt>
          <dd title={formatDateTime(node.mtime)}>{formatRelative(node.mtime)}</dd>
          {node.kind === "dir" && knownTime(node.newest) && node.newest !== node.mtime ? (
            <>
              <dt>Newest inside</dt>
              <dd title={formatDateTime(node.newest)}>{formatRelative(node.newest)}</dd>
            </>
          ) : null}
          <dt>Created</dt>
          <dd title={formatDateTime(node.ctime)}>{formatRelative(node.ctime)}</dd>
        </dl>
      </div>

      {node.kind === "dir" && largest.items.length ? (
        <div className="dk-insp-card">
          <div className="dk-insp-card-title">
            Largest inside <span className="muted">{formatCount(largest.total)} items</span>
          </div>
          <ul className="dk-insp-list">
            {largest.items.map((c) => (
              <li key={c.id}>
                <button onClick={() => select(c.id)} onDoubleClick={() => c.kind === "dir" && drill(c.id)} title={c.path}>
                  <span className="dk-insp-list-name">
                    <i className="dk-dot" style={{ background: CATEGORY_COLORS[c.cat] }} />
                    {c.name}
                  </span>
                  <span className="dk-insp-list-size">{formatBytes(c.size)}</span>
                  <SizeBar value={c.size} max={node.size} color={CATEGORY_COLORS[c.cat]} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="dk-insp-actions">
        <button onClick={() => reveal(node.path)}>
          <Eye size={13} /> Reveal
        </button>
        <button onClick={() => open(node.path)}>
          <ExternalLink size={13} /> Open
        </button>
        <button onClick={() => (node.kind === "dir" ? drill(node.id) : node.parent !== null && drill(node.parent))} disabled={node.kind === "dir" ? node.id === currentId : false}>
          <Crosshair size={13} /> Focus
        </button>
        <button onClick={() => copyPath(node.path)}>
          <Copy size={13} /> Copy path
        </button>
      </div>
      {!isRoot ? (
        <button className={`dk-insp-cleanup${inCleanup ? " on" : ""}`} onClick={() => toggleCleanup(node)}>
          {inCleanup ? <X size={14} /> : <Trash2 size={14} />}
          {inCleanup ? "Remove from cleanup" : "Add to cleanup"}
        </button>
      ) : null}
    </aside>
  );
}
