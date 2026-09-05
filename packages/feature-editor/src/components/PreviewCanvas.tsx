import { useEffect, useRef } from "react";
import { WinDots, ToolIcons } from "@ui/WinDots";
import type { Project } from "../types";
import { canvasSize, drawFrame } from "../lib/compositor";
import { isPro } from "@licensing/license";
import { timelineDuration, timelineToSource } from "../lib/segments";
import { TransitionTracker } from "../lib/transitions";
import { useAppStore } from "../store/appStore";

/**
 * The preview renders at display resolution (not full export resolution) and
 * skips frames entirely while nothing changes — both are large CPU savings.
 * Time is read straight from the store inside the rAF loop, so playback does
 * not re-render the React tree.
 */
export function PreviewCanvas({
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const projectRef = useRef(project);
  const screenRef = useRef(screen);
  const webcamRef = useRef(webcam);
  const bgRef = useRef(background);
  const overlaysRef = useRef(overlayImages);
  projectRef.current = project;
  screenRef.current = screen;
  webcamRef.current = webcam;
  bgRef.current = background;
  overlaysRef.current = overlayImages;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    let displayW = 0;
    let displayH = 0;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) {
        displayW = box.width;
        displayH = box.height;
      }
    });
    observer.observe(wrap);

    let raf = 0;
    const transitions = new TransitionTracker();
    let last: {
      time: number;
      project: Project | null;
      width: number;
      screenReady: number | undefined;
      bg: CanvasImageSource | null;
      overlays: Record<string, HTMLImageElement> | undefined;
    } = { time: -1, project: null, width: 0, screenReady: undefined, bg: null, overlays: undefined };
    let lastChangeAt = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const state = useAppStore.getState();
      // Do not fight the export renderer for CPU or the backdrop cache.
      if (state.exportProgress !== null) return;

      const p = projectRef.current;
      const full = canvasSize(p.aspect);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const scale = Math.min(
        1,
        displayW > 0 ? (displayW * dpr) / full.width : 1,
        displayH > 0 ? (displayH * dpr) / full.height : 1,
      );
      const width = Math.max(320, Math.round(full.width * scale));
      const height = Math.max(180, Math.round(full.height * scale));

      // `updateProject` always creates a fresh object, so reference equality
      // is a complete change signal for any edit.
      const changed =
        state.timelineTime !== last.time ||
        p !== last.project ||
        width !== last.width ||
        screenRef.current?.readyState !== last.screenReady ||
        bgRef.current !== last.bg ||
        overlaysRef.current !== last.overlays;
      if (changed) {
        lastChangeAt = now;
        last = {
          time: state.timelineTime,
          project: p,
          width,
          screenReady: screenRef.current?.readyState,
          bg: bgRef.current,
          overlays: overlaysRef.current,
        };
      }
      // Keep drawing briefly after a change: video frames arrive async after seeks.
      if (!state.playing && !changed && now - lastChangeAt > 700) return;

      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const timelineTime = state.timelineTime;
      drawFrame({
        ctx,
        width,
        height,
        sourceTime: timelineToSource(timelineTime, p.segments),
        timelineTime,
        timelineDuration: timelineDuration(p.segments),
        project: p,
        screenVideo: screenRef.current,
        webcamVideo: webcamRef.current,
        backgroundImage: bgRef.current,
        overlayImages: overlaysRef.current,
        transition: transitions.begin(p.segments, timelineTime),
        onFrameReady: (frame) => transitions.end(frame, p.segments, timelineTime),
        watermark: !isPro(),
      });
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  const { width, height } = canvasSize(project.aspect);

  return (
    <div className="desktop-bg flex min-h-0 flex-1 items-center justify-center p-5">
      <div className="wincard flex flex-1 flex-col" style={{ minWidth: 0, minHeight: 0, alignSelf: "stretch" }}>
        <div className="wincard-bar">
          <WinDots icon={ToolIcons.video} />
          <span className="wincard-title truncate">
            {project.name.toLowerCase().replace(/\s+/g, "-")}.mp4
          </span>
        </div>
        <div ref={wrapRef} className="flex min-h-0 flex-1 items-center justify-center bg-[#111015] p-3">
          <canvas
            ref={canvasRef}
            className="max-h-full max-w-full rounded-[8px] bg-[#111018]"
            style={{ aspectRatio: `${width} / ${height}` }}
          />
        </div>
      </div>
    </div>
  );
}
