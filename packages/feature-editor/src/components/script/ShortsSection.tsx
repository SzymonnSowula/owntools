import type { Project } from "../../types";
import type { ShortCandidate } from "../../lib/shorts";
import { formatTime } from "../../lib/time";
import { useAppStore } from "../../store/appStore";
import { useRangePreview } from "./useScriptAnalysis";
import { ScriptEmpty, ScriptNote } from "./bits";

/**
 * Short clips: the best 20–60 s stretches, each with its reason, a preview
 * and an export that opens the dialog pre-set to the clip and a vertical
 * centre crop.
 */
export function ShortsSection({ project, candidates }: { project: Project; candidates: ShortCandidate[] }) {
  const openExport = useAppStore((s) => s.openExport);
  const preview = useRangePreview();
  void project;

  if (!candidates.length) {
    return (
      <ScriptEmpty
        title="No clips to suggest yet"
        body="A clip is 20–60 seconds that starts on a sentence. Once the take has a transcript with a few sentences, the best stretches show up here."
      />
    );
  }

  return (
    <>
      <div className="border-b border-line px-3 py-2 text-[11px] text-muted">
        {candidates.length} {candidates.length === 1 ? "clip" : "clips"} worth cutting out, best first
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto py-1">
        {candidates.map((c, i) => (
          <div key={c.id} className="mx-2 my-1 rounded-[12px] border border-line px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <p className="min-w-0 truncate text-[13px] font-semibold text-ink" title={c.title}>
                {i + 1}. {c.title}
              </p>
              <span className="shrink-0 text-[11px] tabular-nums text-muted">{Math.round(c.duration)} s</span>
            </div>
            <p className="mt-0.5 text-[11px] text-muted">
              {formatTime(c.tlStart)} → {formatTime(c.tlEnd)} · {c.reason}
            </p>
            <div className="mt-2 flex gap-1.5">
              <button className="btn btn-ghost !h-7 !px-2.5 !py-0 text-[11px]" onClick={() => preview(c.tlStart, c.tlEnd)}>
                ▶ Preview
              </button>
              <button
                className="btn btn-secondary !h-7 !px-2.5 !py-0 text-[11px]"
                onClick={() =>
                  openExport({
                    range: { start: c.tlStart, end: c.tlEnd },
                    crop: "9:16",
                    label: c.title,
                  })
                }
              >
                Export clip
              </button>
            </div>
          </div>
        ))}
      </div>
      <ScriptNote>
        Export opens pre-set to the clip and a vertical 9:16 centre crop — switch the crop off in the dialog to keep the whole frame.
      </ScriptNote>
    </>
  );
}
