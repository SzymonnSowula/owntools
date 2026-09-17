import { describe, expect, it } from "vitest";
import {
  clearNote,
  confirmDelete,
  deleteNote,
  fileHint,
  formatBytes,
  pickItems,
  shareLabel,
  spaceRows,
  sumBytes,
  type StorageItem,
  type StorageUsage,
} from "./storage";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 15, 12);
const MB = 1024 * 1024;

const item = (id: string, bytes: number, daysAgo: number, unlisted = false): StorageItem => ({
  id,
  bytes,
  at: NOW - daysAgo * DAY,
  ...(unlisted ? { unlisted } : {}),
});

function usage(over: Partial<StorageUsage> = {}): StorageUsage {
  return {
    root: "C:\\Users\\me\\AppData\\Roaming\\app.owntools.desktop",
    total: 0,
    groups: { captures: 0, recordings: 0, meetings: 0, speech: 0, language: 0, boards: 0, social: 0, cache: 0, downloads: 0, other: 0 },
    cache: { temp: 0, tempFiles: 0, web: 0, downloads: 0, downloadFiles: 0 },
    captures: [],
    recordings: [],
    meetings: [],
    ...over,
  };
}

describe("formatBytes", () => {
  it("speaks the units Windows shows", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(54.3 * MB)).toBe("54.3 MB");
    expect(formatBytes(150 * MB)).toBe("150 MB");
    expect(formatBytes(1024 * MB)).toBe("1 GB");
    expect(formatBytes(2.43 * 1024 * MB)).toBe("2.4 GB");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });

  it("labels a row's share without pretending a sliver is 0%", () => {
    expect(shareLabel(38, 100)).toBe("38%");
    expect(shareLabel(1, 1000)).toBe("<1%");
    expect(shareLabel(0, 1000)).toBe("0%");
  });
});

describe("pickItems", () => {
  const items = [item("today", 10, 0), item("last-week", 20, 8), item("spring", 30, 120)];

  it("takes everything, or only what is older than the chosen age", () => {
    expect(pickItems(items, "all", NOW).map((i) => i.id)).toEqual(["today", "last-week", "spring"]);
    expect(pickItems(items, "7", NOW).map((i) => i.id)).toEqual(["last-week", "spring"]);
    expect(pickItems(items, "30", NOW).map((i) => i.id)).toEqual(["spring"]);
    expect(pickItems(items, "90", NOW).map((i) => i.id)).toEqual(["spring"]);
    expect(sumBytes(pickItems(items, "7", NOW))).toBe(50);
  });

  it("keeps something exactly at the edge", () => {
    expect(pickItems([item("edge", 1, 30)], "30", NOW)).toEqual([]);
  });
});

describe("spaceRows", () => {
  it("adds up to the total, with what the tools keep beside the files counted as everything else", () => {
    const u = usage({
      groups: { captures: 110, recordings: 5000, meetings: 2600, speech: 700, language: 2500, boards: 40, social: 60, cache: 30, downloads: 900, other: 70 },
      captures: [item("a", 100, 1)],
      recordings: [item("r", 4000, 2)],
      meetings: [item("m", 2500, 3)],
    });
    u.total = Object.values(u.groups).reduce((a, b) => a + b, 0);
    const rows = spaceRows(u);
    expect(rows.captures).toBe(100);
    expect(rows.meetingAudio).toBe(2500);
    expect(rows.boardsAndPosts).toBe(100);
    // 10 of the capture index, 1000 of a take still recording, 100 of transcripts.
    expect(rows.other).toBe(70 + 10 + 1000 + 100);
    expect(Object.values(rows).reduce((a, b) => a + b, 0)).toBe(u.total);
  });
});

describe("what a Delete button says", () => {
  const all = [item("a", 40 * MB, 1), item("b", 10 * MB, 40), item("c", 4 * MB, 100)];

  it("counts what the button would take, and what never goes with it", () => {
    expect(fileHint("captures", all, all, "all")).toBe("3 screenshots in the capture library.");
    expect(fileHint("recordings", pickItems(all, "30", NOW), all, "30")).toBe("2 of 3 recordings with their edits. Exported videos stay.");
    expect(fileHint("meeting-audio", all.slice(0, 1), all.slice(0, 1), "all")).toBe("The audio of 1 meeting. Transcripts and notes stay.");
    expect(fileHint("captures", [], all, "90")).toBe("Nothing older than 3 months.");
    expect(fileHint("recordings", [], [], "all")).toBe("No recordings yet.");
  });

  it("names the files, the size and what stays before anything goes", () => {
    const screenshots = confirmDelete("captures", all, "all");
    expect(screenshots.title).toBe("Delete 3 screenshots?");
    expect(screenshots.message).toContain("54 MB, for good");
    expect(screenshots.message).toContain("Pictures stay");

    const old = confirmDelete("recordings", pickItems(all, "30", NOW), "30");
    expect(old.title).toBe("Delete 2 recordings older than a month?");
    expect(old.message).toContain("share links keep working");

    const audio = confirmDelete("meeting-audio", [item("m", 820 * MB, 3), item("crash", 5 * MB, 9, true)], "all");
    expect(audio.title).toBe("Delete the audio of 2 meetings?");
    expect(audio.okLabel).toBe("Delete audio");
    expect(audio.message).toContain("transcripts, summaries and notes stay");
    expect(audio.message).toContain("1 meeting never finished saving and has nothing else, so it goes completely.");
  });

  it("reports what happened, including what was left alone", () => {
    expect(deleteNote("captures", { removed: ["a", "b"], freed: 50 * MB, failed: [], skipped: [] })).toBe("Deleted 2 screenshots · 50 MB freed.");
    expect(deleteNote("meeting-audio", { removed: ["m"], freed: 820 * MB, failed: ["x"], skipped: ["live"] })).toBe(
      "Deleted the audio of 1 meeting · 820 MB freed. 1 could not be deleted - a file may be open in another app. 1 is being recorded and was left alone.",
    );
    expect(deleteNote("recordings", { removed: [], freed: 0, failed: [], skipped: [] })).toBe("Nothing to delete.");
  });

  it("says when the cache was already clean or a file was busy", () => {
    expect(clearNote("cache", { freed: 0, removed: 0, kept: 0 })).toBe("The cache was already empty.");
    expect(clearNote("cache", { freed: 38 * MB, removed: 12, kept: 0 })).toBe("Cleared 38 MB.");
    expect(clearNote("downloads", { freed: MB, removed: 1, kept: 2 })).toBe(
      "Deleted 1 MB of unfinished downloads. 2 files are in use and stay for now.",
    );
    expect(clearNote("cache", { freed: MB, removed: 3, kept: 1 })).toBe("Cleared 1 MB. 1 file is in use and stays for now.");
  });
});
