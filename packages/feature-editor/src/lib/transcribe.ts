import { dictationStatus, parseWhisperJson, transcribeBlob } from "@feature-dictation/engine";
import { uid } from "./id";
import { captionsFromTokenJson } from "./whisperWords";
import type { Caption, SpeechLang } from "../types";

export async function whisperReady(): Promise<boolean> {
  try {
    const status = await dictationStatus();
    return Boolean(status?.engine && status?.model);
  } catch {
    return false;
  }
}

export interface TranscribeCaptionsOptions {
  /**
   * Ask whisper for word timing. The Rust command only writes plain `-oj`
   * JSON, but it forwards `maxLen` as `-ml`, and `-ml 1` makes whisper.cpp
   * emit one token per entry with the token's own timestamp — which
   * `lib/whisperWords.ts` joins back into words and cues. Falls back to plain
   * cues when the output does not look token-shaped (an older binary).
   */
  words?: boolean;
}

/**
 * Runs on-device Whisper over the recording's audio and returns captions in
 * source-time coordinates (same clock as the video's currentTime).
 */
export async function transcribeCaptions(
  screenUrl: string,
  lang: SpeechLang,
  options: TranscribeCaptionsOptions = {},
): Promise<Caption[]> {
  const blob = await fetch(screenUrl).then((r) => {
    if (!r.ok) throw new Error("Couldn't load the recording's audio.");
    return r.blob();
  });
  const raw = await transcribeBlob(blob, lang === "pl-PL" ? "pl" : "en", true, false, {
    // A recording carries its own context; the dictation pill's rolling tail
    // would only bias it.
    ignoreSessionContext: true,
    ...(options.words ? { maxLen: 1 } : {}),
  });
  if (options.words) {
    const timed = captionsFromTokenJson(raw);
    if (timed) return timed;
  }
  return parseWhisperJson(raw).map((seg) => ({
    id: uid("cap"),
    start: seg.start,
    end: seg.end,
    text: seg.text,
    style: "subtitle" as const,
  }));
}
