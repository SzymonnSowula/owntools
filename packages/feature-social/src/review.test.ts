import { describe, expect, it } from "vitest";
import { newPost } from "./model";
import { approvalApplies, approvePlan, initialStatus, reviewQueue } from "./review";
import { fromIso, toIso } from "./time";

const now = new Date(2026, 8, 14, 8, 0);

describe("initialStatus", () => {
  it("sends agent and automation posts to review while approval is on, whatever else they carry", () => {
    for (const source of ["agent", "automation"] as const) {
      expect(initialStatus({ source, channelIds: ["c1"], scheduledAt: toIso(now) }, true)).toBe("needs_review");
      expect(initialStatus({ source, channelIds: [], scheduledAt: null }, true)).toBe("needs_review");
    }
    expect(approvalApplies("agent")).toBe(true);
    expect(approvalApplies("screeni")).toBe(false);
  });

  it("treats them like anyone else when approval is off", () => {
    expect(initialStatus({ source: "agent", channelIds: ["c1"], scheduledAt: toIso(now) }, false)).toBe("scheduled");
    expect(initialStatus({ source: "automation", channelIds: [], scheduledAt: toIso(now) }, false)).toBe("draft");
  });

  it("never reviews what a person or another tool hands over", () => {
    expect(initialStatus({ source: "app", channelIds: ["c1"], scheduledAt: toIso(now) }, true)).toBe("scheduled");
    expect(initialStatus({ source: "screeni", channelIds: ["c1"], scheduledAt: null }, true)).toBe("draft");
    expect(initialStatus({ source: "meet", channelIds: [], scheduledAt: toIso(now) }, true)).toBe("draft");
  });
});

describe("approvePlan", () => {
  const waiting = (patch = {}) => newPost({ status: "needs_review", channelIds: ["c1"], source: "agent", ...patch });
  const slotAt = new Date(2026, 8, 14, 13, 0);

  it("keeps a time that is still ahead", () => {
    const own = new Date(2026, 8, 15, 9, 0);
    const out = approvePlan(waiting({ scheduledAt: toIso(own) }), now, () => slotAt, false);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.post.status).toBe("scheduled");
    expect(fromIso(out.post.scheduledAt)).toEqual(own);
    expect(out.movedToSlot).toBe(false);
  });

  it("moves a post without a time, or with a time that passed, to the next free slot", () => {
    const none = approvePlan(waiting({ scheduledAt: null }), now, () => slotAt, false);
    const past = approvePlan(waiting({ scheduledAt: toIso(new Date(2026, 8, 13, 9, 0)) }), now, () => slotAt, false);
    for (const out of [none, past]) {
      expect(out.ok).toBe(true);
      if (!out.ok) continue;
      expect(fromIso(out.post.scheduledAt)).toEqual(slotAt);
      expect(out.movedToSlot).toBe(true);
      expect(out.post.attempts).toBe(0);
    }
  });

  it("falls back to the next quarter hour when the queue has nothing free", () => {
    const out = approvePlan(waiting({ scheduledAt: null }), now, () => null, false);
    expect(out.ok).toBe(true);
    if (out.ok) expect(fromIso(out.post.scheduledAt)!.getTime()).toBeGreaterThan(now.getTime());
  });

  it("refuses without channels, with blocking issues, or when the post is not waiting", () => {
    expect(approvePlan(waiting({ channelIds: [] }), now, () => slotAt, false)).toMatchObject({ ok: false, reason: "no-channels" });
    expect(approvePlan(waiting(), now, () => slotAt, true)).toMatchObject({ ok: false, reason: "issues" });
    expect(approvePlan(waiting({ status: "scheduled" }), now, () => slotAt, false)).toMatchObject({ ok: false, reason: "not-waiting" });
  });
});

describe("reviewQueue", () => {
  it("lists only posts waiting for review, oldest first", () => {
    const a = newPost({ status: "needs_review", createdAt: "2026-09-14T08:00:00.000Z" });
    const b = newPost({ status: "needs_review", createdAt: "2026-09-14T07:00:00.000Z" });
    const c = newPost({ status: "scheduled" });
    expect(reviewQueue([a, c, b]).map((p) => p.id)).toEqual([b.id, a.id]);
  });
});
