import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "../../types";
import { findFillers, type FillerCandidate } from "../../lib/fillers";
import { findRetakes, type RetakeCandidate } from "../../lib/retakes";
import { findShorts, type ShortCandidate } from "../../lib/shorts";
import { sourceToTimeline } from "../../lib/segments";
import { transcribeCaptions, whisperReady } from "../../lib/transcribe";
import { sentencesFromCaptions, type Sentence } from "../../lib/transcriptEdit";
import { useAppStore } from "../../store/appStore";

/**
 * The Script panel's analyses, each memoised on exactly what it reads, so a
 * playhead tick never re-runs a filler search and a cut only re-runs what the
 * cut can change.
 */

export function useSentences(project: Project): Sentence[] {
  return useMemo(() => sentencesFromCaptions(project.captions), [project.captions]);
}

export function useFillers(project: Project, sentences: Sentence[]): FillerCandidate[] {
  const exclude = project.script?.fillersRemoved;
  return useMemo(
    () => findFillers(sentences, { exclude, segments: project.segments }),
    [sentences, exclude, project.segments],
  );
}

export function useRetakes(project: Project, sentences: Sentence[]): RetakeCandidate[] {
  const exclude = project.script?.retakesRemoved;
  return useMemo(
    () => findRetakes(sentences, { exclude, segments: project.segments }),
    [sentences, exclude, project.segments],
  );
}

export function useShorts(project: Project, sentences: Sentence[], fillers: FillerCandidate[]): ShortCandidate[] {
  const chapters = project.chapters;
  return useMemo(
    () => findShorts(sentences, project.segments, chapters ?? [], { fillers }),
    [sentences, project.segments, chapters, fillers],
  );
}

/**
 * "Hear it first": plays a stretch of the *timeline* and stops at its end.
 * Seeking goes through the store like every other seek — the Editor's loop
 * owns `currentTime` and its `seeking` guard — so this never touches the
 * video element. A manual pause cancels the stop.
 */
export function useRangePreview(): (tlStart: number, tlEnd: number) => void {
  const stopAt = useRef<number | null>(null);
  useEffect(
    () =>
      useAppStore.subscribe((s, prev) => {
        if (stopAt.current === null) return;
        if (!s.playing && prev.playing) {
          stopAt.current = null;
          return;
        }
        if (s.playing && s.timelineTime >= stopAt.current) {
          stopAt.current = null;
          useAppStore.getState().setPlaying(false);
        }
      }),
    [],
  );
  useEffect(() => () => void (stopAt.current = null), []);
  return useCallback((tlStart, tlEnd) => {
    const state = useAppStore.getState();
    state.setPlaying(false);
    state.setTimelineTime(Math.max(0, tlStart));
    stopAt.current = Math.max(tlStart + 0.2, tlEnd);
    // The seek lands first (the Editor reacts to the time change), then play.
    requestAnimationFrame(() => useAppStore.getState().setPlaying(true));
  }, []);
}

/** Seconds of the recording as the viewer sees them: on the cut timeline. */
export function useTimelineOf(project: Project): (source: number) => number {
  const segments = project.segments;
  return useCallback((source: number) => sourceToTimeline(source, segments), [segments]);
}

/**
 * Whisper over the take, with word timing. `replace` throws the current
 * captions away first (an old transcript without word times) — one undo step
 * either way.
 */
export function useTranscribe(): { ready: boolean; busy: boolean; run: (replace: boolean) => Promise<void> } {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void whisperReady().then(setReady);
  }, []);
  const run = useCallback(async (replace: boolean) => {
    const { project, media, updateProject, showToast, setPlaying } = useAppStore.getState();
    if (!project || !media?.screenUrl) return;
    setBusy(true);
    setPlaying(false);
    try {
      const captions = await transcribeCaptions(media.screenUrl, project.speechLang, { words: true });
      if (!captions.length) {
        showToast("No speech detected in the recording.", "info");
        return;
      }
      const current = useAppStore.getState().project;
      if (!current) return;
      updateProject({ captions: replace ? captions : [...current.captions, ...captions] }, true);
      const timed = captions.every((c) => c.words?.length);
      showToast(
        timed
          ? `Transcribed ${captions.length} cues with word timing.`
          : `Transcribed ${captions.length} cues — word timing is estimated on this whisper build.`,
        "info",
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Transcription failed.", "error");
    } finally {
      setBusy(false);
    }
  }, []);
  return { ready, busy, run };
}
