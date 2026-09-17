/**
 * Settings → Storage: what `storage_usage` answers with, and the sums and
 * words the page builds from it. Pure on purpose — which files a Delete button
 * takes, and what the dialog promises about them, is tested here without a
 * disk (storage.test.ts). The measuring and deleting is Rust
 * (`src-tauri/src/storage.rs`).
 */

export interface StorageItem {
  id: string;
  bytes: number;
  /** Epoch ms: when a screenshot was taken; when a recording or a meeting's audio was last written. */
  at: number;
  /** On disk but not listed by its tool: a take that never saved, a PNG the library lost. */
  unlisted?: boolean;
}

/** Every byte owntools keeps is in exactly one group. */
export interface StorageGroups {
  captures: number;
  recordings: number;
  meetings: number;
  speech: number;
  language: number;
  boards: number;
  social: number;
  cache: number;
  downloads: number;
  other: number;
}

export interface StorageUsage {
  /** The app data folder. */
  root: string;
  total: number;
  groups: StorageGroups;
  cache: { temp: number; tempFiles: number; web: number; downloads: number; downloadFiles: number };
  captures: StorageItem[];
  recordings: StorageItem[];
  /** `bytes` is the audio only. */
  meetings: StorageItem[];
}

export interface ClearOutcome {
  freed: number;
  removed: number;
  /** In use or refused — left for next time. */
  kept: number;
}

export interface DeleteOutcome {
  removed: string[];
  freed: number;
  failed: string[];
  /** Being recorded right now. */
  skipped: string[];
}

/** The `kind` of `storage_delete`. */
export type FileKind = "captures" | "recordings" | "meeting-audio";

export type Age = "all" | "7" | "30" | "90";

export const AGE_OPTIONS: readonly { value: Age; label: string }[] = [
  { value: "all", label: "All files" },
  { value: "7", label: "Older than a week" },
  { value: "30", label: "Older than a month" },
  { value: "90", label: "Older than 3 months" },
];

const AGE_WORDS: Record<Exclude<Age, "all">, string> = {
  "7": "a week",
  "30": "a month",
  "90": "3 months",
};

const DAY = 24 * 60 * 60 * 1000;

/** What a Delete button takes under the chosen age. */
export function pickItems(items: readonly StorageItem[], age: Age, now = Date.now()): StorageItem[] {
  if (age === "all") return [...items];
  const cutoff = now - Number(age) * DAY;
  return items.filter((item) => item.at < cutoff);
}

export function sumBytes(items: readonly { bytes: number }[]): number {
  return items.reduce((sum, item) => sum + item.bytes, 0);
}

const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** Binary units under Windows' labels, like the disk tool: 512 B, 1.5 KB, 820 MB, 2.4 GB. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = value >= 100 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
  return `${text} ${UNITS[unit]}`;
}

/** "38%", "<1%" — a row's share of everything, for the bar's label. */
export function shareLabel(bytes: number, total: number): string {
  if (total <= 0 || bytes <= 0) return "0%";
  const pct = (bytes / total) * 100;
  return pct < 1 ? "<1%" : `${Math.round(pct)}%`;
}

/**
 * The rows of the page, in bytes. What a file group holds besides the files
 * the page can delete — a meeting's transcript, the capture index, a take
 * still being recorded — is counted with everything else, so the rows always
 * add up to the total.
 */
export interface SpaceRows {
  captures: number;
  recordings: number;
  meetingAudio: number;
  cache: number;
  downloads: number;
  speech: number;
  language: number;
  boardsAndPosts: number;
  other: number;
}

export function spaceRows(usage: StorageUsage): SpaceRows {
  const g = usage.groups;
  const captures = sumBytes(usage.captures);
  const recordings = sumBytes(usage.recordings);
  const meetingAudio = sumBytes(usage.meetings);
  const rest =
    Math.max(0, g.captures - captures) + Math.max(0, g.recordings - recordings) + Math.max(0, g.meetings - meetingAudio);
  return {
    captures,
    recordings,
    meetingAudio,
    cache: g.cache,
    downloads: g.downloads,
    speech: g.speech,
    language: g.language,
    boardsAndPosts: g.boards + g.social,
    other: g.other + rest,
  };
}

const NOUN: Record<FileKind, readonly [one: string, many: string]> = {
  captures: ["screenshot", "screenshots"],
  recordings: ["recording", "recordings"],
  "meeting-audio": ["meeting", "meetings"],
};

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

export function countOf(kind: FileKind, n: number): string {
  return plural(n, ...NOUN[kind]);
}

/** The line under a file row: how many the button would take, and what never goes with them. */
export function fileHint(kind: FileKind, picked: readonly StorageItem[], all: readonly StorageItem[], age: Age): string {
  if (all.length === 0) {
    return kind === "captures"
      ? "Nothing in the capture library."
      : kind === "recordings"
        ? "No recordings yet."
        : "No meeting audio is kept.";
  }
  if (age !== "all" && picked.length === 0) return `Nothing older than ${AGE_WORDS[age]}.`;
  const which =
    age === "all" ? countOf(kind, picked.length) : `${picked.length.toLocaleString("en-US")} of ${countOf(kind, all.length)}`;
  switch (kind) {
    case "captures":
      return `${which} in the capture library.`;
    case "recordings":
      return `${which} with their edits. Exported videos stay.`;
    case "meeting-audio":
      return `The audio of ${which}. Transcripts and notes stay.`;
  }
}

export interface Confirmation {
  title: string;
  message: string;
  okLabel: string;
}

/** The dialog before a file row's Delete: exactly what goes, and what stays. */
export function confirmDelete(kind: FileKind, picked: readonly StorageItem[], age: Age): Confirmation {
  const n = picked.length;
  const size = formatBytes(sumBytes(picked));
  const older = age === "all" ? "" : ` older than ${AGE_WORDS[age]}`;
  const unlisted = picked.filter((item) => item.unlisted).length;
  switch (kind) {
    case "captures":
      return {
        title: `Delete ${countOf(kind, n)}${older}?`,
        message:
          `${size}, for good. Copies you saved to Pictures stay where they are.` +
          (unlisted ? ` Includes ${plural(unlisted, "screenshot", "screenshots")} the library had lost track of.` : ""),
        okLabel: "Delete",
      };
    case "recordings":
      return {
        title: `Delete ${countOf(kind, n)}${older}?`,
        message:
          `${size} of takes and their edits, for good. Videos you exported stay where you saved them, and share links keep working until they expire.` +
          (unlisted ? ` Includes ${plural(unlisted, "take", "takes")} that never finished saving.` : ""),
        okLabel: "Delete",
      };
    case "meeting-audio":
      return {
        title: `Delete the audio of ${countOf(kind, n)}${older}?`,
        message:
          `${size}, for good. Their transcripts, summaries and notes stay.` +
          (unlisted ? ` ${plural(unlisted, "meeting", "meetings")} never finished saving and ${unlisted === 1 ? "has" : "have"} nothing else, so ${unlisted === 1 ? "it goes" : "they go"} completely.` : ""),
        okLabel: "Delete audio",
      };
  }
}

export function confirmDownloads(usage: StorageUsage): Confirmation {
  return {
    title: "Delete unfinished downloads?",
    message: `${formatBytes(usage.cache.downloads)} of paused or failed downloads. Each one starts from the beginning the next time you install it.`,
    okLabel: "Delete",
  };
}

/** What a file row's Delete did, in one line. */
export function deleteNote(kind: FileKind, outcome: DeleteOutcome): string {
  const parts: string[] = [];
  const n = outcome.removed.length;
  if (n > 0) {
    const what = kind === "meeting-audio" ? `the audio of ${countOf(kind, n)}` : countOf(kind, n);
    parts.push(`Deleted ${what} · ${formatBytes(outcome.freed)} freed.`);
  }
  if (outcome.failed.length) {
    const f = outcome.failed.length;
    parts.push(`${f} could not be deleted - a file may be open in another app.`);
  }
  if (outcome.skipped.length) {
    const s = outcome.skipped.length;
    parts.push(`${s} ${s === 1 ? "is" : "are"} being recorded and ${s === 1 ? "was" : "were"} left alone.`);
  }
  return parts.join(" ") || "Nothing to delete.";
}

/** What "Clear cache" or "Delete unfinished downloads" did. */
export function clearNote(what: "cache" | "downloads", outcome: ClearOutcome): string {
  if (outcome.freed === 0 && outcome.removed === 0 && outcome.kept === 0) {
    return what === "cache" ? "The cache was already empty." : "There were no unfinished downloads.";
  }
  const done = what === "cache" ? `Cleared ${formatBytes(outcome.freed)}.` : `Deleted ${formatBytes(outcome.freed)} of unfinished downloads.`;
  if (!outcome.kept) return done;
  const busy = outcome.kept === 1 ? "1 file is in use and stays" : `${outcome.kept.toLocaleString("en-US")} files are in use and stay`;
  return `${done} ${busy} for now.`;
}

export function cacheHint(usage: StorageUsage): string {
  const web = usage.cache.web > 0 ? " and the web view's cache" : "";
  return `Scratch audio, unfinished screenshots, leftovers of interrupted jobs${web}.`;
}

export function downloadsHint(usage: StorageUsage): string {
  const n = usage.cache.downloadFiles;
  if (n === 0) return "None right now.";
  return `${plural(n, "file", "files")} from paused or failed model downloads. Each starts over next time.`;
}
