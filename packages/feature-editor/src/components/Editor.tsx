import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { PreviewCanvas } from "./PreviewCanvas";
import { Timeline } from "./Timeline";
import { Inspector } from "./Inspector";
import { ExportModal } from "./ExportModal";
import { formatTime } from "../lib/time";
import { ensureFiniteDuration } from "../lib/videoEl";
import { sourceToTimeline, timelineDuration, timelineToSource, segmentAtTimeline } from "../lib/segments";
import { useAppStore } from "../store/appStore";

export function Editor() {
  const project = useAppStore((s) => s.project);
  const media = useAppStore((s) => s.media);
  const playing = useAppStore((s) => s.playing);
  const setPlaying = useAppStore((s) => s.setPlaying);
  const setView = useAppStore((s) => s.setView);
  const splitAtPlayhead = useAppStore((s) => s.splitAtPlayhead);
  const deleteSelection = useAppStore((s) => s.deleteSelection);
  const addZoom = useAppStore((s) => s.addZoom);
  const addCaption = useAppStore((s) => s.addCaption);
  const addText = useAppStore((s) => s.addText);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const historyIndex = useAppStore((s) => s.historyIndex);
  const history = useAppStore((s) => s.history);
  const updateProject = useAppStore((s) => s.updateProject);

  const screenRef = useRef<HTMLVideoElement>(null);
  const webcamRef = useRef<HTMLVideoElement>(null);
  const [screenEl, setScreenEl] = useState<HTMLVideoElement | null>(null);
  const [webcamEl, setWebcamEl] = useState<HTMLVideoElement | null>(null);
  const [bgEl, setBgEl] = useState<HTMLImageElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setScreenEl(screenRef.current);
    setWebcamEl(webcamRef.current);
    const screen = screenRef.current;
    if (!screen) return;
    void ensureFiniteDuration(screen).catch(() => undefined);
    if (webcamRef.current?.src) void ensureFiniteDuration(webcamRef.current).catch(() => undefined);
  }, [media?.screenUrl, media?.webcamUrl]);

  useEffect(() => {
    if (!media?.backgroundUrl) {
      setBgEl(null);
      return;
    }
    const img = new Image();
    img.src = media.backgroundUrl;
    img.onload = () => setBgEl(img);
  }, [media?.backgroundUrl]);

  // Scrub/seek only while paused — seeking a <video> mid-playback causes
  // visible hitches, and during playback the video itself is the time source.
  useEffect(() => {
    const unsub = useAppStore.subscribe((s, prev) => {
      if (s.playing) return;
      if (s.timelineTime === prev.timelineTime && s.project === prev.project) return;
      const screen = screenRef.current;
      if (!screen || !s.project) return;
      const source = timelineToSource(s.timelineTime, s.project.segments);
      if (Math.abs(screen.currentTime - source) > 0.04) screen.currentTime = source;
      if (webcamRef.current?.src) {
        webcamRef.current.currentTime = Math.max(0, source - s.project.webcamOffset);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    const screen = screenRef.current;
    if (!screen || !project) return;
    if (playing) {
      const source = timelineToSource(useAppStore.getState().timelineTime, project.segments);
      if (Math.abs(screen.currentTime - source) > 0.1) screen.currentTime = source;
      if (webcamRef.current?.src) {
        webcamRef.current.currentTime = Math.max(0, source - project.webcamOffset);
      }
      void screen.play().catch(() => undefined);
      void webcamRef.current?.play().catch(() => undefined);
    } else {
      screen.pause();
      webcamRef.current?.pause();
    }
  }, [playing, project]);

  useEffect(() => {
    if (!playing || !project) return;
    let raf = 0;
    const tick = () => {
      const screen = screenRef.current;
      if (!screen) return;
      const source = screen.currentTime;
      const seg = segmentAtTimeline(
        useAppStore.getState().timelineTime,
        project.segments,
      );
      if (seg && source >= seg.end - 0.03) {
        const idx = project.segments.findIndex((s) => s.id === seg.id);
        const next = project.segments[idx + 1];
        if (next) {
          screen.currentTime = next.start;
          if (webcamRef.current) webcamRef.current.currentTime = Math.max(0, next.start - project.webcamOffset);
        } else {
          useAppStore.setState({ playing: false, timelineTime: timelineDuration(project.segments) });
          return;
        }
      }
      useAppStore.setState({ timelineTime: sourceToTimeline(screen.currentTime, project.segments) });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, project]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying(!useAppStore.getState().playing);
      } else if (e.key.toLowerCase() === "s" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        splitAtPlayhead();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        deleteSelection();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPlaying, splitAtPlayhead, deleteSelection, undo, redo]);

  if (!project || !media) {
    return (
      <div className="grid flex-1 place-items-center text-sm text-muted">
        Brak otwartego projektu.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper">
      <div className="flex items-center gap-2 border-b border-line/80 px-4 py-2">
        <button className="btn btn-ghost h-8 px-2 text-xs" onClick={() => void setView("home")}>
          Home
        </button>
        <input
          className="field h-8 max-w-xs"
          value={project.name}
          onChange={(e) => updateProject({ name: e.target.value })}
        />
        <div className="ml-2 flex flex-wrap gap-1.5">
          <Tool onClick={() => setPlaying(!playing)}>{playing ? "Pauza" : "Odtwórz"}</Tool>
          <Tool onClick={splitAtPlayhead}>Split</Tool>
          <Tool onClick={() => addZoom("in")}>Zoom in</Tool>
          <Tool onClick={() => addZoom("out")}>Zoom out</Tool>
          <Tool onClick={addCaption}>Napis</Tool>
          <Tool onClick={addText}>Tekst</Tool>
          <Tool onClick={deleteSelection}>Usuń</Tool>
          <Tool disabled={historyIndex <= 0} onClick={undo}>
            Cofnij
          </Tool>
          <Tool disabled={historyIndex >= history.length - 1} onClick={redo}>
            Ponów
          </Tool>
          <Tool onClick={() => fileRef.current?.click()}>Import</Tool>
        </div>
        <TimeReadout />
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const url = URL.createObjectURL(file);
            useAppStore.setState((s) => ({
              media: s.media ? { ...s.media, screenUrl: url } : { screenUrl: url },
            }));
            e.currentTarget.value = "";
          }}
        />
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 min-h-0 flex-1 flex-col">
          <PreviewCanvas
            project={project}
            screen={screenEl}
            webcam={webcamEl}
            background={bgEl}
          />
          <TransportBar />
          <Timeline project={project} />
        </div>
        <Inspector />
      </div>

      <video
        ref={screenRef}
        src={media.screenUrl}
        className="pointer-events-none fixed left-0 top-0 -z-10 h-[180px] w-[320px] opacity-0"
        playsInline
        preload="auto"
        muted
      />
      {media.webcamUrl ? (
        <video
          ref={webcamRef}
          src={media.webcamUrl}
          className="pointer-events-none fixed left-0 top-0 -z-10 h-[120px] w-[120px] opacity-0"
          playsInline
          preload="auto"
          muted
        />
      ) : (
        <video ref={webcamRef} className="pointer-events-none fixed left-0 top-0 -z-10 h-px w-px opacity-0" muted playsInline />
      )}
      <ExportModal project={project} screen={screenEl} webcam={webcamEl} background={bgEl} />
    </div>
  );
}

/** Isolated so 60 fps time updates re-render only this tiny node. */
function TimeReadout() {
  const time = useAppStore((s) => s.timelineTime);
  const project = useAppStore((s) => s.project);
  const duration = project ? timelineDuration(project.segments) : 0;
  return (
    <span className="ml-auto font-mono text-xs tabular-nums text-muted">
      {formatTime(time, true)} / {formatTime(duration)}
    </span>
  );
}

function TransportBar() {
  const time = useAppStore((s) => s.timelineTime);
  const playing = useAppStore((s) => s.playing);
  const setPlaying = useAppStore((s) => s.setPlaying);
  const setTime = useAppStore((s) => s.setTimelineTime);
  const project = useAppStore((s) => s.project);
  const duration = project ? timelineDuration(project.segments) : 0;
  return (
    <div className="flex items-center gap-3 px-5 pb-2">
      <button className="btn btn-secondary h-8 w-8 p-0" onClick={() => setPlaying(!playing)}>
        {playing ? "❚❚" : "▶"}
      </button>
      <input
        className="slider"
        type="range"
        min={0}
        max={duration || 1}
        step={0.01}
        value={Math.min(time, duration)}
        onChange={(e) => {
          setPlaying(false);
          setTime(Number(e.target.value));
        }}
      />
    </div>
  );
}

function Tool({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button className="btn btn-secondary h-8 px-2.5 text-xs" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
