import { notesMarkdown, transcriptMarkdown } from "../lib/transcript";
import type { Meeting } from "../types";

/** The two Markdown files written next to meeting.json, from one place. */
export function meetingMarkdownFiles(meeting: Meeting): { transcript: string; notes: string } {
  return { transcript: transcriptMarkdown(meeting), notes: notesMarkdown(meeting) };
}
