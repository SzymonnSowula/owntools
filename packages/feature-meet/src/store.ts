import { create } from "zustand";
import { logError, logInfo } from "@core/errors";
import { emitToolEvent, MEET_FINISHED_EVENT } from "@core/events";
import { OPEN_TOOL_EVENT } from "@core/handoff";
import { useAppStore } from "@feature-focus/store/useAppStore";
import { createDraft } from "@feature-social/api";
import { backend } from "./api";
import type { SegmentEvent } from "./api/backend";
import { defaultTitle, meetingId } from "./lib/format";
import { createQueue, type Queue } from "./lib/queue";
import { copyText, markdownFilename, saveText } from "./lib/save";
import { summarizeMeeting } from "./lib/summary";
import { insertSegment, meetingMarkdown, summaryMarkdown } from "./lib/transcript";
import { getMeetSettings } from "./settings";
import { SENSITIVITY_DB, type AudioDevices, type EngineInfo, type LiveLine, type Meeting, type MeetingSegment, type Speaker } from "./types";

/**
 * meet's state: the live call (phase, clock, levels, the transcript arriving
 * line by line, notes), the meeting that just finished with its summary, and
 * the list of past meetings. The capture and the files are behind
 * `backend()`; this store only knows what the person is looking at.
 */

export type Phase = "idle" | "starting" | "recording" | "paused" | "stopping" | "finished";

export type SummaryState =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "done" }
  | { kind: "unavailable"; reason?: string }
  | { kind: "empty" }
  | { kind: "error"; message: string };

export interface Notice {
  kind: "ok" | "error";
  text: string;
}

interface LiveSession {
  id: string;
  session: string;
  startedAt: number;
  pausedTotal: number;
  pauseStarted: number | null;
  sources: Speaker[];
  unsubs: (() => void)[];
  queue: Queue<SegmentEvent>;
  timer: ReturnType<typeof setInterval> | null;
  /** The first engine failure is shown; the rest only logged. */
  warned: boolean;
}

interface MeetState {
  phase: Phase;
  liveId: string | null;
  elapsedMs: number;
  levels: { mic: number; system: number };
  lines: LiveLine[];
  pending: number;
  transcribing: boolean;
  notes: string;
  title: string;
  error: string | null;
  engine: EngineInfo | null;
  devices: AudioDevices | null;
  /** The platform cannot capture at all (macOS/Linux for now). */
  unavailable: string | null;

  finished: Meeting | null;
  summary: SummaryState;

  meetings: Meeting[];
  meetingsLoaded: boolean;
  selectedId: string | null;
  audioUrl: string | null;
  query: string;
  notice: Notice | null;

  init(): Promise<void>;
  start(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  reset(): void;
  setNotes(notes: string): void;
  setTitle(title: string): void;

  summarize(meeting?: Meeting): Promise<void>;
  addToFocus(meeting: Meeting): void;
  copySummary(meeting: Meeting): Promise<void>;
  saveMarkdown(meeting: Meeting): Promise<void>;
  postSummary(meeting: Meeting): Promise<void>;
  openFolder(meeting: Meeting): Promise<void>;

  loadMeetings(force?: boolean): Promise<void>;
  openMeeting(id: string): Promise<void>;
  closeMeeting(): void;
  renameMeeting(id: string, title: string): Promise<void>;
  deleteMeeting(id: string): Promise<void>;
  setQuery(query: string): void;
  notify(kind: Notice["kind"], text: string): void;
}

let live: LiveSession | null = null;
let notesTimer: ReturnType<typeof setTimeout> | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function recordingElapsed(s: LiveSession, now = Date.now()): number {
  let ms = now - s.startedAt - s.pausedTotal;
  if (s.pauseStarted !== null) ms -= now - s.pauseStarted;
  return Math.max(0, ms);
}

function toSegments(lines: LiveLine[]): MeetingSegment[] {
  return lines
    .filter((l) => !l.pending && l.text.trim())
    .map(({ source, startMs, endMs, text }) => ({ source, startMs, endMs, text: text.trim() }));
}

function upsert(list: Meeting[], meeting: Meeting): Meeting[] {
  const i = list.findIndex((m) => m.id === meeting.id);
  const next = i >= 0 ? list.map((m) => (m.id === meeting.id ? meeting : m)) : [meeting, ...list];
  return next.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

export const useMeetStore = create<MeetState>()((set, get) => ({
  phase: "idle",
  liveId: null,
  elapsedMs: 0,
  levels: { mic: 0, system: 0 },
  lines: [],
  pending: 0,
  transcribing: false,
  notes: "",
  title: "",
  error: null,
  engine: null,
  devices: null,
  unavailable: null,
  finished: null,
  summary: { kind: "idle" },
  meetings: [],
  meetingsLoaded: false,
  selectedId: null,
  audioUrl: null,
  query: "",
  notice: null,

  async init() {
    const api = backend();
    const [engine, devices] = await Promise.allSettled([api.engine(), api.devices()]);
    if (engine.status === "fulfilled") set({ engine: engine.value });
    if (devices.status === "fulfilled") set({ devices: devices.value, unavailable: null });
    else set({ unavailable: devices.reason instanceof Error ? devices.reason.message : String(devices.reason) });
    void get().loadMeetings();
  },

  async start() {
    if (live || get().phase !== "idle") return;
    const settings = getMeetSettings();
    const sources: Speaker[] = [];
    if (settings.mic) sources.push("mic");
    if (settings.system) sources.push("system");
    if (!sources.length) {
      set({ error: "Turn on the microphone, the system audio, or both." });
      return;
    }
    const api = backend();
    const id = meetingId();
    const session = `meet:${id}`;
    const now = Date.now();
    set({
      phase: "starting",
      error: null,
      lines: [],
      pending: 0,
      transcribing: false,
      levels: { mic: 0, system: 0 },
      elapsedMs: 0,
      finished: null,
      summary: { kind: "idle" },
      title: defaultTitle(now),
      liveId: id,
    });

    const s: LiveSession = {
      id,
      session,
      startedAt: now,
      pausedTotal: 0,
      pauseStarted: null,
      sources,
      unsubs: [],
      timer: null,
      warned: false,
      queue: createQueue<SegmentEvent>(
        async (e) => {
          const key = (l: LiveLine) => l.source === e.source && l.startMs === e.startMs;
          try {
            const text = (await api.transcribe(e.path, getMeetSettings().lang)).trim();
            set((st) => ({
              lines: text
                ? st.lines.map((l) => (key(l) ? { ...l, text, pending: false } : l))
                : st.lines.filter((l) => !key(l)),
            }));
          } catch (err) {
            set((st) => ({ lines: st.lines.filter((l) => !key(l)) }));
            logError("meet", "transcribe", err);
            if (live && !live.warned) {
              live.warned = true;
              get().notify("error", `Transcription failed: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        },
        (pending, active) => set({ pending, transcribing: active }),
      ),
    };
    live = s;

    s.unsubs.push(
      api.onLevel((e) => {
        if (e.session === session) set({ levels: { mic: e.mic, system: e.system } });
      }),
      api.onSegment((e) => {
        if (e.session !== session) return;
        set((st) => ({
          lines: insertSegment(st.lines, { source: e.source, startMs: e.startMs, endMs: e.endMs, text: "", pending: true }),
        }));
        s.queue.push(e);
      }),
      api.onError((e) => {
        if (e.session === session) get().notify("error", e.message);
      }),
    );

    try {
      await api.start({
        session,
        sources,
        micDevice: settings.micDevice || undefined,
        dir: api.meetingDir(id),
        archive: true,
        vad: { thresholdDb: SENSITIVITY_DB[settings.sensitivity] },
      });
    } catch (err) {
      for (const un of s.unsubs) un();
      live = null;
      const message = err instanceof Error ? err.message : String(err);
      logError("meet", "start", err);
      set({ phase: "idle", liveId: null, error: message });
      return;
    }
    s.startedAt = Date.now();
    s.timer = setInterval(() => {
      if (live === s) set({ elapsedMs: recordingElapsed(s) });
    }, 250);
    logInfo("meet", `recording ${id} (${sources.join(" + ")})`);
    set({ phase: "recording" });
  },

  async pause() {
    const s = live;
    if (!s || get().phase !== "recording") return;
    try {
      await backend().pause(s.session);
      s.pauseStarted = Date.now();
      set({ phase: "paused", levels: { mic: 0, system: 0 } });
    } catch (err) {
      get().notify("error", err instanceof Error ? err.message : String(err));
    }
  },

  async resume() {
    const s = live;
    if (!s || get().phase !== "paused") return;
    try {
      await backend().resume(s.session);
      if (s.pauseStarted !== null) {
        s.pausedTotal += Date.now() - s.pauseStarted;
        s.pauseStarted = null;
      }
      set({ phase: "recording" });
    } catch (err) {
      get().notify("error", err instanceof Error ? err.message : String(err));
    }
  },

  async stop() {
    const s = live;
    const phase = get().phase;
    if (!s || (phase !== "recording" && phase !== "paused")) return;
    const api = backend();
    set({ phase: "stopping" });
    if (s.timer) clearInterval(s.timer);
    let durationMs = recordingElapsed(s);
    let wavPath: string | null = null;
    try {
      const result = await api.stop(s.session);
      durationMs = result.durationMs || durationMs;
      wavPath = result.wavPath;
    } catch (err) {
      logError("meet", "stop", err);
      get().notify("error", `Stopping the capture failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    set({ elapsedMs: durationMs, levels: { mic: 0, system: 0 } });
    // The flush of an open stretch of speech may still be in flight as an
    // event; give it a moment before the segment listener goes away.
    await sleep(400);
    await s.queue.idle();
    for (const un of s.unsubs) un();
    live = null;

    const settings = getMeetSettings();
    const st = get();
    const meeting: Meeting = {
      id: s.id,
      title: st.title.trim() || defaultTitle(s.startedAt),
      startedAt: new Date(s.startedAt).toISOString(),
      durationMs,
      sources: s.sources,
      segments: toSegments(st.lines),
      notes: st.notes,
      audio: !!wavPath && settings.keepAudio,
    };
    try {
      await api.writeMeeting(meeting);
      if (wavPath && !settings.keepAudio) await api.removeAudio(meeting.id);
      const dir = await api.absoluteDir(meeting.id);
      emitToolEvent(MEET_FINISHED_EVENT, {
        id: meeting.id,
        dir,
        title: meeting.title,
        durationMs: meeting.durationMs,
        transcriptPath: `${dir}${dir.includes("\\") ? "\\" : "/"}transcript.md`,
      });
      logInfo("meet", `saved ${meeting.id}: ${meeting.segments.length} lines, ${Math.round(durationMs / 1000)} s`);
    } catch (err) {
      logError("meet", "save", err);
      get().notify("error", `The meeting could not be saved: ${err instanceof Error ? err.message : String(err)}`);
    }
    set((state) => ({
      phase: "finished",
      finished: meeting,
      lines: meeting.segments,
      pending: 0,
      transcribing: false,
      meetings: upsert(state.meetings, meeting),
    }));
    void get().summarize(meeting);
  },

  reset() {
    if (live) return;
    set({
      phase: "idle",
      liveId: null,
      elapsedMs: 0,
      levels: { mic: 0, system: 0 },
      lines: [],
      pending: 0,
      transcribing: false,
      notes: "",
      title: "",
      error: null,
      finished: null,
      summary: { kind: "idle" },
    });
  },

  setNotes(notes) {
    set({ notes });
    const finished = get().finished;
    if (finished && get().phase === "finished") {
      const next = { ...finished, notes };
      set((st) => ({ finished: next, meetings: upsert(st.meetings, next) }));
      if (notesTimer) clearTimeout(notesTimer);
      notesTimer = setTimeout(() => {
        void backend().writeMeeting(next).catch((err) => logError("meet", "save notes", err));
      }, 600);
    }
  },

  setTitle(title) {
    set({ title });
    const finished = get().finished;
    if (finished && get().phase === "finished") void get().renameMeeting(finished.id, title);
  },

  async summarize(target) {
    const meeting = target ?? get().finished;
    if (!meeting) return;
    set({ summary: { kind: "working" } });
    const outcome = await summarizeMeeting(meeting);
    if (outcome.kind === "done") {
      const next: Meeting = {
        ...meeting,
        summary: outcome.summary.summary,
        decisions: outcome.summary.decisions,
        actionItems: outcome.summary.actionItems,
      };
      set((st) => ({
        summary: { kind: "done" },
        finished: st.finished?.id === next.id ? next : st.finished,
        meetings: upsert(st.meetings, next),
      }));
      void backend().writeMeeting(next).catch((err) => logError("meet", "save summary", err));
      return;
    }
    set({ summary: outcome });
  },

  addToFocus(meeting) {
    const items = (meeting.actionItems ?? []).map((a) => a.text.trim()).filter(Boolean);
    if (!items.length) {
      get().notify("error", "No action items to add yet.");
      return;
    }
    const add = useAppStore.getState().addTask;
    // Newest-first store: add in reverse so the list reads in meeting order.
    for (const text of [...items].reverse()) add(text, "inbox");
    get().notify("ok", `${items.length} task${items.length === 1 ? "" : "s"} added to focus.`);
    window.dispatchEvent(new CustomEvent(OPEN_TOOL_EVENT, { detail: { tool: "focus" } }));
  },

  async copySummary(meeting) {
    const text = summaryMarkdown(meeting) || meetingMarkdown(meeting);
    const ok = await copyText(text);
    get().notify(ok ? "ok" : "error", ok ? "Summary copied." : "Could not copy to the clipboard.");
  },

  async saveMarkdown(meeting) {
    try {
      const outcome = await saveText(meetingMarkdown(meeting), markdownFilename(meeting.title));
      if (outcome.kind === "saved") get().notify("ok", `Saved to ${outcome.path}`);
      else if (outcome.kind === "downloaded") get().notify("ok", `Downloaded ${outcome.name}`);
    } catch (err) {
      get().notify("error", err instanceof Error ? err.message : String(err));
    }
  },

  async postSummary(meeting) {
    const text = meeting.summary?.trim() || meetingMarkdown(meeting);
    try {
      const result = await createDraft({ text, source: "meet" });
      get().notify("ok", `Draft ${result.status === "draft" ? "created" : result.status} in social.`);
    } catch (err) {
      get().notify("error", err instanceof Error ? err.message : String(err));
    }
  },

  async openFolder(meeting) {
    try {
      await backend().reveal(meeting.id);
    } catch (err) {
      get().notify("error", err instanceof Error ? err.message : String(err));
    }
  },

  async loadMeetings(force) {
    if (get().meetingsLoaded && !force) return;
    try {
      const meetings = await backend().listMeetings();
      set({ meetings, meetingsLoaded: true });
    } catch (err) {
      logError("meet", "list", err);
      set({ meetingsLoaded: true });
    }
  },

  async openMeeting(id) {
    set({ selectedId: id, audioUrl: null });
    try {
      const url = await backend().audioUrl(id);
      if (get().selectedId === id) set({ audioUrl: url });
    } catch (err) {
      logError("meet", "audio", err);
    }
  },

  closeMeeting() {
    set({ selectedId: null, audioUrl: null });
  },

  async renameMeeting(id, title) {
    const meeting = get().meetings.find((m) => m.id === id) ?? (get().finished?.id === id ? get().finished : null);
    if (!meeting) return;
    const next = { ...meeting, title: title.trim() || defaultTitle(meeting.startedAt) };
    set((st) => ({
      meetings: upsert(st.meetings, next),
      finished: st.finished?.id === id ? next : st.finished,
    }));
    try {
      await backend().writeMeeting(next);
    } catch (err) {
      logError("meet", "rename", err);
    }
  },

  async deleteMeeting(id) {
    try {
      await backend().deleteMeeting(id);
    } catch (err) {
      get().notify("error", err instanceof Error ? err.message : String(err));
      return;
    }
    set((st) => ({
      meetings: st.meetings.filter((m) => m.id !== id),
      selectedId: st.selectedId === id ? null : st.selectedId,
      audioUrl: st.selectedId === id ? null : st.audioUrl,
      finished: st.finished?.id === id ? null : st.finished,
      phase: st.finished?.id === id && st.phase === "finished" ? "idle" : st.phase,
    }));
    get().notify("ok", "Meeting deleted.");
  },

  setQuery(query) {
    set({ query });
  },

  notify(kind, text) {
    set({ notice: { kind, text } });
    if (noticeTimer) clearTimeout(noticeTimer);
    // Errors stay until the next action; a confirmation fades.
    if (kind === "ok") noticeTimer = setTimeout(() => set({ notice: null }), 4000);
  },
}));
