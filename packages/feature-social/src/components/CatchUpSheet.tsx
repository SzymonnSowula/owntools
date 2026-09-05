import { Clock, Loader2, Send, SkipForward } from "lucide-react";
import { useState } from "react";
import { postSummary } from "../model";
import { publishPost } from "../scheduler";
import { useSocialStore } from "../store";
import { fromIso, relativeTime, toIso, tomorrowSameTime } from "../time";
import type { Post } from "../types";
import { Avatar } from "./Avatar";
import { Dialog } from "./primitives";

/**
 * Posts whose time passed while the app was closed. Nothing goes out until
 * the user says so: publish now, move to tomorrow at the same time, or skip.
 */
export function CatchUpSheet() {
  const catchUp = useSocialStore((s) => s.catchUp);
  const setCatchUp = useSocialStore((s) => s.setCatchUp);
  const updatePost = useSocialStore((s) => s.updatePost);
  const channels = useSocialStore((s) => s.channels);
  const [busy, setBusy] = useState<string | null>(null);

  if (catchUp.length === 0) return null;

  const drop = (id: string) => setCatchUp(useSocialStore.getState().catchUp.filter((p) => p.id !== id));

  const now = async (post: Post) => {
    setBusy(post.id);
    await updatePost(post.id, (p) => ({ ...p, scheduledAt: toIso(new Date()), attempts: 0 }));
    drop(post.id);
    setBusy(null);
    void publishPost(post.id, { manual: true });
  };
  const move = async (post: Post) => {
    setBusy(post.id);
    const at = fromIso(post.scheduledAt) ?? new Date();
    await updatePost(post.id, (p) => ({ ...p, scheduledAt: toIso(tomorrowSameTime(at)), attempts: 0 }));
    drop(post.id);
    setBusy(null);
  };
  const skip = async (post: Post) => {
    setBusy(post.id);
    await updatePost(post.id, (p) => ({ ...p, status: "cancelled" }));
    drop(post.id);
    setBusy(null);
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) setCatchUp([]);
      }}
      title={`${catchUp.length} post${catchUp.length === 1 ? "" : "s"} missed`}
      description="Posts that were due while the app was closed."
      footer={
        <>
          <span className="text-[12px] text-muted">Their time passed while shipshape was closed. Nothing was sent.</span>
          <div className="ml-auto flex gap-2">
            <button className="sc-btn" onClick={() => void Promise.all(catchUp.map(skip))}>
              Skip all
            </button>
            <button className="sc-btn primary" onClick={() => void (async () => { for (const p of [...catchUp]) await now(p); })()}>
              <Send /> Publish all now
            </button>
          </div>
        </>
      }
    >
      <div className="divide-y divide-line">
        {catchUp.map((post) => {
          const own = post.channelIds.map((id) => channels.find((c) => c.id === id)).filter((c) => c);
          const when = fromIso(post.scheduledAt);
          return (
            <div key={post.id} className="flex items-center gap-3 px-5 py-3">
              <span className="sc-avatars">
                {own.slice(0, 3).map((c) => (
                  <Avatar key={c!.id} channel={c!} size="sm" />
                ))}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px]">{postSummary(post, 90)}</div>
                <div className="text-[11.5px] text-muted">was due {when ? relativeTime(when) : "—"}</div>
              </div>
              {busy === post.id ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted" />
              ) : (
                <div className="flex gap-1">
                  <button className="sc-btn sm primary" onClick={() => void now(post)}>
                    <Send /> Now
                  </button>
                  <button className="sc-btn sm" onClick={() => void move(post)} title="Tomorrow, same time">
                    <Clock /> Tomorrow
                  </button>
                  <button className="sc-btn sm ghost" onClick={() => void skip(post)}>
                    <SkipForward /> Skip
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
