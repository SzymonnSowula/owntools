import { describeError } from "@core/errors";
import { timeAgo } from "@feature-board/boards";
import { confirmDialog } from "@ui/Dialog";
import { useEffect, useState } from "react";
import { NEVER_SYNCED } from "./collections";
import {
  clearSyncFolder,
  peekFolder,
  pickSyncFolder,
  renameDevice,
  setCollectionEnabled,
  setSyncFolder,
  syncNow,
  useSyncStatus,
} from "./engine";
import type { CollectionId, CollectionStatus, DeviceInfo } from "./types";

/**
 * Settings → Sync. Lives in the focus Settings page, so it speaks that page's
 * vocabulary (`card stack`, `row`, `btn`, `field`) and carries
 * `data-settings-section="sync"` for the shell's deep link.
 */

const UNITS: Record<CollectionId, [string, string]> = {
  "dictation-settings": ["set of settings", "sets of settings"],
  "dictation-vocabulary": ["entry", "entries"],
  "dictation-history": ["take", "takes"],
  "look-presets": ["look", "looks"],
  focus: ["workspace", "workspaces"],
  "automations-rules": ["rule", "rules"],
  boards: ["board", "boards"],
  meet: ["meeting", "meetings"],
};

function countLabel(c: CollectionStatus): string {
  const [one, many] = UNITS[c.id];
  return `${c.count} ${c.count === 1 ? one : many}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function deviceList(me: string, others: DeviceInfo[]): string {
  return [me, ...others.map((d) => d.deviceName)].join(", ");
}

function statusLine(deviceName: string, devices: DeviceInfo[], lastSyncAt: number | null, syncing: boolean): string {
  if (syncing) return "Syncing…";
  const when = lastSyncAt ? `Synced ${timeAgo(lastSyncAt)}` : "Not synced yet";
  if (!devices.length) return `${when} · only this device so far - open owntools on the other one and pick the same folder`;
  const n = devices.length + 1;
  return `${when} · ${n} devices: ${deviceList(deviceName, devices)}`;
}

export default function SyncCard() {
  const s = useSyncStatus();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [name, setName] = useState(s.deviceName);
  useEffect(() => setName(s.deviceName), [s.deviceName]);

  const choose = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const folder = await pickSyncFolder();
      if (!folder) return;
      const others = await peekFolder(folder);
      if (others.length) {
        const names = others.map((d) => d.deviceName).join(", ");
        const ok = await confirmDialog({
          title: "This folder already syncs owntools",
          message:
            `It holds data from ${names}. On this first sync, anything that exists on both sides - a workspace, a setting, a vocabulary entry - comes from the folder; everything only this device has is added. After that the last edit wins. Export a focus backup first if this device holds work you are not sure about.`,
          okLabel: "Use this folder",
          cancelLabel: "Not now",
          kind: "warning",
        });
        if (!ok) return;
      }
      await setSyncFolder(folder);
      setMsg("Synced.");
    } catch (err) {
      setMsg(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    const ok = await confirmDialog({
      title: "Stop syncing?",
      message: "This device stops reading and writing the folder. Its files stay where they are, and nothing on this device changes.",
      okLabel: "Stop syncing",
      kind: "info",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await clearSyncFolder();
      setMsg("Stopped. The folder keeps its files.");
    } catch (err) {
      setMsg(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const commitName = () => {
    const clean = name.trim();
    if (!clean || clean === s.deviceName) {
      setName(s.deviceName);
      return;
    }
    void renameDevice(clean).catch((err) => setMsg(describeError(err)));
  };

  const futureDevices = s.devices.filter((d) => d.futureClock);

  return (
    <section className="card stack" data-settings-section="sync">
      <div className="spread">
        <div>
          <strong>Sync between your devices</strong>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
            Via a folder another app already syncs for you - Dropbox, OneDrive, iCloud Drive, Syncthing, a NAS share.
            No account and no owntools server: each device writes its own files there and reads the others&apos;.
            Direct sync between devices on the same network is a later step.
          </p>
        </div>
        <span className={`pill${s.folder ? " active" : ""}`}>{s.folder ? "On" : "Off"}</span>
      </div>

      {!s.available ? (
        <p className="faint" style={{ fontSize: 12, margin: 0 }}>
          Sync needs the desktop app - in this browser preview there is no folder to sync to.
        </p>
      ) : (
        <>
          <div>
            <div className="row" style={{ flexWrap: "wrap", alignItems: "center" }}>
              <code
                title={s.folder ?? undefined}
                style={{ fontSize: 12, maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {s.folder ?? "No folder chosen yet"}
              </code>
              <button className="btn small" disabled={busy} onClick={() => void choose()}>
                {busy ? "Working…" : s.folder ? "Change folder…" : "Choose folder…"}
              </button>
              {s.folder ? (
                <button className="btn small ghost" disabled={busy} onClick={() => void stop()}>
                  Stop syncing
                </button>
              ) : null}
            </div>
            <p className="faint" style={{ fontSize: 12, margin: "6px 0 0" }}>
              Pick a folder that another app already syncs for you (Dropbox, OneDrive, iCloud Drive, Syncthing).
              {s.demo ? " Demo: an in-memory folder with a MacBook already in it." : ""}
            </p>
          </div>

          <label className="field" style={{ maxWidth: 320 }}>
            <span>This device&apos;s name</span>
            <input
              className="input"
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </label>

          {s.folder ? (
            <div className="row" style={{ flexWrap: "wrap", alignItems: "center" }}>
              <span className="muted" style={{ fontSize: 12 }} data-sync-status>
                {statusLine(s.deviceName, s.devices, s.lastSyncAt, s.syncing)}
              </span>
              <button className="btn small" disabled={s.syncing || busy} onClick={() => void syncNow()}>
                {s.syncing ? "Syncing…" : "Sync now"}
              </button>
            </div>
          ) : null}

          {s.error || s.warnings.length || futureDevices.length ? (
            <ul className="faint" style={{ fontSize: 12, margin: 0, paddingLeft: 18 }} data-sync-warnings>
              {s.error ? <li>{s.error}</li> : null}
              {futureDevices.map((d) => (
                <li key={d.deviceId}>
                  {d.deviceName}&apos;s clock is more than an hour ahead of this one - its edits will win until it is fixed.
                </li>
              ))}
              {s.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}

          <div>
            <strong style={{ fontSize: 13 }}>What syncs</strong>
            <div className="stack" style={{ gap: 8, marginTop: 6 }}>
              {s.collections.map((c) => (
                <div key={c.id} data-sync-collection={c.id}>
                  <label className="row" style={{ alignItems: "center" }}>
                    <input type="checkbox" checked={c.enabled} onChange={(e) => setCollectionEnabled(c.id, e.target.checked)} />
                    <span>{c.label}</span>
                    {c.enabled && s.folder ? (
                      <span className="faint" style={{ fontSize: 12 }}>
                        · {countLabel(c)} · {formatBytes(c.bytes)}
                      </span>
                    ) : null}
                  </label>
                  <div className="muted" style={{ fontSize: 12, marginLeft: 24 }}>
                    {c.detail}
                  </div>
                  {c.note ? (
                    <div className="faint" style={{ fontSize: 12, marginLeft: 24 }}>
                      {c.note}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <p className="faint" style={{ fontSize: 12, margin: 0 }}>What never syncs: {NEVER_SYNCED}.</p>
          {msg ? (
            <span className="faint" style={{ fontSize: 12 }} data-sync-message>
              {msg}
            </span>
          ) : null}
        </>
      )}
    </section>
  );
}
