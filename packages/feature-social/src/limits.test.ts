import { describe, expect, it } from "vitest";
import { applySignature, flattenThread, measure, resolveContent, truncateToLimit, validateForChannel } from "./limits";
import type { Channel, MediaItem, PostContent } from "./types";

const channel = (patch: Partial<Channel> = {}): Channel => ({
  id: "c1",
  provider: "x",
  handle: "@ship",
  displayName: "shipshape",
  avatar: null,
  collection: "Personal",
  disabled: false,
  preferences: {},
  meta: {},
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...patch,
});

const content = (patch: Partial<PostContent> = {}): PostContent => ({
  text: "",
  media: [],
  thread: [],
  ...patch,
});

const media: Record<string, MediaItem> = {
  img: { id: "img", file: "media/img.png", name: "img.png", mime: "image/png", bytes: 2_000_000, createdAt: "" },
  vid: { id: "vid", file: "media/vid.mp4", name: "vid.mp4", mime: "video/mp4", bytes: 9_000_000, createdAt: "" },
};
const byId = (id: string) => media[id];

describe("measure", () => {
  it("counts a URL as 23 on X and Mastodon, and emoji as 2 on X", () => {
    expect(measure("x", "https://shipshape.app/a/very/long/path/that/goes/on")).toBe(23);
    expect(measure("mastodon", "look https://shipshape.app/a/very/long/path")).toBe(5 + 23);
    expect(measure("x", "🚀")).toBe(2);
    expect(measure("x", "abc")).toBe(3);
    expect(measure("linkedin", "🚀")).toBe(1);
  });

  it("counts graphemes on Bluesky", () => {
    expect(measure("bluesky", "👨‍👩‍👧")).toBe(1);
    expect(measure("bluesky", "https://shipshape.app")).toBe(21);
  });
});

describe("validateForChannel", () => {
  it("flags an empty post and an overlong one", () => {
    expect(validateForChannel(content(), channel(), byId)[0]?.level).toBe("error");
    const long = content({ text: "x".repeat(281) });
    expect(validateForChannel(long, channel(), byId).map((i) => i.message)).toContain(
      "1 over the 280-character limit for X.",
    );
  });

  it("respects a per-channel limit override and the signature", () => {
    const ch = channel({ provider: "mastodon", preferences: { charLimit: 5000, signature: "— via shipshape" } });
    expect(validateForChannel(content({ text: "x".repeat(600) }), ch, byId)).toEqual([]);
    expect(applySignature("hi", ch)).toBe("hi\n\n— via shipshape");
  });

  it("checks media counts, sizes and title requirements", () => {
    const bsky = channel({ provider: "bluesky" });
    const issues = validateForChannel(content({ text: "pic", media: [{ id: "img" }] }), bsky, byId);
    expect(issues.some((i) => i.message.includes("1 MB per image"))).toBe(true);
    const slack = channel({ provider: "slack" });
    const warn = validateForChannel(content({ text: "pic", media: [{ id: "img" }] }), slack, byId);
    expect(warn[0]).toMatchObject({ level: "warning" });
    const devto = channel({ provider: "devto" });
    expect(validateForChannel(content({ text: "body" }), devto, byId).map((i) => i.message)).toContain(
      "Dev.to needs a title.",
    );
    const insta = channel({ provider: "instagram" });
    expect(validateForChannel(content({ text: "no pic" }), insta, byId).some((i) => i.message.includes("photo"))).toBe(true);
  });

  it("joins thread parts for networks without threads and warns", () => {
    const c = content({ text: "one", thread: [{ text: "two", media: [] }] });
    expect(flattenThread(c)).toBe("one\n\ntwo");
    const li = channel({ provider: "linkedin" });
    expect(validateForChannel(c, li, byId)[0]).toMatchObject({ level: "warning" });
    const x = channel();
    expect(validateForChannel(c, x, byId)).toEqual([]);
  });

  it("marks stubs and disabled channels as errors", () => {
    expect(validateForChannel(content({ text: "a" }), channel({ stub: true }), byId)[0]?.level).toBe("error");
    expect(validateForChannel(content({ text: "a" }), channel({ disabled: true }), byId)[0]?.level).toBe("error");
  });
});

describe("resolveContent + truncate", () => {
  it("falls back field by field to the global content", () => {
    const post = {
      content: content({ text: "global", title: "T", media: [{ id: "img" }] }),
      overrides: { c1: { text: "custom" } },
    };
    expect(resolveContent(post, "c1")).toMatchObject({ text: "custom", title: "T", media: [{ id: "img" }] });
    expect(resolveContent(post, "other").text).toBe("global");
  });

  it("truncates on a word boundary with an ellipsis", () => {
    const text = "one two three four five six";
    const cut = truncateToLimit("x", text, 12);
    expect(cut).toBe("one two…");
    expect(measure("x", cut)).toBeLessThanOrEqual(12);
    expect(truncateToLimit("x", "short", 280)).toBe("short");
  });
});
