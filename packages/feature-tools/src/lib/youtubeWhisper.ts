import { isTauri } from "@core/env";
import {
  parseWhisperJson,
  transcribeBlob,
  type DictationLang,
  type WhisperSegment,
} from "@feature-dictation/engine";
import type { YouTubeVideo } from "./youtube";

/**
 * The whisper route for YouTube: the audio-only stream comes down through the
 * Rust downloader (streamed to disk, progress events, resumable) and the local
 * engine transcribes — or translates to English — the file. This is the only
 * way to a transcript when a video has no captions, and the only translation
 * path at all (see youtube.ts). Desktop app only.
 */

export interface WhisperRouteProgress {
  phase: "download" | "transcribe";
  loaded: number;
  total: number;
}

interface DownloadProgressPayload {
  id: string;
  loaded: number;
  total: number;
}

const DEST_DIR = "tools/youtube";
/** Past this, decoding the take to PCM in the webview gets uncomfortable. */
export const WHISPER_ROUTE_MAX_SECONDS = 3 * 3600;

export function whisperRouteId(videoId: string): string {
  return `yt-audio-${videoId}`;
}

export async function transcribeYouTubeAudio(
  video: YouTubeVideo,
  lang: DictationLang,
  translate: boolean,
  onProgress: (p: WhisperRouteProgress) => void,
): Promise<WhisperSegment[]> {
  if (!isTauri()) throw new Error("Whisper needs the desktop app.");
  const audio = video.audio;
  if (!audio) throw new Error("YouTube offers no audio-only stream for this video.");
  if (video.lengthSeconds > WHISPER_ROUTE_MAX_SECONDS) {
    throw new Error("That is over three hours — too long to transcribe in one go here.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const { readFile, remove, BaseDirectory } = await import("@tauri-apps/plugin-fs");

  const id = whisperRouteId(video.id);
  const dest = `${DEST_DIR}/${video.id}.${audio.ext}`;
  const unlisten = await listen<DownloadProgressPayload>("download-progress", (event) => {
    if (event.payload.id !== id) return;
    onProgress({
      phase: "download",
      loaded: event.payload.loaded,
      total: event.payload.total || audio.contentLength || 0,
    });
  });
  try {
    await invoke<string>("download_file", {
      request: {
        id,
        url: audio.url,
        dest,
        expectedSize: audio.contentLength ?? undefined,
      },
    });
  } catch (err) {
    if (err === "cancelled") throw new Error("Cancelled.");
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    unlisten();
  }

  onProgress({ phase: "transcribe", loaded: 0, total: 0 });
  try {
    const bytes = await readFile(dest, { baseDir: BaseDirectory.AppData });
    const blob = new Blob([bytes as BlobPart], { type: audio.mimeType.split(";")[0] });
    const raw = await transcribeBlob(blob, lang, true, translate, { ignoreSessionContext: true });
    return parseWhisperJson(raw);
  } finally {
    void remove(dest, { baseDir: BaseDirectory.AppData }).catch(() => undefined);
  }
}

/** Stops the download half; the partial file stays for a later resume. */
export async function cancelYouTubeAudio(videoId: string): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("download_cancel", { id: whisperRouteId(videoId) }).catch(() => undefined);
}
