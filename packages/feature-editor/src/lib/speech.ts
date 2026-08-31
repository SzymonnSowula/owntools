import { uid } from "./id";
import type { Caption, SpeechLang } from "../types";

type RecCtor = new () => SpeechRecognition;

export function getSpeechRecognition(): RecCtor | null {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export interface SpeechCapture {
  stop: () => void;
}

export function startSpeechCapture(
  lang: SpeechLang,
  getElapsed: () => number,
  onCaption: (caption: Caption) => void,
): SpeechCapture | null {
  const Ctor = getSpeechRecognition();
  if (!Ctor) return null;

  const rec = new Ctor();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  let stopped = false;

  rec.onresult = (event) => {
    const now = getElapsed();
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (!result.isFinal) continue;
      const text = result[0]?.transcript.trim();
      if (!text) continue;
      const words = text.split(/\s+/).filter(Boolean);
      const dur = Math.max(1.1, words.length * 0.3);
      const start = Math.max(0, now - dur);
      const slice = dur / Math.max(1, words.length);
      onCaption({
        id: uid("cap"),
        start,
        end: now,
        text,
        style: "tiktok",
        words: words.map((word, wi) => ({
          word,
          start: start + wi * slice,
          end: start + (wi + 1) * slice,
        })),
      });
    }
  };

  rec.onend = () => {
    if (!stopped) {
      try {
        rec.start();
      } catch {
        /* ignore restart races */
      }
    }
  };

  try {
    rec.start();
  } catch {
    return null;
  }

  return {
    stop: () => {
      stopped = true;
      try {
        rec.stop();
      } catch {
        rec.abort();
      }
    },
  };
}
