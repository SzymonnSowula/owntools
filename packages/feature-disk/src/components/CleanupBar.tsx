import { useEffect, useState } from "react";
import { AppWindow, ChevronUp, Loader2, ShieldAlert, Trash2, X } from "lucide-react";
import { backend } from "../api";
import type { Protection } from "../api/types";
import { useDiskStore } from "../store";
import { appsQueryFor, protectedNames } from "../lib/cleanup";
import { baseName, formatBytes } from "../lib/format";
import { KindIcon } from "./primitives";

/** The basket at the bottom: what is queued for the Recycle Bin, and the one button that sends it there. */
export function CleanupBar() {
  const cleanup = useDiskStore((s) => s.cleanup);
  const notice = useDiskStore((s) => s.notice);
  const trashing = useDiskStore((s) => s.trashing);
  const { runCleanup, clearCleanup, removeFromCleanup, select, dismissNotice, openApps } = useDiskStore.getState();
  const [open, setOpen] = useState(false);
  const [guarded, setGuarded] = useState<Map<number, Protection>>(() => new Map());
  const total = cleanup.reduce((a, c) => a + c.size, 0);
  const ids = cleanup.map((c) => c.id).join(",");

  // Parts of installed programs stay where they are however the list was
  // built; the row says so before the button is pressed.
  useEffect(() => {
    if (!open || !ids) return;
    let live = true;
    backend()
      .cleanupCheck(ids.split(",").map(Number))
      .then((check) => {
        if (live) setGuarded(new Map(check.protections.map((p) => [p.id, p])));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [open, ids]);

  if (!cleanup.length && !notice && !trashing) return null;
  // A slot on every row once any row is tagged, so the sizes stay in one column.
  const tagSlots = cleanup.some((c) => guarded.has(c.id));
  return (
    <div className={`dk-cleanup${open && cleanup.length ? " open" : ""}`}>
      {open && cleanup.length ? (
        <ul className="dk-cleanup-list">
          {cleanup.map((c) => {
            const guard = guarded.get(c.id);
            return (
              <li key={c.id}>
                <button className="dk-cleanup-item" onClick={() => select(c.id)} title={c.path}>
                  <KindIcon node={c} />
                  <span className="dk-name-text">{c.name}</span>
                  <span className="muted dk-cleanup-path">{c.path}</span>
                  <span className="dk-cleanup-size">{formatBytes(c.size)}</span>
                </button>
                {tagSlots ? (
                  <span className="dk-cleanup-tag-slot">
                    {guard ? (
                      <button
                        className="dk-cleanup-tag"
                        onClick={() => openApps(appsQueryFor(guard))}
                        title={`Part of ${protectedNames([guard]).join(", ")}: it stays where it is. Uninstall it from Applications.`}
                      >
                        <ShieldAlert size={11} /> installed program
                      </button>
                    ) : null}
                  </span>
                ) : null}
                <button className="dk-icon-btn" aria-label="Remove from cleanup" onClick={() => removeFromCleanup(c.id)}>
                  <X size={13} />
                </button>
              </li>
            );
          })}
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
            <span className="dk-notice-text" title={notice.text}>
              {notice.text}
            </span>
            {notice.appsQuery !== undefined ? (
              <button className="dk-notice-action" onClick={() => openApps(notice.appsQuery)}>
                <AppWindow size={12} /> Applications
              </button>
            ) : null}
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
