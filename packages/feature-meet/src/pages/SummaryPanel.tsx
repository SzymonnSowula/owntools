import { openIntelligenceSettings } from "@core/llm";
import { AlertTriangle, Copy, Download, FolderOpen, ListTodo, Loader2, Plus, RotateCcw, Send, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { dateLabel, formatDuration, wordCount } from "../lib/format";
import { useMeetStore, type SummaryState } from "../store";
import type { Meeting } from "../types";

/**
 * What a finished meeting looks like: its name, the summary / decisions /
 * to-dos when a model made them (or the one honest line when there is no
 * model), and the five things you can do with it. Shared by the Live page
 * (right after Stop) and the Meetings page (opening an old one).
 */
export function SummaryPanel({
  meeting,
  summary,
  onNew,
}: {
  meeting: Meeting;
  summary: SummaryState;
  /** Present right after a call: "New call" resets the Live page. */
  onNew?: () => void;
}) {
  const { renameMeeting, summarize, addToFocus, copySummary, saveMarkdown, postSummary, openFolder } = useMeetStore.getState();
  const [title, setTitle] = useState(meeting.title);
  useEffect(() => setTitle(meeting.title), [meeting.id, meeting.title]);

  const words = meeting.segments.reduce((n, s) => n + wordCount(s.text), 0);
  const hasSummary = !!meeting.summary || !!meeting.decisions?.length || !!meeting.actionItems?.length;
  const items = meeting.actionItems ?? [];

  const commit = () => {
    const next = title.trim();
    if (next && next !== meeting.title) void renameMeeting(meeting.id, next);
    else setTitle(meeting.title);
  };

  return (
    <section className="mt-card mt-summary">
      <div className="mt-summary-head">
        <div className="mt-summary-name">
          <input
            className="mt-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setTitle(meeting.title);
            }}
            aria-label="Meeting title"
            spellCheck={false}
          />
          <div className="mt-summary-meta">
            {dateLabel(meeting.startedAt)} · {formatDuration(meeting.durationMs)} · {meeting.segments.length} lines · {words} words
            {meeting.audio === false ? " · audio not kept" : ""}
          </div>
        </div>
        {onNew ? (
          <button type="button" className="mt-btn" onClick={onNew}>
            <Plus /> New call
          </button>
        ) : null}
      </div>

      <div className="mt-summary-body">
        {summary.kind === "working" ? (
          <div className="mt-working">
            <Loader2 className="mt-spin" /> Summarising the call…
          </div>
        ) : hasSummary ? (
          <>
            {meeting.summary ? <p className="mt-summary-text">{meeting.summary}</p> : null}
            {meeting.decisions?.length ? (
              <div className="mt-block">
                <div className="mt-block-title">Decisions</div>
                <ul className="mt-list">
                  {meeting.decisions.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {items.length ? (
              <div className="mt-block">
                <div className="mt-block-title">Action items</div>
                <ul className="mt-list mt-todos">
                  {items.map((a, i) => (
                    <li key={i}>
                      <span className="mt-todo-box" aria-hidden />
                      <span>{a.text}</span>
                      {a.owner ? <span className={`mt-owner ${a.owner}`}>{a.owner}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : summary.kind === "unavailable" || summary.kind === "idle" ? (
          <div className="mt-nomodel">
            <Sparkles />
            <div>
              The transcript and your notes are saved.{" "}
              <button type="button" className="mt-link" onClick={openIntelligenceSettings}>
                Add a language model in Settings → Intelligence
              </button>{" "}
              to get a summary, the decisions and the to-dos - on this device or through your own key.
            </div>
          </div>
        ) : summary.kind === "empty" ? (
          <div className="mt-nomodel">
            <Sparkles />
            <div>Nothing was transcribed and no notes were taken, so there is nothing to summarise.</div>
          </div>
        ) : (
          <div className="mt-alert error">
            <AlertTriangle />
            <div>
              The summary did not come back: {summary.kind === "error" ? summary.message : "the model answered with nothing"}{" "}
              <button type="button" className="mt-link" onClick={() => void summarize(meeting)}>
                <RotateCcw /> Try again
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-actions">
        <button type="button" className="mt-btn primary" onClick={() => addToFocus(meeting)} disabled={!items.length} title={items.length ? "One task per action item" : "No action items yet"}>
          <ListTodo /> Add to focus
        </button>
        <button type="button" className="mt-btn" onClick={() => void copySummary(meeting)}>
          <Copy /> Copy summary
        </button>
        <button type="button" className="mt-btn" onClick={() => void saveMarkdown(meeting)}>
          <Download /> Save Markdown
        </button>
        <button type="button" className="mt-btn" onClick={() => void postSummary(meeting)}>
          <Send /> Post summary
        </button>
        <button type="button" className="mt-btn ghost" onClick={() => void openFolder(meeting)}>
          <FolderOpen /> Open folder
        </button>
      </div>
    </section>
  );
}
