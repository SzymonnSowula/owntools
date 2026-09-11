import { describe, expect, it, vi } from "vitest";
import type { LlmRequest, LlmStatus } from "@core/llm";
import type { Meeting } from "../types";
import { isMeetingSummary, normalizeSummary, summarizeMeeting, type SummaryDeps } from "./summary";

const available: LlmStatus = {
  available: true,
  provider: "local",
  model: "test",
  local: { runtime: true, model: true, server: "ready", installing: false },
};

const meeting: Meeting = {
  id: "m1",
  title: "Sync",
  startedAt: new Date(2026, 8, 11, 10, 0).toISOString(),
  durationMs: 600_000,
  sources: ["mic", "system"],
  segments: [
    { source: "system", startMs: 1000, endMs: 3000, text: "Can you send the invoice by Friday?" },
    { source: "mic", startMs: 3500, endMs: 5000, text: "Yes. And you will review the draft." },
  ],
  notes: "",
};

describe("isMeetingSummary", () => {
  it("accepts the shape with optional arrays and rejects the rest", () => {
    expect(isMeetingSummary({ summary: "ok" })).toBe(true);
    expect(isMeetingSummary({ summary: "ok", decisions: ["a"], actionItems: [{ text: "x", owner: "you" }] })).toBe(true);
    expect(isMeetingSummary({ summary: "ok", actionItems: [{ text: "x", owner: null }] })).toBe(true);
    expect(isMeetingSummary({ summary: 3 })).toBe(false);
    expect(isMeetingSummary({ summary: "ok", decisions: "a" })).toBe(false);
    expect(isMeetingSummary({ summary: "ok", actionItems: [{ owner: "you" }] })).toBe(false);
    expect(isMeetingSummary({ summary: "ok", actionItems: [{ text: "x", owner: "boss" }] })).toBe(false);
    expect(isMeetingSummary(null)).toBe(false);
    expect(isMeetingSummary("text")).toBe(false);
  });

  it("normalizes: trims, drops empties, strips a null owner", () => {
    const n = normalizeSummary({
      summary: "  We agreed.  ",
      decisions: [" a ", ""],
      actionItems: [{ text: " x ", owner: null as unknown as undefined }, { text: "   " }, { text: "y", owner: "them" }],
    });
    expect(n).toEqual({ summary: "We agreed.", decisions: ["a"], actionItems: [{ text: "x" }, { text: "y", owner: "them" }] });
  });
});

describe("summarizeMeeting", () => {
  it("degrades to unavailable without a model and never throws", async () => {
    const deps: SummaryDeps = {
      status: async () => ({ ...available, available: false, reason: "No model" }),
      complete: vi.fn(),
      json: vi.fn(),
    };
    expect(await summarizeMeeting(meeting, deps)).toEqual({ kind: "unavailable", reason: "No model" });
    expect(deps.complete).not.toHaveBeenCalled();
  });

  it("asks for JSON once on a short call, with the transcript and the purpose", async () => {
    const json = vi.fn(async (req: LlmRequest) => {
      expect(req.purpose).toBe("meeting summary");
      expect(req.json).toBe(true);
      expect(req.prompt).toContain("[0:01] them: Can you send the invoice by Friday?");
      return { summary: "Invoice by Friday.", actionItems: [{ text: "Send the invoice", owner: "you" }] };
    });
    const deps: SummaryDeps = { status: async () => available, complete: vi.fn(), json: json as SummaryDeps["json"] };
    const out = await summarizeMeeting(meeting, deps);
    expect(out).toEqual({
      kind: "done",
      summary: { summary: "Invoice by Friday.", decisions: [], actionItems: [{ text: "Send the invoice", owner: "you" }] },
    });
    expect(deps.complete).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledTimes(1);
  });

  it("map-reduces a long call: one completion per chunk, then one JSON call", async () => {
    const long: Meeting = {
      ...meeting,
      segments: Array.from({ length: 120 }, (_, i) => ({
        source: (i % 2 ? "mic" : "system") as "mic" | "system",
        startMs: i * 5000,
        endMs: i * 5000 + 4000,
        text: `Point number ${i} about the launch plan and the pricing page and what ships when.`,
      })),
    };
    const complete = vi.fn(async (req: LlmRequest) => {
      expect(req.purpose).toBe("meeting summary");
      return `notes for ${req.prompt.slice(8, 20)}`;
    });
    const json = vi.fn(async (req: LlmRequest) => {
      expect(req.prompt).toContain("Notes from the");
      expect(req.prompt).not.toContain("Point number 0 ");
      return { summary: "Long call.", decisions: ["Ship"], actionItems: [] };
    });
    const deps: SummaryDeps = { status: async () => available, complete, json: json as SummaryDeps["json"], chunkTokens: 400 };
    const out = await summarizeMeeting(long, deps);
    expect(out.kind).toBe("done");
    expect(complete.mock.calls.length).toBeGreaterThan(1);
    expect(json).toHaveBeenCalledTimes(1);
  });

  it("reports an error outcome when the model answers nonsense", async () => {
    const deps: SummaryDeps = {
      status: async () => available,
      complete: vi.fn(),
      json: vi.fn(async () => {
        throw new Error("The model answered with something other than the JSON asked for.");
      }) as SummaryDeps["json"],
    };
    const out = await summarizeMeeting(meeting, deps);
    expect(out).toEqual({ kind: "error", message: "The model answered with something other than the JSON asked for." });
  });

  it("has nothing to summarise without transcript or notes", async () => {
    const deps: SummaryDeps = { status: vi.fn(), complete: vi.fn(), json: vi.fn() };
    expect(await summarizeMeeting({ ...meeting, segments: [], notes: "" }, deps)).toEqual({ kind: "empty" });
    expect(deps.status).not.toHaveBeenCalled();
  });
});
