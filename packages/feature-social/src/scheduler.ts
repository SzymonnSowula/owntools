import { logError, logInfo } from "@core/errors";
import { notify } from "@feature-focus/lib/notify";
import { applySignature, flattenThread, resolveContent, validateForChannel } from "./limits";
import { newPost, nowIso, postSummary } from "./model";
import { networkById } from "./networks";
import { providerFor, ProviderError, type LoadedMedia } from "./providers";
import { nextOccurrence } from "./recurrence";
import { toIso } from "./time";
import { useSocialStore } from "./store";
import type { Channel, MediaItem, Post, PostContent, PublishResult } from "./types";

/**
 * The runner. Every 30 s (and right after any change) it looks for posts
 * whose time has come, publishes them channel by channel, records where they
 * landed, retries with backoff, and creates the next occurrence of a repeat
 * rule. Posts that were due while the app was closed go to the catch-up
 * sheet instead of being fired blindly.
 */

export const TICK_MS = 30_000;
export const MAX_ATTEMPTS = 3;
/** Minutes to wait after the 1st and 2nd failed attempt. */
export const BACKOFF_MINUTES = [1, 5];
/** A "publishing" post untouched for this long is a crashed attempt. */
export const STALE_PUBLISHING_MS = 5 * 60_000;

export function backoffMs(attempts: number): number {
  const minutes = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length) - 1] ?? 5;
  return minutes * 60_000;
}

const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : Number.NaN);

/** Posts the runner may publish right now. */
export function duePosts(posts: Post[], now: Date, lateToleranceMinutes: number, inFlight: Set<string>): Post[] {
  const t = now.getTime();
  const earliest = t - lateToleranceMinutes * 60_000;
  return posts.filter((p) => {
    if (p.status !== "scheduled" || !p.scheduledAt || inFlight.has(p.id)) return false;
    const at = ms(p.scheduledAt);
    if (Number.isNaN(at) || at > t) return false;
    if (p.nextAttemptAt && ms(p.nextAttemptAt) > t) return false;
    // A retry keeps its original scheduledAt; the attempt counter says it is not "missed".
    return p.attempts > 0 || at >= earliest;
  });
}

/** Posts that were missed while the app was not running — the catch-up sheet decides. */
export function missedPosts(posts: Post[], now: Date, lateToleranceMinutes: number): Post[] {
  const t = now.getTime();
  const earliest = t - lateToleranceMinutes * 60_000;
  return posts.filter((p) => {
    if (p.status !== "scheduled" || !p.scheduledAt || p.attempts > 0) return false;
    const at = ms(p.scheduledAt);
    return !Number.isNaN(at) && at < earliest;
  });
}

/** Content a provider receives: overrides resolved, signature added, thread flattened when needed. */
export function finalContent(post: Post, channel: Channel): PostContent {
  const net = networkById(channel.provider);
  const resolved = resolveContent(post, channel.id);
  const text = applySignature(net.threads ? resolved.text : flattenThread(resolved), channel);
  const out: PostContent = { text, media: resolved.media, thread: net.threads ? resolved.thread : [] };
  if (resolved.title) out.title = resolved.title;
  return out;
}

/** Outcome bookkeeping on the post after one round over its channels. */
export function settle(post: Post, results: Record<string, PublishResult>, now: Date): Post {
  const merged = { ...post.results, ...results };
  const pending = post.channelIds.filter((id) => merged[id]?.status !== "ok" && merged[id]?.status !== "skipped");
  const errors = post.channelIds.map((id) => merged[id]).filter((r): r is PublishResult => r?.status === "error");
  if (pending.length === 0) {
    return { ...post, results: merged, status: "published", publishedAt: now.toISOString(), nextAttemptAt: null, lastError: null };
  }
  const attempts = post.attempts + 1;
  const retryable = errors.some((e) => e.error?.startsWith("[retry]"));
  const lastError = errors[0]?.error?.replace(/^\[retry\]\s*/, "") ?? "Unknown error";
  if (attempts >= MAX_ATTEMPTS || !retryable) {
    return { ...post, results: merged, status: "failed", attempts, nextAttemptAt: null, lastError };
  }
  return {
    ...post,
    results: merged,
    status: "scheduled",
    attempts,
    nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)).toISOString(),
    lastError,
  };
}

/** The follow-up occurrence for a repeat rule, or null. */
export function nextRepeat(post: Post): Post | null {
  if (!post.scheduledAt || post.repeat.kind === "none") return null;
  const next = nextOccurrence(post.repeat, post.scheduledAt);
  if (!next) return null;
  return newPost({
    status: "scheduled",
    scheduledAt: toIso(next),
    timezone: post.timezone,
    channelIds: [...post.channelIds],
    content: JSON.parse(JSON.stringify(post.content)) as PostContent,
    overrides: JSON.parse(JSON.stringify(post.overrides)) as Post["overrides"],
    tags: [...post.tags],
    repeat: { ...post.repeat },
    source: "repeat",
    repeatOf: post.repeatOf ?? post.id,
  });
}

async function loadMedia(refs: PostContent["media"], mediaById: (id: string) => MediaItem | undefined): Promise<LoadedMedia[]> {
  const storage = useSocialStore.getState().storage;
  const out: LoadedMedia[] = [];
  for (const ref of refs) {
    const item = mediaById(ref.id);
    if (!item) continue;
    const bytes = await storage.readBinary(item.file);
    if (!bytes) continue;
    out.push(ref.alt ? { item, bytes, alt: ref.alt } : { item, bytes });
  }
  return out;
}

/**
 * Publishes one post to every channel that has not succeeded yet. Safe to
 * call from the tick, from "Post now" and from the catch-up sheet.
 */
export async function publishPost(id: string, opts: { manual?: boolean } = {}): Promise<Post | null> {
  const store = useSocialStore.getState();
  if (store.publishing.has(id)) return store.getPost(id) ?? null;
  store.markPublishing(id, true);
  try {
    const start = await store.updatePost(id, (p) => ({ ...p, status: "publishing", nextAttemptAt: null }));
    if (!start) return null;
    const { channels, media, settings } = useSocialStore.getState();
    const byId = (mid: string) => media.find((m) => m.id === mid);
    const results: Record<string, PublishResult> = {};
    for (const channelId of start.channelIds) {
      if (start.results[channelId]?.status === "ok") continue;
      const channel = channels.find((c) => c.id === channelId);
      const at = nowIso();
      if (!channel) {
        results[channelId] = { status: "skipped", error: "Channel was removed.", at };
        continue;
      }
      const content = finalContent(start, channel);
      const issues = validateForChannel(resolveContent(start, channel.id), channel, byId).filter((i) => i.level === "error");
      if (issues.length) {
        results[channelId] = { status: "error", error: issues.map((i) => i.message).join(" "), at };
        continue;
      }
      try {
        const provider = providerFor(channel.provider, settings.simulate);
        const creds = useSocialStore.getState().credentials[channelId] ?? {};
        const out = await provider.publish({
          channel,
          creds,
          content,
          media: await loadMedia(content.media, byId),
          threadMedia: await Promise.all(content.thread.map((part) => loadMedia(part.media, byId))),
        });
        if (out.creds) await useSocialStore.getState().saveCredentials(channelId, out.creds);
        const r: PublishResult = { status: "ok", url: out.url, remoteId: out.remoteId, at: nowIso() };
        if (settings.simulate) r.simulated = true;
        results[channelId] = r;
        logInfo("social", `published ${id} → ${channel.provider} ${out.url ?? out.remoteId ?? ""}`);
      } catch (err) {
        const retryable = err instanceof ProviderError ? err.retryable : true;
        const message = err instanceof Error ? err.message : String(err);
        results[channelId] = { status: "error", error: `${retryable ? "[retry] " : ""}${message}`, at: nowIso() };
        logError("social", `publish ${id} → ${channel.provider}`, err);
      }
    }
    const settled = await store.updatePost(id, (p) => settle({ ...p, status: "publishing" }, results, new Date()));
    if (!settled) return null;
    // Errors are shown without the internal retry marker.
    const cleaned = Object.fromEntries(
      Object.entries(settled.results).map(([k, r]) => [k, r.error ? { ...r, error: r.error.replace(/^\[retry\]\s*/, "") } : r]),
    );
    const final = (await store.updatePost(id, (p) => ({ ...p, results: cleaned }))) ?? settled;
    await announce(final, opts.manual ?? false);
    if (final.status === "published") {
      const follow = nextRepeat(final);
      if (follow) await store.createPost(follow);
    }
    return final;
  } finally {
    useSocialStore.getState().markPublishing(id, false);
  }
}

async function announce(post: Post, manual: boolean): Promise<void> {
  const store = useSocialStore.getState();
  const summary = postSummary(post, 60);
  const okResult = Object.values(post.results).find((r) => r.status === "ok" && r.url);
  if (post.status === "published") {
    store.toast({ kind: "success", title: "Published", body: summary, url: okResult?.url ?? null });
    if (store.settings.notifications && !manual) void notify("Published", summary);
  } else if (post.status === "failed") {
    store.toast({ kind: "error", title: "Publishing failed", body: post.lastError ?? summary });
    if (store.settings.notifications) void notify("Publishing failed", post.lastError ?? summary);
  } else {
    store.toast({ kind: "info", title: "Will retry", body: `${post.lastError ?? "Temporary error"} — attempt ${post.attempts} of ${MAX_ATTEMPTS}.` });
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

export async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const state = useSocialStore.getState();
    if (!state.ready) return;
    const now = new Date();
    // Crashed mid-publish last time: hand the post back to the queue.
    for (const p of state.posts) {
      if (p.status === "publishing" && !state.publishing.has(p.id) && now.getTime() - ms(p.updatedAt) > STALE_PUBLISHING_MS) {
        await state.updatePost(p.id, (x) => ({ ...x, status: "scheduled" }));
      }
    }
    const due = duePosts(useSocialStore.getState().posts, now, state.settings.lateToleranceMinutes, state.publishing);
    for (const post of due) await publishPost(post.id);
    const missed = missedPosts(useSocialStore.getState().posts, now, state.settings.lateToleranceMinutes);
    const known = new Set(state.catchUp.map((p) => p.id));
    if (missed.length !== state.catchUp.length || missed.some((p) => !known.has(p.id))) {
      useSocialStore.getState().setCatchUp(missed);
    }
  } catch (err) {
    logError("social", "tick", err);
  } finally {
    ticking = false;
  }
}

/** Starts the interval once; returns a stop function. */
export function startScheduler(): () => void {
  if (timer) return () => undefined;
  timer = setInterval(() => void tick(), TICK_MS);
  void tick();
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}
