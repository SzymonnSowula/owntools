import { useEffect, useMemo, useState } from "react";
import { isTauri } from "@core/env";
import { dictationStatus, type DictationLang } from "@feature-dictation/engine";
import { segmentsToSrt } from "@feature-editor/lib/srt";
import {
  GROUPINGS,
  groupTranscript,
  transcriptToText,
  type TimedText,
  type TranscriptGrouping,
} from "@feature-editor/lib/transcriptFormat";
import { fetchDataUrl } from "../lib/net";
import { baseName, copyText, formatBytes, saveBlob, type SaveOutcome } from "../lib/save";
import {
  fetchCaptions,
  formatDuration,
  lookupVideo,
  parseYouTubeId,
  pickCaptionTrack,
  type YouTubeVideo,
} from "../lib/youtube";
import {
  cancelYouTubeAudio,
  transcribeYouTubeAudio,
  type WhisperRouteProgress,
} from "../lib/youtubeWhisper";
import { SavedLine, TextPreview, ToolError, ToolModal, ToolNote, ToolProgress, ToolRow } from "./ToolModal";

const LANGS: { value: DictationLang; label: string }[] = [
  { value: "auto", label: "Auto-detect" },
  { value: "en", label: "English" },
  { value: "pl", label: "Polski" },
];

type Busy = null | "lookup" | "captions" | "whisper";

export interface YouTubeModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Link → transcript. Captions come straight from YouTube (any language the
 * video carries); with none, or for a translation, the audio is pulled down
 * and whisper runs on it locally.
 */
export function YouTubeModal({ open, onClose }: YouTubeModalProps) {
  const tauri = isTauri();
  const [url, setUrl] = useState("");
  const [video, setVideo] = useState<YouTubeVideo | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const [trackUrl, setTrackUrl] = useState("");
  const [lang, setLang] = useState<DictationLang>("auto");
  const [translate, setTranslate] = useState(false);
  const [grouping, setGrouping] = useState<TranscriptGrouping>("sentences");
  const [timestamps, setTimestamps] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [progress, setProgress] = useState<WhisperRouteProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [segments, setSegments] = useState<TimedText[] | null>(null);
  const [source, setSource] = useState<"captions" | "whisper" | null>(null);
  const [saved, setSaved] = useState<SaveOutcome | null>(null);
  const [copied, setCopied] = useState(false);

  const blocks = useMemo(() => (segments ? groupTranscript(segments, grouping) : []), [segments, grouping]);
  const text = useMemo(() => transcriptToText(blocks, timestamps), [blocks, timestamps]);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(id);
  }, [copied]);

  if (!open) return null;

  const track = video?.tracks.find((t) => t.url === trackUrl) ?? null;

  function resetResult() {
    setSegments(null);
    setSource(null);
    setSaved(null);
    setError(null);
  }

  async function lookup() {
    const id = parseYouTubeId(url);
    if (!id) {
      setError("That doesn't look like a YouTube link.");
      return;
    }
    setBusy("lookup");
    setVideo(null);
    setThumb(null);
    resetResult();
    try {
      const found = await lookupVideo(id);
      setVideo(found);
      setTrackUrl(pickCaptionTrack(found.tracks, navigator.languages ?? [])?.url ?? "");
      if (found.thumbnailUrl) void fetchDataUrl(found.thumbnailUrl).then(setThumb);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reach YouTube.");
    } finally {
      setBusy(null);
    }
  }

  async function getCaptions() {
    if (!video || !track) return;
    setBusy("captions");
    resetResult();
    try {
      setSegments(await fetchCaptions(track));
      setSource("captions");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't fetch the captions.");
    } finally {
      setBusy(null);
    }
  }

  async function runWhisper() {
    if (!video) return;
    setBusy("whisper");
    resetResult();
    setProgress(null);
    try {
      const status = await dictationStatus();
      if (!status?.engine || !status?.model) {
        setError("Set up the local speech engine in the dictate tool first.");
        return;
      }
      const result = await transcribeYouTubeAudio(video, lang, translate, setProgress);
      if (!result.length) {
        setError("Whisper heard no speech in this video.");
        return;
      }
      setSegments(result);
      setSource("whisper");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transcription failed.");
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  async function save(ext: "txt" | "srt") {
    if (!blocks.length || !video) return;
    const content = ext === "srt" ? segmentsToSrt(blocks) : text;
    const stem = baseName(video.title || video.id, video.id);
    try {
      setSaved(await saveBlob(new Blob([content], { type: "text/plain" }), `${stem}.${ext}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the file.");
    }
  }

  const progressLabel = !progress
    ? "Starting…"
    : progress.phase === "download"
      ? `Downloading audio… ${formatBytes(progress.loaded)}${progress.total ? ` of ${formatBytes(progress.total)}` : ""}`
      : "Transcribing on this device…";
  const progressValue =
    progress?.phase === "download" && progress.total ? progress.loaded / progress.total : null;

  return (
    <ToolModal
      title="YouTube → transcript"
      subtitle="Captions come from YouTube; whisper runs here when there are none, or to translate."
      onClose={onClose}
      status={<SavedLine outcome={saved} />}
      busy={busy !== null}
      wide
      footer={
        <>
          <button className="btn btn-secondary flex-1" disabled={busy !== null} onClick={onClose}>
            Close
          </button>
          {blocks.length ? (
            <>
              <button
                className="btn btn-secondary flex-1"
                onClick={() => void copyText(text).then(() => setCopied(true))}
              >
                {copied ? "Copied" : "Copy"}
              </button>
              <button className="btn btn-secondary flex-1" onClick={() => void save("txt")}>
                Save .txt
              </button>
              <button className="btn btn-secondary flex-1" onClick={() => void save("srt")}>
                Save .srt
              </button>
            </>
          ) : video && track ? (
            <button className="btn btn-primary flex-1" disabled={busy !== null} onClick={() => void getCaptions()}>
              {busy === "captions" ? "Fetching…" : "Get transcript"}
            </button>
          ) : (
            <button className="btn btn-primary flex-1" disabled={busy !== null || !url.trim()} onClick={() => void lookup()}>
              {busy === "lookup" ? "Looking up…" : "Look up"}
            </button>
          )}
        </>
      }
    >
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void lookup();
        }}
      >
        <input
          className="field h-9 flex-1"
          type="url"
          placeholder="https://www.youtube.com/watch?v=…"
          value={url}
          disabled={busy !== null}
          autoFocus
          onKeyDown={(e) => {
            // Explicit: implicit submission is off once the field is not alone in the form.
            if (e.key === "Enter") {
              e.preventDefault();
              void lookup();
            }
          }}
          onChange={(e) => {
            setUrl(e.target.value);
            if (video) {
              setVideo(null);
              setThumb(null);
              resetResult();
            }
          }}
        />
        {video ? (
          <button type="submit" className="btn btn-secondary shrink-0 px-3 py-1.5 text-xs" disabled={busy !== null}>
            Look up
          </button>
        ) : null}
      </form>

      {video ? (
        <div className="flex items-center gap-3 rounded-[14px] border border-line bg-paper p-2">
          <div className="h-14 w-24 shrink-0 overflow-hidden rounded-[8px] bg-line/60">
            {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : null}
          </div>
          <div className="min-w-0 flex-1 text-xs">
            <p className="truncate font-medium text-ink" title={video.title}>
              {video.title || video.id}
            </p>
            <p className="truncate text-muted">
              {video.author ? `${video.author} · ` : ""}
              {formatDuration(video.lengthSeconds)}
              {" · "}
              {video.tracks.length
                ? `${video.tracks.length} caption track${video.tracks.length === 1 ? "" : "s"}`
                : "no captions"}
            </p>
          </div>
        </div>
      ) : null}

      {video && video.tracks.length ? (
        <ToolRow label="Captions">
          <select
            className="field h-9 w-full"
            value={trackUrl}
            disabled={busy !== null}
            onChange={(e) => {
              setTrackUrl(e.target.value);
              resetResult();
            }}
          >
            {video.tracks.map((t) => (
              <option key={t.url} value={t.url}>
                {t.name}
                {t.auto && !/auto/i.test(t.name) ? " (auto-generated)" : ""}
              </option>
            ))}
          </select>
        </ToolRow>
      ) : null}

      {video ? (
        <div className="rounded-[14px] border border-line p-3">
          <p className="text-sm font-medium text-ink">
            {video.tracks.length ? "Or run whisper on the audio" : "Run whisper on the audio"}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {tauri
              ? `Downloads the audio track (${video.audio?.contentLength ? formatBytes(video.audio.contentLength) : "audio only"}) and transcribes it on this device. The only way to translate.`
              : "Needs the desktop app — the browser preview can only read captions."}
          </p>
          {tauri ? (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <select
                className="field h-9 flex-1"
                value={lang}
                disabled={busy !== null}
                onChange={(e) => setLang(e.target.value as DictationLang)}
              >
                {LANGS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  checked={translate}
                  disabled={busy !== null}
                  onChange={(e) => setTranslate(e.target.checked)}
                />
                Translate to English
              </label>
              {busy === "whisper" ? (
                <button
                  type="button"
                  className="btn btn-secondary px-3 py-1.5 text-xs"
                  onClick={() => void cancelYouTubeAudio(video.id)}
                >
                  Cancel
                </button>
              ) : (
                <button
                  type="button"
                  className={`btn ${video.tracks.length ? "btn-secondary" : "btn-primary"} px-3 py-1.5 text-xs`}
                  disabled={busy !== null || !video.audio}
                  onClick={() => void runWhisper()}
                >
                  Transcribe with whisper
                </button>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {busy === "whisper" ? <ToolProgress value={progressValue} label={progressLabel} /> : null}
      {busy === "lookup" || busy === "captions" ? <ToolProgress value={null} /> : null}

      {error ? <ToolError>{error}</ToolError> : null}

      {segments ? (
        <>
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
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={timestamps} onChange={(e) => setTimestamps(e.target.checked)} />
              Add timestamps
            </label>
          </div>
          <ToolNote>
            {segments.length} cues from {source === "whisper" ? "whisper" : track?.auto ? "YouTube's auto captions" : "YouTube"}
            {" · "}
            {GROUPINGS.find((g) => g.value === grouping)?.hint}
          </ToolNote>
          <TextPreview text={text} />
        </>
      ) : null}
    </ToolModal>
  );
}
