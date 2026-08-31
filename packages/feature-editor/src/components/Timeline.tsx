import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Project, Selection } from "../types";
import { formatTime } from "../lib/time";
import { sourceToTimeline, timelineDuration } from "../lib/segments";
import { useAppStore } from "../store/appStore";

const TRACKS = [
  { key: "video", label: "Video", color: "#0a84ff" },
  { key: "zoom", label: "Zoom", color: "#5e5ce6" },
  { key: "captions", label: "Captions", color: "#32ade6" },
  { key: "text", label: "Text", color: "#3a3a3c" },
] as const;

export function Timeline({ project }: { project: Project }) {
  const setTime = useAppStore((s) => s.setTimelineTime);
  const setPlaying = useAppStore((s) => s.setPlaying);
  const selection = useAppStore((s) => s.selection);
  const setSelection = useAppStore((s) => s.setSelection);
  const updateProject = useAppStore((s) => s.updateProject);
  const [pps, setPps] = useState(92);
  const scroller = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<number | null>(null);
  const duration = Math.max(0.1, timelineDuration(project.segments));
  const width = Math.max(640, duration * pps + 80);

  // Apply the scroll offset that keeps the time under the mouse stationary,
  // in the same commit that lays out the new pps.
  useLayoutEffect(() => {
    if (pendingScroll.current != null && scroller.current) {
      scroller.current.scrollLeft = pendingScroll.current;
      pendingScroll.current = null;
    }
  }, [pps]);

  // Wheel: Ctrl+wheel = zoom to cursor, plain wheel = horizontal pan.
  // Attached manually because React's onWheel is passive (can't preventDefault).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const next = Math.min(400, Math.max(20, pps * factor));
        if (next === pps) return;
        const rect = inner.current?.getBoundingClientRect();
        const t = rect ? Math.max(0, (e.clientX - rect.left) / pps) : 0;
        // Point at time t sits at (padding + t*pps) - scrollLeft in the viewport;
        // padding is constant, so shifting scrollLeft by t*(next-pps) keeps it put.
        pendingScroll.current = Math.max(0, el.scrollLeft + t * (next - pps));
        setPps(next);
      } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [pps]);

  const ticks = useMemo(() => {
    const step = pps > 120 ? 0.5 : pps > 70 ? 1 : 2;
    const out: number[] = [];
    for (let t = 0; t <= duration + 0.01; t += step) out.push(t);
    return out;
  }, [duration, pps]);

  function scrubTo(clientX: number) {
    const rect = inner.current?.getBoundingClientRect();
    if (!rect) return;
    const t = Math.min(duration, Math.max(0, (clientX - rect.left) / pps));
    setPlaying(false);
    setTime(t);
  }

  /** Scrub immediately, then keep scrubbing while the pointer is down. */
  function beginScrub(e: React.PointerEvent) {
    e.preventDefault();
    scrubTo(e.clientX);
    const move = (ev: PointerEvent) => scrubTo(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** Drag empty timeline space to pan; a still click clears the selection. */
  function beginPan(e: React.PointerEvent) {
    const el = scroller.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Don't hijack the native horizontal scrollbar.
    if (e.clientY - rect.top > el.clientHeight) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startScroll = el.scrollLeft;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (Math.abs(dx) >= 4) {
        moved = true;
        el.style.cursor = "grabbing";
      }
      el.scrollLeft = startScroll - dx;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      el.style.cursor = "";
      if (!moved) setSelection(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function startDrag(
    e: React.PointerEvent,
    onMove: (dt: number) => void,
    onUp?: () => void,
  ) {
    e.preventDefault();
    e.stopPropagation();
    const origin = e.clientX;
    const move = (ev: PointerEvent) => onMove((ev.clientX - origin) / pps);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onUp?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div className="border-t border-line bg-card">
      <div className="flex items-center justify-between px-4 py-2 text-xs text-muted">
        <span>Timeline · Space play · S split · Del delete · Ctrl+Z undo</span>
        <label className="flex items-center gap-2">
          Zoom
          <input
            className="slider w-28"
            type="range"
            min={48}
            max={180}
            value={Math.round(Math.min(180, Math.max(48, pps)))}
            onChange={(e) => setPps(Number(e.target.value))}
          />
        </label>
      </div>
      <div
        ref={scroller}
        className="scroll-thin relative overflow-x-auto px-4 pb-3"
        onPointerDown={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest("[data-clip]")) return;
          if (target.closest('[data-track="ruler"]')) {
            beginScrub(e);
          } else {
            beginPan(e);
          }
        }}
      >
        <div ref={inner} className="relative" style={{ width }}>
          <div data-track="ruler" className="relative h-7 cursor-ew-resize">
            {ticks.map((t) => (
              <div
                key={t}
                className="absolute top-0 h-full border-l border-line/80 pl-1 text-[10px] text-muted"
                style={{ left: t * pps }}
              >
                {formatTime(t)}
              </div>
            ))}
          </div>

          {TRACKS.map((track) => (
            <div key={track.key} className="mb-1.5 flex items-stretch gap-2">
              <div className="sticky left-0 z-10 w-16 shrink-0 pt-2 text-[11px] font-medium text-muted">
                {track.label}
              </div>
              <div className="relative h-9 flex-1 rounded-[10px] bg-paper">
                {track.key === "video" &&
                  project.segments.map((seg) => {
                    const left = sourceToTimeline(seg.start, project.segments) * pps;
                    const w = Math.max(8, (seg.end - seg.start) * pps);
                    const selected = selection?.type === "segment" && selection.id === seg.id;
                    return (
                      <Clip
                        key={seg.id}
                        left={left}
                        width={w}
                        color="#0a84ff"
                        selected={selected}
                        label={formatTime(seg.end - seg.start)}
                        onSelect={() => setSelection({ type: "segment", id: seg.id })}
                        onDrag={(dt) => {
                          /* video segments stay in source order; edge trim only */
                          void dt;
                        }}
                        onTrimStart={(dt) => {
                          const next = Math.min(seg.end - 0.1, Math.max(0, seg.start + dt));
                          updateProject({
                            segments: project.segments.map((s) =>
                              s.id === seg.id ? { ...s, start: next } : s,
                            ),
                          });
                        }}
                        onTrimEnd={(dt) => {
                          const next = Math.max(seg.start + 0.1, Math.min(project.duration, seg.end + dt));
                          updateProject({
                            segments: project.segments.map((s) =>
                              s.id === seg.id ? { ...s, end: next } : s,
                            ),
                          });
                        }}
                        startDrag={startDrag}
                      />
                    );
                  })}
                {track.key === "zoom" &&
                  project.zooms.map((z) => (
                    <Clip
                      key={z.id}
                      left={sourceToTimeline(z.start, project.segments) * pps}
                      width={Math.max(8, (z.end - z.start) * pps)}
                      color="#5e5ce6"
                      selected={selection?.type === "zoom" && selection.id === z.id}
                      label={`${z.scale.toFixed(1)}×`}
                      onSelect={() => setSelection({ type: "zoom", id: z.id })}
                      onDrag={(dt) => moveClip("zoom", z.id, dt, project, updateProject)}
                      onTrimStart={(dt) => trimClip("zoom", z.id, "start", dt, project, updateProject)}
                      onTrimEnd={(dt) => trimClip("zoom", z.id, "end", dt, project, updateProject)}
                      startDrag={startDrag}
                    />
                  ))}
                {track.key === "captions" &&
                  project.captions.map((c) => (
                    <Clip
                      key={c.id}
                      left={sourceToTimeline(c.start, project.segments) * pps}
                      width={Math.max(8, (c.end - c.start) * pps)}
                      color="#32ade6"
                      selected={selection?.type === "caption" && selection.id === c.id}
                      label={c.text}
                      onSelect={() => setSelection({ type: "caption", id: c.id })}
                      onDrag={(dt) => moveClip("caption", c.id, dt, project, updateProject)}
                      onTrimStart={(dt) => trimClip("caption", c.id, "start", dt, project, updateProject)}
                      onTrimEnd={(dt) => trimClip("caption", c.id, "end", dt, project, updateProject)}
                      startDrag={startDrag}
                    />
                  ))}
                {track.key === "text" &&
                  project.texts.map((t) => (
                    <Clip
                      key={t.id}
                      left={sourceToTimeline(t.start, project.segments) * pps}
                      width={Math.max(8, (t.end - t.start) * pps)}
                      color="#3a3a3c"
                      selected={selection?.type === "text" && selection.id === t.id}
                      label={t.text}
                      onSelect={() => setSelection({ type: "text", id: t.id })}
                      onDrag={(dt) => moveClip("text", t.id, dt, project, updateProject)}
                      onTrimStart={(dt) => trimClip("text", t.id, "start", dt, project, updateProject)}
                      onTrimEnd={(dt) => trimClip("text", t.id, "end", dt, project, updateProject)}
                      startDrag={startDrag}
                    />
                  ))}
              </div>
            </div>
          ))}

          <Playhead pps={pps} onScrubStart={beginScrub} />
        </div>
      </div>
    </div>
  );
}

/** Subscribes to time on its own so playback doesn't re-render the clip lists. */
function Playhead({
  pps,
  onScrubStart,
}: {
  pps: number;
  onScrubStart: (e: React.PointerEvent) => void;
}) {
  const time = useAppStore((s) => s.timelineTime);
  return (
    <div
      className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-coral"
      style={{ left: time * pps }}
    >
      <div
        className="pointer-events-auto absolute -top-0.5 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 cursor-ew-resize rounded-[2px] bg-coral"
        onPointerDown={(e) => {
          e.stopPropagation();
          onScrubStart(e);
        }}
      />
    </div>
  );
}

function Clip({
  left,
  width,
  color,
  selected,
  label,
  onSelect,
  onDrag,
  onTrimStart,
  onTrimEnd,
  startDrag,
}: {
  left: number;
  width: number;
  color: string;
  selected: boolean;
  label: string;
  onSelect: () => void;
  onDrag: (dt: number) => void;
  onTrimStart: (dt: number) => void;
  onTrimEnd: (dt: number) => void;
  startDrag: (
    e: React.PointerEvent,
    onMove: (dt: number) => void,
    onUp?: () => void,
  ) => void;
}) {
  const last = useRef(0);
  return (
    <div
      data-clip
      className={`absolute top-1 h-7 overflow-hidden rounded-[8px] text-[10px] font-medium text-white shadow-sm transition-opacity ${
        selected ? "z-10 opacity-100" : "opacity-[0.88]"
      }`}
      style={{
        left,
        width,
        background: color,
        boxShadow: selected ? "0 0 0 2px #fff, 0 0 0 4px #0a84ff" : undefined,
      }}
      onPointerDown={(e) => {
        onSelect();
        last.current = 0;
        startDrag(e, (dt) => {
          const delta = dt - last.current;
          last.current = dt;
          onDrag(delta);
        });
      }}
    >
      <button
        className={`absolute left-0 top-0 h-full cursor-ew-resize ${selected ? "w-2 bg-white/60" : "w-1.5 bg-white/25"}`}
        onPointerDown={(e) => {
          last.current = 0;
          startDrag(e, (dt) => {
            const delta = dt - last.current;
            last.current = dt;
            onTrimStart(delta);
          });
        }}
      />
      <span className="pointer-events-none block truncate px-3 pt-1.5">{label}</span>
      <button
        className={`absolute right-0 top-0 h-full cursor-ew-resize ${selected ? "w-2 bg-white/60" : "w-1.5 bg-white/25"}`}
        onPointerDown={(e) => {
          last.current = 0;
          startDrag(e, (dt) => {
            const delta = dt - last.current;
            last.current = dt;
            onTrimEnd(delta);
          });
        }}
      />
    </div>
  );
}

function moveClip(
  kind: Selection["type"],
  id: string,
  dt: number,
  project: Project,
  updateProject: (patch: Partial<Project> | ((p: Project) => Project), history?: boolean) => void,
) {
  if (kind === "segment") return;
  const key = kind === "zoom" ? "zooms" : kind === "caption" ? "captions" : "texts";
  updateProject({
    [key]: project[key].map((item) =>
      item.id === id
        ? {
            ...item,
            start: Math.max(0, item.start + dt),
            end: Math.min(project.duration, item.end + dt),
          }
        : item,
    ),
  } as Partial<Project>);
}

function trimClip(
  kind: Selection["type"],
  id: string,
  edge: "start" | "end",
  dt: number,
  project: Project,
  updateProject: (patch: Partial<Project> | ((p: Project) => Project), history?: boolean) => void,
) {
  if (kind === "segment") return;
  const key = kind === "zoom" ? "zooms" : kind === "caption" ? "captions" : "texts";
  updateProject({
    [key]: project[key].map((item) => {
      if (item.id !== id) return item;
      if (edge === "start") {
        return { ...item, start: Math.min(item.end - 0.1, Math.max(0, item.start + dt)) };
      }
      return { ...item, end: Math.max(item.start + 0.1, Math.min(project.duration, item.end + dt)) };
    }),
  } as Partial<Project>);
}
