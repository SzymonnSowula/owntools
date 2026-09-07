import { useEffect, useMemo, useState } from "react";
import { segmentsToSrt } from "@feature-editor/lib/srt";
import {
  GROUPINGS,
  groupTranscript,
  transcriptToText,
  type TimedText,
  type TranscriptGrouping,
} from "@feature-editor/lib/transcriptFormat";
import { baseName, copyText, saveBlob, type SaveOutcome } from "../lib/save";
import { flattenCues, parseSubtitles, shiftTimes, toVtt, type SubtitleFormat } from "../lib/subtitles";
import { FilePicker } from "./FilePicker";
import { SavedLine, TextPreview, ToolError, ToolModal, ToolNote, ToolRow } from "./ToolModal";

type Target = "srt" | "vtt" | "txt";

const TARGETS: { value: Target; label: string }[] = [
  { value: "srt", label: "SubRip (.srt)" },
  { value: "vtt", label: "WebVTT (.vtt)" },
  { value: "txt", label: "Plain text (.txt)" },
];

export interface SubtitlesModalProps {
  open: boolean;
  onClose: () => void;
}

/** .srt ↔ .vtt ↔ .txt, with a timing shift and the transcript regrouping. */
export function SubtitlesModal({ open, onClose }: SubtitlesModalProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [cues, setCues] = useState<TimedText[] | null>(null);
  const [sourceFormat, setSourceFormat] = useState<SubtitleFormat | null>(null);
  const [target, setTarget] = useState<Target>("vtt");
  const [offset, setOffset] = useState("0");
  const [grouping, setGrouping] = useState<TranscriptGrouping>("lines");
  const [timestamps, setTimestamps] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SaveOutcome | null>(null);
  const [copied, setCopied] = useState(false);

  const file = files[0] ?? null;
  const offsetSeconds = Number(offset) || 0;

  const output = useMemo(() => {
    if (!cues) return "";
    const shifted = shiftTimes(cues, offsetSeconds);
    if (target === "vtt") return toVtt(shifted);
    const grouped = grouping === "lines" ? shifted : groupTranscript(flattenCues(shifted), grouping);
    if (target === "srt") return segmentsToSrt(grouped);
    return transcriptToText(flattenCues(grouped), timestamps);
  }, [cues, offsetSeconds, target, grouping, timestamps]);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(id);
  }, [copied]);

  if (!open) return null;

  async function pick(next: File[]) {
    setFiles(next);
    setCues(null);
    setSourceFormat(null);
    setSaved(null);
    setError(null);
    const picked = next[0];
    if (!picked) return;
    try {
      const parsed = parseSubtitles(await picked.text());
      setCues(parsed.cues);
      setSourceFormat(parsed.format);
      setTarget(parsed.format === "srt" ? "vtt" : "srt");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read this file.");
    }
  }

  async function save() {
    if (!file || !output) return;
    try {
      const mime = target === "vtt" ? "text/vtt" : "text/plain";
      setSaved(await saveBlob(new Blob([output], { type: mime }), `${baseName(file.name, "subtitles")}.${target}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the file.");
    }
  }

  return (
    <ToolModal
      title="Convert subtitles"
      subtitle="SubRip or WebVTT in; the other one, or plain text, out."
      onClose={onClose}
      status={<SavedLine outcome={saved} />}
      footer={
        <>
          <button className="btn btn-secondary flex-1" onClick={onClose}>
            Close
          </button>
          {cues ? (
            <>
              <button className="btn btn-secondary flex-1" onClick={() => void copyText(output).then(() => setCopied(true))}>
                {copied ? "Copied" : "Copy"}
              </button>
              <button className="btn btn-primary flex-1" onClick={() => void save()}>
                Save .{target}
              </button>
            </>
          ) : null}
        </>
      }
    >
      <FilePicker
        files={files}
        onChange={(next) => void pick(next)}
        accept=".srt,.vtt,text/vtt,application/x-subrip,text/plain"
        hint="…or drop an .srt / .vtt file here"
      />
      {cues && sourceFormat ? (
        <ToolNote>
          {cues.length} cues, {sourceFormat.toUpperCase()}.
        </ToolNote>
      ) : null}

      <ToolRow label="Convert to">
        <select className="field h-9 w-full" value={target} onChange={(e) => setTarget(e.target.value as Target)}>
          {TARGETS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </ToolRow>

      <ToolRow label="Shift timing (s)">
        <input
          className="field h-9 w-28 text-right"
          type="number"
          step={0.1}
          value={offset}
          onChange={(e) => setOffset(e.target.value)}
        />
      </ToolRow>
      <ToolNote>Positive moves every cue later, negative earlier — for subtitles that run ahead or behind.</ToolNote>

      {target !== "vtt" ? (
        <div className="flex items-center gap-3">
          <select
            className="field h-9 flex-1"
            value={grouping}
            onChange={(e) => setGrouping(e.target.value as TranscriptGrouping)}
          >
            {GROUPINGS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
          {target === "txt" ? (
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={timestamps} onChange={(e) => setTimestamps(e.target.checked)} />
              Add timestamps
            </label>
          ) : null}
        </div>
      ) : null}

      {error ? <ToolError>{error}</ToolError> : null}
      {cues ? (
        <>
          <TextPreview text={output.length > 4000 ? `${output.slice(0, 4000)}\n…` : output} />
        </>
      ) : null}
    </ToolModal>
  );
}
