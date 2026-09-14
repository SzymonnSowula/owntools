import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Project, Segment } from "../types";
import { formatTime } from "../lib/time";
import { sourceToTimeline, timelineToSource } from "../lib/segments";
import {
  cutRangesForSentences,
  foldForSearch,
  keepRangesForSentences,
  searchSentences,
  selectedSeconds,
  sentenceCutState,
  sentenceIndexAt,
  wordIndexAt,
  wordIsCut,
  type CutState,
  type Sentence,
} from "../lib/transcriptEdit";
import { isTauri } from "../lib/tauri";
import { useAppStore, type ScriptView } from "../store/appStore";
import { ScriptGlyph } from "./icons";
import { ChaptersSection } from "./script/ChaptersSection";
import { FillerReview } from "./script/FillerReview";
import { RetakeReview } from "./script/RetakeReview";
import { ShortsSection } from "./script/ShortsSection";
import { Count, ScriptEmpty, ScriptNote } from "./script/bits";
import { useFillers, useRetakes, useSentences, useShorts, useTranscribe } from "./script/useScriptAnalysis";

/**
 * The Script panel — the transcript as a second timeline, to the left of the
 * picture the way a script sits next to the footage. A left panel rather than
 * an eighth inspector tab: the inspector is 268 px of property editors for
 * whatever is selected, and a transcript wants height, a time gutter and room
 * for a sentence to wrap, and it wants to stay put while you scrub.
 *
 * Text: sentences with the current one lit by the playhead, a click seeks,
 * shift-click / ctrl-click / drag select, Cut and Keep only go through the
 * segments model as one undo step; cut words are struck through, never
 * hidden. Fillers, Retakes, Chapters and Shorts are the same words looked at
 * four other ways.
 */
export function TranscriptPanel() {
  const project = useAppStore((s) => s.project);
  const view = useAppStore((s) => s.scriptView);
  const setView = useAppStore((s) => s.setScriptView);
  const setOpen = useAppStore((s) => s.setScriptOpen);
  if (!project) return null;
  return (
    <aside className="flex w-[336px] shrink-0 flex-col border-r border-line bg-card min-[1400px]:w-[392px]" data-script-panel>
      <PanelBody project={project} view={view} setView={setView} onClose={() => setOpen(false)} />
    </aside>
  );
}

const TABS: { id: ScriptView; label: string }[] = [
  { id: "transcript", label: "Text" },
  { id: "fillers", label: "Fillers" },
  { id: "retakes", label: "Retakes" },
  { id: "chapters", label: "Chapters" },
  { id: "shorts", label: "Shorts" },
];

function PanelBody({
  project,
  view,
  setView,
  onClose,
}: {
  project: Project;
  view: ScriptView;
  setView: (v: ScriptView) => void;
  onClose: () => void;
}) {
  const sentences = useSentences(project);
  const fillers = useFillers(project, sentences);
  const retakes = useRetakes(project, sentences);
  const shorts = useShorts(project, sentences, fillers);
  const words = useMemo(() => sentences.reduce((n, s) => n + s.words.length, 0), [sentences]);
  const counts: Record<ScriptView, number> = {
    transcript: 0,
    fillers: fillers.length,
    retakes: retakes.length,
    chapters: project.chapters?.length ?? 0,
    shorts: shorts.length,
  };

  return (
    <>
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="text-teal-2">
          <ScriptGlyph />
        </span>
        <h2 className="text-sm font-semibold tracking-[-0.01em] text-ink">Script</h2>
        <span className="min-w-0 truncate text-[11px] text-muted">
          {sentences.length ? `${words} words · ${sentences.length} sentences` : "no transcript"}
        </span>
        <button
          type="button"
          className="ml-auto rounded-[6px] px-1.5 text-sm text-muted hover:bg-paper hover:text-ink"
          title="Hide the Script panel (Shift+S)"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <nav className="grid grid-cols-5 gap-0.5 border-b border-line px-1.5 py-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`flex items-center justify-center rounded-[8px] px-1 py-1 text-[10px] font-semibold ${
              view === t.id ? "bg-teal/10 text-teal-2" : "text-muted hover:text-ink"
            }`}
            onClick={() => setView(t.id)}
          >
            {t.label}
            <Count n={counts[t.id]} />
          </button>
        ))}
      </nav>
      <div className="flex min-h-0 flex-1 flex-col">
        {!sentences.length ? (
          <NoTranscript project={project} />
        ) : view === "fillers" ? (
          <FillerReview project={project} candidates={fillers} />
        ) : view === "retakes" ? (
          <RetakeReview project={project} candidates={retakes} />
        ) : view === "chapters" ? (
          <ChaptersSection project={project} sentences={sentences} />
        ) : view === "shorts" ? (
          <ShortsSection project={project} candidates={shorts} />
        ) : (
          <TranscriptList project={project} sentences={sentences} />
        )}
      </div>
    </>
  );
}

const LANGS: { id: Project["speechLang"]; label: string }[] = [
  { id: "en-US", label: "English" },
  { id: "pl-PL", label: "Polish" },
];

/** The empty state is the way in: transcribe, and the words become the timeline. */
function NoTranscript({ project }: { project: Project }) {
  const updateProject = useAppStore((s) => s.updateProject);
  const { ready, busy, run } = useTranscribe();
  const tauri = isTauri();
  return (
    <ScriptEmpty
      title="No transcript yet"
      body="Transcribe the take on this device and the words become a second timeline: delete a sentence and the video is cut, fillers and retakes are found for you, chapters and short clips come out of the same words."
    >
      <div className="grid grid-cols-2 gap-1">
        {LANGS.map((l) => (
          <button
            key={l.id}
            type="button"
            className={`rounded-[9px] border px-2 py-1.5 text-[11px] font-semibold ${
              project.speechLang === l.id ? "border-teal bg-teal/10 text-teal-2" : "border-line text-muted hover:text-ink"
            }`}
            onClick={() => updateProject({ speechLang: l.id })}
          >
            {l.label}
          </button>
        ))}
      </div>
      {ready ? (
        <button className="btn btn-primary mt-2 w-full !py-2 text-xs" disabled={busy} onClick={() => void run(false)}>
          {busy ? "Transcribing…" : "Transcribe (Whisper, on-device)"}
        </button>
      ) : (
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          {tauri
            ? "Install the speech engine in dictate first — the Script panel runs on whisper."
            : "In the browser preview transcription needs the desktop app; a recording opened with captions shows up here."}
        </p>
      )}
    </ScriptEmpty>
  );
}

interface SelectionState {
  ids: Set<string>;
  anchor: string | null;
}

const EMPTY_SELECTION: SelectionState = { ids: new Set(), anchor: null };

function TranscriptList({ project, sentences }: { project: Project; sentences: Sentence[] }) {
  const seekSource = useAppStore((s) => s.seekSource);
  const cutSourceRanges = useAppStore((s) => s.cutSourceRanges);
  const keepOnlySourceRanges = useAppStore((s) => s.keepOnlySourceRanges);
  const showToast = useAppStore((s) => s.showToast);
  const playing = useAppStore((s) => s.playing);
  const { ready, busy, run } = useTranscribe();
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION);
  const listRef = useRef<HTMLDivElement>(null);
  const segments = project.segments;

  // A new transcript is a new set of ids; nothing selected carries over.
  useEffect(() => setSelection(EMPTY_SELECTION), [sentences]);

  const matches = useMemo(() => (query.trim() ? searchSentences(sentences, query) : null), [sentences, query]);
  const visible = useMemo(() => (matches ? sentences.filter((s) => matches.has(s.id)) : sentences), [sentences, matches]);
  const indexOf = useMemo(() => new Map(sentences.map((s, i) => [s.id, i])), [sentences]);
  const states = useMemo(() => new Map(sentences.map((s) => [s.id, sentenceCutState(s, segments)])), [sentences, segments]);

  // Only the *id* is selected out of the store, so the list re-renders when the
  // playhead crosses into another sentence, not sixty times a second.
  const activeId = useAppStore((s) => {
    if (!s.project) return null;
    const i = sentenceIndexAt(sentences, timelineToSource(s.timelineTime, s.project.segments));
    return i >= 0 ? sentences[i].id : null;
  });

  useEffect(() => {
    if (!playing || !activeId) return;
    listRef.current?.querySelector<HTMLElement>(`[data-sentence-id="${activeId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeId, playing]);

  const selectRange = useCallback(
    (fromId: string, toId: string, add = false) => {
      const a = indexOf.get(fromId) ?? 0;
      const b = indexOf.get(toId) ?? a;
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      setSelection((prev) => {
        const ids = add ? new Set(prev.ids) : new Set<string>();
        for (let i = lo; i <= hi; i++) {
          const s = sentences[i];
          if (!matches || matches.has(s.id)) ids.add(s.id);
        }
        return { ids, anchor: fromId };
      });
    },
    [indexOf, sentences, matches],
  );

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const row = target.closest<HTMLElement>("[data-sentence-id]");
    if (!row) return;
    const id = row.dataset.sentenceId!;
    const wordEl = target.closest<HTMLElement>("[data-word-index]");
    const startX = e.clientX;
    const startY = e.clientY;
    let dragged = false;
    e.preventDefault();
    listRef.current?.focus({ preventScroll: true });
    const move = (ev: PointerEvent) => {
      if (!dragged && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
      dragged = true;
      const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-sentence-id]");
      selectRange(id, over?.dataset.sentenceId ?? id);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (dragged) return;
      if (e.shiftKey && selection.anchor) {
        selectRange(selection.anchor, id);
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        setSelection((prev) => {
          const ids = new Set(prev.ids);
          if (ids.has(id)) ids.delete(id);
          else ids.add(id);
          return { ids, anchor: id };
        });
        return;
      }
      // A plain click places the playhead on the word (or the sentence) and
      // remembers the row as the anchor for a shift-click.
      const sentence = sentences[indexOf.get(id) ?? 0];
      const wi = wordEl ? Number(wordEl.dataset.wordIndex) : -1;
      const word = sentence.words[wi];
      seekSource(word ? word.start : sentence.start);
      setSelection({ ids: new Set(), anchor: id });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    if (e.key === "Escape" && selection.ids.size) {
      e.preventDefault();
      e.stopPropagation();
      setSelection((prev) => ({ ids: new Set(), anchor: prev.anchor }));
    } else if ((e.key === "Delete" || e.key === "Backspace") && selection.ids.size) {
      e.preventDefault();
      e.stopPropagation();
      cutSelection();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      e.stopPropagation();
      setSelection({ ids: new Set(visible.map((s) => s.id)), anchor: visible[0]?.id ?? null });
    }
  }

  const selectedIds = selection.ids;
  const selectedCount = selectedIds.size;
  const selectedSecs = selectedSeconds(sentences, selectedIds);
  const allCut = selectedCount > 0 && [...selectedIds].every((id) => states.get(id) === "cut");

  function cutSelection() {
    if (!selectedCount || allCut) return;
    const removed = cutSourceRanges(cutRangesForSentences(sentences, selectedIds, project.duration));
    if (removed > 0) {
      showToast(`Cut ${selectedCount} ${selectedCount === 1 ? "sentence" : "sentences"} (${removed.toFixed(1)} s). Ctrl+Z puts them back.`, "info");
    }
    setSelection((prev) => ({ ids: new Set(), anchor: prev.anchor }));
  }

  function keepOnly() {
    if (!selectedCount) return;
    const removed = keepOnlySourceRanges(keepRangesForSentences(sentences, selectedIds));
    if (removed > 0) showToast(`Kept ${selectedCount} ${selectedCount === 1 ? "sentence" : "sentences"}, removed ${removed.toFixed(1)} s.`, "info");
    setSelection((prev) => ({ ids: new Set(), anchor: prev.anchor }));
  }

  const estimated = !sentences.some((s) => s.timed);

  return (
    <>
      <div className="border-b border-line px-3 py-2">
        <input
          className="field !h-8 w-full text-xs"
          placeholder="Search the words…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("");
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        {matches ? (
          <p className="mt-1 text-[11px] text-muted">
            {matches.size} of {sentences.length} sentences match
          </p>
        ) : null}
      </div>
      <div
        ref={listRef}
        tabIndex={0}
        className="scroll-thin min-h-0 flex-1 overflow-y-auto py-1 outline-none"
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      >
        {visible.map((s) => (
          <SentenceRow
            key={s.id}
            sentence={s}
            segments={segments}
            state={states.get(s.id) ?? "kept"}
            time={formatTime(sourceToTimeline(s.start, segments))}
            active={s.id === activeId}
            selected={selectedIds.has(s.id)}
            query={matches ? foldForSearch(query.trim()) : ""}
          />
        ))}
        {matches && !visible.length ? <p className="px-4 py-6 text-center text-xs text-muted">Nothing matches “{query}”.</p> : null}
      </div>
      {estimated ? (
        <ScriptNote>
          Word timing is estimated from cue lengths — a cut lands roughly where a word does.{" "}
          {ready ? (
            <button className="font-semibold text-teal-2 hover:underline" disabled={busy} onClick={() => void run(true)} title="Replaces the current captions; Ctrl+Z brings them back">
              {busy ? "Transcribing…" : "Redo with word timing"}
            </button>
          ) : null}
        </ScriptNote>
      ) : null}
      {selectedCount ? (
        <div className="flex items-center gap-2 border-t border-line px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
            {selectedCount} {selectedCount === 1 ? "sentence" : "sentences"} · {selectedSecs.toFixed(1)} s
          </span>
          <button className="btn btn-primary !h-8 !px-3 !py-0 text-xs" disabled={allCut} title="Remove these sentences from the video (Del)" onClick={cutSelection}>
            Cut
          </button>
          <button className="btn btn-secondary !h-8 !px-3 !py-0 text-xs" title="Keep only these sentences" onClick={keepOnly}>
            Keep only
          </button>
          <button
            className="rounded-[6px] px-1.5 text-sm text-muted hover:bg-paper hover:text-ink"
            title="Clear the selection (Esc)"
            onClick={() => setSelection((prev) => ({ ids: new Set(), anchor: prev.anchor }))}
          >
            ×
          </button>
        </div>
      ) : (
        <ScriptNote>Click a word to go there · shift-click or drag to select · Cut removes the sentences, Ctrl+Z brings them back</ScriptNote>
      )}
    </>
  );
}

const SentenceRow = memo(function SentenceRow({
  sentence,
  segments,
  state,
  time,
  active,
  selected,
  query,
}: {
  sentence: Sentence;
  segments: Segment[];
  state: CutState;
  time: string;
  active: boolean;
  selected: boolean;
  query: string;
}) {
  // Only the active row follows the playhead word by word; the rest select nothing.
  const activeWord = useAppStore((s) =>
    active && s.project ? wordIndexAt(sentence, timelineToSource(s.timelineTime, s.project.segments)) : -1,
  );
  const cutWords = useMemo(
    () => (state === "kept" ? null : sentence.words.map((w) => wordIsCut(w, segments))),
    [sentence, segments, state],
  );
  return (
    <div
      data-sentence-id={sentence.id}
      className={`mx-1.5 my-px flex gap-2 rounded-[10px] px-2 py-1.5 select-none ${
        selected ? "bg-teal/10 ring-1 ring-teal/35" : active ? "bg-paper" : "hover:bg-paper/70"
      } ${state === "cut" ? "opacity-60" : ""}`}
    >
      <span className="w-10 shrink-0 pt-0.5 text-right text-[10px] tabular-nums text-muted" title={state === "cut" ? "Cut from the video" : "Where this starts in the cut video"}>
        {state === "cut" ? "cut" : time}
      </span>
      <p className="min-w-0 flex-1 cursor-text text-[13px] leading-[1.55] text-ink">
        {sentence.words.map((w, i) => {
          const cut = cutWords ? cutWords[i] : false;
          const hit = query && foldForSearch(w.text).includes(query);
          return (
            <span
              key={i}
              data-word-index={i}
              className={`rounded-[3px] ${cut ? "text-muted line-through decoration-muted/70" : ""} ${
                i === activeWord ? "bg-teal/20" : ""
              } ${hit ? "bg-[#ffd60a]/45" : ""}`}
            >
              {w.text}{" "}
            </span>
          );
        })}
      </p>
    </div>
  );
});
