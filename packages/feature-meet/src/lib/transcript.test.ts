import { describe, expect, it } from "vitest";
import type { Meeting, MeetingSegment } from "../types";
import {
  insertSegment,
  meetingMarkdown,
  meetingMatches,
  normalizeMeeting,
  notesMarkdown,
  parseTranscriptMarkdown,
  summaryMarkdown,
  transcriptMarkdown,
  transcriptPlain,
} from "./transcript";

const meeting: Meeting = {
  id: "20260911-143200-ab12",
  title: "Roadmap sync",
  startedAt: new Date(2026, 8, 11, 14, 32).toISOString(),
  durationMs: 25 * 60_000,
  sources: ["mic", "system"],
  segments: [
    { source: "system", startMs: 4_000, endMs: 7_500, text: "Can we ship the export this week?" },
    { source: "mic", startMs: 8_200, endMs: 12_000, text: "Yes, if the watermark stays the only gate." },
    { source: "system", startMs: 65_000, endMs: 70_000, text: "Agreed. I will write the changelog." },
    { source: "mic", startMs: 2_000, endMs: 3_500, text: "" },
  ],
  notes: "Ask about pricing\n149 zł vs $49",
  summary: "Export ships this week; the watermark stays the only Pro gate.",
  decisions: ["Ship the export this week"],
  actionItems: [{ text: "Write the changelog", owner: "them" }, { text: "Check the price constant" }],
  audio: true,
};

describe("transcriptMarkdown", () => {
  it("renders a dated dialog in time order, skipping empty lines", () => {
    const md = transcriptMarkdown(meeting);
    expect(md).toContain("# Roadmap sync");
    expect(md).toContain("25 min · you (mic) + them (system audio)");
    const lines = md.split("\n").filter((l) => l.startsWith("**["));
    expect(lines).toEqual([
      "**[0:04] them:** Can we ship the export this week?",
      "**[0:08] you:** Yes, if the watermark stays the only gate.",
      "**[1:05] them:** Agreed. I will write the changelog.",
    ]);
  });

  it("round-trips through parseTranscriptMarkdown at second precision", () => {
    const back = parseTranscriptMarkdown(transcriptMarkdown(meeting));
    expect(back.map((s) => [s.source, s.startMs, s.text])).toEqual([
      ["system", 4_000, "Can we ship the export this week?"],
      ["mic", 8_000, "Yes, if the watermark stays the only gate."],
      ["system", 65_000, "Agreed. I will write the changelog."],
    ]);
    expect(back[0].endMs).toBe(8_000);
    expect(back[2].endMs).toBe(66_000);
  });

  it("parses hour-long stamps", () => {
    const [seg] = parseTranscriptMarkdown("**[1:02:15] you:** late point");
    expect(seg.startMs).toBe(3_735_000);
  });

  it("says so when nothing was transcribed", () => {
    const md = transcriptMarkdown({ ...meeting, segments: [] });
    expect(md).toContain("_No speech was transcribed._");
  });
});

describe("meetingMarkdown / notes / summary", () => {
  it("puts summary, decisions, action items, notes and transcript in one file", () => {
    const md = meetingMarkdown(meeting);
    const order = ["## Summary", "## Decisions", "## Action items", "## Notes", "## Transcript"].map((h) => md.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(md).toContain("- [ ] Write the changelog _(them)_");
    expect(md).toContain("- [ ] Check the price constant\n");
    expect(md).toContain("· 21 words");
  });

  it("notes.md carries the notes; summaryMarkdown is empty without a summary", () => {
    expect(notesMarkdown(meeting)).toBe("# Roadmap sync — notes\n\nAsk about pricing\n149 zł vs $49\n");
    expect(notesMarkdown({ ...meeting, notes: "  " })).toContain("_No notes._");
    expect(summaryMarkdown({ ...meeting, summary: undefined, decisions: [], actionItems: [] })).toBe("");
  });

  it("transcriptPlain is what the model reads", () => {
    expect(transcriptPlain(meeting.segments).split("\n")[0]).toBe("[0:04] them: Can we ship the export this week?");
  });
});

describe("normalizeMeeting", () => {
  it("accepts a meeting.json and drops what it cannot trust", () => {
    const parsed = normalizeMeeting({
      ...JSON.parse(JSON.stringify(meeting)),
      segments: [...meeting.segments, { source: "phone", startMs: 1, endMs: 2, text: "x" }, "junk"],
      sources: ["mic", "tv"],
      actionItems: [{ text: "ok", owner: "nobody" }, { owner: "you" }],
      decisions: ["a", 3],
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.segments).toHaveLength(4);
    expect(parsed!.segments[0].startMs).toBe(2_000);
    expect(parsed!.sources).toEqual(["mic"]);
    expect(parsed!.actionItems).toEqual([{ text: "ok" }]);
    expect(parsed!.decisions).toEqual(["a"]);
    expect(parsed!.audio).toBe(true);
  });

  it("rejects a file without an id", () => {
    expect(normalizeMeeting({ title: "x" })).toBeNull();
    expect(normalizeMeeting(null)).toBeNull();
    expect(normalizeMeeting("nope")).toBeNull();
  });
});

describe("insertSegment / meetingMatches", () => {
  it("keeps lines in time order and merges a re-delivered one", () => {
    let list: MeetingSegment[] = insertSegment([], { source: "mic", startMs: 10, endMs: 20, text: "b" });
    list = insertSegment(list, { source: "system", startMs: 5, endMs: 8, text: "a" });
    list = insertSegment(list, { source: "mic", startMs: 30, endMs: 40, text: "c" });
    list = insertSegment(list, { source: "mic", startMs: 10, endMs: 20, text: "B" });
    expect(list.map((s) => s.text)).toEqual(["a", "B", "c"]);
  });

  it("searches title, summary, notes and transcript", () => {
    expect(meetingMatches(meeting, "roadmap")).toBe(true);
    expect(meetingMatches(meeting, "WATERMARK")).toBe(true);
    expect(meetingMatches(meeting, "pricing")).toBe(true);
    expect(meetingMatches(meeting, "unicorn")).toBe(false);
    expect(meetingMatches(meeting, "  ")).toBe(true);
  });
});
