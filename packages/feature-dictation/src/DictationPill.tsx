import { useEffect, useRef, useState } from "react";
import { isTauri } from "@core/env";
import { getDictationLang, transcribeBlob, typeText } from "./engine";

type PillState = "idle" | "listening" | "transcribing" | "error";

async function hideSelf(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().hide();
}

async function positionSelf(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow, LogicalPosition } = await import("@tauri-apps/api/window");
  const x = Math.round((screen.availWidth - 320) / 2);
  const y = Math.max(0, screen.availHeight - 130);
  await getCurrentWindow().setPosition(new LogicalPosition(x, y));
}

/**
 * Tiny always-on-top pill. The global hotkey (Ctrl+Shift+Space) toggles it:
 * first press = start listening, second press = stop → transcribe → type the
 * text into whatever app has focus (this window never takes focus itself).
 */
export function DictationPill() {
  const [state, setState] = useState<PillState>("idle");
  const [message, setMessage] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const stateRef = useRef<PillState>("idle");
  stateRef.current = state;

  useEffect(() => {
    void positionSelf();
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen("dictation-toggle", () => {
        if (stateRef.current === "listening") {
          recorder.current?.stop();
        } else if (stateRef.current === "idle" || stateRef.current === "error") {
          void startListening();
        }
      });
    })();
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startListening() {
    setMessage("");
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = mic;
      const rec = new MediaRecorder(mic);
      recorder.current = rec;
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      rec.onstop = () => {
        mic.getTracks().forEach((t) => t.stop());
        stream.current = null;
        void finish(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
      };
      rec.start(200);
      setState("listening");
    } catch {
      setState("error");
      setMessage("Microphone unavailable");
      window.setTimeout(() => void hideSelf().then(() => setState("idle")), 1600);
    }
  }

  async function finish(blob: Blob) {
    setState("transcribing");
    try {
      const text = (await transcribeBlob(blob, getDictationLang())).trim();
      if (text) await typeText(text.endsWith(" ") ? text : `${text} `);
      setState("idle");
      await hideSelf();
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Transcription failed");
      window.setTimeout(() => {
        setState("idle");
        void hideSelf();
      }, 2600);
    }
  }

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 18px",
          borderRadius: 999,
          background: "rgba(17,17,17,0.92)",
          color: "#fffdfb",
          fontSize: 13,
          fontWeight: 600,
          boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
          maxWidth: 300,
          overflow: "hidden",
          whiteSpace: "nowrap",
        }}
      >
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: 999,
            background:
              state === "listening" ? "#ff5f57" : state === "transcribing" ? "#febc2e" : "#666",
            animation: state === "listening" ? "pill-pulse 1.1s ease-in-out infinite" : undefined,
          }}
        />
        {state === "listening"
          ? "Listening… press Ctrl+Shift+Space to finish"
          : state === "transcribing"
            ? "Transcribing…"
            : state === "error"
              ? message || "Something went wrong"
              : "Ready"}
      </div>
      <style>{`@keyframes pill-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }`}</style>
    </div>
  );
}
