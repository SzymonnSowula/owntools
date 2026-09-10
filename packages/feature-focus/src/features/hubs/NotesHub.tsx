import { useEffect, useRef, useState } from "react";
import {
  createDictationRecorder,
  dictate,
  dictationReady,
  dictationStatus,
  openDictationMic,
} from "@feature-dictation/engine";
import { useAppStore } from "../../store/useAppStore";
import { createBlock } from "../../lib/notebook";
import { NotebookView } from "../notebook/NotebookView";
import { NotesView } from "../notes/NotesView";
import { JournalView } from "../journal/JournalView";
import { HubTabs, useHubTab, type HubTabDef } from "./HubTabs";

type Tab = "pages" | "board" | "journal";

const TABS: readonly HubTabDef<Tab>[] = [
  { id: "pages", label: "Pages" },
  { id: "board", label: "Board" },
  { id: "journal", label: "Journal" },
];

type VoicePhase = "idle" | "recording" | "transcribing";

function voiceNoteTitle(): string {
  const stamp = new Date().toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `Voice note — ${stamp}`;
}

function VoiceNoteButton({ onSaved }: { onSaved: () => void }) {
  const createNotebookPage = useAppStore((s) => s.createNotebookPage);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelledRef = useRef(false);

  // Abort a recording in flight if the hub unmounts mid-take.
  useEffect(
    () => () => {
      cancelledRef.current = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    },
    [],
  );

  const start = async () => {
    setMessage("");
    setIsError(false);
    let status = null;
    try {
      status = await dictationStatus();
    } catch {
      status = null;
    }
    if (!dictationReady(status)) {
      setMessage("Voice notes need the dictation engine — set it up in the dictate tool.");
      return;
    }
    try {
      const mic = await openDictationMic();
      streamRef.current = mic;
      const rec = createDictationRecorder(mic);
      recorderRef.current = rec;
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      rec.onstop = () => {
        mic.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        recorderRef.current = null;
        if (cancelledRef.current) return;
        void finish(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
      };
      rec.start(200);
      setPhase("recording");
    } catch {
      setIsError(true);
      setMessage("Microphone unavailable — check the permission and try again.");
    }
  };

  const finish = async (blob: Blob) => {
    setPhase("transcribing");
    try {
      const text = await dictate(blob);
      if (!text) {
        setIsError(false);
        setMessage("Nothing was heard — try again a little closer to the mic.");
        setPhase("idle");
        return;
      }
      const blocks = text
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => createBlock("paragraph", { text: line }));
      createNotebookPage(voiceNoteTitle(), null, blocks);
      setPhase("idle");
      onSaved();
    } catch (err) {
      setIsError(true);
      setMessage(err instanceof Error ? err.message : "Transcription failed.");
      setPhase("idle");
    }
  };

  return (
    <div className="hub-voice">
      {message && <span className={`hub-voice-msg${isError ? " error" : ""}`}>{message}</span>}
      <button
        type="button"
        className={`hub-voice-btn${phase === "recording" ? " live" : ""}`}
        disabled={phase === "transcribing"}
        onClick={() => {
          if (phase === "recording") recorderRef.current?.stop();
          else if (phase === "idle") void start();
        }}
      >
        {phase === "recording" ? (
          <>
            <span className="hub-voice-dot" />
            Stop &amp; save
          </>
        ) : phase === "transcribing" ? (
          "Transcribing…"
        ) : (
          <>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="5" y="1.5" width="4" height="7" rx="2" />
              <path d="M3 6.5a4 4 0 008 0M7 10.5v2M5 12.5h4" />
            </svg>
            Voice note
          </>
        )}
      </button>
    </div>
  );
}

export function NotesHub() {
  const [tab, setTab] = useHubTab<Tab>("owntools-hub-notes", ["pages", "board", "journal"]);
  return (
    <>
      <HubTabs
        tabs={TABS}
        active={tab}
        onSelect={setTab}
        right={<VoiceNoteButton onSaved={() => setTab("pages")} />}
      />
      {tab === "board" ? <NotesView /> : tab === "journal" ? <JournalView /> : <NotebookView />}
    </>
  );
}
