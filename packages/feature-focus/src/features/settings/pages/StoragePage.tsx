import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { confirmDialog } from "@ui/Dialog";
import { logError } from "@core/errors";
import { emitToolEvent, STORAGE_CLEARED_EVENT } from "@core/events";
import { OPEN_TOOL_EVENT } from "@core/handoff";
import { openSettings, requestToolPage } from "@core/navigation";
import { isTauri } from "../../../lib/env";
import {
  AGE_OPTIONS,
  cacheHint,
  clearNote,
  confirmDelete,
  confirmDownloads,
  deleteNote,
  downloadsHint,
  fileHint,
  formatBytes,
  pickItems,
  shareLabel,
  spaceRows,
  sumBytes,
  type Age,
  type ClearOutcome,
  type DeleteOutcome,
  type FileKind,
  type StorageUsage,
} from "../storage";
import { Button, Card, Note } from "../ui";

type Busy = "cache" | "downloads" | FileKind | null;
type Notice = { card: "cache" | "files"; text: string } | null;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/**
 * Settings → Storage. How much owntools keeps on this device, row by row, and
 * the buttons that take space back: the cache (nothing anyone made), unfinished
 * downloads, and — after a dialog that names them — screenshots, recordings and
 * meeting audio. Models only link to where they are managed: removing one has
 * rules of its own (a resident server to stop, a setting to reset).
 */
export function StoragePage() {
  const native = isTauri();
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [age, setAge] = useState<Age>("all");
  const mounted = useRef(true);

  const measure = useCallback(async () => {
    setMeasuring(true);
    try {
      const next = await call<StorageUsage>("storage_usage");
      if (!mounted.current) return;
      setUsage(next);
      setError(null);
    } catch (err) {
      logError("storage", "measure", err);
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setMeasuring(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (native) void measure();
    return () => {
      mounted.current = false;
    };
  }, [native, measure]);

  const picked = useMemo(() => {
    const now = Date.now();
    return {
      captures: pickItems(usage?.captures ?? [], age, now),
      recordings: pickItems(usage?.recordings ?? [], age, now),
      "meeting-audio": pickItems(usage?.meetings ?? [], age, now),
    } satisfies Record<FileKind, unknown>;
  }, [usage, age]);

  if (!native) {
    return (
      <Card title="On this device">
        <div className="st-row-foot">Storage is measured in the desktop app.</div>
      </Card>
    );
  }

  if (!usage) {
    return error ? (
      <Card title="On this device">
        <div className="st-row-foot st-inline">
          <Note>Couldn't measure what owntools keeps: {error}</Note>
          <Button kind="ghost" onClick={() => void measure()}>
            Try again
          </Button>
        </div>
      </Card>
    ) : (
      <div className="st-loading">
        <LoaderCircle aria-hidden />
        Measuring…
      </div>
    );
  }

  const rows = spaceRows(usage);
  const total = usage.total;

  async function run<T>(what: Exclude<Busy, null>, card: "cache" | "files", work: () => Promise<T>, note: (result: T) => string) {
    setBusy(what);
    setNotice(null);
    try {
      const result = await work();
      if (mounted.current) setNotice({ card, text: note(result) });
    } catch (err) {
      logError("storage", what, err);
      if (mounted.current) setNotice({ card, text: `That did not work: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      if (mounted.current) setBusy(null);
      await measure();
    }
  }

  const clearCache = () =>
    run("cache", "cache", async () => {
      const outcome = await call<ClearOutcome>("storage_clear_cache");
      emitToolEvent(STORAGE_CLEARED_EVENT, { kind: "cache", ids: [] });
      return outcome;
    }, (outcome) => clearNote("cache", outcome));

  const clearDownloads = async () => {
    if (!(await confirmDialog({ ...confirmDownloads(usage), kind: "warning" }))) return;
    await run("downloads", "cache", async () => {
      const outcome = await call<ClearOutcome>("storage_clear_downloads");
      emitToolEvent(STORAGE_CLEARED_EVENT, { kind: "downloads", ids: [] });
      return outcome;
    }, (outcome) => clearNote("downloads", outcome));
  };

  const deleteFiles = async (kind: FileKind) => {
    const items = picked[kind];
    if (!items.length) return;
    if (!(await confirmDialog({ ...confirmDelete(kind, items, age), kind: "danger" }))) return;
    await run(kind, "files", async () => {
      const outcome = await call<DeleteOutcome>("storage_delete", { kind, ids: items.map((i) => i.id) });
      if (outcome.removed.length) emitToolEvent(STORAGE_CLEARED_EVENT, { kind, ids: outcome.removed });
      return outcome;
    }, (outcome) => deleteNote(kind, outcome));
  };

  const openFolder = () =>
    void call("storage_open_folder").catch((err) => {
      logError("storage", "open folder", err);
      setNotice({ card: "cache", text: "Couldn't open the folder." });
    });

  const manageSpeech = () => {
    requestToolPage("dictate", "models");
    window.dispatchEvent(new CustomEvent(OPEN_TOOL_EVENT, { detail: { tool: "dictate" } }));
  };

  const idle = busy === null;

  return (
    <>
      <Card flush={false}>
        <div className="st-space-hero">
          <div>
            <div className="st-space-total">{formatBytes(total)}</div>
            <div className="st-row-hint">used by owntools on this device</div>
          </div>
          <div className="st-row-ctl">
            <Button kind="ghost" disabled={measuring} onClick={() => void measure()}>
              {measuring ? "Measuring…" : "Refresh"}
            </Button>
            <Button onClick={openFolder}>Show folder</Button>
          </div>
        </div>
      </Card>

      <Card id="cache" title="Cache" desc="Files owntools made for itself - none of your work is in here.">
        <SpaceRow
          label="Cache and temporary files"
          hint={cacheHint(usage)}
          bytes={rows.cache}
          total={total}
          action={
            <Button disabled={!idle} onClick={() => void clearCache()}>
              {busy === "cache" ? "Clearing…" : "Clear cache"}
            </Button>
          }
        />
        <SpaceRow
          id="downloads"
          label="Unfinished downloads"
          hint={downloadsHint(usage)}
          bytes={rows.downloads}
          total={total}
          action={
            <Button kind="ghost" disabled={!idle || usage.cache.downloadFiles === 0} onClick={() => void clearDownloads()}>
              {busy === "downloads" ? "Deleting…" : "Delete"}
            </Button>
          }
        />
        {notice?.card === "cache" ? (
          <div className="st-row-foot">
            <Note>{notice.text}</Note>
          </div>
        ) : null}
      </Card>

      <Card
        id="files"
        title="Your files"
        desc="Deleted for good - move anything you want to keep first."
        action={
          <select
            className="st-select"
            aria-label="Which files the buttons delete"
            value={age}
            disabled={!idle}
            onChange={(e) => setAge(e.target.value as Age)}
          >
            {AGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        }
      >
        {(
          [
            ["captures", "Screenshots", "Delete"],
            ["recordings", "Screen recordings", "Delete"],
            ["meeting-audio", "Meeting audio", "Delete audio"],
          ] as const
        ).map(([kind, label, verb]) => {
          const all = kind === "captures" ? usage.captures : kind === "recordings" ? usage.recordings : usage.meetings;
          const chosen = picked[kind];
          return (
            <SpaceRow
              key={kind}
              label={label}
              hint={fileHint(kind, chosen, all, age)}
              bytes={sumBytes(chosen)}
              total={total}
              action={
                <Button kind="danger" disabled={!idle || chosen.length === 0} onClick={() => void deleteFiles(kind)}>
                  {busy === kind ? "Deleting…" : verb}
                </Button>
              }
            />
          );
        })}
        {notice?.card === "files" ? (
          <div className="st-row-foot">
            <Note>{notice.text}</Note>
          </div>
        ) : null}
      </Card>

      <Card id="models" title="Kept by the tools" desc="Models are the largest files; each one downloads again when a tool needs it.">
        <SpaceRow
          label="Speech models"
          hint="The dictation engines and models. Remove one in dictate."
          bytes={rows.speech}
          total={total}
          action={
            <Button kind="ghost" onClick={manageSpeech}>
              Manage
            </Button>
          }
        />
        <SpaceRow
          label="Language model"
          hint="The model the tools share for summaries and drafts."
          bytes={rows.language}
          total={total}
          action={
            <Button kind="ghost" onClick={() => openSettings("intelligence")}>
              Manage
            </Button>
          }
        />
        <SpaceRow label="Boards and posts" hint="Deleted from inside board and social." bytes={rows.boardsAndPosts} total={total} />
        <SpaceRow
          label="Everything else"
          hint="Tasks, notes, settings, transcripts, logs and the web view's own files."
          bytes={rows.other}
          total={total}
        />
      </Card>
    </>
  );
}

/** One kind of thing on disk: what it is, its share of the whole as a bar, its size, and what to do about it. */
function SpaceRow({
  id,
  label,
  hint,
  bytes,
  total,
  action,
}: {
  id?: string;
  label: string;
  hint: string;
  bytes: number;
  total: number;
  action?: ReactNode;
}) {
  const pct = total > 0 ? Math.min(100, (bytes / total) * 100) : 0;
  const share = shareLabel(bytes, total);
  return (
    <div className="st-row st-space" data-settings-section={id}>
      <div className="st-row-text">
        <div className="st-row-label">{label}</div>
        <div className="st-row-hint">{hint}</div>
        <div className="st-meter" role="img" aria-label={`${label}: ${share} of the space owntools uses`} title={`${share} of the space owntools uses`}>
          {bytes > 0 ? <div className="st-meter-fill" style={{ width: `max(3px, ${pct}%)` }} /> : null}
        </div>
      </div>
      <div className="st-row-ctl">
        <span className="st-space-size">{formatBytes(bytes)}</span>
        {action}
      </div>
    </div>
  );
}
