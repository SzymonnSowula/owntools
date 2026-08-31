import { useEffect, useRef, useState } from "react";
import type { AspectRatio, Project } from "../types";
import type { ExportPhase } from "../lib/exportVideo";
import { exportProject, blobToFileDownload, probeExportSupport } from "../lib/exportVideo";
import { canvasSize } from "../lib/compositor";
import { activateLicense, isPro } from "@licensing/license";
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

export function ExportModal({
  project,
  screen,
  webcam,
  background,
}: {
  project: Project;
  screen: HTMLVideoElement | null;
  webcam: HTMLVideoElement | null;
  background: HTMLImageElement | null;
}) {
  const open = useAppStore((s) => s.exportOpen);
  const setOpen = useAppStore((s) => s.setExportOpen);
  const progress = useAppStore((s) => s.exportProgress);
  const setProgress = useAppStore((s) => s.setExportProgress);
  const media = useAppStore((s) => s.media);
  const updateProject = useAppStore((s) => s.updateProject);
  const showToast = useAppStore((s) => s.showToast);
  const setPlaying = useAppStore((s) => s.setPlaying);
  const [busy, setBusy] = useState(false);
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
        signal: abort.current.signal,
        onProgress: (p, ph) => {
          setProgress(p);
          setPhase(ph);
        },
      });
      const base = project.name.replace(/[^\w\-]+/g, "_") || "screeni";
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

  async function saveSrt() {
    try {
      const srt = captionsToSrt(project.captions, project.segments);
      const blob = new Blob([srt], { type: "text/plain" });
      const base = project.name.replace(/[^\w\-]+/g, "_") || "screeni";
      const saved = await exportBlobToPath(blob, `${base}.srt`, "srt");
      if (saved === null && !isTauri()) await blobToFileDownload(blob, `${base}.srt`);
      if (saved !== null || !isTauri()) showToast("Subtitles saved.", "info");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't save subtitles.", "error");
    }
  }

  function tryActivate() {
    if (activateLicense(licenseInput)) {
      setPro(true);
      setShowLicense(false);
      showToast("License active. Thanks for the support!", "info");
    } else {
      showToast("Invalid license key.", "error");
    }
  }

  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-[#17151f]/35 p-6">
      <div className="w-full max-w-md rounded-[18px] border border-line bg-card p-6 shadow-[0_30px_80px_rgba(23,21,31,0.18)]">
        <h2 className="text-lg font-semibold tracking-[-0.03em]">Export</h2>
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

        {!pro ? (
          <div className="mt-4 rounded-[12px] border border-line bg-paper px-3 py-2.5 text-xs text-muted">
            {showLicense ? (
              <div className="flex gap-2">
                <input
                  className="field h-8 flex-1 font-mono text-xs uppercase"
                  placeholder="SCRN-XXXXX-XXXXX-XXXXX"
                  value={licenseInput}
                  onChange={(e) => setLicenseInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && tryActivate()}
                />
                <button className="btn btn-secondary h-8 px-3 text-xs" onClick={tryActivate}>
                  Activate
                </button>
              </div>
            ) : (
              <span>
                The free version adds a small "Made with Screeni" badge.{" "}
                <button className="font-semibold text-teal-2 underline" onClick={() => setShowLicense(true)}>
                  I have a license key
                </button>
              </span>
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
