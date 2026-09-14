import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Layers, Loader2, ShieldCheck, Trash2, X } from "lucide-react";
import { backend } from "../api";
import type { DupeGroup, DupesProgress, DupesResult, NodeInfo, TrashFailure } from "../api/types";
import { canTick, defaultPicks, leftOutParts, type Keep } from "../lib/dupes";
import { baseName, formatBytes, formatCount, formatRelative } from "../lib/format";
import { useDiskStore } from "../store";
import { Empty, KindIcon } from "../components/primitives";

const MIN_SIZES: { label: string; bytes: number }[] = [
  { label: "64 KB", bytes: 64 * 1024 },
  { label: "1 MB", bytes: 1024 * 1024 },
  { label: "10 MB", bytes: 10 * 1024 * 1024 },
  { label: "100 MB", bytes: 100 * 1024 * 1024 },
];

/** A stable empty list: a fresh `[]` per render would re-derive the picks forever. */
const NO_GROUPS: DupeGroup[] = [];

const MOVE_NOTE =
  "They go to the Recycle Bin, and one copy of every file stays. Right before anything moves, each copy is read again and compared with a copy that stays — anything no longer identical is left where it is.";

/**
 * Duplicates: a person's own files that are byte-for-byte identical (size +
 * content hash) under the scan root or the current folder. Windows, installed
 * programs, tool and package folders and code projects are left out in Rust
 * (`protect.rs`) — they keep identical copies on purpose — and the page says
 * how much it left out. Each group keeps one copy by rule; the rest are ticked,
 * and go to the Recycle Bin only after Rust has read them again.
 */
export function DuplicatesPage() {
  const summary = useDiskStore((s) => s.summary);
  const currentId = useDiskStore((s) => s.currentId);
  const dataVersion = useDiskStore((s) => s.dataVersion);
  const trashing = useDiskStore((s) => s.trashing);
  const notice = useDiskStore((s) => s.notice);
  const { trashNow, reveal, copyPath, dismissNotice } = useDiskStore.getState();
  /** What the last move left where it was, and why — the cleanup bar that says so lives on Explore. */
  const [leftAlone, setLeftAlone] = useState<TrashFailure[]>([]);
  const [minBytes, setMinBytes] = useState(MIN_SIZES[1].bytes);
  const [scope, setScope] = useState<"root" | "current">("root");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<DupesProgress | null>(null);
  const [check, setCheck] = useState<DupesProgress | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [result, setResult] = useState<DupesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keep, setKeep] = useState<Keep>("best");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  /** Set while this page's own cleanup runs, so the reset below leaves the trimmed groups alone. */
  const ownChange = useRef(false);

  useEffect(() => {
    const api = backend();
    void api.dupesResult().then((r) => r && setResult(r));
    const offP = api.onDupesProgress((p) => (p.phase === "check" ? setCheck(p) : setProgress(p)));
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
  const initialPicks = useMemo(() => defaultPicks(groups, keep), [groups, keep]);
  useEffect(() => setPicked(initialPicks), [initialPicks]);

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
  const leftOut = leftOutParts(result?.leftOut);

  const clean = async () => {
    ownChange.current = true;
    setCleaning(true);
    setLeftAlone([]);
    try {
      const outcome = await trashNow(pickedFiles, "duplicates", {
        move: (ids, options) => backend().dupesTrash(ids, options),
        note: MOVE_NOTE,
      });
      if (!outcome) {
        ownChange.current = false;
        return;
      }
      setLeftAlone(outcome.failed);
      // The backend dropped what moved and recomputed the totals; fall back to trimming here.
      const fresh = await backend().dupesResult().catch(() => null);
      const gone = new Set(outcome.removed);
      setResult((r) =>
        fresh ?? (r ? { ...r, groups: r.groups.map((g) => ({ ...g, files: g.files.filter((f) => !gone.has(f.id)) })).filter((g) => g.files.length + g.more > 1) } : r),
      );
    } finally {
      setCleaning(false);
      setCheck(null);
    }
  };

  if (!summary) return <Empty title="Scan something first" hint="Duplicates are found inside the scanned tree." />;

  return (
    <div className="dk-page">
      <header className="dk-page-head">
        <div>
          <h1>
            <Layers size={18} /> Duplicates
          </h1>
          <p>Your own files with the same bytes — checked by hashing, not by name.</p>
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
            <button className="dk-btn primary" onClick={() => void start()} disabled={cleaning}>
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
      {check && cleaning ? (
        <div className="dk-progress slim" role="status" aria-live="polite">
          <Loader2 size={16} className="dk-spin" />
          <div className="dk-progress-text">
            Reading each copy again before it moves · {formatCount(check.done)} of {formatCount(check.total)}
          </div>
          <div className="dk-progress-track">
            <span style={{ width: check.total ? `${(check.done / check.total) * 100}%` : undefined }} />
          </div>
        </div>
      ) : null}
      {trashing && cleaning ? (
        <div className="dk-progress slim" role="status" aria-live="polite">
          <Loader2 size={16} className="dk-spin" />
          <div className="dk-progress-text">
            Moving to the Recycle Bin · {formatCount(Math.min(trashing.done + 1, trashing.total))} of {formatCount(trashing.total)}
            {trashing.path ? ` · ${baseName(trashing.path)}` : ""}
          </div>
          <div className="dk-progress-track">
            <span style={{ width: `${(trashing.done / Math.max(1, trashing.total)) * 100}%` }} />
          </div>
        </div>
      ) : null}
      {notice && !cleaning ? (
        <div className={`dk-notice block ${notice.kind}`} role="status">
          <span className="dk-notice-text">{notice.text}</span>
          <button
            className="dk-notice-close"
            aria-label="Dismiss"
            onClick={() => {
              dismissNotice();
              setLeftAlone([]);
            }}
          >
            <X size={12} />
          </button>
        </div>
      ) : null}
      {notice && !cleaning && leftAlone.length ? (
        <ul className="dk-left-alone" aria-label="Left where they were">
          {leftAlone.slice(0, 8).map((f) => (
            <li key={f.id}>
              <span className="dk-group-path" title={f.path}>
                {f.path}
              </span>
              <span className="muted" title={f.error}>
                {f.error}
              </span>
            </li>
          ))}
          {leftAlone.length > 8 ? <li className="muted">…and {formatCount(leftAlone.length - 8)} more</li> : null}
        </ul>
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
              <span>files compared</span>
            </div>
            <span className="dk-cleanup-spacer" />
            <label className="dk-field">
              <span>Keep</span>
              <select value={keep} onChange={(e) => setKeep(e.target.value as Keep)}>
                <option value="best">the best-placed copy</option>
                <option value="oldest">the oldest copy</option>
                <option value="newest">the newest copy</option>
              </select>
            </label>
            <button
              className="dk-btn danger"
              disabled={!pickedFiles.length || cleaning || !!trashing}
              title="One copy of every file stays, and each copy is read again right before it moves."
              onClick={() => void clean()}
            >
              <Trash2 size={13} /> Move {formatCount(pickedFiles.length)} to Recycle Bin · {formatBytes(pickedBytes)}
            </button>
          </div>
          {leftOut.length ? (
            <p className="dk-leftout">
              <ShieldCheck size={14} aria-hidden />
              <span>
                <b>Left out on purpose:</b> {leftOut.map((p) => p.text).join(" · ")}. Programs and projects keep identical copies on
                purpose — each loads its files from its own folder, so removing “the extra copy” breaks it.
              </span>
            </p>
          ) : null}
          {result.cancelled ? <div className="dk-caution">Stopped early — this is a partial list.</div> : null}
          {!groups.length ? (
            <Empty title="No duplicates" hint={`None of your files over ${formatBytes(result.minBytes)} appears twice.`} />
          ) : null}
          <div className="dk-groups">
            {groups.map((g) => (
              <Group
                key={g.hash}
                group={g}
                picked={picked}
                onToggle={(id) =>
                  setPicked((s) => {
                    if (!canTick(g, s, id)) return s;
                    const n = new Set(s);
                    if (n.has(id)) n.delete(id);
                    else n.add(id);
                    return n;
                  })
                }
                onReveal={reveal}
                onCopy={copyPath}
              />
            ))}
          </div>
        </>
      ) : null}
      {!result && !running && !error ? (
        <Empty
          title="Find files you have twice"
          hint="Start with files over 1 MB; that is where the space is. The check reads file contents, so it takes a moment on a big disk. Windows, apps and code projects are never offered."
        />
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
}) {
  const first = group.files[0];
  const copies = group.files.length + group.more;
  const wasted = group.size * (copies - 1);
  return (
    <div className="dk-group">
      <div className="dk-group-head">
        <KindIcon node={first} size={15} />
        <span className="dk-group-name" title={first.name}>
          {first.name}
        </span>
        <span className="dk-chip">{copies} copies</span>
        <span className="muted">{formatBytes(group.size)} each</span>
        <span className="dk-group-wasted">{formatBytes(wasted)} extra</span>
      </div>
      <ul className="dk-group-files">
        {group.files.map((f) => {
          const on = picked.has(f.id);
          const locked = !canTick(group, picked, f.id);
          return (
            <li key={f.id} className={on ? "picked" : ""}>
              <button
                className={`dk-check${on ? " on" : ""}`}
                aria-pressed={on}
                disabled={locked}
                title={locked ? "One copy of every file always stays" : on ? "Keep this copy" : "Remove this copy"}
                onClick={() => onToggle(f.id)}
                aria-label={on ? "Keep this copy" : "Remove this copy"}
              >
                {on ? <Check size={11} /> : null}
              </button>
              <span className="dk-group-path" title={f.path}>
                {f.path}
              </span>
              <span className="muted">{formatRelative(f.mtime)}</span>
              <span className={`dk-group-verdict${on ? " remove" : ""}`}>{on ? "remove" : "stays"}</span>
              <button className="dk-icon-btn" title="Reveal in Explorer" onClick={() => onReveal(f.path)}>
                <span>↗</span>
              </button>
              <button className="dk-icon-btn" title="Copy path" onClick={() => onCopy(f.path)}>
                <Copy size={12} />
              </button>
            </li>
          );
        })}
        {group.more ? <li className="muted">…and {group.more} more copies, which always stay</li> : null}
      </ul>
    </div>
  );
}
