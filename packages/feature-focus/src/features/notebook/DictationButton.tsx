import { useEffect, useRef, useState } from "react";
import type { SpeechLang } from "../../types";
import {
  classifyUtterance,
  createRecognizer,
  errorMessage,
  speechSupported,
  type DictationCommand,
  type SpeechStatus,
} from "../../lib/speech";

interface Props {
  lang: SpeechLang;
  onFinal: (text: string, command: DictationCommand | null) => void;
  onInterim?: (text: string) => void;
}

export function DictationButton({ lang, onFinal, onInterim }: Props) {
  const [status, setStatus] = useState<SpeechStatus>(speechSupported() ? "idle" : "unsupported");
  const [error, setError] = useState("");
  const recRef = useRef<SpeechRecognition | null>(null);
  const onFinalRef = useRef(onFinal);
  const onInterimRef = useRef(onInterim);
  onFinalRef.current = onFinal;
  onInterimRef.current = onInterim;

  useEffect(() => () => recRef.current?.abort(), []);

  const stop = () => {
    recRef.current?.stop();
    recRef.current = null;
    setStatus(speechSupported() ? "idle" : "unsupported");
  };

  const start = () => {
    setError("");
    if (!speechSupported()) {
      setStatus("unsupported");
      setError(errorMessage("unsupported"));
      return;
    }
    const rec = createRecognizer(lang);
    if (!rec) {
      setStatus("unsupported");
      setError(errorMessage("unsupported"));
      return;
    }
    rec.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const chunk = ev.results[i][0]?.transcript ?? "";
        if (ev.results[i].isFinal) {
          const { text, command } = classifyUtterance(chunk);
          if (command === "stop") {
            onFinalRef.current("", "stop");
            stop();
            return;
          }
          onFinalRef.current(text, command);
          onInterimRef.current?.("");
        } else {
          interim += chunk;
        }
      }
      if (interim) onInterimRef.current?.(interim);
    };
    rec.onerror = (ev) => {
      setStatus("error");
      setError(errorMessage(ev.error));
      recRef.current = null;
    };
    rec.onend = () => {
      if (recRef.current === rec) {
        try {
          rec.start();
        } catch {
          recRef.current = null;
          setStatus(speechSupported() ? "idle" : "unsupported");
        }
      }
    };
    try {
      rec.start();
      recRef.current = rec;
      setStatus("listening");
    } catch {
      setStatus("error");
      setError(errorMessage("audio-capture"));
    }
  };

  return (
    <div className="dictate-wrap">
      <button
        type="button"
        className={`pill dictate${status === "listening" ? " live" : ""}`}
        onClick={() => (status === "listening" ? stop() : start())}
        aria-pressed={status === "listening"}
      >
        <span className={`pulse${status === "listening" ? " on" : ""}`} />
        {status === "listening" ? "Listening…" : "Dictate"}
      </button>
      {status === "unsupported" && (
        <span className="faint" style={{ fontSize: 11 }}>
          No Web Speech
        </span>
      )}
      {error && <p className="dictate-error">{error}</p>}
    </div>
  );
}
