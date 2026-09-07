import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Layers, Loader2, Trash2, X } from "lucide-react";
import { backend } from "../api";
import type { DupeGroup, DupesProgress, DupesResult, NodeInfo } from "../api/types";
import { formatBytes, formatCount, formatRelative } from "../lib/format";
import { useDiskStore } from "../store";
import { Empty, KindIcon } from "../components/primitives";

const MIN_SIZES: { label: string; bytes: number }[] = [
  { label: "64 KB", bytes: 64 * 1024 },
  { label: "1 MB", bytes: 1024 * 1024 },
  { label: "10 MB", bytes: 10 * 1024 * 1024 },
  { label: "100 MB", bytes: 100 * 1024 * 1024 },
];

type Keep = "oldest" | "newest" | "first";

/** A stable empty list: a fresh `[]` per render would re-derive the picks forever. */
const NO_GROUPS: DupeGroup[] = [];

/**
 * Duplicates: identical files (size + content hash) under the scan root or
 * the current folder. Each group keeps one copy by rule (oldest / newest);
 * the rest are ticked and go to the Recycle Bin together.
 */
export function DuplicatesPage() {
  const summary = useDiskStore((s) => s.summary);
  const currentId = useDiskStore((s) => s.currentId);
  const dataVersion = useDiskStore((s) => s.dataVersion);
  const { trashNow, reveal, copyPath, notify } = useDiskStore.getState();
  const [minBytes, setMinBytes] = useState(MIN_SIZES[1].bytes);
  const [scope, setScope] = useState<"root" | "current">("root");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<DupesProgress | null>(null);
  const [result, setResult] = useState<DupesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keep, setKeep] = useState<Keep>("oldest");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  /** Set while this page's own cleanup runs, so the reset below leaves the trimmed groups alone. */
  const ownChange = useRef(false);

  useEffect(() => {
    const api = backend();
    void api.dupesResult().then((r) => r && setResult(r));
    const offP = api.onDupesProgress((p) => setProgress(p));
    const offD = api.onDupesDone((d) => {
      setRunning(false);
      setProgress(null);
      if (!d.ok) setError(d.error ?? "could not finish");
      else {
        setResult(d.result);
        setError(null);
      }
    });
    return () => {
      offP();
      offD();
    };
  }, []);

  // A cleanup elsewhere (the Explore basket) may have removed files these groups list.
  useEffect(() => {
    if (ownChange.current) {
      ownChange.current = false;
      return;
    }
    void backend()
      .dupesResult()
      .then((r) => setResult((cur) => (cur && r === null ? null : cur)))
      .catch(() => undefined);
  }, [dataVersion]);

  const groups = result?.groups ?? NO_GROUPS;
  const defaultPicks = useMemo(() => {
    const s = new Set<number>();
    for (const g of groups) {
      const files = g.files.slice();
      if (keep === "newest") files.sort((a, b) => b.mtime - a.mtime);
      else if (keep === "oldest") files.sort((a, b) => a.mtime - b.mtime);
      files.slice(1).forEach((f) => s.add(f.id));
    }
    return s;
  }, [groups, keep]);
  useEffect(() => setPicked(defaultPicks), [defaultPicks]);

  const start = async () => {
    if (!summary) return;
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress({ phase: "collect", done: 0, total: 0, bytesDone: 0, bytesTotal: 0 });
    try {
      await backend().dupesStart(scope === "current" ? currentId : 0, minBytes);
    } catch (err) {
      setRunning(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const pickedFiles: NodeInfo[] = useMemo(() => groups.flatMap((g) => g.files.filter((f) => picked.has(f.id))), [groups, picked]);
  const pickedBytes = pickedFiles.reduce((a, f) => a + f.size, 0);

  const clean = async () => {
    ownChange.current = true;
    const outcome = await trashNow(pickedFiles, "duplicates");
    if (!outcome) {
      ownChange.current = false;
      return;
    }
    const gone = new Set(outcome.removed);
    setResult((r) =>
      r
        ? {
            ...r,
            groups: r.groups.map((g) => ({ ...g, files: g.files.filter((f) => !gone.has(f.id)) })).filter((g) => g.files.length > 1),
          }
        : r,
    );
  };

  if (!summary) return <Empty title="Scan something first" hint="Duplicates are found inside the scanned tree." />;

  return (
    <div className="dk-page">
      <header className="dk-page-head">
        <div>
          <h1>
            <Layers size={18} /> Duplicates
          </h1>
          <p>Same size and the same bytes — checked by hashing, not by name.</p>
        </div>
        <div className="dk-page-controls">
          <label className="dk-field">
            <span>Larger than</span>
            <select value={minBytes} onChange={(e) => setMinBytes(Number(e.target.value))} disabled={running}>
              {MIN_SIZES.map((m) => (
                <option key={m.bytes} value={m.bytes}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="dk-field">
            <span>Where</span>
            <select value={scope} onChange={(e) => setScope(e.target.value as "root" | "current")} disabled={running}>
              <option value="root">Whole scan ({summary.name})</option>
              <option value="current">Current folder</option>
            </select>
          </label>
          {running ? (
            <button className="dk-btn" onClick={() => void backend().dupesCancel()}>
              <X size={13} /> Stop
            </button>
          ) : (
            <button className="dk-btn primary" onClick={() => void start()}>
              <Copy size={13} /> Find duplicates
            </button>
          )}
        </div>
      </header>

      {running && progress ? (
        <div className="dk-progress slim">
          <Loader2 size={16} className="dk-spin" />
          <div className="dk-progress-text">
            {progress.phase === "collect"
              ? "Grouping files by size…"
              : progress.phase === "prefix"
                ? `Comparing the first 64 KB · ${formatCount(progress.done)} of ${formatCount(progress.total)} files`
                : `Hashing whole files · ${formatBytes(progress.bytesDone)} of ${formatBytes(progress.bytesTotal)}`}
          </div>
          <div className="dk-progress-track">
            <span style={{ width: progress.total ? `${(progress.done / progress.total) * 100}%` : undefined }} />
          </div>
        </div>
      ) : null}
      {error ? <div className="dk-error">{error}</div> : null}

      {result && !running ? (
        <>
          <div className="dk-stats-row">
            <div className="dk-stat">
              <b>{formatBytes(result.wasted)}</b>
              <span>reclaimable</span>
            </div>
            <div className="dk-stat">
              <b>{formatCount(result.groupCount)}</b>
              <span>groups</span>
            </div>
            <div className="dk-stat">
              <b>{formatCount(result.extraCopies)}</b>
              <span>extra copies</span>
            </div>
            <div className="dk-stat">
              <b>{formatCount(result.scannedFiles)}</b>
              <span>files checked</span>
            </div>
            <span className="dk-cleanup-spacer" />
            <label className="dk-field">
              <span>Keep</span>
              <select value={keep} onChange={(e) => setKeep(e.target.value as Keep)}>
                <option value="oldest">the oldest copy</option>
                <option value="newest">the newest copy</option>
                <option value="first">the first listed</option>
              </select>
            </label>
            <button className="dk-btn danger" disabled={!pickedFiles.length} onClick={() => void clean()}>
              <Trash2 size={13} /> Move {formatCount(pickedFiles.length)} to Recycle Bin · {formatBytes(pickedBytes)}
            </button>
          </div>
          {result.cancelled ? <div className="dk-caution">Stopped early — this is a partial list.</div> : null}
          {!groups.length ? <Empty title="No duplicates" hint={`Nothing over ${formatBytes(result.minBytes)} appears twice.`} /> : null}
          <div className="dk-groups">
            {groups.map((g) => (
              <Group key={g.hash} group={g} picked={picked} onToggle={(id) => setPicked((s) => {
                const n = new Set(s);
                if (n.has(id)) n.delete(id);
                else n.add(id);
                return n;
              })} onReveal={reveal} onCopy={copyPath} onNotify={notify} />
            ))}
          </div>
        </>
      ) : null}
      {!result && !running && !error ? (
        <Empty title="Find files you have twice" hint="Start with files over 1 MB; that is where the space is. The check reads file contents, so it takes a moment on a big disk." />
      ) : null}
    </div>
  );
}

function Group({
  group,
  picked,
  onToggle,
  onReveal,
  onCopy,
}: {
  group: DupeGroup;
  picked: Set<number>;
  onToggle(id: number): void;
  onReveal(path: string): void;
  onCopy(path: string): void;
  onNotify(text: string): void;
}) {
  const first = group.files[0];
  const wasted = group.size * (group.files.length - 1);
  return (
    <div className="dk-group">
      <div className="dk-group-head">
        <KindIcon node={first} size={15} />
        <span className="dk-group-name" title={first.name}>
          {first.name}
        </span>
        <span className="dk-chip">{group.files.length} copies</span>
        <span className="muted">{formatBytes(group.size)} each</span>
        <span className="dk-group-wasted">{formatBytes(wasted)} extra</span>
      </div>
      <ul className="dk-group-files">
        {group.files.map((f) => {
          const on = picked.has(f.id);
          return (
            <li key={f.id} className={on ? "picked" : ""}>
              <button className={`dk-check${on ? " on" : ""}`} aria-pressed={on} onClick={() => onToggle(f.id)} aria-label={on ? "Keep this copy" : "Remove this copy"}>
                {on ? <Check size={11} /> : null}
              </button>
              <span className="dk-group-path" title={f.path}>
                {f.path}
              </span>
              <span className="muted">{formatRelative(f.mtime)}</span>
              <span className={`dk-group-verdict${on ? " remove" : ""}`}>{on ? "remove" : "keep"}</span>
              <button className="dk-icon-btn" title="Reveal in Explorer" onClick={() => onReveal(f.path)}>
                <Copy size={12} style={{ display: "none" }} />
                <span>↗</span>
              </button>
              <button className="dk-icon-btn" title="Copy path" onClick={() => onCopy(f.path)}>
                <Copy size={12} />
              </button>
            </li>
          );
        })}
        {group.more ? <li className="muted">…and {group.more} more copies</li> : null}
      </ul>
    </div>
  );
}
