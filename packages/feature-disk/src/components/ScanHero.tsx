import { Folder, HardDrive, Home, Loader2, Usb, X } from "lucide-react";
import { useDiskStore } from "../store";
import { baseName, formatBytes, formatCount, formatDuration } from "../lib/format";

/** The centre before a scan: volumes to pick from, plus Home / Folder. */
export function ScanHero() {
  const volumes = useDiskStore((s) => s.volumes);
  const scanError = useDiskStore((s) => s.scanError);
  const scanning = useDiskStore((s) => s.scanning);
  const { scan, scanHome, scanFolder } = useDiskStore.getState();
  return (
    <div className="dk-hero">
      <div className="dk-hero-copy">
        <h1>see where the space went.</h1>
        <p>Pick a drive or a folder. Every file is counted on this device, nothing leaves it.</p>
      </div>
      <div className="dk-volumes">
        {volumes.map((v) => {
          const used = v.total - v.free;
          const pct = v.total > 0 ? used / v.total : 0;
          return (
            <button key={v.path} className="dk-volume" onClick={() => scan(v.path)} disabled={scanning}>
              <span className="dk-volume-icon">{v.kind === "removable" ? <Usb size={18} /> : <HardDrive size={18} />}</span>
              <span className="dk-volume-text">
                <span className="dk-volume-name">
                  {v.label} <span className="muted">({baseName(v.path)})</span>
                </span>
                <span className="dk-volume-meta">
                  {formatBytes(used)} used of {formatBytes(v.total)} · {formatBytes(v.free)} free
                  {v.fs ? ` · ${v.fs}` : ""}
                </span>
                <span className="dk-volume-track">
                  <span className="dk-volume-fill" style={{ width: `${pct * 100}%`, background: pct > 0.92 ? "#ff453a" : pct > 0.8 ? "#f0a56c" : "var(--color-accent)" }} />
                </span>
              </span>
            </button>
          );
        })}
        <div className="dk-hero-row">
          <button className="dk-btn" onClick={() => void scanHome()} disabled={scanning}>
            <Home size={13} /> Scan my home folder
          </button>
          <button className="dk-btn" onClick={() => void scanFolder()} disabled={scanning}>
            <Folder size={13} /> Choose a folder…
          </button>
        </div>
        {scanError ? <div className="dk-error">{scanError}</div> : null}
      </div>
    </div>
  );
}

export function ScanProgressCard() {
  const progress = useDiskStore((s) => s.progress);
  const { cancelScan } = useDiskStore.getState();
  return (
    <div className="dk-progress">
      <div className="dk-progress-head">
        <Loader2 size={18} className="dk-spin" />
        <div>
          <div className="dk-progress-title">Scanning {progress?.root ?? "…"}</div>
          <div className="dk-progress-sub">Counting every file. Big disks take a minute or two the first time.</div>
        </div>
        <button className="dk-btn" onClick={() => void cancelScan()}>
          <X size={13} /> Cancel
        </button>
      </div>
      <div className="dk-progress-stats">
        <div>
          <b>{formatCount(progress?.files ?? 0)}</b>
          <span>files</span>
        </div>
        <div>
          <b>{formatCount(progress?.dirs ?? 0)}</b>
          <span>folders</span>
        </div>
        <div>
          <b>{formatBytes(progress?.bytes ?? 0)}</b>
          <span>so far</span>
        </div>
        <div>
          <b>{formatDuration(progress?.elapsedMs ?? 0)}</b>
          <span>elapsed</span>
        </div>
      </div>
      <div className="dk-progress-path" title={progress?.current}>
        {progress?.current ?? ""}
      </div>
      <div className="dk-progress-track">
        <span />
      </div>
    </div>
  );
}
