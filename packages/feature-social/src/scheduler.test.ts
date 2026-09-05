import { describe, expect, it } from "vitest";
import { newPost } from "./model";
import { backoffMs, duePosts, finalContent, missedPosts, nextRepeat, settle } from "./scheduler";
import type { Channel, Post } from "./types";

const now = new Date("2026-04-06T10:00:00.000Z");
const iso = (minutesFromNow: number) => new Date(now.getTime() + minutesFromNow * 60_000).toISOString();

const scheduled = (patch: Partial<Post>): Post => newPost({ status: "scheduled", channelIds: ["c1"], ...patch });

describe("duePosts / missedPosts", () => {
  it("picks posts whose time came within the tolerance window", () => {
    const posts = [
      scheduled({ id: "past-ok", scheduledAt: iso(-5) }),
      scheduled({ id: "future", scheduledAt: iso(5) }),
      scheduled({ id: "missed", scheduledAt: iso(-60) }),
      scheduled({ id: "draft", status: "draft", scheduledAt: iso(-5) }),
      scheduled({ id: "retry-later", scheduledAt: iso(-5), attempts: 1, nextAttemptAt: iso(2) }),
      scheduled({ id: "retry-now", scheduledAt: iso(-90), attempts: 1, nextAttemptAt: iso(-1) }),
    ];
    expect(duePosts(posts, now, 10, new Set()).map((p) => p.id)).toEqual(["past-ok", "retry-now"]);
    expect(duePosts(posts, now, 10, new Set(["past-ok"])).map((p) => p.id)).toEqual(["retry-now"]);
    expect(missedPosts(posts, now, 10).map((p) => p.id)).toEqual(["missed"]);
  });
});

describe("settle", () => {
  const base = scheduled({ id: "p", channelIds: ["a", "b"], scheduledAt: iso(-1) });

  it("publishes when every channel succeeded", () => {
    const out = settle(base, { a: { status: "ok", at: "" }, b: { status: "ok", at: "" } }, now);
    expect(out.status).toBe("published");
    expect(out.publishedAt).toBe(now.toISOString());
  });

  it("schedules a retry with backoff for retryable errors", () => {
    const out = settle(base, { a: { status: "ok", at: "" }, b: { status: "error", error: "[retry] 503", at: "" } }, now);
    expect(out.status).toBe("scheduled");
    expect(out.attempts).toBe(1);
    expect(out.nextAttemptAt).toBe(new Date(now.getTime() + backoffMs(1)).toISOString());
    expect(out.lastError).toBe("503");
    const third = settle({ ...out, attempts: 2 }, { b: { status: "error", error: "[retry] 503", at: "" } }, now);
    expect(third.status).toBe("failed");
  });

  it("fails immediately on a permanent error and keeps the successes", () => {
    const out = settle(base, { a: { status: "ok", at: "" }, b: { status: "error", error: "bad token", at: "" } }, now);
    expect(out.status).toBe("failed");
    expect(out.results.a?.status).toBe("ok");
    expect(out.lastError).toBe("bad token");
  });

  it("uses increasing backoff", () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(2)).toBe(5 * 60_000);
  });
});

describe("nextRepeat / finalContent", () => {
  const channel = (provider: Channel["provider"], signature?: string): Channel => ({
    id: "c1",
    provider,
    handle: "@a",
    displayName: "A",
    avatar: null,
    collection: "Personal",
    disabled: false,
    preferences: signature ? { signature } : {},
    meta: {},
    createdAt: "",
    updatedAt: "",
  });

  it("creates the next occurrence with the same content and a back-link", () => {
    const post = scheduled({ id: "orig", scheduledAt: "2026-04-06T09:00:00+02:00", repeat: { kind: "weekly" }, content: { text: "hi", media: [], thread: [] } });
    const next = nextRepeat(post)!;
    expect(next.status).toBe("scheduled");
    expect(next.repeatOf).toBe("orig");
    expect(next.source).toBe("repeat");
    expect(next.content.text).toBe("hi");
    expect(next.scheduledAt?.startsWith("2026-04-13T")).toBe(true);
    expect(nextRepeat(scheduled({ scheduledAt: iso(1) }))).toBeNull();
  });

  it("flattens threads for networks without them and appends the signature", () => {
    const post = scheduled({ content: { text: "one", media: [], thread: [{ text: "two", media: [] }] } });
    expect(finalContent(post, channel("linkedin", "— me")).text).toBe("one\n\ntwo\n\n— me");
    const x = finalContent(post, channel("x"));
    expect(x.text).toBe("one");
    expect(x.thread).toHaveLength(1);
  });
});
