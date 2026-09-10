import { useState } from "react";
import { ChevronUp, Loader2, Trash2, X } from "lucide-react";
import { useDiskStore } from "../store";
import { baseName, formatBytes } from "../lib/format";
import { KindIcon } from "./primitives";

/** The basket at the bottom: what is queued for the Recycle Bin, and the one button that sends it there. */
export function CleanupBar() {
  const cleanup = useDiskStore((s) => s.cleanup);
  const notice = useDiskStore((s) => s.notice);
  const trashing = useDiskStore((s) => s.trashing);
  const { runCleanup, clearCleanup, removeFromCleanup, select, dismissNotice } = useDiskStore.getState();
  const [open, setOpen] = useState(false);
  const total = cleanup.reduce((a, c) => a + c.size, 0);

  if (!cleanup.length && !notice && !trashing) return null;
  return (
    <div className={`dk-cleanup${open && cleanup.length ? " open" : ""}`}>
      {open && cleanup.length ? (
        <ul className="dk-cleanup-list">
          {cleanup.map((c) => (
            <li key={c.id}>
              <button className="dk-cleanup-item" onClick={() => select(c.id)} title={c.path}>
                <KindIcon node={c} />
                <span className="dk-name-text">{c.name}</span>
                <span className="muted dk-cleanup-path">{c.path}</span>
                <span className="dk-cleanup-size">{formatBytes(c.size)}</span>
              </button>
              <button className="dk-icon-btn" aria-label="Remove from cleanup" onClick={() => removeFromCleanup(c.id)}>
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {trashing ? (
        <div className="dk-trashing" role="status" aria-live="polite">
          <Loader2 size={14} className="dk-spin" />
          <span>
            Moving to the Recycle Bin — <b>{Math.min(trashing.done + 1, trashing.total)}</b> of <b>{trashing.total}</b>
          </span>
          {trashing.path ? (
            <span className="muted dk-trashing-path" title={trashing.path}>
              {baseName(trashing.path)}
            </span>
          ) : null}
          <span className="dk-cleanup-spacer" />
          <span className="muted">A big folder can take a few minutes.</span>
        </div>
      ) : null}
      <div className="dk-cleanup-bar">
        {notice ? (
          <span className={`dk-notice ${notice.kind}`}>
            {notice.text}
            {notice.sticky ? (
              <button className="dk-notice-close" aria-label="Dismiss" onClick={dismissNotice}>
                <X size={12} />
              </button>
            ) : null}
          </span>
        ) : null}
        {cleanup.length ? (
          <>
            <button className="dk-cleanup-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              <ChevronUp size={14} className={open ? "flip" : ""} />
              <b>{cleanup.length}</b> item{cleanup.length === 1 ? "" : "s"} in cleanup · <b>{formatBytes(total)}</b>
            </button>
            <span className="dk-cleanup-spacer" />
            <button className="dk-btn" onClick={clearCleanup} disabled={!!trashing}>
              Clear
            </button>
            <button className="dk-btn danger" onClick={() => void runCleanup()} disabled={!!trashing}>
              <Trash2 size={13} /> {trashing ? "Moving…" : "Move to Recycle Bin"}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
