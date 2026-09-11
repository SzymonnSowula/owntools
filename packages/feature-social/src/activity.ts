import { parsePost } from "./model";
import type { ActivityAction, ActivityActor, ActivityEntry, Post } from "./types";

/**
 * The activity log: one JSON object per line in `<AppData>/social/activity.jsonl`.
 *
 * Every write an agent (REST / MCP, appended by Rust) or an automation
 * (appended by the store) makes to a post is one line, with the whole post
 * before and after, and so is every decision a person takes about those
 * posts (approve / reject / undo). "Undo" is nothing more than writing
 * `before` back as a new version — the same read-modify-write every other
 * edit uses, so it never fights the agent server's version counter.
 *
 * Parsing and the undo plan are pure; `store.ts` owns the file.
 */

export const ACTIVITY_FILE = "activity.jsonl";
/** Entries kept in memory / shown on the page. */
export const ACTIVITY_LIMIT = 300;
/** When the file grows past this, it is cut back to the newest `ACTIVITY_KEEP_LINES`. */
export const ACTIVITY_MAX_BYTES = 1_000_000;
export const ACTIVITY_KEEP_LINES = 1000;

export function makeEntry(
  actor: ActivityActor,
  action: ActivityAction,
  postId: string,
  extra: { before?: Post | null; after?: Post | null; note?: string } = {},
): ActivityEntry {
  const entry: ActivityEntry = { ts: new Date().toISOString(), actor, action, postId };
  if (extra.before) entry.before = extra.before;
  if (extra.after) entry.after = extra.after;
  if (extra.note) entry.note = extra.note;
  return entry;
}

export function serializeEntry(entry: ActivityEntry): string {
  return `${JSON.stringify(entry)}\n`;
}

const ACTORS = new Set<ActivityActor>(["agent", "automation", "user"]);
const ACTIONS = new Set<ActivityAction>(["create", "update", "delete", "publish", "approve", "reject"]);

/** One line → an entry, or null for anything that is not one (a half-written line, foreign JSON). */
export function parseEntry(line: string): ActivityEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const actor = r.actor as ActivityActor;
  const action = r.action as ActivityAction;
  if (!ACTORS.has(actor) || !ACTIONS.has(action)) return null;
  if (typeof r.postId !== "string" || !r.postId) return null;
  const entry: ActivityEntry = { ts: typeof r.ts === "string" ? r.ts : "", actor, action, postId: r.postId };
  const before = parsePost(r.before);
  const after = parsePost(r.after);
  if (before) entry.before = before;
  if (after) entry.after = after;
  if (typeof r.note === "string" && r.note) entry.note = r.note;
  return entry;
}

/** The newest `limit` entries, newest first. Bad lines are skipped, never fatal. */
export function parseActivity(text: string | null | undefined, limit = ACTIVITY_LIMIT): ActivityEntry[] {
  if (!text) return [];
  const lines = text.split("\n");
  const out: ActivityEntry[] = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i -= 1) {
    const entry = parseEntry(lines[i]!);
    if (entry) out.push(entry);
  }
  return out;
}

/** The text cut back to its newest lines when it is over the size cap; null when nothing needs doing. */
export function trimActivity(text: string, maxBytes = ACTIVITY_MAX_BYTES, keepLines = ACTIVITY_KEEP_LINES): string | null {
  if (text.length <= maxBytes) return null;
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length <= keepLines) return null;
  return `${lines.slice(-keepLines).join("\n")}\n`;
}

export type UndoPlan =
  | { kind: "restore"; post: Post; recreate: boolean; note: string }
  | { kind: "none"; reason: string };

/**
 * What undoing `entry` means, given the post as it is now:
 * - an update, an approval: write `before` back (recreating the post if it is gone);
 * - a delete, a rejection: put `before` back, unless the post exists again;
 * - a create or a publish: nothing to undo — open the post and decide there.
 * The caller writes `post` through the store, which bumps the version.
 */
export function undoPlan(entry: ActivityEntry, current: Post | undefined): UndoPlan {
  switch (entry.action) {
    case "update":
    case "approve": {
      if (!entry.before) return { kind: "none", reason: "The log has no copy of the post before this change." };
      const changedSince = Boolean(current && entry.after && current.version !== entry.after.version);
      const note = !current
        ? "The post was deleted since; undoing brings it back as it was before this change."
        : changedSince
          ? "The post was edited again since; undoing overwrites those edits too."
          : entry.action === "approve"
            ? "Back to waiting for review."
            : "Back to the version before this change.";
      return { kind: "restore", post: entry.before, recreate: !current, note };
    }
    case "delete":
    case "reject": {
      if (!entry.before) return { kind: "none", reason: "The log has no copy of the deleted post." };
      if (current) return { kind: "none", reason: "The post exists again." };
      return { kind: "restore", post: entry.before, recreate: true, note: "Brings the post back exactly as it was." };
    }
    case "create":
      return { kind: "none", reason: current ? "Open the post and delete it if it should not exist." : "The post is already gone." };
    case "publish":
      return { kind: "none", reason: "A publish cannot be taken back from here — the networks keep their copies." };
    default:
      return { kind: "none", reason: "Nothing to undo." };
  }
}

/** "created a post", "approved", … — the verb of a row on the Agents page. */
export function describeAction(entry: ActivityEntry): string {
  switch (entry.action) {
    case "create":
      return entry.note?.startsWith("undo") ? "restored a post" : "created a post";
    case "update":
      return entry.note?.startsWith("undo") ? "undid a change" : "edited a post";
    case "delete":
      return "deleted a post";
    case "publish":
      return "published";
    case "approve":
      return "approved";
    case "reject":
      return "rejected";
    default:
      return entry.action;
  }
}

export function describeActor(actor: ActivityActor): string {
  return actor === "user" ? "you" : actor === "agent" ? "an agent" : "an automation";
}
