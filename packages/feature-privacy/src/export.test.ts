import { describe, expect, it } from "vitest";
import type { NetEntry } from "@core/net";
import { csvCell, parseJsonl, toCsv, toJsonl } from "./export";

const entry: NetEntry = {
  ts: Date.UTC(2026, 8, 11, 12, 0, 0),
  host: "bsky.social",
  method: "POST",
  bytesOut: 512,
  bytesIn: null,
  purpose: 'post to Bluesky, "hello"',
  ok: true,
  status: 200,
  kind: "cloud",
};

describe("export", () => {
  it("quotes CSV cells that need it and leaves the rest bare", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell(null)).toBe("");
    expect(csvCell('a "quoted", cell')).toBe('"a ""quoted"", cell"');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });

  it("writes a header, ISO times and empty cells for unknown sizes", () => {
    const csv = toCsv([entry]);
    const [header, row, tail] = csv.split("\r\n");
    expect(header).toBe("time,host,purpose,kind,method,status,ok,bytesOut,bytesIn");
    expect(row).toBe('2026-09-11T12:00:00.000Z,bsky.social,"post to Bluesky, ""hello""",cloud,POST,200,true,512,');
    expect(tail).toBe("");
  });

  it("round-trips JSONL and skips garbage lines", () => {
    const text = toJsonl([entry, { ...entry, ts: entry.ts + 1, kind: "local", host: "127.0.0.1" }]);
    expect(text.endsWith("\n")).toBe(true);
    const parsed = parseJsonl(`${text}not json\n{"ts":"wrong"}\n\n`);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual(entry);
    expect(parsed[1].kind).toBe("local");
    expect(toJsonl([])).toBe("");
  });
});
