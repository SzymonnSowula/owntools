import { useEffect, useRef, useState } from "react";
import {
  createDictationRecorder,
  dictate,
  dictationReady,
  dictationStatus,
  openDictationMic,
} from "@feature-dictation/engine";
import { isTauri } from "../../lib/env";
import type { DictationCommand, SpeechLang } from "../../types";

interface Props {
  /**
   * Kept for callers; whisper picks its language from the dictate tool's own
   * settings (auto / en / pl), so this no longer steers recognition.
   */
  lang: SpeechLang;
  onFinal: (text: string, command: DictationCommand | null) => void;
  onInterim?: (text: string) => void;
}

type Phase = "idle" | "recording" | "transcribing";

/**
 * Press to record, press again to transcribe — the same on-device Whisper path
 * as the dictation pill and voice notes, so speech never leaves this computer.
 * (The old Web Speech API version didn't work in WebView2 at all.)
 */
export function DictationButton({ onFinal, onInterim }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelledRef = useRef(false);
  const onFinalRef = useRef(onFinal);
  const onInterimRef = useRef(onInterim);
  onFinalRef.current = onFinal;
  onInterimRef.current = onInterim;

  // A take in progress dies with the page; a transcription in flight still
  // lands in the store (onFinal is a store action), so we let it finish.
  useEffect(
    () => () => {
      cancelledRef.current = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    },
    [],
  );

  const start = async () => {
    setError("");
    if (!isTauri()) {
      setError("Dictation works in the desktop app.");
      return;
    }
    let status = null;
    try {
      status = await dictationStatus();
    } catch {
      status = null;
    }
    if (!dictationReady(status)) {
      setError("Set up dictation in the dictate tool first.");
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
      setError("Microphone unavailable — check the permission and try again.");
    }
  };

  const finish = async (blob: Blob) => {
    setPhase("transcribing");
    onInterimRef.current?.("Transcribing…");
    try {
      const text = await dictate(blob);
      if (text) onFinalRef.current(text, null);
      else setError("Nothing was heard — try again a little closer to the mic.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transcription failed.");
    } finally {
      onInterimRef.current?.("");
      setPhase("idle");
    }
  };

  const live = phase === "recording";

  return (
    <div className="dictate-wrap">
      <button
        type="button"
        className={`pill dictate${live ? " live" : ""}`}
        disabled={phase === "transcribing"}
        onClick={() => {
          if (live) recorderRef.current?.stop();
          else if (phase === "idle") void start();
        }}
        aria-pressed={live}
      >
        <span className={`pulse${live ? " on" : ""}`} />
        {live ? "Listening…" : phase === "transcribing" ? "Transcribing…" : "Dictate"}
      </button>
      {error && <p className="dictate-error">{error}</p>}
    </div>
  );
}
