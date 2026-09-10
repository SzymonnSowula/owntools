import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { WinDots, ToolIcons } from "@ui/WinDots";
import {
  hideRecorderOverlay,
  recordsItself,
  setRecordsItself,
  showMainWindow,
  watchRecorderVisible,
} from "@core/recorderWindow";
import { isTauri } from "@core/env";
import {
  captureWindowRect,
  confirmCaptureMatch,
  listDisplaySources,
  matchCaptureSource,
  type CaptureMatch,
} from "@feature-editor/lib/captureSources";
import { getCursor, getScreenSize } from "@feature-editor/lib/cursor";
import {
  collectInputTrack,
  startInputTrack,
  stopInputTrack,
  type Pause,
} from "@feature-editor/lib/inputTrack";
import { invokeSafe } from "@feature-editor/lib/tauri";
import { DEFAULT_WEBCAM } from "@feature-editor/lib/defaults";
import { formatTime } from "@feature-editor/lib/time";
import { uid } from "@feature-editor/lib/id";
import {
  buildRecordingStream,
  describeCaptureError,
  getDisplayStream,
  getMicStream,
  getWebcamStream,
  measureDisplayStream,
  recordStream,
  recordStreamToFile,
  setAudioEnabled,
  stopStream,
  type FileRecordingResult,
  type RecordingSource,
} from "@feature-editor/lib/recorder";
import { generateZoomKeyframes } from "@feature-editor/lib/zoom";
import { ensureFiniteDuration } from "@feature-editor/lib/videoEl";
import {
  appDataPath,
  createProjectDir,
  discardProjectDir,
  finalizeRecordedProject,
  revealInAppData,
  revealProjectsFolder,
  saveProjectToDisk,
} from "@feature-editor/lib/projectIo";
import { emptyProject } from "@feature-editor/store/appStore";
import type {
  CaptureSurface,
  CursorSample,
  DisplaySources,
  InputTrack,
  ScreenBounds,
  SurfaceSample,
} from "@feature-editor/types";
import {
  BackIcon,
  CloseIcon,
  DotsIcon,
  FolderIcon,
  MicIcon,
  PauseIcon,
  PlayIcon,
  RestartIcon,
  StopIcon,
  TrashIcon,
} from "./icons";

type Phase = "setup" | "live" | "saving";

/**
 * Everything a stopped recording needs to become a project. Kept around after
 * a failed save so the user can retry without re-recording: the media is
 * already on disk (Tauri) or in memory (browser preview).
 */
interface Take {
  id: string;
  dir: string;
  screenPath?: string;
  webcamPath?: string;
  screenBlob?: Blob;
  webcamBlob?: Blob;
  hasWebcam: boolean;
  elapsed: number;
  screen: ScreenBounds;
  surface: CaptureSurface;
  /** Which rectangle of the desktop this take shows; null when we could not tell. */
  match: CaptureMatch | null;
  /** What was on the desktop as the take began, to check the match against the finished file. */
  sources: DisplaySources | null;
  pointer: { x: number; y: number } | null;
  /** Rect over time, when the recorded window was moved or resized. */
  surfaceTrack: SurfaceSample[];
  samples: CursorSample[];
  /** Precise clicks and keystrokes from the native sampler, when it ran. */
  inputs?: InputTrack;
  autoZoom: boolean;
}

interface Failure {
  title: string;
  message: string;
  take: Take;
}

/** A take whose file on disk is complete up to a point but missing its tail. */
class LossError extends Error {}

const MIC_UNAVAILABLE = "Microphone unavailable — recording system audio only.";

const SETUP_SIZE = { width: 460, height: 690 };
const FAILURE_SIZE = { width: 460, height: 790 };
const LIVE_SIZE = { width: 460, height: 64 };

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

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return fallback;
}

function describeLoss(label: string, result: FileRecordingResult): string {
  const mb = (result.lostBytes / 1_048_576).toFixed(1);
  const why = result.error?.message ? ` (${result.error.message})` : "";
  return `${label}: ${mb} MB never reached the disk${why}.`;
}

/**
 * Reads duration and frame size off the finished file. MediaRecorder WebMs
 * report an Infinite duration until seeked past the end — ensureFiniteDuration
 * handles that. Returns zeros when the probe fails; the caller falls back to
 * the elapsed time and the screen size.
 */
async function probeTake(take: Take): Promise<{ duration: number; width: number; height: number }> {
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  let objectUrl: string | null = null;
  try {
    if (take.screenPath) {
      video.src = convertFileSrc(await appDataPath(take.screenPath));
    } else if (take.screenBlob) {
      objectUrl = URL.createObjectURL(take.screenBlob);
      video.src = objectUrl;
    } else {
      return { duration: 0, width: 0, height: 0 };
    }
    const duration = await ensureFiniteDuration(video);
    return { duration, width: video.videoWidth, height: video.videoHeight };
  } catch {
    return { duration: 0, width: 0, height: 0 };
  } finally {
    // Let go of the file handle / object URL right away.
    video.removeAttribute("src");
    video.load();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

export function RecorderOverlay() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [webcamOn, setWebcamOn] = useState(true);
  /** Is this window actually on screen? It exists, hidden, from app start-up. */
  const [shown, setShown] = useState(!isTauri());
  const [micOn, setMicOn] = useState(true);
  const [micNote, setMicNote] = useState<string | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [autoZoom, setAutoZoom] = useState(true);
  const [inputTiming, setInputTiming] = useState(true);
  const [recordSelf, setRecordSelf] = useState(recordsItself);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [diskTrouble, setDiskTrouble] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  const screenStream = useRef<MediaStream | null>(null);
  const camStream = useRef<MediaStream | null>(null);
  const micStream = useRef<MediaStream | null>(null);
  const mixer = useRef<RecordingSource | null>(null);
  const screenRec = useRef<MediaRecorder | null>(null);
  const camRec = useRef<MediaRecorder | null>(null);
  const screenFile = useRef<Promise<FileRecordingResult> | null>(null);
  const camFile = useRef<Promise<FileRecordingResult> | null>(null);
  const screenBlob = useRef<Promise<Blob> | null>(null);
  const camBlob = useRef<Promise<Blob> | null>(null);
  const take = useRef<Take | null>(null);
  const samples = useRef<CursorSample[]>([]);
  const timer = useRef<number | null>(null);
  const cursorTimer = useRef<number | null>(null);
  const surfaceTimer = useRef<number | null>(null);
  /** Set while a cursor read is in flight, so slow IPC cannot interleave samples. */
  const sampling = useRef(false);
  const startedAt = useRef(0);
  /** performance.now() at the moment the recorders were started. */
  const startedAtRef = useRef(0);
  const surface = useRef<SurfaceSample[]>([]);
  const pausedMs = useRef(0);
  const pauseStarted = useRef(0);
  const pausedRef = useRef(false);
  /** Every pause of this take, so the input track can be rebased around them. */
  const pauses = useRef<Pause[]>([]);
  /** performance.now() the native input sampler's clock starts at; null while it is not running. */
  const inputBase = useRef<number | null>(null);
  // The track "ended" listener holds a stale closure, so the re-entry guard is a ref, not state.
  const stopping = useRef(false);
  const webcamPreview = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    void resizeSelf(phase === "live" ? LIVE_SIZE : failure ? FAILURE_SIZE : SETUP_SIZE);
  }, [phase, failure]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let dropped = false;
    void watchRecorderVisible((visible) => {
      if (!dropped) setShown(visible);
    }).then((off) => {
      if (dropped) off();
      else stop = off;
    });
    return () => {
      dropped = true;
      stop?.();
    };
  }, []);

  /**
   * The camera preview. It runs only while the window is on screen: this page
   * is alive from start-up in a hidden window, so a preview that ignored that
   * held the webcam - LED and all - for as long as owntools was open.
   */
  useEffect(() => {
    if (phase !== "setup" || !webcamOn || !shown) {
      // A live take records through this stream; only setup may end it.
      if (phase === "setup") {
        stopStream(camStream.current);
        camStream.current = null;
        if (webcamPreview.current) webcamPreview.current.srcObject = null;
      }
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
  }, [phase, webcamOn, shown]);

  /**
   * Puts the overlay away. Hiding is all that happens to this window, so the
   * page has to know at once - otherwise the return to "setup" re-opens the
   * camera preview onto a window nobody can see.
   */
  async function closeOverlay(): Promise<void> {
    setShown(false);
    await hideRecorderOverlay();
  }

  function nowElapsed() {
    return (performance.now() - startedAt.current - pausedMs.current) / 1000;
  }

  function clearTimers() {
    if (timer.current) window.clearInterval(timer.current);
    if (cursorTimer.current) window.clearInterval(cursorTimer.current);
    if (surfaceTimer.current) window.clearInterval(surfaceTimer.current);
    timer.current = null;
    cursorTimer.current = null;
    surfaceTimer.current = null;
    sampling.current = false;
  }

  /** Stops the native input sampler without keeping what it saw. */
  function discardInputTrack() {
    if (inputBase.current === null) return;
    inputBase.current = null;
    void stopInputTrack();
  }

  /** Lets go of every device. Call only after the recorders have stopped, or the last chunk is cut short. */
  async function releaseCapture() {
    void invokeSafe("capture_shield", { on: false });
    await mixer.current?.close().catch(() => undefined);
    mixer.current = null;
    stopStream(screenStream.current);
    stopStream(camStream.current);
    stopStream(micStream.current);
    screenStream.current = null;
    camStream.current = null;
    micStream.current = null;
    screenRec.current = null;
    camRec.current = null;
  }

  /** Stops the recorders and the mic mix but keeps the display and camera streams for another take. */
  async function releaseRecorders() {
    await mixer.current?.close().catch(() => undefined);
    mixer.current = null;
    micStream.current = null;
    screenRec.current = null;
    camRec.current = null;
  }

  function stopRecorders() {
    for (const rec of [screenRec.current, camRec.current]) {
      // A recorder whose track already ended is inactive; stop() would throw.
      if (rec && rec.state !== "inactive") rec.stop();
    }
  }

  function resetTakeRefs() {
    take.current = null;
    surface.current = [];
    screenFile.current = camFile.current = null;
    screenBlob.current = camBlob.current = null;
  }

  async function start() {
    setBusy(true);
    setError(null);
    setMicNote(null);
    setDiskTrouble(false);

    let display: MediaStream;
    try {
      display = await getDisplayStream();
    } catch (err) {
      setError(describeCaptureError(err));
      setBusy(false);
      return;
    }
    screenStream.current = display;
    // Keep the browser's own "sharing your screen" bar out of the take (and off the screen).
    void invokeSafe("capture_shield", { on: true });
    // "Stop sharing" in the capture bar ends the track — treat it as Stop.
    display.getVideoTracks()[0]?.addEventListener("ended", () => {
      void stopRecording();
    });
    try {
      await beginTake(display);
    } finally {
      setBusy(false);
    }
  }

  /** Everything after the picker: devices, the project folder, recorders, timers. */
  async function beginTake(display: MediaStream) {
    const id = uid("proj");
    try {
      if (webcamOn && !camStream.current) {
        try {
          camStream.current = await getWebcamStream();
        } catch {
          setWebcamOn(false);
        }
      }
      if (micOn) {
        try {
          micStream.current = await getMicStream();
          setAudioEnabled(micStream.current, !micMuted);
        } catch {
          setMicOn(false);
          setMicNote(MIC_UNAVAILABLE);
        }
      }

      const tauri = isTauri();
      let paths: Awaited<ReturnType<typeof createProjectDir>>;
      try {
        paths = await createProjectDir(id);
      } catch (err) {
        await releaseCapture();
        setError(
          `Couldn't create the recording folder: ${errorMessage(err, "unknown file system error")}`,
        );
        return;
      }

      mixer.current = buildRecordingStream(display, micStream.current);
      const hasWebcam = Boolean(camStream.current);

      // Which rectangle of the desktop this video will show. The browser only
      // says "a monitor" or "a window" and how big the frames are; the OS knows
      // where every monitor and window sits. Matching the two is what lets the
      // editor put the pointer back where it belongs.
      const info = await measureDisplayStream(display);
      const [sources, pointer] = await Promise.all([listDisplaySources(), getCursor()]);
      const match = matchCaptureSource(info, sources, pointer);

      screenFile.current = camFile.current = null;
      screenBlob.current = camBlob.current = null;
      startedAtRef.current = performance.now();
      if (tauri) {
        // Straight to disk: RAM stays flat and a crash keeps everything but the last second.
        const screen = recordStreamToFile(mixer.current.stream, paths.screenPath, {
          onWriteError: (err) => setDiskTrouble(Boolean(err)),
        });
        screenRec.current = screen.recorder;
        screenFile.current = screen.done;
        if (camStream.current) {
          const cam = recordStreamToFile(camStream.current, paths.webcamPath);
          camRec.current = cam.recorder;
          camFile.current = cam.done;
        }
      } else {
        const screen = recordStream(mixer.current.stream);
        screenRec.current = screen.recorder;
        screenBlob.current = screen.done;
        if (camStream.current) {
          const cam = recordStream(camStream.current);
          camRec.current = cam.recorder;
          camBlob.current = cam.done;
        }
      }

      // Precise click and key timing for the editor's sound effects and click
      // rings. The 33 ms cursor track below stays the source of positions.
      pauses.current = [];
      inputBase.current = tauri && inputTiming ? await startInputTrack() : null;

      const screen = await getScreenSize();
      take.current = {
        id,
        dir: paths.dir,
        screenPath: tauri ? paths.screenPath : undefined,
        webcamPath: tauri && hasWebcam ? paths.webcamPath : undefined,
        hasWebcam,
        elapsed: 0,
        screen,
        surface: info.surface,
        match,
        sources,
        pointer: pointer ? { x: pointer.x, y: pointer.y } : null,
        surfaceTrack: [],
        samples: [],
        autoZoom,
      };

      samples.current = [];
      surface.current = [];
      pausedMs.current = 0;
      // The clock the cursor is stamped against starts with the recorders, not
      // after the setup that follows them — a sample labelled t=0 has to mean
      // the video's first frame.
      startedAt.current = startedAtRef.current;
      setElapsed(0);
      setPaused(false);
      setMore(false);
      setFailure(null);
      setPhase("live");

      pausedRef.current = false;
      timer.current = window.setInterval(() => {
        if (!pausedRef.current) setElapsed(nowElapsed());
      }, 200);

      cursorTimer.current = window.setInterval(() => {
        if (pausedRef.current || sampling.current) return;
        // Stamp before the round trip: a sample timed after it would drift, and
        // two overlapping reads could land out of order — which every lookup,
        // being a binary search on time, would then read wrong.
        const t = nowElapsed();
        sampling.current = true;
        void getCursor()
          .then((c) => {
            // A read can fail on a secure desktop (a UAC prompt); skipping the
            // sample leaves a gap, which every consumer interpolates over.
            if (c) samples.current.push({ ...c, t });
          })
          .catch(() => undefined)
          .finally(() => {
            sampling.current = false;
          });
      }, 33);

      // A recorded window can be dragged or resized mid-take; the capture
      // follows it, so the mapping has to as well.
      if (match?.windowId) {
        const windowId = match.windowId;
        surfaceTimer.current = window.setInterval(() => {
          if (pausedRef.current) return;
          const t = nowElapsed();
          void captureWindowRect(windowId).then((rect) => {
            if (!rect) return;
            const last = surface.current[surface.current.length - 1] ?? match.rect;
            const moved =
              Math.abs(last.x - rect.x) > 1 ||
              Math.abs(last.y - rect.y) > 1 ||
              Math.abs(last.width - rect.width) > 1 ||
              Math.abs(last.height - rect.height) > 1;
            if (moved) surface.current.push({ t, ...rect });
          });
        }, 400);
      }
    } catch (err) {
      clearTimers();
      discardInputTrack();
      await releaseCapture();
      await discardProjectDir(id).catch(() => undefined);
      take.current = null;
      setError(
        err instanceof Error && err.message
          ? `Recording could not start: ${err.message}`
          : "Recording could not start.",
      );
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
      const now = performance.now();
      pausedMs.current += now - pauseStarted.current;
      pauses.current.push({ from: pauseStarted.current, to: now });
      pausedRef.current = false;
      setPaused(false);
    }
  }

  function toggleMute() {
    const next = !micMuted;
    setMicMuted(next);
    setAudioEnabled(micStream.current, !next);
  }

  /** Builds the project from a take and hands it to the main window. Safe to call again after a failure. */
  async function finalizeTake(t: Take): Promise<void> {
    setPhase("saving");
    const probe = await probeTake(t);
    const duration = probe.duration > 0.2 ? probe.duration : t.elapsed;
    // The rectangle was matched to the frames' size as the take began; the
    // file's own size has the last word (see `confirmCaptureMatch`).
    const match = confirmCaptureMatch(t.match, t.surface, probe, t.sources, t.pointer);
    // The window followed during the take is the one matched then; with a
    // different match, that track means nothing.
    const surfaceTrack = match === t.match ? t.surfaceTrack : [];
    const captureRect = match?.rect ?? null;
    // Auto-zoom anchors are cursor positions too, so they need the same rectangle.
    const zoomArea = captureRect ?? { x: 0, y: 0, width: t.screen.width, height: t.screen.height };
    const zooms = t.autoZoom && captureRect ? generateZoomKeyframes(t.samples, zoomArea) : [];

    const project = emptyProject({
      id: t.id,
      duration,
      videoWidth: probe.width || t.screen.width,
      videoHeight: probe.height || t.screen.height,
      screenWidth: t.screen.width,
      screenHeight: t.screen.height,
      captureSurface: t.surface,
      captureRect: captureRect ?? undefined,
      captureSource: match?.source,
      captureLabel: match?.label,
      surfaceTrack: surfaceTrack.length ? surfaceTrack : undefined,
      cursor: t.samples,
      inputs: t.inputs,
      autoZoom: t.autoZoom,
      zooms,
      // Captions come from the editor's on-device whisper pass, not from the recorder.
      captions: [],
      webcam: { ...DEFAULT_WEBCAM, enabled: t.hasWebcam },
      segments: [{ id: uid("seg"), start: 0, end: duration }],
      speechLang: "en-US",
    });

    if (t.screenPath) {
      await finalizeRecordedProject(project, { screenPath: t.screenPath, webcamPath: t.webcamPath });
    } else {
      // Browser preview: nothing is persisted, the take lives and dies with the tab.
      await saveProjectToDisk(project, t.screenBlob, t.webcamBlob);
    }

    await emitToMain("recording-finished", { projectId: project.id });
    take.current = null;
    setFailure(null);
    setPhase("setup");
    await closeOverlay();
  }

  /** Stops the recorders and settles the last chunk. Returns the take with its timing filled in. */
  async function settleTake(): Promise<{ take: Take; lost: string[] }> {
    clearTimers();
    // A take stopped while paused must not count the open pause as recorded time.
    if (pausedRef.current) {
      const now = performance.now();
      pausedMs.current += now - pauseStarted.current;
      pauses.current.push({ from: pauseStarted.current, to: now });
      pausedRef.current = false;
    }
    const t = take.current!;
    t.elapsed = nowElapsed();
    // Ordered by time: promises settle in whatever order the IPC returns.
    t.samples = samples.current.slice().sort((a, b) => a.t - b.t);
    t.surfaceTrack = surface.current.slice().sort((a, b) => a.t - b.t);
    // The input sampler stops with the recorders; its events are rebased once the files have settled.
    const inputBaseAt = inputBase.current;
    const rawInputs = inputBaseAt !== null ? stopInputTrack() : null;
    inputBase.current = null;
    stopRecorders();

    // Wait for the final chunk before touching any device: closing the
    // AudioContext or stopping tracks first would cut the tail off.
    const lost: string[] = [];
    if (screenFile.current) {
      const screen = await screenFile.current;
      const cam = camFile.current ? await camFile.current : null;
      if (screen.lostBytes > 0) lost.push(describeLoss("Screen recording", screen));
      if (cam && cam.lostBytes > 0) lost.push(describeLoss("Camera recording", cam));
    } else {
      t.screenBlob = (await screenBlob.current) ?? new Blob();
      t.webcamBlob = camBlob.current ? await camBlob.current : undefined;
    }
    if (rawInputs && inputBaseAt !== null) {
      const raw = await rawInputs;
      if (raw) t.inputs = collectInputTrack(raw, inputBaseAt, startedAt.current, pauses.current);
    }
    return { take: t, lost };
  }

  async function stopRecording() {
    if (stopping.current || !take.current) return;
    stopping.current = true;
    setBusy(true);
    let t: Take | null = null;

    try {
      setPhase("saving");
      const settled = await settleTake();
      t = settled.take;
      await releaseCapture();

      if (settled.lost.length) {
        // The file on disk is a clean prefix of the take; say so and let the user decide.
        throw new LossError(settled.lost.join(" "));
      }
      await finalizeTake(t);
    } catch (err) {
      await releaseCapture();
      if (isTauri() && t?.screenPath) {
        // The media is on disk either way — never throw it away on the user's behalf.
        setFailure(
          err instanceof LossError
            ? {
                title: "Part of the recording never reached the disk.",
                message: `${err.message} What was written plays fine up to that point.`,
                take: t,
              }
            : {
                title: "The video is on disk, but the project couldn't be saved.",
                message: errorMessage(err, "Saving the recording failed."),
                take: t,
              },
        );
      } else {
        setError(errorMessage(err, "Saving the recording failed."));
        await showMainWindow();
      }
      setPhase("setup");
    } finally {
      setBusy(false);
      stopping.current = false;
    }
  }

  /** Throws the take away and starts a fresh one on the same screen, camera and mic — no picker. */
  async function restart() {
    if (stopping.current || !take.current) return;
    stopping.current = true;
    setBusy(true);
    const id = take.current.id;
    const display = screenStream.current;
    try {
      await settleTake().catch(() => undefined);
      await releaseRecorders();
      await discardProjectDir(id).catch(() => undefined);
      resetTakeRefs();
      setDiskTrouble(false);
      if (!display || display.getVideoTracks()[0]?.readyState !== "live") {
        // The share was ended in the meantime; fall back to the setup screen.
        await releaseCapture();
        setPhase("setup");
        return;
      }
      await beginTake(display);
    } finally {
      setBusy(false);
      stopping.current = false;
    }
  }

  /** Discards the take and returns to the setup screen; the overlay stays open. */
  async function deleteTake() {
    if (stopping.current || !take.current) return;
    stopping.current = true;
    setBusy(true);
    const id = take.current.id;
    try {
      await settleTake().catch(() => undefined);
      await releaseCapture();
      await discardProjectDir(id).catch(() => undefined);
      resetTakeRefs();
      setDiskTrouble(false);
      setError(null);
      setPhase("setup");
    } finally {
      setBusy(false);
      stopping.current = false;
    }
  }

  async function retryFinalize() {
    const current = failure;
    if (!current) return;
    setBusy(true);
    try {
      await finalizeTake(current.take);
    } catch (err) {
      setFailure({ ...current, message: errorMessage(err, "Saving the recording failed.") });
      setPhase("setup");
    } finally {
      setBusy(false);
    }
  }

  async function showRecordingFolder() {
    const path = failure?.take.screenPath;
    if (!path) return;
    try {
      await revealInAppData(path);
    } catch (err) {
      setError(errorMessage(err, "Couldn't open the recording folder."));
    }
  }

  async function openRecordingsFolder() {
    try {
      await revealProjectsFolder(take.current?.id);
    } catch {
      /* the explorer is a convenience; the recording is unaffected */
    }
  }

  async function cancel() {
    const wasLive = phase === "live";
    const id = take.current?.id;
    clearTimers();
    discardInputTrack();
    try {
      stopRecorders();
      if (wasLive && screenFile.current) {
        // Let the final chunk land before deleting, or the write re-creates the folder.
        await Promise.all([screenFile.current, camFile.current].filter(Boolean));
      }
    } catch {
      /* nothing to keep on cancel */
    }
    await releaseCapture();
    // Cancelling a live take discards it; a failed save keeps its files (the user has the folder).
    if (wasLive && id && !failure) await discardProjectDir(id).catch(() => undefined);
    resetTakeRefs();
    setFailure(null);
    setError(null);
    setDiskTrouble(false);
    setPhase("setup");
    await emitToMain("recorder-cancelled");
    await closeOverlay();
  }

  if (phase === "live") {
    return (
      <div className="flex h-screen items-center gap-1 bg-[#1d1d1f] px-3 text-white">
        <div className="drag-region flex items-center gap-2 pr-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${paused ? "bg-white/35" : "bg-coral animate-pulse"}`}
          />
          <span
            className={`w-[54px] font-mono text-sm font-semibold tabular-nums ${
              paused ? "text-white/55" : "text-coral"
            }`}
          >
            {formatTime(elapsed)}
          </span>
          {micMuted ? (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-white/50">muted</span>
          ) : null}
          {diskTrouble ? (
            <span
              className="text-[10px] font-semibold uppercase tracking-wide text-coral"
              title="A chunk couldn't be written to disk — retrying"
            >
              disk error
            </span>
          ) : null}
        </div>
        <div className="no-drag ml-auto flex items-center gap-0.5">
          {more ? (
            <>
              <IconButton title={micMuted ? "Unmute microphone" : "Mute microphone"} active={micMuted} onClick={toggleMute} disabled={!micStream.current}>
                <MicIcon muted={micMuted} />
              </IconButton>
              <IconButton title="Open recordings folder" onClick={() => void openRecordingsFolder()}>
                <FolderIcon />
              </IconButton>
              <IconButton title="Close the recorder (discards this take)" onClick={() => void cancel()}>
                <CloseIcon />
              </IconButton>
              <IconButton title="Back" onClick={() => setMore(false)}>
                <BackIcon />
              </IconButton>
            </>
          ) : (
            <>
              <IconButton title={paused ? "Resume" : "Pause"} onClick={togglePause} active={paused}>
                {paused ? <PlayIcon /> : <PauseIcon />}
              </IconButton>
              <IconButton title="Restart this take" onClick={() => void restart()} disabled={busy}>
                <RestartIcon />
              </IconButton>
              <IconButton title="Delete this take" onClick={() => void deleteTake()} disabled={busy}>
                <TrashIcon />
              </IconButton>
              <IconButton title="More" onClick={() => setMore(true)}>
                <DotsIcon />
              </IconButton>
              <button
                className="ml-1 inline-flex h-8 items-center gap-1.5 rounded-full bg-coral px-3 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50"
                onClick={() => void stopRecording()}
                disabled={busy}
                title="Stop and open the editor"
              >
                <StopIcon />
                Stop
              </button>
            </>
          )}
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
    <div className="scroll-thin flex min-h-screen flex-col bg-paper px-5 pb-5">
      <div className="drag-region mb-3 flex items-center justify-between pt-3">
        <span className="flex items-center gap-1.5">
          <WinDots icon={ToolIcons.record} />
          <span className="ml-2 text-sm font-semibold tracking-[-0.02em]">record</span>
        </span>
        <button className="no-drag btn btn-ghost h-8 px-2 text-xs" onClick={() => void cancel()}>
          Cancel
        </button>
      </div>
      <p className="text-sm text-muted">
        Pick a screen, toggle the camera and mic, hit start. The overlay stays tiny — pause,
        restart or delete the take from there.
      </p>

      <div className="mt-4 overflow-hidden rounded-[16px] border border-line bg-card shadow-sm">
        <video ref={webcamPreview} muted playsInline className="h-40 w-full bg-[#111018] object-cover" />
      </div>

      <label className="mt-4 flex items-center justify-between rounded-[14px] border border-line bg-card px-3 py-2.5 text-sm">
        <span>Camera</span>
        <input type="checkbox" checked={webcamOn} onChange={(e) => setWebcamOn(e.target.checked)} />
      </label>
      <label className="mt-2 flex items-center justify-between rounded-[14px] border border-line bg-card px-3 py-2.5 text-sm">
        <span>Microphone</span>
        <input
          type="checkbox"
          checked={micOn}
          onChange={(e) => {
            setMicOn(e.target.checked);
            setMicNote(null);
          }}
        />
      </label>
      {micNote ? <p className="mt-1.5 px-1 text-xs text-muted">{micNote}</p> : null}
      <label className="mt-2 flex items-center justify-between rounded-[14px] border border-line bg-card px-3 py-2.5 text-sm">
        <span>Auto-zoom</span>
        <input type="checkbox" checked={autoZoom} onChange={(e) => setAutoZoom(e.target.checked)} />
      </label>
      <label className="mt-2 flex items-center justify-between rounded-[14px] border border-line bg-card px-3 py-2.5 text-sm">
        <span>Click &amp; key timing</span>
        <input type="checkbox" checked={inputTiming} onChange={(e) => setInputTiming(e.target.checked)} />
      </label>
      <label className="mt-2 flex items-center justify-between rounded-[14px] border border-line bg-card px-3 py-2.5 text-sm">
        <span>Record owntools itself</span>
        <input
          type="checkbox"
          checked={recordSelf}
          onChange={(e) => {
            setRecordSelf(e.target.checked);
            void setRecordsItself(e.target.checked);
          }}
        />
      </label>
      <p className="mt-2 px-1 text-[11px] text-muted">
        Pick a screen or a window and the editor can draw the pointer, click rings and zooms on it; a
        browser tab has no fixed place on the desktop, so cursor effects stay off for one. Click &amp;
        key timing keeps when you clicked and typed — the sort of key, never which one — for the
        sound effects in the editor. Recording owntools itself keeps the main window on screen so it
        is there to pick — this bar stays out of the video either way.
      </p>

      {failure ? (
        <div className="mt-3 rounded-[14px] border border-coral/40 bg-coral/10 px-3 py-3 text-xs">
          <p className="font-semibold text-ink">{failure.title}</p>
          <p className="mt-1 leading-relaxed text-muted">{failure.message}</p>
          <div className="mt-3 flex gap-2">
            <button
              className="btn btn-secondary !h-8 !px-3 !py-0 text-xs"
              onClick={() => void showRecordingFolder()}
            >
              Show recording folder
            </button>
            <button
              className="btn btn-primary !h-8 !px-3 !py-0 text-xs"
              disabled={busy}
              onClick={() => void retryFinalize()}
            >
              Try again
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-xs text-coral">{error}</p> : null}

      <button
        className="btn btn-primary mt-auto"
        disabled={busy || Boolean(failure)}
        onClick={() => void start()}
      >
        {busy ? "Starting…" : "Start recording"}
      </button>
    </div>
  );
}

function IconButton({
  title,
  onClick,
  disabled,
  active,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`grid h-8 w-8 place-items-center rounded-full transition disabled:opacity-40 ${
        active ? "bg-white/20 text-white" : "text-white/85 hover:bg-white/10 hover:text-white"
      }`}
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
