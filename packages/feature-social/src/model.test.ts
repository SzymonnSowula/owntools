import { describe, expect, it } from "vitest";
import {
  DEFAULT_COLLECTION,
  extensionFor,
  newId,
  newPost,
  parseChannelsFile,
  parseContent,
  parsePost,
  parseSettings,
  parseTagsFile,
  postSummary,
} from "./model";

describe("model parsers", () => {
  it("makes unique ids and fresh posts", () => {
    expect(newId("post")).toMatch(/^post_[0-9a-f]{16}$/);
    expect(newId()).not.toBe(newId());
    const p = newPost({ channelIds: ["a"] });
    expect(p.status).toBe("draft");
    expect(p.version).toBe(1);
    expect(p.channelIds).toEqual(["a"]);
  });

  it("parses a post tolerantly", () => {
    expect(parsePost(null)).toBeNull();
    expect(parsePost({ id: "" })).toBeNull();
    const p = parsePost({
      id: "p1",
      status: "bogus",
      content: "just text",
      channelIds: ["c1", 4],
      overrides: { c1: { text: "x", media: ["m1"] } },
      results: { c1: { status: "ok", url: "https://x.com/1" }, c2: { status: "nope" } },
      repeat: { kind: "weekly" },
      version: "3",
    })!;
    expect(p.status).toBe("draft");
    expect(p.content.text).toBe("just text");
    expect(p.channelIds).toEqual(["c1"]);
    expect(p.overrides.c1).toEqual({ text: "x", media: [{ id: "m1" }] });
    expect(Object.keys(p.results)).toEqual(["c1"]);
    expect(p.repeat).toEqual({ kind: "weekly" });
    expect(p.version).toBe(1);
  });

  it("parses content with threads and titles", () => {
    const c = parseContent({ text: "a", thread: ["b", { text: "", media: [] }, { text: "c" }], title: "T" });
    expect(c.thread.map((t) => t.text)).toEqual(["b", "c"]);
    expect(c.title).toBe("T");
  });

  it("dedupes channels and collects collections", () => {
    const f = parseChannelsFile({
      channels: [
        { id: "a", provider: "bluesky", handle: "@a", collection: "Work" },
        { id: "a", provider: "x" },
        { id: "b", provider: "x", handle: "@b" },
        { provider: "x" },
      ],
    });
    expect(f.channels.map((c) => c.id)).toEqual(["a", "b"]);
    expect(f.collections).toEqual(["Work", DEFAULT_COLLECTION]);
    expect(f.channels[1]!.displayName).toBe("@b");
  });

  it("falls back to default tags and settings", () => {
    expect(parseTagsFile(null).tags.length).toBeGreaterThan(0);
    expect(parseTagsFile({ tags: [{ id: "t", name: "x", color: "red" }] }).tags[0]!.color).toBe("#0a84ff");
    const s = parseSettings({ weekStart: 0, agent: { port: 80 }, ai: { provider: "anthropic" }, lateToleranceMinutes: 9999 });
    expect(s.weekStart).toBe(0);
    expect(s.agent.port).toBe(1024);
    expect(s.ai.provider).toBe("anthropic");
    expect(s.lateToleranceMinutes).toBe(720);
    expect(parseSettings(undefined).calendarView).toBe("week");
  });

  it("derives extensions and summaries", () => {
    expect(extensionFor("image/jpeg")).toBe("jpg");
    expect(extensionFor("application/x-unknown", "photo.HEIC")).toBe("heic");
    expect(postSummary(newPost({ content: { text: "  hello   world  ", media: [], thread: [] } }))).toBe("hello world");
    expect(postSummary(newPost({ content: { text: "", media: [{ id: "m" }], thread: [] } }))).toBe("1 media item");
  });
});
