import { describe, expect, it } from "vitest";
import { describeAction, makeEntry, parseActivity, parseEntry, serializeEntry, trimActivity, undoPlan } from "./activity";
import { newPost } from "./model";

const post = newPost({ id: "post_a", status: "scheduled", channelIds: ["c1"], content: { text: "hello", media: [], thread: [] } });

describe("parseActivity", () => {
  it("reads newest first and skips lines that are not entries", () => {
    const text = [
      serializeEntry(makeEntry("agent", "create", "post_a", { after: post })),
      "not json at all\n",
      `${JSON.stringify({ actor: "nobody", action: "create", postId: "x" })}\n`,
      serializeEntry(makeEntry("user", "approve", "post_a", { before: post, after: { ...post, version: 2 } })),
      '{"truncated": tru',
    ].join("");
    const entries = parseActivity(text);
    expect(entries.map((e) => e.action)).toEqual(["approve", "create"]);
    expect(entries[1]!.after?.id).toBe("post_a");
    expect(parseActivity(null)).toEqual([]);
  });

  it("honours the limit from the newest end", () => {
    const text = Array.from({ length: 5 }, (_, i) => serializeEntry(makeEntry("agent", "create", `post_${i}`))).join("");
    expect(parseActivity(text, 2).map((e) => e.postId)).toEqual(["post_4", "post_3"]);
  });

  it("keeps a note and a Rust-shaped line with snake-case-free fields", () => {
    const entry = parseEntry(JSON.stringify({ ts: "2026-09-14T08:00:00Z", actor: "agent", action: "delete", postId: "post_a", before: post, note: "cleanup" }));
    expect(entry?.note).toBe("cleanup");
    expect(entry?.before?.version).toBe(1);
  });
});

describe("trimActivity", () => {
  it("cuts the file back to the newest lines only when it is over the cap", () => {
    const line = serializeEntry(makeEntry("agent", "create", "post_a"));
    const big = line.repeat(50);
    expect(trimActivity(big, big.length + 1, 10)).toBeNull();
    const cut = trimActivity(big, 100, 10);
    expect(cut?.split("\n").filter(Boolean)).toHaveLength(10);
  });
});

describe("undoPlan", () => {
  const before = { ...post, content: { text: "before", media: [], thread: [] } };
  const after = { ...post, version: 2, content: { text: "after", media: [], thread: [] } };

  it("restores the version before an update, and warns when the post moved on", () => {
    const entry = makeEntry("agent", "update", "post_a", { before, after });
    expect(undoPlan(entry, after)).toMatchObject({ kind: "restore", recreate: false, post: { content: { text: "before" } } });
    const later = undoPlan(entry, { ...after, version: 3 });
    expect(later.kind).toBe("restore");
    if (later.kind === "restore") expect(later.note).toMatch(/edited again/);
    expect(undoPlan(entry, undefined)).toMatchObject({ kind: "restore", recreate: true });
  });

  it("recreates a deleted or rejected post, unless it exists again", () => {
    const entry = makeEntry("agent", "delete", "post_a", { before });
    expect(undoPlan(entry, undefined)).toMatchObject({ kind: "restore", recreate: true });
    expect(undoPlan(entry, post)).toMatchObject({ kind: "none" });
    const rejected = makeEntry("user", "reject", "post_a", { before: { ...before, status: "needs_review" }, note: "off brand" });
    expect(undoPlan(rejected, undefined)).toMatchObject({ kind: "restore", post: { status: "needs_review" } });
  });

  it("has nothing to undo for a create or a publish, and no plan without a copy", () => {
    expect(undoPlan(makeEntry("agent", "create", "post_a", { after }), after).kind).toBe("none");
    expect(undoPlan(makeEntry("automation", "publish", "post_a"), after).kind).toBe("none");
    expect(undoPlan(makeEntry("agent", "update", "post_a"), after).kind).toBe("none");
  });

  it("puts an approved post back to waiting", () => {
    const waiting = { ...before, status: "needs_review" as const };
    const plan = undoPlan(makeEntry("user", "approve", "post_a", { before: waiting, after }), after);
    expect(plan).toMatchObject({ kind: "restore", post: { status: "needs_review" } });
    expect(describeAction(makeEntry("user", "approve", "post_a"))).toBe("approved");
  });
});
