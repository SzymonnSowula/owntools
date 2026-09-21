import type { ComponentType } from "react";
import AreDuplicateFilesSafeToDelete from "./posts/are-duplicate-files-safe-to-delete";
import ConvertPdfWithoutUploading from "./posts/convert-pdf-without-uploading";
import DictateOnWindowsWithoutTheCloud from "./posts/dictate-on-windows-without-the-cloud";
import ParakeetVsWhisperCpu from "./posts/parakeet-vs-whisper-cpu";
import ScreenRecordingAutoZoomWindows from "./posts/screen-recording-auto-zoom-windows";
import TranscribeAudioWithoutUploading from "./posts/transcribe-audio-without-uploading";
import WhatYourToolsCostAYear from "./posts/what-your-tools-cost-a-year";

/**
 * slug -> the post's body. Static imports rather than a dynamic one: every
 * post is known at build time and this way a missing file is a type error
 * instead of a 404 somebody finds in production.
 *
 * `blog.test.ts` checks this record against POSTS in lib/blog.ts, so adding a
 * post to one and not the other fails the suite rather than the deploy.
 */
export const BODIES: Record<string, ComponentType> = {
  "dictate-on-windows-without-the-cloud": DictateOnWindowsWithoutTheCloud,
  "transcribe-audio-without-uploading": TranscribeAudioWithoutUploading,
  "screen-recording-auto-zoom-windows": ScreenRecordingAutoZoomWindows,
  "convert-pdf-without-uploading": ConvertPdfWithoutUploading,
  "what-your-tools-cost-a-year": WhatYourToolsCostAYear,
  "are-duplicate-files-safe-to-delete": AreDuplicateFilesSafeToDelete,
  "parakeet-vs-whisper-cpu": ParakeetVsWhisperCpu,
};
