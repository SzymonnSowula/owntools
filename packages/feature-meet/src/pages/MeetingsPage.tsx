import { confirmDialog } from "@ui/Dialog";
import { ArrowLeft, Headphones, Pencil, Search, Trash2, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Empty, PageHead } from "../components";
import { dayLabel, firstLine, formatDuration, timeLabel } from "../lib/format";
import { meetingMatches } from "../lib/transcript";
import { useMeetStore, type SummaryState } from "../store";
import type { Meeting } from "../types";
import { TranscriptLine } from "./LivePage";
import { SummaryPanel } from "./SummaryPanel";

/**
 * Every call recorded on this machine, by day, searchable across titles,
 * transcripts, notes and summaries. Opening one shows the summary panel,
 * the notes and the transcript over the archived audio - click a line to
 * hear that moment.
 */
export function MeetingsPage({ onLive }: { onLive: () => void }) {
  const meetings = useMeetStore((s) => s.meetings);
  const loaded = useMeetStore((s) => s.meetingsLoaded);
  const selectedId = useMeetStore((s) => s.selectedId);
  const query = useMeetStore((s) => s.query);
  const { loadMeetings, openMeeting, setQuery } = useMeetStore.getState();

  useEffect(() => {
    void loadMeetings();
  }, [loadMeetings]);

  const selected = selectedId ? meetings.find((m) => m.id === selectedId) ?? null : null;
  if (selected) return <MeetingDetail meeting={selected} />;

  const shown = meetings.filter((m) => meetingMatches(m, query));
  const groups = groupByDay(shown);

  return (
    <div className="mt-page">
      <PageHead
        title="meetings"
        sub={`${meetings.length} recorded on this device. Each one is a folder with the audio, the transcript and your notes - open it any time.`}
        actions={
          <div className="mt-search">
            <Search />
            <input className="mt-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search titles, transcripts, notes" aria-label="Search meetings" />
          </div>
        }
      />
      {!loaded ? null : meetings.length === 0 ? (
        <Card flush>
          <Empty icon={<Users />} title="No meetings yet" text="Start a recording on the Live page; it lands here when you stop.">
            <div className="mt-chips">
              <button type="button" className="mt-chip" onClick={onLive}>
                Go to Live
              </button>
            </div>
          </Empty>
        </Card>
      ) : shown.length === 0 ? (
        <Card flush>
          <Empty icon={<Search />} title="Nothing matches" text={`No meeting mentions "${query.trim()}".`} />
        </Card>
      ) : (
        <Card flush>
          {groups.map((g) => (
            <div key={g.label}>
              <div className="mt-day">{g.label}</div>
              {g.meetings.map((m) => (
                <MeetingRow key={m.id} meeting={m} onOpen={() => void openMeeting(m.id)} />
              ))}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function groupByDay(list: Meeting[]): { label: string; meetings: Meeting[] }[] {
  const out: { label: string; meetings: Meeting[] }[] = [];
  for (const m of list) {
    const label = dayLabel(m.startedAt);
    const last = out[out.length - 1];
    if (last && last.label === label) last.meetings.push(m);
    else out.push({ label, meetings: [m] });
  }
  return out;
}

function MeetingRow({ meeting, onOpen }: { meeting: Meeting; onOpen: () => void }) {
  const { renameMeeting, deleteMeeting } = useMeetStore.getState();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(meeting.title);
  const summary = firstLine(meeting.summary);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== meeting.title) void renameMeeting(meeting.id, draft);
    else setDraft(meeting.title);
  };

  async function remove() {
    const ok = await confirmDialog({
      title: "Delete this meeting?",
      message: `"${meeting.title}" - the audio, the transcript and the notes are removed from this device. This cannot be undone.`,
      okLabel: "Delete",
      kind: "danger",
    });
    if (ok) await deleteMeeting(meeting.id);
  }

  return (
    <div className="mt-meeting">
      {editing ? (
        <input
          className="mt-input mt-meeting-edit"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(meeting.title);
              setEditing(false);
            }
          }}
          aria-label="Meeting title"
        />
      ) : (
        <button type="button" className="mt-meeting-main" onClick={onOpen}>
          <div className="mt-meeting-title">{meeting.title}</div>
          <div className="mt-meeting-sub">
            {timeLabel(meeting.startedAt)} · {formatDuration(meeting.durationMs)} · {meeting.segments.length} lines
            {summary ? <span className="mt-meeting-summary"> · {summary}</span> : <span className="mt-meeting-summary faint"> · no summary</span>}
          </div>
        </button>
      )}
      <div className="mt-meeting-actions">
        <button type="button" className="mt-icon-btn" onClick={() => setEditing(true)} title="Rename" aria-label="Rename">
          <Pencil />
        </button>
        <button type="button" className="mt-icon-btn danger" onClick={() => void remove()} title="Delete" aria-label="Delete">
          <Trash2 />
        </button>
      </div>
    </div>
  );
}

function MeetingDetail({ meeting }: { meeting: Meeting }) {
  const audioUrl = useMeetStore((s) => s.audioUrl);
  const { closeMeeting, deleteMeeting } = useMeetStore.getState();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [positionMs, setPositionMs] = useState(0);
  const [playing, setPlaying] = useState(false);

  // The panel's summary state is derived here: an old meeting either has
  // one or offers to make one; the Live page's in-flight state does not apply.
  const summary: SummaryState = useMemo(() => (meeting.summary ? { kind: "done" } : { kind: "idle" }), [meeting.summary]);

  const activeIndex = useMemo(() => {
    if (!playing && positionMs === 0) return -1;
    let idx = -1;
    for (let i = 0; i < meeting.segments.length; i += 1) {
      if (meeting.segments[i].startMs <= positionMs) idx = i;
    }
    return idx;
  }, [meeting.segments, positionMs, playing]);

  const seek = (ms: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = ms / 1000;
    void el.play().catch(() => undefined);
  };

  async function remove() {
    const ok = await confirmDialog({
      title: "Delete this meeting?",
      message: `"${meeting.title}" - the audio, the transcript and the notes are removed from this device. This cannot be undone.`,
      okLabel: "Delete",
      kind: "danger",
    });
    if (ok) await deleteMeeting(meeting.id);
  }

  return (
    <div className="mt-page">
      <div className="mt-back-row">
        <button type="button" className="mt-btn ghost" onClick={closeMeeting}>
          <ArrowLeft /> All meetings
        </button>
        <button type="button" className="mt-btn ghost danger" onClick={() => void remove()}>
          <Trash2 /> Delete
        </button>
      </div>

      <SummaryPanel meeting={meeting} summary={summary} />

      <Card title="Playback" desc={meeting.audio === false ? "The audio was not kept for this meeting." : "Left channel is you, right channel is them. Click a transcript line to jump there."} className="mt-player-card">
        {meeting.audio === false ? (
          <div className="mt-note">Only the transcript and the notes were saved.</div>
        ) : audioUrl ? (
          <audio
            ref={audioRef}
            className="mt-audio"
            controls
            preload="metadata"
            src={audioUrl}
            onTimeUpdate={(e) => setPositionMs(e.currentTarget.currentTime * 1000)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        ) : (
          <div className="mt-note">
            <Headphones className="mt-inline-icon" /> Loading the audio…
          </div>
        )}
      </Card>

      <div className="mt-split">
        <Card title="Transcript" action={<span className="mt-status">{meeting.segments.length} lines</span>} flush className="mt-transcript-card">
          {meeting.segments.length ? (
            <div className="mt-transcript tall">
              {meeting.segments.map((line, i) => (
                <TranscriptLine
                  key={`${line.source}-${line.startMs}`}
                  line={line}
                  active={i === activeIndex}
                  onClick={meeting.audio === false ? undefined : () => seek(line.startMs)}
                />
              ))}
            </div>
          ) : (
            <div className="mt-transcript-empty">
              <Users />
              <div>No speech was transcribed in this call.</div>
            </div>
          )}
        </Card>
        <Card title="Your notes" className="mt-notes-card">
          {meeting.notes.trim() ? <pre className="mt-notes-read">{meeting.notes}</pre> : <div className="mt-note">No notes were taken.</div>}
        </Card>
      </div>
    </div>
  );
}
