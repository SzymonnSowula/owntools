import { useEffect, useMemo, useState } from "react";
import type { Project } from "../../types";
import { fillerSeconds, removeFillerRanges, type FillerCandidate } from "../../lib/fillers";
import { formatTime } from "../../lib/time";
import { useAppStore } from "../../store/appStore";
import { useRangePreview, useTimelineOf } from "./useScriptAnalysis";
import { ReviewFooter, ReviewRow, ScriptEmpty, ScriptNote } from "./bits";

const KIND_LABEL: Record<FillerCandidate["kind"], string> = {
  sound: "sounds",
  phrase: "asides",
  stutter: "stutters",
};

/**
 * The filler checklist. Everything the analysis is sure of arrives ticked
 * ("um", a repeated word); the contextual ones ("like", "you know") arrive
 * unticked, because there the analysis is guessing and the person is not.
 * Every row can be heard before it goes — the cut is one undo step.
 */
export function FillerReview({ project, candidates }: { project: Project; candidates: FillerCandidate[] }) {
  const cutSourceRanges = useAppStore((s) => s.cutSourceRanges);
  const showToast = useAppStore((s) => s.showToast);
  const preview = useRangePreview();
  const tl = useTimelineOf(project);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(candidates.filter((c) => c.confident).map((c) => c.id)));

  // The list changes when a cut lands; ticks follow the candidates that remain.
  useEffect(() => {
    setChecked((prev) => {
      const next = new Set<string>();
      for (const c of candidates) if (prev.has(c.id) || (!prev.size && c.confident)) next.add(c.id);
      return next;
    });
  }, [candidates]);

  const selected = useMemo(() => candidates.filter((c) => checked.has(c.id)), [candidates, checked]);
  const seconds = useMemo(() => fillerSeconds(selected), [selected]);
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of candidates) out[c.kind] = (out[c.kind] ?? 0) + 1;
    return out;
  }, [candidates]);
  const estimated = selected.some((c) => !c.timed);

  if (!candidates.length) {
    return <ScriptEmpty title="No fillers found" body="Nothing to take out — no hesitation sounds, asides or repeated words in what is left of the take." />;
  }

  function toggle(id: string, on: boolean) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function removeSelected() {
    if (!selected.length) return;
    const removed = cutSourceRanges(removeFillerRanges(selected), { fillers: selected.map((c) => c.id) });
    if (removed > 0) {
      showToast(`Removed ${selected.length} ${selected.length === 1 ? "filler" : "fillers"} (${removed.toFixed(1)} s). Ctrl+Z puts them back.`, "info");
    }
  }

  return (
    <>
      <div className="border-b border-line px-3 py-2 text-[11px] text-muted">
        {candidates.length} found ·{" "}
        {Object.entries(counts)
          .map(([kind, n]) => `${n} ${KIND_LABEL[kind as FillerCandidate["kind"]]}`)
          .join(" · ")}
        <div className="mt-1 flex gap-2">
          <button className="font-semibold text-teal-2 hover:underline" onClick={() => setChecked(new Set(candidates.map((c) => c.id)))}>
            Tick all
          </button>
          <button className="font-semibold text-teal-2 hover:underline" onClick={() => setChecked(new Set(candidates.filter((c) => c.confident).map((c) => c.id)))}>
            Only the sure ones
          </button>
          <button className="font-semibold text-muted hover:underline" onClick={() => setChecked(new Set())}>
            None
          </button>
        </div>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto py-1">
        {candidates.map((c) => (
          <ReviewRow
            key={c.id}
            checked={checked.has(c.id)}
            onToggle={(on) => toggle(c.id, on)}
            time={formatTime(tl(c.start), true)}
            reason={c.reason}
            onHear={() => preview(tl(c.start) - 0.5, tl(c.end) + 0.6)}
            onGo={() => useAppStore.getState().seekSource(c.start)}
          >
            <span className="text-muted">{c.before} </span>
            <mark className="rounded-[4px] bg-coral/15 px-0.5 text-ink line-through decoration-coral/70">{c.text}</mark>
            <span className="text-muted"> {c.after}</span>
          </ReviewRow>
        ))}
      </div>
      {estimated ? (
        <ScriptNote>Word timing is estimated from cue lengths on some of these — hear each one before removing it.</ScriptNote>
      ) : null}
      <ReviewFooter
        summary={selected.length ? `${selected.length} ticked · ${seconds.toFixed(1)} s` : "Nothing ticked"}
        action={`Remove ${selected.length ? selected.length : ""}`.trim()}
        disabled={!selected.length}
        onAction={removeSelected}
      />
    </>
  );
}
