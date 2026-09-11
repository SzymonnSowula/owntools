import { useEffect, useMemo, useState } from "react";
import type { Project } from "../../types";
import { retakeRanges, retakeSeconds, type RetakeCandidate } from "../../lib/retakes";
import { formatTime } from "../../lib/time";
import { useAppStore } from "../../store/appStore";
import { useRangePreview, useTimelineOf } from "./useScriptAnalysis";
import { ReviewFooter, ReviewRow, ScriptEmpty, ScriptNote } from "./bits";

/**
 * Retakes: a phrase said again within seconds. The proposal cuts from the
 * first attempt to the start of the second — heard as one stretch before it
 * goes. Quick restarts arrive ticked; a repeat with a lot in between does not,
 * because that is how a phrase repeated on purpose looks too.
 */
export function RetakeReview({ project, candidates }: { project: Project; candidates: RetakeCandidate[] }) {
  const cutSourceRanges = useAppStore((s) => s.cutSourceRanges);
  const showToast = useAppStore((s) => s.showToast);
  const preview = useRangePreview();
  const tl = useTimelineOf(project);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(candidates.filter((c) => c.confident).map((c) => c.id)));

  useEffect(() => {
    setChecked((prev) => {
      const next = new Set<string>();
      for (const c of candidates) if (prev.has(c.id) || (!prev.size && c.confident)) next.add(c.id);
      return next;
    });
  }, [candidates]);

  const selected = useMemo(() => candidates.filter((c) => checked.has(c.id)), [candidates, checked]);
  const seconds = useMemo(() => retakeSeconds(selected), [selected]);

  if (!candidates.length) {
    return <ScriptEmpty title="No retakes found" body="No sentence is said twice within twenty seconds — or the ones that were are already cut." />;
  }

  function removeSelected() {
    if (!selected.length) return;
    const removed = cutSourceRanges(retakeRanges(selected), { retakes: selected.map((c) => c.id) });
    if (removed > 0) {
      showToast(`Removed ${selected.length} ${selected.length === 1 ? "retake" : "retakes"} (${removed.toFixed(1)} s). Ctrl+Z puts them back.`, "info");
    }
  }

  return (
    <>
      <div className="border-b border-line px-3 py-2 text-[11px] text-muted">
        {candidates.length} {candidates.length === 1 ? "retake" : "retakes"} · the first attempt goes, the second stays
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto py-1">
        {candidates.map((c) => (
          <ReviewRow
            key={c.id}
            checked={checked.has(c.id)}
            onToggle={(on) =>
              setChecked((prev) => {
                const next = new Set(prev);
                if (on) next.add(c.id);
                else next.delete(c.id);
                return next;
              })
            }
            time={`${formatTime(tl(c.firstStart))} → ${formatTime(tl(c.secondStart))}`}
            reason={`${c.reason} · cuts ${(c.cutEnd - c.cutStart).toFixed(1)} s`}
            onHear={() => preview(tl(c.cutStart) - 0.3, tl(c.secondStart) + 1.2)}
            onGo={() => useAppStore.getState().seekSource(c.firstStart)}
          >
            <span className="text-ink">“{c.phrase}”</span>
          </ReviewRow>
        ))}
      </div>
      {selected.some((c) => !c.timed) ? <ScriptNote>Word timing is estimated here — hear it before removing.</ScriptNote> : null}
      <ReviewFooter
        summary={selected.length ? `${selected.length} ticked · ${seconds.toFixed(1)} s` : "Nothing ticked"}
        action={`Remove ${selected.length ? selected.length : ""}`.trim()}
        disabled={!selected.length}
        onAction={removeSelected}
      />
    </>
  );
}
