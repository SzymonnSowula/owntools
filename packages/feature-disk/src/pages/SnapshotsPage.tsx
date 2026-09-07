import { useEffect, useState } from "react";
import { Camera, GitCompareArrows, FolderOpen, Trash2 } from "lucide-react";
import { confirmDialog } from "@ui/Dialog";
import { backend } from "../api";
import type { SnapshotDiff, SnapshotMeta } from "../api/types";
import { formatBytes, formatCount, formatDelta, formatIso } from "../lib/format";
import { useDiskStore } from "../store";
import { Empty, Spinner } from "../components/primitives";

/**
 * Snapshots: keep today's scan, compare it later. A snapshot stores every
 * folder and every file over 1 MB, so "what grew" is answered per folder.
 */
export function SnapshotsPage() {
  const summary = useDiskStore((s) => s.summary);
  const dataVersion = useDiskStore((s) => s.dataVersion);
  const { notify, setTab } = useDiskStore.getState();
  const [list, setList] = useState<SnapshotMeta[] | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [diff, setDiff] = useState<SnapshotDiff | null>(null);
  const [diffing, setDiffing] = useState<string | null>(null);
  const [against, setAgainst] = useState<string>("current");

  const load = () =>
    backend()
      .snapshotList()
      .then(setList)
      .catch(() => setList([]));
  useEffect(() => {
    void load();
  }, [dataVersion]);

  const save = async () => {
    setSaving(true);
    try {
      const meta = await backend().snapshotSave(name.trim() || undefined);
      notify(`Snapshot “${meta.name}” saved`);
      setName("");
      await load();
    } catch (err) {
      notify(`Could not save: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const compare = async (id: string) => {
    setDiffing(id);
    setDiff(null);
    try {
      setDiff(await backend().snapshotDiff(id, against === "current" ? undefined : against));
    } catch (err) {
      notify(`Could not compare: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setDiffing(null);
    }
  };

  const openSnap = async (meta: SnapshotMeta) => {
    try {
      await backend().snapshotOpen(meta.id);
      notify(`Browsing snapshot “${meta.name}” — folders and files over 1 MB`);
      setTab("explore");
    } catch (err) {
      notify(`Could not open: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  };

  const remove = async (meta: SnapshotMeta) => {
    const ok = await confirmDialog({ kind: "danger", title: "Delete this snapshot?", message: `“${meta.name}” · ${formatBytes(meta.fileBytes)} on disk.`, okLabel: "Delete" });
    if (!ok) return;
    await backend().snapshotDelete(meta.id).catch(() => undefined);
    if (diff && (diff.before.id === meta.id || diff.after.id === meta.id)) setDiff(null);
    await load();
  };

  const sameRoot = (m: SnapshotMeta) => summary && m.root.toLowerCase() === summary.root.toLowerCase();

  return (
    <div className="dk-page">
      <header className="dk-page-head">
        <div>
          <h1>
            <Camera size={18} /> Snapshots
          </h1>
          <p>Keep today's scan; compare it later to see what grew.</p>
        </div>
        <div className="dk-page-controls">
          <input className="dk-input" placeholder={summary ? `Name (optional) — e.g. “before cleanup”` : "Scan something to snapshot it"} value={name} onChange={(e) => setName(e.target.value)} disabled={!summary || saving} onKeyDown={(e) => e.key === "Enter" && summary && void save()} />
          <button className="dk-btn primary" disabled={!summary || saving || summary.source === "snapshot"} onClick={() => void save()} title={summary?.source === "snapshot" ? "This is already a snapshot" : undefined}>
            <Camera size={13} /> {saving ? "Saving…" : `Save snapshot${summary ? ` of ${summary.name}` : ""}`}
          </button>
        </div>
      </header>

      {!list ? (
        <Spinner label="Reading snapshots…" />
      ) : !list.length ? (
        <Empty title="No snapshots yet" hint="Save one after a scan. Each keeps every folder and every file over 1 MB — a few megabytes, not a copy of your disk." />
      ) : (
        <div className="dk-table-wrap">
          <table className="dk-table dk-snaps">
            <thead>
              <tr>
                <th>Snapshot</th>
                <th>Root</th>
                <th className="num">Size</th>
                <th className="num">Files</th>
                <th>Taken</th>
                <th>
                  <span className="dk-field inline">
                    <span>Compare with</span>
                    <select value={against} onChange={(e) => setAgainst(e.target.value)}>
                      <option value="current">the current scan</option>
                      {list.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((m) => (
                <tr key={m.id} className={diff?.before.id === m.id ? "selected" : ""}>
                  <td className="name">
                    <span className="dk-name-text">{m.name}</span>
                  </td>
                  <td className="muted path" title={m.root}>
                    {m.root}
                  </td>
                  <td className="num">{formatBytes(m.size)}</td>
                  <td className="num muted">{formatCount(m.files)}</td>
                  <td className="muted">{formatIso(m.created)}</td>
                  <td className="actions">
                    <button className="dk-btn" onClick={() => void compare(m.id)} disabled={diffing !== null || (against === "current" && !sameRoot(m)) || against === m.id} title={against === "current" && !sameRoot(m) ? "The current scan has a different root" : "What changed since this snapshot"}>
                      <GitCompareArrows size={13} /> {diffing === m.id ? "Comparing…" : "Compare"}
                    </button>
                    <button className="dk-icon-btn" title="Browse this snapshot" onClick={() => void openSnap(m)}>
                      <FolderOpen size={13} />
                    </button>
                    <button className="dk-icon-btn danger" title="Delete" onClick={() => void remove(m)}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {diff ? (
        <div className="dk-diff">
          <div className="dk-diff-head">
            <div>
              <h2>
                {diff.before.name} → {diff.after.name}
              </h2>
              <p>
                {formatIso(diff.before.created)} → {formatIso(diff.after.created)} · {formatBytes(diff.before.size)} → {formatBytes(diff.after.size)}
              </p>
            </div>
            <div className={`dk-diff-total ${diff.delta >= 0 ? "dk-pos" : "dk-neg"}`}>{formatDelta(diff.delta)}</div>
          </div>
          {!diff.entries.length ? (
            <Empty title="No folder changed by more than 1 MB" />
          ) : (
            <ul className="dk-diff-list">
              {diff.entries.map((e) => (
                <li key={e.path} className={`state-${e.state}`} style={{ paddingLeft: 12 + e.depth * 18 }}>
                  <span className="dk-diff-name" title={e.path}>
                    {e.kind === "dir" ? "📁" : "📄"} {e.name}
                    <span className={`dk-chip state-${e.state}`}>{e.state}</span>
                  </span>
                  <span className="muted">
                    {formatBytes(e.before)} → {formatBytes(e.after)}
                  </span>
                  <span className={`dk-diff-delta ${e.delta >= 0 ? "dk-pos" : "dk-neg"}`}>{formatDelta(e.delta)}</span>
                </li>
              ))}
            </ul>
          )}
          {diff.truncated ? <div className="dk-side-note">The list stops at 800 entries.</div> : null}
        </div>
      ) : null}
    </div>
  );
}
