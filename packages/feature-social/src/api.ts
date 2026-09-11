/**
 * social's door for the other tools (meet, capture, automations, screeni).
 *
 * The composer's UI is not the only way a post starts: a finished meeting
 * wants its summary posted, an automation wants "every export → a draft",
 * capture wants "share this screenshot". They all come through here, so the
 * rules (limits, approval queue, `source` labelling, queue slots) live in one
 * place and the calling tool never reaches into the social store.
 *
 * `draftFromInput` is the pure half — what gets written, given what the
 * store holds — and is what the tests cover; `createDraft` does the IO.
 */

import { isTauri } from "@core/env";
import { logError } from "@core/errors";
import { OPEN_TOOL_EVENT } from "@core/handoff";
import { makeEntry } from "./activity";
import { newPost } from "./model";
import { REVIEW_MESSAGE, approvalApplies, approvalOn, initialStatus } from "./review";
import { startSocialRuntime } from "./runtime";
import { nextFreeSlot } from "./slots";
import { useSocialStore } from "./store";
import { toIso } from "./time";
import type { Channel, MediaItem, MediaRef, Post, PostSource, SocialSettings } from "./types";
import { useUi } from "./ui";

export type DraftSource = "user" | "agent" | "automation" | "meet" | "capture" | "screeni";

export interface CreateDraftInput {
  text: string;
  /** Channel ids to post to; empty = the composer opens with none selected. */
  channelIds?: string[];
  /** Absolute paths of media on this machine to attach (imported into the library). */
  mediaPaths?: string[];
  /** In-memory media (a rendered export handed over without touching the disk). */
  media?: { bytes: Uint8Array; name: string; mime: string }[];
  /** ISO time; omitted = a draft with no time (or the next queue slot when `queue` is set). */
  scheduledAt?: string;
  /** Put it in the next free queue slot of the selected channels. */
  queue?: boolean;
  source: DraftSource;
  /** Opens the composer on the new draft. Default true for user-facing callers. */
  open?: boolean;
}

export interface CreateDraftResult {
  id: string;
  /** "draft" | "needs_review" | "scheduled" */
  status: string;
  /** Set when the post waits for approval — what to tell the person. */
  message?: string;
}

/** The post's `source` for a caller's label; "user" is the composer's own "app". */
export function sourceOf(source: DraftSource): PostSource {
  return source === "user" ? "app" : source;
}

export interface DraftContext {
  channels: Channel[];
  posts: Post[];
  settings: Pick<SocialSettings, "agentPostsNeedApproval">;
  /** Library ids of the media already imported for this draft. */
  media: MediaRef[];
  now?: Date;
}

/**
 * The post `createDraft` writes. Unknown channel ids are dropped, `queue`
 * takes the next free slot of the chosen channels, and the status follows
 * the review rules: an agent's or an automation's post waits for approval
 * while the setting is on, whatever time it carries.
 */
export function draftFromInput(input: CreateDraftInput, ctx: DraftContext): Post {
  const now = ctx.now ?? new Date();
  const source = sourceOf(input.source);
  const channelIds = (input.channelIds ?? []).filter((id) => ctx.channels.some((c) => c.id === id));
  let scheduledAt = input.scheduledAt?.trim() ? input.scheduledAt : null;
  if (!scheduledAt && input.queue) {
    const slot = nextFreeSlot(channelIds, now, { channels: ctx.channels, posts: ctx.posts });
    if (slot) scheduledAt = toIso(slot);
  }
  const status = initialStatus({ source, channelIds, scheduledAt }, approvalOn(ctx.settings));
  return newPost({
    source,
    status,
    scheduledAt,
    channelIds,
    content: { text: input.text, media: [...ctx.media], thread: [] },
  });
}

/** A file already on this machine → the media library, through Rust (the fs scope is AppData-only). */
async function importMediaFromPath(path: string): Promise<MediaItem | null> {
  if (!isTauri()) {
    logError("social", "media from path", new Error(`not in the desktop app — cannot read ${path}`));
    return null;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<MediaItem>("social_media_from_path", { path, alt: null, name: null });
  } catch (err) {
    logError("social", `media from path ${path}`, err);
    return null;
  }
}

/** Switches to social and opens the composer on the draft (the composer reads the ui store when it mounts). */
function openOnDraft(id: string): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OPEN_TOOL_EVENT, { detail: { tool: "social" } }));
  useUi.getState().setPage("calendar");
  useUi.getState().openComposer(id);
}

export async function createDraft(input: CreateDraftInput): Promise<CreateDraftResult> {
  await startSocialRuntime();
  const store = useSocialStore.getState();
  const media: MediaRef[] = [];
  for (const m of input.media ?? []) {
    const item = await store.addMedia(m);
    media.push({ id: item.id });
  }
  let imported = false;
  for (const path of input.mediaPaths ?? []) {
    const item = await importMediaFromPath(path);
    if (item) {
      media.push({ id: item.id });
      imported = true;
    }
  }
  // Rust wrote straight into media.json; the store's copy is behind.
  if (imported) await store.reload();
  const fresh = useSocialStore.getState();
  const post = draftFromInput(input, { channels: fresh.channels, posts: fresh.posts, settings: fresh.settings, media });
  const saved = await fresh.createPost(post);
  if (approvalApplies(saved.source)) {
    await fresh.appendActivity(
      makeEntry(saved.source === "agent" ? "agent" : "automation", "create", saved.id, { after: saved, note: `created through createDraft (${input.source})` }),
    );
  }
  if (input.open ?? true) openOnDraft(saved.id);
  const result: CreateDraftResult = { id: saved.id, status: saved.status };
  if (saved.status === "needs_review") result.message = REVIEW_MESSAGE;
  return result;
}
