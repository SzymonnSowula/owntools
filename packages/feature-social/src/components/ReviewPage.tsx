import { Check, Loader2, Pencil, ShieldCheck, X } from "lucide-react";
import { useMemo, useState } from "react";
import { hasErrors, validatePost } from "../limits";
import { postSummary } from "../model";
import { describeSource, reviewQueue } from "../review";
import { nextFreeSlot } from "../slots";
import { mediaById, useSocialStore } from "../store";
import { formatDateTime, fromIso, relativeTime } from "../time";
import type { Post } from "../types";
import { useUi } from "../ui";
import { Avatar } from "./Avatar";
import { EmptyState, Switch } from "./primitives";

/**
 * The review queue — posts an agent or an automation created while
 * "agent posts need my approval" is on. Each one can be approved (onto the
 * calendar at its time, or the next free queue slot), edited in the
 * composer, or rejected with a reason that stays in the activity log.
 * Nothing here publishes on its own.
 */

function ReviewCard({ post }: { post: Post }) {
  const channels = useSocialStore((s) => s.channels);
  const media = useSocialStore((s) => s.media);
  const posts = useSocialStore((s) => s.posts);
  const approvePost = useSocialStore((s) => s.approvePost);
  const rejectPost = useSocialStore((s) => s.rejectPost);
  const toast = useSocialStore((s) => s.toast);
  const openComposer = useUi((s) => s.openComposer);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const own = post.channelIds.map((id) => channels.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => Boolean(c));
  const issues = useMemo(() => validatePost(post, channels, mediaById(media)), [post, channels, media]);
  const blocking = hasErrors(issues) || post.channelIds.length === 0;
  const errors = Object.values(issues).flat().filter((i) => i.level === "error");
  const when = fromIso(post.scheduledAt);
  const keepsTime = when && when.getTime() > Date.now() - 60_000;
  const slot = useMemo(
    () => (keepsTime ? null : nextFreeSlot(post.channelIds, new Date(), { channels, posts, excludeId: post.id })),
    [keepsTime, post.channelIds, post.id, channels, posts],
  );
  const created = fromIso(post.createdAt);
  const source = describeSource(post.source) || "agent";

  const approve = async () => {
    setBusy("approve");
    try {
      const out = await approvePost(post.id);
      if (out.ok) {
        const at = fromIso(out.post.scheduledAt);
        toast({ kind: "success", title: "Approved", body: at ? `On the calendar ${relativeTime(at)}${out.movedToSlot ? " (next free slot)" : ""}.` : undefined });
      } else {
        toast({ kind: "error", title: "Cannot approve yet", body: out.message });
        if (out.reason !== "not-waiting") openComposer(post.id);
      }
    } finally {
      setBusy(null);
    }
  };

  const reject = async () => {
    setBusy("reject");
    try {
      await rejectPost(post.id, reason);
      toast({ kind: "info", title: "Rejected", body: reason.trim() ? `Reason kept in the activity log: ${reason.trim()}` : "The post is gone; the activity log keeps a copy." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="sc-card sc-review-card">
      <div className="sc-card-head">
        <span className="sc-avatars">
          {own.slice(0, 4).map((c) => (
            <Avatar key={c.id} channel={c} size="sm" />
          ))}
        </span>
        <span className="min-w-0 truncate text-[12.5px] font-semibold">{own.length ? own.map((c) => c.displayName).join(", ") : "No channel picked"}</span>
        <span className="sc-pill byo">{source}</span>
        <span className="ml-auto text-[11.5px] text-muted" title={created ? formatDateTime(created) : ""}>
          {created ? `queued ${relativeTime(created)}` : ""}
        </span>
      </div>
      <div className="sc-card-body flex flex-col gap-3">
        {post.content.title ? <div className="text-[13.5px] font-semibold">{post.content.title}</div> : null}
        <div className="sc-review-text">{post.content.text.trim() || postSummary(post)}</div>
        {post.content.thread.length ? (
          <div className="text-[11.5px] text-muted">
            + {post.content.thread.length} thread part{post.content.thread.length === 1 ? "" : "s"}
          </div>
        ) : null}
        {post.content.media.length ? (
          <div className="text-[11.5px] text-muted">
            {post.content.media.length} media item{post.content.media.length === 1 ? "" : "s"} attached
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
          {keepsTime && when ? (
            <span>
              Goes out <b className="text-ink">{formatDateTime(when)}</b> once approved.
            </span>
          ) : slot ? (
            <span>
              {when ? "Its time has passed — " : "No time set — "}approving puts it in the next free slot: <b className="text-ink">{formatDateTime(slot)}</b>.
            </span>
          ) : (
            <span>Approving puts it at the next free time.</span>
          )}
        </div>
        {errors.length ? (
          <div className="flex flex-col gap-1.5">
            {errors
              .filter((i, n, arr) => arr.findIndex((x) => x.message === i.message) === n)
              .map((i, n) => (
                <div key={n} className="sc-issue error">
                  <span>{i.message}</span>
                </div>
              ))}
          </div>
        ) : null}
        {post.channelIds.length === 0 ? (
          <div className="sc-issue warning">
            <span>Pick at least one channel in the composer before approving.</span>
          </div>
        ) : null}
        {rejecting ? (
          <div className="flex items-center gap-2">
            <input
              className="sc-field !h-8 flex-1"
              autoFocus
              placeholder="Reason (kept in the activity log, optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void reject();
                if (e.key === "Escape") setRejecting(false);
              }}
            />
            <button className="sc-btn danger sm" onClick={() => void reject()} disabled={busy !== null}>
              {busy === "reject" ? <Loader2 className="animate-spin" /> : <X />} Reject
            </button>
            <button className="sc-btn ghost sm" onClick={() => setRejecting(false)}>
              Keep
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button className="sc-btn primary" onClick={() => void approve()} disabled={busy !== null || blocking} title={blocking ? "Fix the issues in the composer first" : "Put it on the calendar"}>
              {busy === "approve" ? <Loader2 className="animate-spin" /> : <Check />} Approve
            </button>
            <button className="sc-btn" onClick={() => openComposer(post.id)} disabled={busy !== null}>
              <Pencil /> Edit
            </button>
            <button className="sc-btn ghost ml-auto" onClick={() => setRejecting(true)} disabled={busy !== null}>
              <X /> Reject…
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function ReviewPage() {
  const posts = useSocialStore((s) => s.posts);
  const settings = useSocialStore((s) => s.settings);
  const saveSettings = useSocialStore((s) => s.saveSettings);
  const setPage = useUi((s) => s.setPage);
  const queue = useMemo(() => reviewQueue(posts), [posts]);

  return (
    <div className="sc-main">
      <div className="sc-toolbar">
        <div className="sc-toolbar-title">review</div>
        <span className="text-[12px] text-muted">
          {queue.length ? `${queue.length} post${queue.length === 1 ? "" : "s"} waiting for you` : "nothing waiting"}
        </span>
        <label className="ml-auto flex items-center gap-3 text-[12.5px]">
          <span className="text-muted">Agent posts need my approval</span>
          <Switch checked={settings.agentPostsNeedApproval} onCheckedChange={(v) => void saveSettings({ agentPostsNeedApproval: v })} label="Agent posts need my approval" />
        </label>
      </div>
      <div className="sc-content sc-desk sc-scroll">
        {queue.length === 0 ? (
          <div className="grid h-full place-items-center p-6">
            <div className="sc-card max-w-[480px]">
              <EmptyState
                icon={<ShieldCheck />}
                title="nothing to review"
                action={
                  <>
                    <button className="sc-btn" onClick={() => setPage("agents")}>
                      See what agents did
                    </button>
                    <button className="sc-btn ghost" onClick={() => setPage("calendar")}>
                      Back to the calendar
                    </button>
                  </>
                }
              >
                {settings.agentPostsNeedApproval
                  ? "Posts an agent or an automation creates land here first and wait for you. The scheduler never publishes them until you approve; rejecting keeps the reason in the activity log."
                  : "Approval is off: posts an agent creates go straight onto the calendar. Turn it on above to see them here first."}
              </EmptyState>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-[760px] flex-col gap-4 p-6">
            <p className="text-[12.5px] leading-5 text-muted">
              Made by an agent or an automation. Approve puts a post on the calendar at its own time, or at the next free queue slot when it has none; Edit opens the composer; Reject deletes it and keeps your reason in the activity log on the Agents page.
            </p>
            {queue.map((p) => (
              <ReviewCard key={p.id} post={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
