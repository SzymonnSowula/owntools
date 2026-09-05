import { useEffect, useRef, useState } from "react";
import type { AspectRatio, Project, ShareLink } from "../types";
import type { ExportPhase } from "../lib/exportVideo";
import { exportProject, blobToFileDownload, probeExportSupport } from "../lib/exportVideo";
import { canvasSize, drawFrame } from "../lib/compositor";
import { timelineDuration, timelineToSource } from "../lib/segments";
import {
  createShareLink,
  deleteShareLink,
  describeShareError,
  isShareExpired,
  type SharePhase,
} from "../lib/share";
import { activateLicense, isPro } from "@licensing/license";
import { PRICING_URL, SUITE_NAME } from "@core/branding";
import { exportBlobToPath } from "../lib/projectIo";
import { captionsToSrt } from "../lib/srt";
import { invokeSafe, isTauri } from "../lib/tauri";
import { useAppStore } from "../store/appStore";

const PHASE_LABEL: Record<ExportPhase, string> = {
  prepare: "Preparing…",
  audio: "Rendering audio…",
  video: "Rendering frames…",
  finalize: "Writing file…",
};

const SHARE_LABEL: Record<SharePhase, string> = {
  creating: "Asking shipshape.app for an upload…",
  uploading: "Uploading…",
  finishing: "Publishing the link…",
};

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function ExportModal({
  project,
  screen,
  webcam,
  background,
  overlayImages,
}: {
  project: Project;
  screen: HTMLVideoElement | null;
  webcam: HTMLVideoElement | null;
  background: HTMLImageElement | null;
  overlayImages?: Record<string, HTMLImageElement>;
}) {
  const open = useAppStore((s) => s.exportOpen);
  const setOpen = useAppStore((s) => s.setExportOpen);
  const progress = useAppStore((s) => s.exportProgress);
  const setProgress = useAppStore((s) => s.setExportProgress);
  const media = useAppStore((s) => s.media);
  const updateProject = useAppStore((s) => s.updateProject);
  const persistProject = useAppStore((s) => s.persistProject);
  const showToast = useAppStore((s) => s.showToast);
  const setPlaying = useAppStore((s) => s.setPlaying);
  const [busy, setBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [sharePhase, setSharePhase] = useState<SharePhase | null>(null);
  const [shareFraction, setShareFraction] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [phase, setPhase] = useState<ExportPhase>("prepare");
  const [fps, setFps] = useState<30 | 60>(60);
  const [hasFfmpeg, setHasFfmpeg] = useState(false);
  const [container, setContainer] = useState<"mp4" | "webm" | "legacy" | null>(null);
  const [pro, setPro] = useState(isPro());
  const [licenseInput, setLicenseInput] = useState("");
  const [showLicense, setShowLicense] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    setPro(isPro());
    void invokeSafe<boolean>("ffmpeg_available").then((v) => setHasFfmpeg(Boolean(v)));
    const { width, height } = canvasSize(project.aspect);
    void probeExportSupport(width, height)
      .then((choice) => setContainer(choice ? choice.container : "legacy"))
      .catch(() => setContainer("legacy"));
  }, [open, project.aspect]);

  if (!open) return null;

  const mp4Direct = container === "mp4";
  const canMp4 = mp4Direct || hasFfmpeg;

  async function run() {
    if (!media) {
      showToast("No video to export.", "error");
      return;
    }
    setPlaying(false);
    setBusy(true);
    setProgress(0.01);
    setPhase("prepare");
    abort.current = new AbortController();
    try {
      const { blob, ext } = await exportProject(project, media, screen, webcam, background, {
        fps,
        watermark: !isPro(),
        overlayImages,
        signal: abort.current.signal,
        onProgress: (p, ph) => {
          setProgress(p);
          setPhase(ph);
        },
      });
      const base = project.name.replace(/[^\w\-]+/g, "_") || SUITE_NAME;
      let outExt = ext;
      let saved = await exportBlobToPath(blob, `${base}.${ext}`, ext);

      if (ext === "webm" && hasFfmpeg && saved && isTauri()) {
        try {
          setPhase("finalize");
          setProgress(0.99);
          const mp4Path = saved.replace(/\.webm$/i, ".mp4");
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("convert_to_mp4", { input: saved, output: mp4Path });
          outExt = "mp4";
          saved = mp4Path;
        } catch {
          /* keep the WebM if conversion fails */
        }
      }

      if (!saved) await blobToFileDownload(blob, `${base}.${outExt}`);
      showToast(outExt === "mp4" ? "MP4 saved." : "Video saved.", "info");
      setOpen(false);
    } catch (err) {
      if ((err as { name?: string }).name !== "AbortError") {
        showToast(err instanceof Error ? err.message : "Export failed.", "error");
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  /** The frame under the playhead, at 1280 px wide — the link preview and the player's poster. */
  async function makePoster(): Promise<Blob | null> {
    try {
      const state = useAppStore.getState();
      const full = canvasSize(project.aspect);
      const scale = 1280 / full.width;
      const width = Math.round(full.width * scale);
      const height = Math.round(full.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      drawFrame({
        ctx,
        width,
        height,
        sourceTime: timelineToSource(state.timelineTime, project.segments),
        timelineTime: state.timelineTime,
        timelineDuration: timelineDuration(project.segments),
        project,
        screenVideo: screen,
        webcamVideo: webcam,
        backgroundImage: background,
        overlayImages,
        watermark: !isPro(),
      });
      return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    } catch {
      return null;
    }
  }

  async function copyLink(link: ShareLink) {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopiedId(link.id);
      window.setTimeout(() => setCopiedId((id) => (id === link.id ? null : id)), 1800);
    } catch {
      showToast(link.url, "info");
    }
  }

  async function openLink(link: ShareLink) {
    try {
      if (isTauri()) {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(link.url);
      } else {
        window.open(link.url, "_blank", "noopener");
      }
    } catch {
      showToast("Couldn't open the link.", "error");
    }
  }

  async function removeLink(link: ShareLink) {
    try {
      await deleteShareLink(link);
      updateProject({ shares: project.shares.filter((s) => s.id !== link.id) });
      await persistProject().catch(() => undefined);
      showToast("Link removed.", "info");
    } catch (err) {
      showToast(describeShareError(err), "error");
    }
  }

  /** Renders the video, uploads it and copies the link — one click, no file dialog. */
  async function share() {
    if (!media) {
      showToast("No video to export.", "error");
      return;
    }
    setPlaying(false);
    setShareBusy(true);
    setBusy(true);
    setProgress(0.01);
    setPhase("prepare");
    setSharePhase(null);
    abort.current = new AbortController();
    try {
      const poster = await makePoster();
      const { blob, ext } = await exportProject(project, media, screen, webcam, background, {
        fps,
        watermark: !isPro(),
        overlayImages,
        signal: abort.current.signal,
        onProgress: (p, ph) => {
          setProgress(p);
          setPhase(ph);
        },
      });
      setProgress(null);
      const { width, height } = canvasSize(project.aspect);
      const link = await createShareLink(
        {
          blob,
          ext,
          name: project.name,
          width,
          height,
          duration: timelineDuration(project.segments),
          poster,
        },
        (ph, fraction) => {
          setSharePhase(ph);
          setShareFraction(fraction);
        },
        abort.current.signal,
      );
      updateProject({ shares: [link, ...project.shares] });
      await persistProject().catch(() => undefined);
      await copyLink(link);
      showToast("Link copied — send it to anyone.", "info");
    } catch (err) {
      if ((err as { name?: string }).name !== "AbortError") {
        showToast(describeShareError(err), "error");
      }
    } finally {
      setShareBusy(false);
      setBusy(false);
      setProgress(null);
      setSharePhase(null);
    }
  }

  async function saveSrt() {
    try {
      const srt = captionsToSrt(project.captions, project.segments);
      const blob = new Blob([srt], { type: "text/plain" });
      const base = project.name.replace(/[^\w\-]+/g, "_") || SUITE_NAME;
      const saved = await exportBlobToPath(blob, `${base}.srt`, "srt");
      if (saved === null && !isTauri()) await blobToFileDownload(blob, `${base}.srt`);
      if (saved !== null || !isTauri()) showToast("Subtitles saved.", "info");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't save subtitles.", "error");
    }
  }

  async function tryActivate() {
    if (await activateLicense(licenseInput)) {
      setPro(true);
      setShowLicense(false);
      showToast("License active. Thanks for the support!", "info");
    } else {
      showToast("Invalid license key.", "error");
    }
  }

  async function openPricing() {
    try {
      if (isTauri()) {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(PRICING_URL);
      } else {
        window.open(PRICING_URL, "_blank", "noopener");
      }
    } catch {
      showToast("Couldn't open the pricing page.", "error");
    }
  }

  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-[#17151f]/35 p-6">
      <div className="scroll-thin max-h-[92vh] w-full max-w-md overflow-y-auto rounded-[18px] border border-line bg-card p-6 shadow-[0_30px_80px_rgba(23,21,31,0.18)]">
        <h2 className="text-lg font-semibold tracking-[-0.03em]">Export & share</h2>
        <p className="mt-1 text-sm text-muted">
          {canMp4
            ? "Saves an MP4 ready for YouTube, LinkedIn, Slack, or Drive."
            : "Saves a WebM (Chrome, VLC, Discord)."}
        </p>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {(["16:9", "9:16", "1:1"] as AspectRatio[]).map((aspect) => (
            <button
              key={aspect}
              className={`rounded-[12px] border py-3 text-sm font-semibold ${
                project.aspect === aspect ? "border-teal bg-teal/10 text-teal-2" : "border-line"
              }`}
              disabled={busy}
              onClick={() => updateProject({ aspect })}
            >
              {aspect}
            </button>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {([30, 60] as const).map((value) => (
            <button
              key={value}
              className={`rounded-[12px] border py-2 text-sm font-semibold ${
                fps === value ? "border-teal bg-teal/10 text-teal-2" : "border-line"
              }`}
              disabled={busy}
              onClick={() => setFps(value)}
            >
              {value} fps
            </button>
          ))}
        </div>

        {project.captions.length > 0 ? (
          <button
            className="btn btn-secondary mt-3 w-full text-xs"
            disabled={busy}
            onClick={() => void saveSrt()}
          >
            Download .srt
          </button>
        ) : null}

        <div className="mt-4 rounded-[12px] border border-line bg-paper px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Share link</p>
              <p className="text-xs text-muted">
                Renders the video, uploads it to shipshape.app and copies a link anyone can open.
              </p>
            </div>
            <button
              className="btn btn-secondary !h-8 shrink-0 !px-3 !py-0 text-xs"
              disabled={busy}
              onClick={() => void share()}
            >
              {shareBusy ? "Sharing…" : "Create link"}
            </button>
          </div>
          {sharePhase ? (
            <div className="mt-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-line">
                <div
                  className={`h-full bg-teal transition-[width] ${sharePhase === "uploading" ? "" : "animate-pulse"}`}
                  style={{ width: `${sharePhase === "uploading" ? Math.round(shareFraction * 100) : 100}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-muted">
                {SHARE_LABEL[sharePhase]}
                {sharePhase === "uploading" ? ` ${Math.round(shareFraction * 100)}%` : ""}
              </p>
            </div>
          ) : null}
          {project.shares.length ? (
            <ul className="mt-3 space-y-1.5">
              {project.shares.map((link) => (
                <li key={link.id} className="flex items-center gap-2 rounded-[10px] border border-line bg-card px-2.5 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[11px] text-ink">{link.url.replace(/^https?:\/\//, "")}</p>
                    <p className="text-[10px] text-muted">
                      {shortDate(link.createdAt)}
                      {link.expiresAt ? (isShareExpired(link) ? " · expired" : ` · until ${shortDate(link.expiresAt)}`) : ""}
                    </p>
                  </div>
                  <button className="btn btn-secondary !h-7 !px-2 !py-0 text-[11px]" onClick={() => void copyLink(link)}>
                    {copiedId === link.id ? "Copied" : "Copy"}
                  </button>
                  <button className="btn btn-ghost !h-7 !px-2 !py-0 text-[11px]" onClick={() => void openLink(link)}>
                    Open
                  </button>
                  <button
                    className="btn btn-ghost !h-7 !w-7 !p-0 text-[11px] text-muted"
                    title="Remove this link for everyone"
                    onClick={() => void removeLink(link)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {!pro ? (
          <div className="mt-4 rounded-[12px] border border-line bg-paper px-3 py-2.5 text-xs text-muted">
            {showLicense ? (
              <div className="flex gap-2">
                <input
                  className="field h-8 flex-1 font-mono text-xs uppercase"
                  placeholder="SCRN-XXXXX-XXXXX-XXXXX"
                  value={licenseInput}
                  onChange={(e) => setLicenseInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void tryActivate();
                  }}
                />
                <button className="btn btn-secondary h-8 px-3 text-xs" onClick={() => void tryActivate()}>
                  Activate
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  The free version adds a small "made with shipshape" badge.{" "}
                  <button className="font-semibold text-teal-2 underline" onClick={() => setShowLicense(true)}>
                    I have a license key
                  </button>
                </span>
                <button
                  className="btn btn-primary !h-7 !px-3 !py-0 !text-xs"
                  onClick={() => void openPricing()}
                >
                  Get Pro
                </button>
              </div>
            )}
          </div>
        ) : null}

        {progress !== null ? (
          <div className="mt-5">
            <div className="h-2 overflow-hidden rounded-full bg-line">
              <div
                className="h-full bg-teal transition-[width]"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-center text-xs text-muted">
              {PHASE_LABEL[phase]} {Math.round(progress * 100)}%
            </p>
          </div>
        ) : null}

        <div className="mt-6 flex gap-2">
          <button
            className="btn btn-secondary flex-1"
            onClick={() => {
              abort.current?.abort();
              setOpen(false);
              setProgress(null);
              setSharePhase(null);
            }}
          >
            {busy ? "Stop" : "Cancel"}
          </button>
          <button className="btn btn-primary flex-1" disabled={busy} onClick={() => void run()}>
            {busy ? "Exporting…" : canMp4 ? "Save MP4" : "Save video"}
          </button>
        </div>
      </div>
    </div>
  );
}
