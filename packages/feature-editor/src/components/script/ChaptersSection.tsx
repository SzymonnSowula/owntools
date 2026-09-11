import { useEffect, useState } from "react";
import { llmStatus, openIntelligenceSettings } from "@core/llm";
import type { Chapter, Project } from "../../types";
import { chaptersToYouTube, improveChapterTitles, proposeChapters } from "../../lib/chapters";
import { formatTime } from "../../lib/time";
import { timelineToSource } from "../../lib/segments";
import { sentenceIndexAt, type Sentence } from "../../lib/transcriptEdit";
import { useAppStore } from "../../store/appStore";
import { useTimelineOf } from "./useScriptAnalysis";
import { ScriptEmpty, ScriptNote } from "./bits";

/**
 * Chapters: proposed from the pauses in the speech, titled from the opening
 * words, editable in place, drawn on the timeline ruler, and copied out in
 * the exact shape a YouTube description wants. A language model, when one is
 * set up, only ever rewrites the titles.
 */
export function ChaptersSection({ project, sentences }: { project: Project; sentences: Sentence[] }) {
  const setChapters = useAppStore((s) => s.setChapters);
  const showToast = useAppStore((s) => s.showToast);
  const seekSource = useAppStore((s) => s.seekSource);
  const tl = useTimelineOf(project);
  const chapters = project.chapters ?? [];
  const [model, setModel] = useState(false);
  const [improving, setImproving] = useState(false);

  useEffect(() => {
    void llmStatus()
      .then((s) => setModel(s.available))
      .catch(() => setModel(false));
  }, []);

  function generate() {
    const proposed = proposeChapters(sentences, project.duration);
    if (!proposed.length) {
      showToast("The take is too short for chapters, or has too few pauses.", "info");
      return;
    }
    setChapters(proposed);
    showToast(`${proposed.length} chapters from the pauses in the take.`, "info");
  }

  async function improve() {
    setImproving(true);
    try {
      const result = await improveChapterTitles(chapters, sentences);
      if (result.used === "model") {
        setChapters(result.chapters);
        showToast("Titles rewritten by the model.", "info");
      } else {
        showToast("The model did not answer — the titles stay as they are.", "info");
      }
    } finally {
      setImproving(false);
    }
  }

  async function copyForYouTube() {
    const text = chaptersToYouTube(chapters, project.segments);
    try {
      await navigator.clipboard.writeText(text);
      showToast("Chapters copied — paste them into the video description.", "info");
    } catch {
      showToast(text, "info");
    }
  }

  function rename(index: number, title: string) {
    const next = chapters.map((c, i) => (i === index ? { ...c, title } : c));
    setChapters(next);
  }

  function remove(index: number) {
    setChapters(chapters.filter((_, i) => i !== index));
  }

  function addAtPlayhead() {
    const source = timelineToSource(useAppStore.getState().timelineTime, project.segments);
    const at = sentenceIndexAt(sentences, source);
    const sentence = at >= 0 ? sentences[at] : undefined;
    const start = sentence && Math.abs(sentence.start - source) < 2 ? sentence.start : source;
    if (chapters.some((c) => Math.abs(c.start - start) < 1)) {
      showToast("There is a chapter here already.", "info");
      return;
    }
    const words = sentence ? sentence.words.slice(0, 6).map((w) => w.text).join(" ") : "";
    setChapters([...chapters, { start, title: words.replace(/[.,;:!?…]+$/, "") || "New chapter" }]);
  }

  if (!chapters.length) {
    return (
      <ScriptEmpty
        title="No chapters yet"
        body="Chapters come from the pauses in the take — where you stopped to change subject — with the opening words as titles. Rename any of them, then copy the list for YouTube."
      >
        <button className="btn btn-primary w-full !py-2 text-xs" onClick={generate}>
          Generate chapters
        </button>
        <button className="btn btn-ghost mt-1.5 w-full !py-1.5 text-xs text-muted" onClick={addAtPlayhead}>
          Add one at the playhead
        </button>
      </ScriptEmpty>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-2">
        <button className="btn btn-secondary !h-7 !px-2.5 !py-0 text-[11px]" onClick={generate} title="Propose chapters from the pauses again — replaces the list">
          Regenerate
        </button>
        <button className="btn btn-secondary !h-7 !px-2.5 !py-0 text-[11px]" onClick={addAtPlayhead} title="A chapter at the playhead">
          + At playhead
        </button>
        <button className="btn btn-primary ml-auto !h-7 !px-2.5 !py-0 text-[11px]" onClick={() => void copyForYouTube()}>
          Copy for YouTube
        </button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto py-1">
        {chapters.map((c, i) => (
          <ChapterRow
            key={`${c.start}-${i}`}
            chapter={c}
            time={formatTime(tl(c.start))}
            onSeek={() => seekSource(c.start)}
            onRename={(title) => rename(i, title)}
            onRemove={() => remove(i)}
          />
        ))}
      </div>
      {model ? (
        <div className="border-t border-line px-3 py-2">
          <button className="btn btn-secondary w-full !py-1.5 text-xs" disabled={improving} onClick={() => void improve()}>
            {improving ? "Asking the model…" : "Improve titles with the model"}
          </button>
        </div>
      ) : (
        <ScriptNote>
          Titles are the opening words of each chapter.{" "}
          <button className="font-semibold text-teal-2 hover:underline" onClick={openIntelligenceSettings}>
            Add a language model in Settings → Intelligence
          </button>{" "}
          for titles that name the subject.
        </ScriptNote>
      )}
    </>
  );
}

function ChapterRow({
  chapter,
  time,
  onSeek,
  onRename,
  onRemove,
}: {
  chapter: Chapter;
  time: string;
  onSeek: () => void;
  onRename: (title: string) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(chapter.title);
  useEffect(() => setDraft(chapter.title), [chapter.title]);
  const commit = () => {
    const title = draft.trim();
    if (title && title !== chapter.title) onRename(title);
    else setDraft(chapter.title);
  };
  return (
    <div className="group mx-2 my-0.5 flex items-center gap-2 rounded-[10px] px-2 py-1 hover:bg-paper">
      <button type="button" className="w-11 shrink-0 text-left text-[11px] tabular-nums text-muted hover:text-ink" title="Put the playhead here" onClick={onSeek}>
        {time}
      </button>
      <input
        className="field !h-7 min-w-0 flex-1 !px-2 text-[13px]"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setDraft(chapter.title);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <button
        type="button"
        className="shrink-0 rounded-[6px] px-1 text-[12px] text-muted opacity-0 hover:bg-card hover:text-red group-hover:opacity-100 focus:opacity-100"
        title="Remove this chapter"
        onClick={onRemove}
      >
        ×
      </button>
    </div>
  );
}
