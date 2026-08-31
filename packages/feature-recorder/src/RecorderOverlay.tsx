import { useEffect, useRef, useState } from "react";
import { hideRecorderOverlay, showMainWindow } from "@core/recorderWindow";
import { isTauri } from "@core/env";
import { getCursor, getScreenSize } from "@feature-editor/lib/cursor";
import { formatTime } from "@feature-editor/lib/time";
import { uid } from "@feature-editor/lib/id";
import {
  getDisplayStream,
  getWebcamStream,
  recordStream,
  stopStream,
} from "@feature-editor/lib/recorder";
import { startSpeechCapture } from "@feature-editor/lib/speech";
import { generateZoomKeyframes } from "@feature-editor/lib/zoom";
import { ensureFiniteDuration } from "@feature-editor/lib/videoEl";
import { saveProjectToDisk } from "@feature-editor/lib/projectIo";
import { emptyProject } from "@feature-editor/store/appStore";
import type { Caption, CursorSample, SpeechLang } from "@feature-editor/types";

type Phase = "setup" | "live" | "saving";

const SETUP_SIZE = { width: 460, height: 620 };
const LIVE_SIZE = { width: 440, height: 64 };

async function resizeSelf(size: { width: number; height: number }): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setSize(new LogicalSize(size.width, size.height));
}

async function emitToMain(event: string, payload?: unknown): Promise<void> {
  if (!isTauri()) return;
  const { emit } = await import("@tauri-apps/api/event");
  await emit(event, payload);
}

export function RecorderOverlay() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [webcamOn, setWebcamOn] = useState(true);
  const [autoZoom, setAutoZoom] = useState(true);
  const [speechLang, setSpeechLang] = useState<SpeechLang>("en-US");
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const screenStream = useRef<MediaStream | null>(null);
  const camStream = useRef<MediaStream | null>(null);
  const screenRec = useRef<MediaRecorder | null>(null);
  const camRec = useRef<MediaRecorder | null>(null);
  const screenDone = useRef<Promise<Blob> | null>(null);
  const camDone = useRef<Promise<Blob> | null>(null);
  const samples = useRef<CursorSample[]>([]);
  const captions = useRef<Caption[]>([]);
  const speech = useRef<{ stop: () => void } | null>(null);
  const timer = useRef<number | null>(null);
  const cursorTimer = useRef<number | null>(null);
  const startedAt = useRef(0);
  const pausedMs = useRef(0);
  const pauseStarted = useRef(0);
  const pausedRef = useRef(false);
  const webcamPreview = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    void resizeSelf(phase === "live" ? LIVE_SIZE : SETUP_SIZE);
  }, [phase]);

  useEffect(() => {
    if (phase !== "setup" || !webcamOn) {
      stopStream(camStream.current);
      camStream.current = null;
      return;
    }
    let cancelled = false;
    void getWebcamStream()
      .then((stream) => {
        if (cancelled) {
          stopStream(stream);
          return;
        }
        camStream.current = stream;
        if (webcamPreview.current) {
          webcamPreview.current.srcObject = stream;
          void webcamPreview.current.play();
        }
      })
      .catch(() => {
        if (!cancelled) setWebcamOn(false);
      });
    return () => {
      cancelled = true;
    };
  }, [phase, webcamOn]);

  function nowElapsed() {
    return (performance.now() - startedAt.current - pausedMs.current) / 1000;
  }

  function cleanup() {
    if (timer.current) window.clearInterval(timer.current);
    if (cursorTimer.current) window.clearInterval(cursorTimer.current);
    speech.current?.stop();
    stopStream(screenStream.current);
    stopStream(camStream.current);
    screenStream.current = null;
    camStream.current = null;
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const display = await getDisplayStream();
      screenStream.current = display;
      display.getVideoTracks()[0]?.addEventListener("ended", () => {
        void stopRecording();
      });

      if (webcamOn && !camStream.current) {
        try {
          camStream.current = await getWebcamStream();
        } catch {
          setWebcamOn(false);
        }
      }

      const screen = recordStream(display);
      screenRec.current = screen.recorder;
      screenDone.current = screen.done;
      if (camStream.current) {
        const cam = recordStream(camStream.current);
        camRec.current = cam.recorder;
        camDone.current = cam.done;
      }

      samples.current = [];
      captions.current = [];
      pausedMs.current = 0;
      startedAt.current = performance.now();
      setElapsed(0);
      setPaused(false);
      setPhase("live");

      pausedRef.current = false;
      timer.current = window.setInterval(() => {
        if (!pausedRef.current) setElapsed(nowElapsed());
      }, 200);

      cursorTimer.current = window.setInterval(() => {
        if (pausedRef.current) return;
        void (async () => {
          const c = await getCursor();
          samples.current.push({ ...c, t: nowElapsed() });
        })();
      }, 33);

      speech.current = startSpeechCapture(speechLang, nowElapsed, (cap) => {
        captions.current.push(cap);
      });
    } catch {
      setError("Screen selection was cancelled.");
    } finally {
      setBusy(false);
    }
  }

  function togglePause() {
    const recs = [screenRec.current, camRec.current].filter(Boolean) as MediaRecorder[];
    if (!recs.length) return;
    if (!paused) {
      recs.forEach((r) => r.state === "recording" && r.pause());
      pauseStarted.current = performance.now();
      pausedRef.current = true;
      setPaused(true);
    } else {
      recs.forEach((r) => r.state === "paused" && r.resume());
      pausedMs.current += performance.now() - pauseStarted.current;
      pausedRef.current = false;
      setPaused(false);
    }
  }

  async function stopRecording() {
    if (busy) return;
    setBusy(true);
    if (timer.current) window.clearInterval(timer.current);
    if (cursorTimer.current) window.clearInterval(cursorTimer.current);
    speech.current?.stop();
    speech.current = null;

    try {
      screenRec.current?.stop();
      camRec.current?.stop();
      const screenBlob = (await screenDone.current) ?? new Blob();
      const webcamBlob = camDone.current ? await camDone.current : undefined;
      stopStream(screenStream.current);
      stopStream(camStream.current);
      screenStream.current = null;
      camStream.current = null;

      setPhase("saving");

      const url = URL.createObjectURL(screenBlob);
      const video = document.createElement("video");
      video.preload = "auto";
      video.src = url;
      const measured = await ensureFiniteDuration(video).catch(() => 0);
      const duration = measured > 0.2 ? measured : nowElapsed();
      URL.revokeObjectURL(url);
      const screen = await getScreenSize();
      const zooms = autoZoom
        ? generateZoomKeyframes(samples.current, screen.width, screen.height)
        : [];

      const project = emptyProject({
        duration,
        videoWidth: video.videoWidth || screen.width,
        videoHeight: video.videoHeight || screen.height,
        screenWidth: screen.width,
        screenHeight: screen.height,
        cursor: samples.current,
        autoZoom,
        zooms,
        captions: captions.current,
        webcam: {
          enabled: Boolean(webcamBlob),
          corner: "br",
          size: 0.22,
          radius: 28,
          border: true,
          borderColor: "#fffdfb",
        },
        segments: [{ id: uid("seg"), start: 0, end: duration }],
        speechLang,
      });

      await saveProjectToDisk(project, screenBlob, webcamBlob);
      await emitToMain("recording-finished", { projectId: project.id });
      setPhase("setup");
      await hideRecorderOverlay();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Saving the recording failed.");
      setPhase("setup");
      await showMainWindow();
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    cleanup();
    setPhase("setup");
    await emitToMain("recorder-cancelled");
    await hideRecorderOverlay();
  }

  if (phase === "live") {
    return (
      <div className="flex h-screen items-center gap-3 bg-card px-3">
        <div className="drag-region flex items-center gap-2 pr-1">
          <span className={`h-2.5 w-2.5 rounded-full ${paused ? "bg-muted" : "bg-coral animate-pulse"}`} />
          <span className="w-[64px] font-mono text-sm font-semibold tabular-nums">
            {formatTime(elapsed)}
          </span>
        </div>
        <div className="no-drag flex items-center gap-1.5">
          <button className="btn btn-secondary h-8 px-3 text-xs" onClick={togglePause}>
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            className="btn btn-primary h-8 px-3 text-xs"
            onClick={() => void stopRecording()}
            disabled={busy}
          >
            Stop
          </button>
          <button className="btn btn-ghost h-8 px-3 text-xs" onClick={() => void cancel()}>
            ✕
          </button>
        </div>
      </div>
    );
  }

  if (phase === "saving") {
    return (
      <div className="grid h-screen place-items-center bg-paper text-sm text-muted">
        Saving recording…
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-paper px-5 pb-5">
      <div className="drag-region mb-3 flex items-center justify-between pt-3">
        <span className="text-sm font-semibold tracking-[-0.02em]">Record</span>
        <button className="no-drag btn btn-ghost h-8 px-2 text-xs" onClick={() => void cancel()}>
          Cancel
        </button>
      </div>
      <p className="text-sm text-muted">
        Pick a screen, toggle the camera, hit start. The overlay stays tiny.
      </p>

      <div className="mt-4 overflow-hidden rounded-[16px] border border-line bg-card shadow-sm">
        <video ref={webcamPreview} muted playsInline className="h-40 w-full bg-[#111018] object-cover" />
      </div>

      <label className="mt-4 flex items-center justify-between rounded-[14px] border border-line bg-card px-3 py-2.5 text-sm">
        <span>Camera</span>
        <input type="checkbox" checked={webcamOn} onChange={(e) => setWebcamOn(e.target.checked)} />
      </label>
      <label className="mt-2 flex items-center justify-between rounded-[14px] border border-line bg-card px-3 py-2.5 text-sm">
        <span>Auto-zoom</span>
        <input type="checkbox" checked={autoZoom} onChange={(e) => setAutoZoom(e.target.checked)} />
      </label>
      <label className="mt-2 flex items-center justify-between rounded-[14px] border border-line bg-card px-3 py-2.5 text-sm">
        <span>Caption language</span>
        <select
          className="no-drag rounded-lg border border-line bg-white px-2 py-1 text-sm"
          value={speechLang}
          onChange={(e) => setSpeechLang(e.target.value as SpeechLang)}
        >
          <option value="en-US">English</option>
          <option value="pl-PL">Polski</option>
        </select>
      </label>

      {error ? <p className="mt-3 text-xs text-coral">{error}</p> : null}

      <button className="btn btn-primary mt-auto" disabled={busy} onClick={() => void start()}>
        {busy ? "Starting…" : "Start recording"}
      </button>
    </div>
  );
}
