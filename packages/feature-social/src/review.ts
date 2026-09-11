import { fromIso, nextDefaultSlot, toIso } from "./time";
import type { Post, PostSource, PostStatus, SocialSettings } from "./types";

/**
 * The review queue — the human in the loop.
 *
 * With `agentPostsNeedApproval` on (the default) a post an agent or an
 * automation creates lands as `needs_review`: the runner never publishes
 * it, the calendar draws it hatched, and a person approves, edits or
 * rejects it in social → Review. Approving puts it on the calendar at its
 * own time when that time is still ahead, otherwise at the next free queue
 * slot. Rejecting deletes it and keeps the reason in the activity log.
 *
 * Pure functions; the store does the writing.
 */

/** What the agent is told, so it can tell the person. */
export const REVIEW_MESSAGE = "waiting for approval in owntools → social → Review";

/** Sources whose posts go through review when the setting is on. */
export function approvalApplies(source: PostSource): boolean {
  return source === "agent" || source === "automation";
}

export function approvalOn(settings: Pick<SocialSettings, "agentPostsNeedApproval">): boolean {
  return settings.agentPostsNeedApproval !== false;
}

/**
 * The status a new post starts with. Review beats everything else for an
 * agent or an automation; otherwise a time plus at least one channel means
 * scheduled, and anything less is a draft.
 */
export function initialStatus(
  input: { source: PostSource; channelIds: string[]; scheduledAt: string | null },
  needsApproval: boolean,
): PostStatus {
  if (needsApproval && approvalApplies(input.source)) return "needs_review";
  if (input.scheduledAt && input.channelIds.length > 0) return "scheduled";
  return "draft";
}

export type ApprovalOutcome =
  | { ok: true; post: Post; movedToSlot: boolean }
  | { ok: false; reason: "no-channels" | "issues" | "not-waiting"; message: string };

/**
 * The approved post: scheduled at its own time when that is still ahead,
 * otherwise at `slot()` (the next free queue slot; the next quarter hour
 * when the queue has nothing free). Refuses without channels or with
 * blocking issues — the composer is the place to fix those.
 */
export function approvePlan(post: Post, now: Date, slot: () => Date | null, hasBlockingIssues: boolean): ApprovalOutcome {
  if (post.status !== "needs_review") return { ok: false, reason: "not-waiting", message: "This post is not waiting for approval." };
  if (post.channelIds.length === 0) return { ok: false, reason: "no-channels", message: "Pick at least one channel before approving." };
  if (hasBlockingIssues) return { ok: false, reason: "issues", message: "Fix the issues in the composer first." };
  const own = fromIso(post.scheduledAt);
  const keep = own && own.getTime() > now.getTime() - 60_000;
  const when = keep ? own : (slot() ?? nextDefaultSlot(now));
  return {
    ok: true,
    movedToSlot: !keep,
    post: { ...post, status: "scheduled", scheduledAt: toIso(when), attempts: 0, nextAttemptAt: null, lastError: null },
  };
}

export function reviewQueue(posts: Post[]): Post[] {
  return posts.filter((p) => p.status === "needs_review").sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

/** "agent", "automation", "screeni"… — empty for a post the person wrote. */
export function describeSource(source: PostSource): string {
  switch (source) {
    case "app":
      return "";
    case "repeat":
      return "repeat";
    default:
      return source;
  }
}
