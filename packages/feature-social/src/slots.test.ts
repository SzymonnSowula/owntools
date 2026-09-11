import { describe, expect, it } from "vitest";
import { newPost } from "./model";
import { DEFAULT_SLOTS, describeSlots, isSlotFree, nextFreeSlot, nextFreeSlots, slotOccurrences, slotsFor } from "./slots";
import { toIso } from "./time";
import type { Channel, Post } from "./types";

// Monday 14 September 2026, 08:00 local — the demo week starts here.
const monday8 = new Date(2026, 8, 14, 8, 0);
const at = (day: number, hour: number, minute = 0) => new Date(2026, 8, day, hour, minute);

const channel = (id: string, slots?: Channel["slots"]): Channel => ({
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
  ...(slots ? { slots } : {}),
});

const held = (channelIds: string[], when: Date, patch: Partial<Post> = {}): Post =>
  newPost({ status: "scheduled", channelIds, scheduledAt: toIso(when), ...patch });

describe("slotOccurrences", () => {
  it("lists the default weekday slots in order and skips the weekend", () => {
    const friday18 = at(18, 18, 0);
    const [first, second, third] = slotOccurrences(DEFAULT_SLOTS, friday18, 7);
    expect(first).toEqual(at(21, 9));
    expect(second).toEqual(at(21, 13));
    expect(third).toEqual(at(21, 17));
  });

  it("only offers times strictly after `from`", () => {
    const occ = slotOccurrences(DEFAULT_SLOTS, at(14, 9, 0), 1);
    expect(occ[0]).toEqual(at(14, 13));
  });
});

describe("nextFreeSlot", () => {
  it("falls back to the defaults when nothing is selected", () => {
    expect(nextFreeSlot([], monday8, { channels: [], posts: [] })).toEqual(at(14, 9));
    expect(slotsFor(undefined)).toBe(DEFAULT_SLOTS);
  });

  it("skips a slot a post on that channel already holds — per channel", () => {
    const c1 = channel("c1");
    const c2 = channel("c2");
    const posts = [held(["c1"], at(14, 9))];
    expect(nextFreeSlot(["c1"], monday8, { channels: [c1, c2], posts })).toEqual(at(14, 13));
    // Another channel's queue is not blocked by c1's post.
    expect(nextFreeSlot(["c2"], monday8, { channels: [c1, c2], posts })).toEqual(at(14, 9));
  });

  it("respects a channel's own slots and unions them for a multi-channel post", () => {
    const c1 = channel("c1");
    const c3 = channel("c3", [{ days: [0, 1, 2, 3, 4, 5, 6], time: "10:30" }]);
    expect(nextFreeSlot(["c3"], monday8, { channels: [c1, c3], posts: [] })).toEqual(at(14, 10, 30));
    // Both channels: the earliest slot of either that is free for both.
    expect(nextFreeSlot(["c1", "c3"], monday8, { channels: [c1, c3], posts: [] })).toEqual(at(14, 9));
    // c1's 9:00 is held by a c1 post, so the shared post moves to c3's 10:30.
    expect(nextFreeSlot(["c1", "c3"], monday8, { channels: [c1, c3], posts: [held(["c1"], at(14, 9))] })).toEqual(at(14, 10, 30));
  });

  it("treats a post waiting for review as holding its slot, and drafts as not", () => {
    const c1 = channel("c1");
    const review = held(["c1"], at(14, 9), { status: "needs_review" });
    const draft = held(["c1"], at(14, 13), { status: "draft" });
    expect(nextFreeSlot(["c1"], monday8, { channels: [c1], posts: [review, draft] })).toEqual(at(14, 13));
  });

  it("ignores the post being edited", () => {
    const c1 = channel("c1");
    const mine = held(["c1"], at(14, 9), { id: "mine" });
    expect(nextFreeSlot(["c1"], monday8, { channels: [c1], posts: [mine], excludeId: "mine" })).toEqual(at(14, 9));
    expect(isSlotFree(at(14, 9), ["c1"], { channels: [c1], posts: [mine] })).toBe(false);
  });

  it("returns several spaced slots and null when the horizon is full", () => {
    const c1 = channel("c1", [{ days: [1], time: "09:00" }]);
    expect(nextFreeSlots(["c1"], monday8, { channels: [c1], posts: [] }, 3)).toEqual([at(14, 9), at(21, 9), at(28, 9)]);
    const every = slotOccurrences(c1.slots!, monday8).map((d) => held(["c1"], d));
    expect(nextFreeSlot(["c1"], monday8, { channels: [c1], posts: every })).toBeNull();
  });
});

describe("describeSlots", () => {
  it("names the common shapes", () => {
    expect(describeSlots(DEFAULT_SLOTS)).toBe("weekdays 9:00, 13:00, 17:00");
    expect(describeSlots([{ days: [0, 1, 2, 3, 4, 5, 6], time: "10:30" }])).toBe("every day 10:30");
    expect(describeSlots([{ days: [1, 4], time: "08:00" }])).toBe("Mon, Thu 8:00");
    expect(describeSlots([])).toBe("no queue slots");
  });
});
