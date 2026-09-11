import { describe, expect, it } from "vitest";
import { draftFromInput, sourceOf, type DraftContext } from "./api";
import { newPost } from "./model";
import { fromIso, toIso } from "./time";
import type { Channel } from "./types";

const now = new Date(2026, 8, 14, 8, 0); // Monday 08:00 local
const channel = (id: string): Channel => ({
  id,
  provider: "bluesky",
  handle: `@${id}`,
  displayName: id,
  avatar: null,
  collection: "Personal",
  disabled: false,
  preferences: {},
  meta: {},
  createdAt: "",
  updatedAt: "",
});
const ctx = (patch: Partial<DraftContext> = {}): DraftContext => ({
  channels: [channel("c1"), channel("c2")],
  posts: [],
  settings: { agentPostsNeedApproval: true },
  media: [],
  now,
  ...patch,
});

describe("draftFromInput", () => {
  it("maps the caller's label onto the post's source", () => {
    expect(sourceOf("user")).toBe("app");
    expect(sourceOf("screeni")).toBe("screeni");
    expect(draftFromInput({ text: "hi", source: "meet" }, ctx()).source).toBe("meet");
  });

  it("sends an agent's or an automation's post to review while the setting is on, even with a time", () => {
    const post = draftFromInput({ text: "hi", source: "agent", channelIds: ["c1"], scheduledAt: toIso(new Date(2026, 8, 15, 9)) }, ctx());
    expect(post.status).toBe("needs_review");
    expect(post.scheduledAt).toBe(toIso(new Date(2026, 8, 15, 9)));
    expect(draftFromInput({ text: "hi", source: "automation", channelIds: ["c1"] }, ctx()).status).toBe("needs_review");
  });

  it("schedules them like anyone else when approval is off", () => {
    const off = ctx({ settings: { agentPostsNeedApproval: false } });
    expect(draftFromInput({ text: "hi", source: "agent", channelIds: ["c1"], scheduledAt: toIso(now) }, off).status).toBe("scheduled");
    expect(draftFromInput({ text: "hi", source: "agent", channelIds: ["c1"] }, off).status).toBe("draft");
  });

  it("puts `queue: true` on the next free slot of the chosen channels and keeps the time through review", () => {
    const held = newPost({ status: "scheduled", channelIds: ["c1"], scheduledAt: toIso(new Date(2026, 8, 14, 9)) });
    const post = draftFromInput({ text: "hi", source: "automation", channelIds: ["c1"], queue: true }, ctx({ posts: [held] }));
    expect(fromIso(post.scheduledAt)).toEqual(new Date(2026, 8, 14, 13));
    expect(post.status).toBe("needs_review");
    const user = draftFromInput({ text: "hi", source: "user", channelIds: ["c1"], queue: true }, ctx({ posts: [held] }));
    expect(user.status).toBe("scheduled");
  });

  it("leaves a hand-over from another tool as a draft without a time, drops unknown channels, attaches the media", () => {
    const post = draftFromInput({ text: "clip", source: "screeni", channelIds: ["c1", "nope"] }, ctx({ media: [{ id: "m1" }] }));
    expect(post.status).toBe("draft");
    expect(post.channelIds).toEqual(["c1"]);
    expect(post.content.media).toEqual([{ id: "m1" }]);
    expect(post.scheduledAt).toBeNull();
  });

  it("schedules a person's own post when it has channels and a time", () => {
    const post = draftFromInput({ text: "hi", source: "user", channelIds: ["c2"], scheduledAt: toIso(now) }, ctx());
    expect(post.status).toBe("scheduled");
    expect(post.source).toBe("app");
  });
});
