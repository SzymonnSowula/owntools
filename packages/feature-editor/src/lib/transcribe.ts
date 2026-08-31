import { dictationStatus, parseWhisperJson, transcribeBlob } from "@feature-dictation/engine";
import { uid } from "./id";
import type { Caption, SpeechLang } from "../types";

export async function whisperReady(): Promise<boolean> {
  try {
    const status = await dictationStatus();
    return Boolean(status?.engine && status?.model);
  } catch {
    return false;
  }
}

/**
 * Runs on-device Whisper over the recording's audio and returns captions in
 * source-time coordinates (same clock as the video's currentTime).
 */
export async function transcribeCaptions(
  screenUrl: string,
  lang: SpeechLang,
): Promise<Caption[]> {
  const blob = await fetch(screenUrl).then((r) => {
    if (!r.ok) throw new Error("Couldn't load the recording's audio.");
    return r.blob();
  });
  const raw = await transcribeBlob(blob, lang === "pl-PL" ? "pl" : "en", true);
  return parseWhisperJson(raw).map((seg) => ({
    id: uid("cap"),
    start: seg.start,
    end: seg.end,
    text: seg.text,
    style: "subtitle" as const,
  }));
}
