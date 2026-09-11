import "./privacy.css";
import { useEffect, useState } from "react";
import { confirmDialog } from "@ui/Dialog";
import { OPEN_SETTINGS_SECTION_EVENT } from "@core/llm";
import {
  monthOf,
  offlineBlockedCount,
  offlineMode,
  onNetLog,
  onOfflineChange,
  setOfflineMode,
  shiftMonth,
  syncOfflineMode,
  type HostRow,
  type NetEntry,
} from "@core/net";
import { clearLog } from "./api";
import { exportLog, type ExportFormat } from "./export";
import { formatBytes, formatWhen, monthLabel } from "./format";
import { useNetSummary } from "./useNetSummary";

/**
 * Settings → Privacy. Turns "never phones home" into a number the person can
 * read: what left this machine this month (from the network log every
 * `trackedFetch` and Rust download writes), by host and purpose, plus the
 * Offline mode switch that makes the app refuse all egress. Written in the
 * focus Settings vocabulary (`.card`, `.stack`, `.row`, `.btn`) so it sits
 * between the other cards; the `pv-*` classes only style its insides.
 */

/** Takes the person to this card from anywhere in the main window. */
export function openPrivacySettings(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_SECTION_EVENT, { detail: { section: "privacy" } }));
}

const NEVER_LEAVES = [
  "audio and dictation takes",
  "transcripts and captions",
  "screen recordings and exports",
  "boards and notes",
  "captures",
  "meetings, their audio and notes",
  "the disk index and snapshots",
  "your dictionary and history",
];

const BY_DESIGN = [
  "model downloads from Hugging Face and GitHub",
  "posting to the networks you connect",
  "share-link uploads to owntools.app",
  "the YouTube transcript tool",
  "cloud model calls, only if you configure a key",
  "update checks against GitHub releases",
];

function useOffline(): [boolean, (on: boolean) => Promise<void>, boolean] {
  const [on, setOn] = useState(offlineMode);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void syncOfflineMode().then(setOn);
    return onOfflineChange(() => setOn(offlineMode()));
  }, []);
  const set = async (next: boolean) => {
    setBusy(true);
    try {
      await setOfflineMode(next);
      setOn(next);
    } finally {
      setBusy(false);
    }
  };
  return [on, set, busy];
}

function useBlockedCount(): number {
  const [n, setN] = useState(offlineBlockedCount);
  useEffect(() => onNetLog(() => setN(offlineBlockedCount())), []);
  return n;
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="pv-stat-n">{value}</div>
      <div className="pv-stat-l">{label}</div>
    </div>
  );
}

function HostTable({ rows, now }: { rows: HostRow[]; now: number }) {
  return (
    <table className="pv-table">
      <thead>
        <tr>
          <th>Host · purpose</th>
          <th className="num">Requests</th>
          <th className="num">Sent</th>
          <th className="num">Received</th>
          <th className="when">Last</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.kind} ${r.host} ${r.purpose}`}>
            <td title={`${r.host} — ${r.purpose}`}>
              <span className="pv-host">{r.host}</span>
              <br />
              <span className="pv-purpose">{r.purpose}</span>
              {r.failed > 0 ? <span className="pv-fail">{r.failed} failed</span> : null}
            </td>
            <td className="num">{r.requests}</td>
            <td className="num">{formatBytes(r.bytesOut)}</td>
            <td className="num" title={r.unknownIn ? `${r.unknownIn} of unknown size` : undefined}>
              {formatBytes(r.bytesIn)}
              {r.unknownIn ? "+" : ""}
            </td>
            <td className="when">{formatWhen(r.last, now)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RecentList({ entries, now }: { entries: NetEntry[]; now: number }) {
  if (!entries.length) {
    return <p className="faint" style={{ fontSize: 12, margin: 0 }}>No requests recorded yet.</p>;
  }
  return (
    <ul className="pv-recent">
      {entries.map((e, i) => (
        <li key={`${e.ts}-${i}`} data-ok={e.ok}>
          <span className="when">{formatWhen(e.ts, now)}</span>
          <span className="what" title={`${e.method} ${e.host} — ${e.purpose}`}>
            <span className="pv-method">{e.method}</span>
            <span className="pv-host">{e.host}</span>
            <span className="pv-purpose">{e.purpose}</span>
            {e.kind === "local" ? <span className="pv-kind">local</span> : null}
          </span>
          <span className="size">
            {e.bytesOut ? `${formatBytes(e.bytesOut)} out` : ""}
            {e.bytesOut && e.bytesIn !== null ? " · " : ""}
            {e.bytesIn !== null ? `${formatBytes(e.bytesIn)} in` : e.bytesOut ? "" : "size unknown"}
            {e.status !== null ? ` · ${e.status}` : e.ok ? "" : " · no answer"}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function PrivacyCard() {
  const { month, setMonth, summary, recent, loading, error, refresh } = useNetSummary();
  const [offline, setOffline, offlineBusy] = useOffline();
  const blocked = useBlockedCount();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = Date.now();
  const thisMonth = monthOf(now);
  const lastMonth = shiftMonth(thisMonth, -1);
  const label = monthLabel(month, now);
  const zero = !summary || summary.requests === 0;
  const recentInMonth = recent.filter((e) => monthOf(e.ts) === month);

  const doExport = async (format: ExportFormat) => {
    setBusy(true);
    setMsg(null);
    try {
      const outcome = await exportLog(format);
      if (outcome.kind === "saved") setMsg(`Saved to ${outcome.path}`);
      else if (outcome.kind === "downloaded") setMsg(`Downloaded ${outcome.name}`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  };

  const doClear = async () => {
    const ok = await confirmDialog({
      title: "Clear the network log?",
      message: "The record of past requests on this device is deleted. Nothing else changes — it starts filling again from the next request.",
      okLabel: "Clear log",
      kind: "warning",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await clearLog();
      await refresh();
      setMsg("Log cleared.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Couldn't clear the log.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack pv-card" data-settings-section="privacy">
      <div className="pv-head">
        <div>
          <strong>Privacy</strong>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
            Every request that leaves this machine is counted here, with what it was for. This page is
            built from a log on this device — it does not phone home to check.
          </p>
        </div>
        <div className="pv-seg" role="group" aria-label="Month">
          <button type="button" aria-pressed={month === thisMonth} onClick={() => setMonth(thisMonth)}>
            this month
          </button>
          <button type="button" aria-pressed={month === lastMonth} onClick={() => setMonth(lastMonth)}>
            last month
          </button>
        </div>
      </div>

      <div className="pv-hero" data-zero={zero} aria-live="polite">
        {loading && !summary ? (
          <div className="pv-hero-sub">Reading the log…</div>
        ) : zero ? (
          <>
            <div className="pv-hero-title">Nothing left this machine {label}.</div>
            <div className="pv-hero-sub">0 requests · 0 B sent · 0 B received</div>
          </>
        ) : (
          <div className="pv-stats">
            <Stat value={String(summary.requests)} label={summary.requests === 1 ? `request left ${label}` : `requests left ${label}`} />
            <Stat value={formatBytes(summary.bytesOut)} label="sent" />
            <Stat
              value={`${formatBytes(summary.bytesIn)}${summary.unknownIn ? "+" : ""}`}
              label={summary.unknownIn ? `received · ${summary.unknownIn} of unknown size` : "received"}
            />
          </div>
        )}
        {summary && (summary.localRequests > 0 || summary.failed > 0) ? (
          <div className="pv-hero-note">
            {summary.localRequests > 0 ? (
              <>
                <b>{summary.localRequests}</b> {summary.localRequests === 1 ? "request" : "requests"} stayed on this machine (loopback or your own network) and{" "}
                {summary.localRequests === 1 ? "is" : "are"} not counted above.
              </>
            ) : null}
            {summary.localRequests > 0 && summary.failed > 0 ? " " : null}
            {summary.failed > 0 ? (
              <>
                <b>{summary.failed}</b> {summary.failed === 1 ? "request" : "requests"} got no good answer.
              </>
            ) : null}
          </div>
        ) : null}
        {error ? <div className="pv-hero-note">Couldn't read the log: {error}</div> : null}
      </div>

      {summary && summary.byHost.length > 0 ? <HostTable rows={summary.byHost} now={now} /> : null}

      {summary && summary.local.length > 0 ? (
        <details className="pv-details">
          <summary>
            Stayed on this machine · {summary.local.length} {summary.local.length === 1 ? "host" : "hosts"}
          </summary>
          <div className="pv-body">
            <HostTable rows={summary.local} now={now} />
          </div>
        </details>
      ) : null}

      <details className="pv-details">
        <summary>Recent requests{recentInMonth.length ? ` · ${recentInMonth.length}` : ""}</summary>
        <div className="pv-body">
          <RecentList entries={recentInMonth} now={now} />
        </div>
      </details>

      <div className="pv-two">
        <div>
          <div className="pv-h">Never leaves this device</div>
          <ul className="pv-list">
            {NEVER_LEAVES.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="pv-h">Leaves only when you ask</div>
          <ul className="pv-list dim">
            {BY_DESIGN.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="pv-offline" data-on={offline}>
        <div className="pv-offline-row">
          <div>
            <strong>Offline mode</strong>
            {offline ? <span className="pv-offline-state">on</span> : null}
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Refuse every request that would leave this machine, before it is sent.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={offline}
            aria-label="Offline mode"
            className="pv-switch"
            disabled={offlineBusy}
            onClick={() => void setOffline(!offline)}
          />
        </div>
        <p className="faint" style={{ fontSize: 12, margin: "10px 0 0" }}>
          Stops: model downloads, posting to networks, share links, the YouTube tool, cloud model
          calls and update checks. Keeps working: dictation, recording, the editor, boards, notes,
          disk, meetings, on-device models — everything that never needed the network.
          {blocked > 0 ? ` Refused ${blocked} ${blocked === 1 ? "request" : "requests"} since the app started.` : ""}
        </p>
      </div>

      <div className="pv-actions">
        <button className="btn small" disabled={busy} onClick={() => void doExport("jsonl")}>
          Export log (JSONL)
        </button>
        <button className="btn small" disabled={busy} onClick={() => void doExport("csv")}>
          Export CSV
        </button>
        <button className="btn small ghost" disabled={busy} onClick={() => void doClear()}>
          Clear log
        </button>
        {msg ? <span className="pv-msg">{msg}</span> : null}
      </div>
      <p className="faint" style={{ fontSize: 12, margin: 0 }}>
        The log is a file on this device — <span className="pv-path">privacy/netlog.jsonl</span> in the
        app's data folder. It keeps hosts, sizes and purposes, never what was sent.
      </p>
    </section>
  );
}

/**
 * A chip for the hub or the titlebar: "0 B out this month" when that is
 * true, the number when it is not, "offline mode" while the switch is on.
 * Clicking it opens the card.
 */
export function PrivacyBadge({ onClick }: { onClick?: () => void }) {
  const { summary } = useNetSummary(1);
  const [offline] = useOffline();
  const zero = !summary || summary.requests === 0;
  const text = offline ? "offline mode" : zero ? "0 B out this month" : `${formatBytes(summary.bytesOut)} out this month`;
  const title = offline
    ? "Offline mode is on — nothing leaves this machine."
    : zero
      ? "Nothing left this machine this month. Open Privacy for the log."
      : `${summary.requests} ${summary.requests === 1 ? "request" : "requests"} left this machine this month. Open Privacy for the list.`;
  return (
    <button type="button" className="pv-badge" data-zero={zero} data-offline={offline} title={title} onClick={onClick ?? openPrivacySettings}>
      {text}
    </button>
  );
}
