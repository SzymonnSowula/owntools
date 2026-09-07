import { useState } from "react";
import { ChevronUp, Trash2, X } from "lucide-react";
import { useDiskStore } from "../store";
import { formatBytes } from "../lib/format";
import { KindIcon } from "./primitives";

/** The basket at the bottom: what is queued for the Recycle Bin, and the one button that sends it there. */
export function CleanupBar() {
  const cleanup = useDiskStore((s) => s.cleanup);
  const notice = useDiskStore((s) => s.notice);
  const { runCleanup, clearCleanup, removeFromCleanup, select } = useDiskStore.getState();
  const [open, setOpen] = useState(false);
  const total = cleanup.reduce((a, c) => a + c.size, 0);

  if (!cleanup.length && !notice) return null;
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
      <div className="dk-cleanup-bar">
        {notice ? <span className={`dk-notice ${notice.kind}`}>{notice.text}</span> : null}
        {cleanup.length ? (
          <>
            <button className="dk-cleanup-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              <ChevronUp size={14} className={open ? "flip" : ""} />
              <b>{cleanup.length}</b> item{cleanup.length === 1 ? "" : "s"} in cleanup · <b>{formatBytes(total)}</b>
            </button>
            <span className="dk-cleanup-spacer" />
            <button className="dk-btn" onClick={clearCleanup}>
              Clear
            </button>
            <button className="dk-btn danger" onClick={() => void runCleanup()}>
              <Trash2 size={13} /> Move to Recycle Bin
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
