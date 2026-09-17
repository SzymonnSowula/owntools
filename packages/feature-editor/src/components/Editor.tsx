import { useEffect, useMemo, useRef, useState } from "react";
import { PreviewCanvas } from "./PreviewCanvas";
import { Timeline } from "./Timeline";
import { Inspector } from "./Inspector";
import { ExportModal } from "./ExportModal";
import { CommandPalette, type PaletteCommand } from "./CommandPalette";
import { Toolbar } from "./Toolbar";
import { TranscriptPanel } from "./TranscriptPanel";
import { proposeChapters } from "../lib/chapters";
import { sentencesFromCaptions } from "../lib/transcriptEdit";
import { saveProjectAsset } from "../lib/projectIo";
import { useOverlayImages } from "../lib/useOverlayImages";
import { ensureFiniteDuration } from "../lib/videoEl";
import { playbackStep, sourceToTimeline, timelineDuration, timelineToSource } from "../lib/segments";
import { cutIntervalsFromSegments, detectSilence } from "../lib/silence";
import { sfxPack } from "../lib/sfx/packs";
import { sfxPlanFor } from "../lib/sfx/plan";
import { sfxPreview } from "../lib/sfx/player";
import { useAppStore } from "../store/appStore";

export function Editor() {
  const project = useAppStore((s) => s.project);
  const media = useAppStore((s) => s.media);
  const playing = useAppStore((s) => s.playing);
  const setPlaying = useAppStore((s) => s.setPlaying);
  const splitAtPlayhead = useAppStore((s) => s.splitAtPlayhead);
  const deleteSelection = useAppStore((s) => s.deleteSelection);
  const addZoom = useAppStore((s) => s.addZoom);
  const addCaption = useAppStore((s) => s.addCaption);
  const addText = useAppStore((s) => s.addText);
  const addOverlay = useAppStore((s) => s.addOverlay);
  const persistProject = useAppStore((s) => s.persistProject);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const updateProject = useAppStore((s) => s.updateProject);
  const showToast = useAppStore((s) => s.showToast);
  const scriptOpen = useAppStore((s) => s.scriptOpen);
  const [autoCutBusy, setAutoCutBusy] = useState(false);
  const sfxOn = Boolean(project?.sfx.enabled);
  const hasTranscript = Boolean(project?.captions.length);

  const screenRef = useRef<HTMLVideoElement>(null);
  const webcamRef = useRef<HTMLVideoElement>(null);
  const [screenEl, setScreenEl] = useState<HTMLVideoElement | null>(null);
  const [webcamEl, setWebcamEl] = useState<HTMLVideoElement | null>(null);
  const [bgEl, setBgEl] = useState<HTMLImageElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const overlayImages = useOverlayImages(media?.overlayUrls);

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
      // A jump across a cut is a seek, and a seek takes time: screen recordings
      // are encoded with very sparse keyframes, so landing on a frame can mean
      // decoding seconds of video. Assigning currentTime again while that is in
      // flight abandons it and starts over — do that every frame, as this loop
      // used to, and the seek never finishes. That is what froze playback at a
      // cut. Wait it out instead; the last drawn frame stays on screen.
      if (screen.seeking) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const step = playbackStep(
        project.segments,
        useAppStore.getState().timelineTime,
        screen.currentTime,
      );
      if (step.action === "stop") {
        useAppStore.setState({ playing: false, timelineTime: timelineDuration(project.segments) });
        return;
      }
      if (step.action === "seek" && step.to !== undefined) {
        screen.currentTime = step.to;
        if (webcamRef.current) {
          webcamRef.current.currentTime = Math.max(0, step.to - project.webcamOffset);
        }
      }
      useAppStore.setState({ timelineTime: sourceToTimeline(screen.currentTime, project.segments) });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, project]);

  // The preview is audible: the recording plays through the <video> at the
  // project's volume (fades and gain above 1× are export-only) and the sound
  // effects through the scheduler below, so the two can be judged together.
  useEffect(() => {
    const screen = screenRef.current;
    if (!screen || !project) return;
    screen.muted = project.audio.muted;
    screen.volume = Math.min(1, Math.max(0, project.audio.volume));
  }, [project?.audio.muted, project?.audio.volume, media?.screenUrl]);

  // Sound effects follow the same plan the export mixes and the timeline
  // shows; the plan is swapped on every edit without re-firing what is queued.
  useEffect(() => {
    if (!project) return;
    sfxPreview().setPlan(project.sfx.enabled ? sfxPlanFor(project) : [], sfxPack(project.sfx.pack));
  }, [project]);

  useEffect(() => {
    const player = sfxPreview();
    const unsub = useAppStore.subscribe((s) => player.sync(s.timelineTime, s.playing));
    return () => {
      unsub();
      // Closes the audio context too; the next play builds a new one.
      player.dispose();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const state = useAppStore.getState();
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      const key = e.key.toLowerCase();

      // Ctrl+K reaches the palette even from a field — it is how you get out of one.
      if ((e.metaKey || e.ctrlKey) && key === "k") {
        e.preventDefault();
        state.setPaletteOpen(!state.paletteOpen);
        return;
      }
      if (state.paletteOpen) return;
      if (e.key === "Escape") {
        if (state.tool !== "select") {
          e.preventDefault();
          state.setTool("select");
        }
        return;
      }
      if (typing) return;

      if (e.code === "Space") {
        e.preventDefault();
        setPlaying(!state.playing);
      } else if (key === "s" && e.shiftKey && !e.metaKey && !e.ctrlKey) {
        // S splits, Shift+S is the Script — the same pairing as Z / Shift+Z.
        e.preventDefault();
        state.setScriptOpen(!state.scriptOpen);
      } else if (key === "s" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        splitAtPlayhead();
      } else if (key === "c" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        state.setTool(state.tool === "cut" ? "select" : "cut");
      } else if (key === "z" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        addZoom(e.shiftKey ? "out" : "in");
      } else if (key === "t" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        addText();
      } else if (key === "k" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        addCaption();
      } else if (key === "i" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        imageRef.current?.click();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        deleteSelection();
      } else if ((e.metaKey || e.ctrlKey) && key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.key === "Home" || e.key === "End") {
        if (!state.project) return;
        e.preventDefault();
        state.setPlaying(false);
        state.setTimelineTime(e.key === "Home" ? 0 : timelineDuration(state.project.segments));
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (!state.project) return;
        e.preventDefault();
        const dur = timelineDuration(state.project.segments);
        const step = (e.shiftKey ? 1 : 1 / 30) * (e.key === "ArrowLeft" ? -1 : 1);
        state.setPlaying(false);
        state.setTimelineTime(Math.min(dur, Math.max(0, state.timelineTime + step)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPlaying, splitAtPlayhead, deleteSelection, undo, redo, addZoom, addText, addCaption]);

  if (!project || !media) {
    return (
      <div className="grid flex-1 place-items-center text-sm text-muted">
        No project open.
      </div>
    );
  }

  async function autoCut() {
    if (!project || !media || autoCutBusy) return;
    setAutoCutBusy(true);
    setPlaying(false);
    try {
      const blob = await fetch(media.screenUrl).then((r) => {
        if (!r.ok) throw new Error("Couldn't load the recording.");
        return r.blob();
      });
      let intervals: { start: number; end: number }[];
      try {
        ({ intervals } = await detectSilence(blob));
      } catch {
        showToast("This recording has no audio to analyze.", "error");
        return;
      }
      if (!intervals.length) {
        showToast("No long pauses found.");
        return;
      }
      const next = cutIntervalsFromSegments(project.segments, intervals);
      const removed = timelineDuration(project.segments) - timelineDuration(next);
      if (!next.length || removed <= 0.01) {
        showToast("No long pauses found.");
        return;
      }
      updateProject({ segments: next }, true);
      showToast(`Removed ${intervals.length} ${intervals.length === 1 ? "pause" : "pauses"} (${removed.toFixed(1)}s).`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Auto-cut failed.", "error");
    } finally {
      setAutoCutBusy(false);
    }
  }

  /** One list behind Ctrl+K; the toolbar is the shortlist of the same actions. */
  const commands = useMemo<PaletteCommand[]>(() => {
    const store = useAppStore.getState;
    return [
      { id: "play", group: "Playback", label: playing ? "Pause" : "Play", keys: "Space", run: () => setPlaying(!store().playing) },
      { id: "start", group: "Playback", label: "Go to the start", keys: "Home", run: () => store().setTimelineTime(0) },
      {
        id: "end",
        group: "Playback",
        label: "Go to the end",
        keys: "End",
        run: () => {
          const p = store().project;
          if (p) store().setTimelineTime(timelineDuration(p.segments));
        },
      },
      { id: "split", group: "Cut", label: "Split at the playhead", keys: "S", run: () => store().splitAtPlayhead() },
      {
        id: "cut-tool",
        group: "Cut",
        label: "Cut tool — click the timeline to cut",
        keys: "C",
        run: () => store().setTool(store().tool === "cut" ? "select" : "cut"),
      },
      { id: "autocut", group: "Cut", label: "Auto-cut the silent pauses", hint: "listens to the audio", disabled: autoCutBusy, run: () => void autoCut() },
      { id: "delete", group: "Cut", label: "Delete the selection", keys: "Del", disabled: !store().selection, run: () => store().deleteSelection() },
      {
        id: "script",
        group: "Script",
        label: scriptOpen ? "Hide the Script panel" : "Open the Script panel",
        keys: "Shift+S",
        hint: "edit the video as text",
        run: () => store().setScriptOpen(!store().scriptOpen),
      },
      {
        id: "fillers",
        group: "Script",
        label: "Remove fillers",
        hint: hasTranscript ? "um, uh, repeated words — reviewed before they go" : "needs a transcript",
        run: () => store().showScript("fillers"),
      },
      {
        id: "retakes",
        group: "Script",
        label: "Find retakes",
        hint: hasTranscript ? "sentences said twice — the first attempt goes" : "needs a transcript",
        run: () => store().showScript("retakes"),
      },
      {
        id: "chapters",
        group: "Script",
        label: "Generate chapters",
        hint: hasTranscript ? "from the pauses in the take" : "needs a transcript",
        run: () => {
          const p = store().project;
          if (p && p.captions.length) {
            const proposed = proposeChapters(sentencesFromCaptions(p.captions), p.duration);
            if (proposed.length) store().setChapters(proposed);
            else store().showToast("The take is too short for chapters, or has too few pauses.", "info");
          }
          store().showScript("chapters");
        },
      },
      {
        id: "shorts",
        group: "Script",
        label: "Find short clips",
        hint: hasTranscript ? "20–60 s stretches worth posting" : "needs a transcript",
        run: () => store().showScript("shorts"),
      },
      { id: "zoom-in", group: "Add", label: "Zoom in at the playhead", keys: "Z", run: () => store().addZoom("in") },
      { id: "zoom-out", group: "Add", label: "Zoom back out", keys: "Shift+Z", run: () => store().addZoom("out") },
      { id: "regen-zoom", group: "Add", label: "Regenerate zooms from the cursor", run: () => store().regenerateZooms() },
      {
        id: "sfx",
        group: "Add",
        label: sfxOn ? "Sound effects off" : "Sound effects on",
        hint: "clicks, keystrokes and zoom whooshes",
        run: () => store().setSfxEnabled(),
      },
      { id: "caption", group: "Add", label: "Add a caption", keys: "K", run: () => store().addCaption() },
      { id: "text", group: "Add", label: "Add a text overlay", keys: "T", run: () => store().addText() },
      { id: "image", group: "Add", label: "Add an image or logo", keys: "I", run: () => imageRef.current?.click() },
      { id: "undo", group: "Project", label: "Undo", keys: "Ctrl+Z", run: () => store().undo() },
      { id: "redo", group: "Project", label: "Redo", keys: "Ctrl+Shift+Z", run: () => store().redo() },
      { id: "import", group: "Project", label: "Open another video file", run: () => fileRef.current?.click() },
      { id: "export", group: "Project", label: "Export & share", hint: "save an MP4 or copy a link", run: () => store().setExportOpen(true) },
      ...(["16:9", "9:16", "1:1"] as const).map((aspect) => ({
        id: `aspect-${aspect}`,
        group: "Project",
        label: `Aspect ratio ${aspect}`,
        run: () => store().updateProject({ aspect }, true),
      })),
      { id: "home", group: "Project", label: "Back to the recordings list", run: () => void store().setView("home") },
    ];
    // `store()` is read at run time, so the list only depends on what it shows.
  }, [playing, autoCutBusy, sfxOn, scriptOpen, hasTranscript]);

  async function addImage(file: File) {
    if (!project) return;
    const url = URL.createObjectURL(file);
    try {
      const saved = await saveProjectAsset(project.id, file, file.name, "img");
      addOverlay(saved?.name ?? file.name, url);
      if (saved) await persistProject();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't add the image.", "error");
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper">
      <Toolbar
        autoCutBusy={autoCutBusy}
        onAutoCut={() => void autoCut()}
        onImport={() => fileRef.current?.click()}
        onAddImage={() => imageRef.current?.click()}
      />
      <input
        ref={imageRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void addImage(file);
          e.currentTarget.value = "";
        }}
      />
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

      <div className="flex min-h-0 flex-1">
        {scriptOpen ? <TranscriptPanel /> : null}
        <div className="flex min-w-0 min-h-0 flex-1 flex-col">
          <PreviewCanvas
            project={project}
            screen={screenEl}
            webcam={webcamEl}
            background={bgEl}
            overlayImages={overlayImages}
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
        muted={project.audio.muted}
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
      <ExportModal
        project={project}
        screen={screenEl}
        webcam={webcamEl}
        background={bgEl}
        overlayImages={overlayImages}
      />
      <CommandPalette commands={commands} />
    </div>
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
