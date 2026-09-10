import { findFacets, toByteRange } from "../facets";
import type { ChannelCredentials } from "../types";
import { HttpError, bearer, getJson, jsonOrThrow, postJson, sfetch } from "./http";
import { ProviderError, retryableStatus, type LoadedMedia, type Provider, type PublishInput } from "./types";

/**
 * Bluesky over the AT Protocol: app-password session, `uploadBlob` for
 * images, `createRecord` with rich-text facets (links, mentions resolved to
 * DIDs, hashtags) and reply refs for threads.
 * Docs: https://docs.bsky.app/docs/api/com-atproto-repo-create-record
 */

const DEFAULT_PDS = "https://bsky.social";

interface Session {
  accessJwt: string;
  refreshJwt: string;
  did: string;
  handle: string;
}

interface BlobRef {
  $type: "blob";
  ref: { $link: string };
  mimeType: string;
  size: number;
}

interface Profile {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

const xrpc = (pds: string, method: string) => `${pds.replace(/\/$/, "")}/xrpc/${method}`;

async function createSession(pds: string, identifier: string, password: string): Promise<Session> {
  try {
    return await postJson<Session>(xrpc(pds, "com.atproto.server.createSession"), { identifier, password });
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      throw new ProviderError("Bluesky rejected the handle or app password.", false);
    }
    throw err;
  }
}

async function refreshSession(pds: string, refreshJwt: string): Promise<Session> {
  return jsonOrThrow<Session>(
    await sfetch(xrpc(pds, "com.atproto.server.refreshSession"), { method: "POST", headers: bearer(refreshJwt) }),
  );
}

/** A live session from stored credentials: refresh first, full login if that fails. */
async function session(creds: ChannelCredentials): Promise<{ s: Session; creds: ChannelCredentials }> {
  const pds = creds.pds || DEFAULT_PDS;
  if (creds.refreshJwt) {
    try {
      const s = await refreshSession(pds, creds.refreshJwt);
      return { s, creds: { ...creds, accessJwt: s.accessJwt, refreshJwt: s.refreshJwt } };
    } catch {
      /* fall through to a fresh login */
    }
  }
  const s = await createSession(pds, creds.identifier ?? "", creds.password ?? "");
  return { s, creds: { ...creds, accessJwt: s.accessJwt, refreshJwt: s.refreshJwt } };
}

async function uploadBlob(pds: string, jwt: string, media: LoadedMedia): Promise<BlobRef> {
  const res = await sfetch(xrpc(pds, "com.atproto.repo.uploadBlob"), {
    method: "POST",
    headers: { ...bearer(jwt), "Content-Type": media.item.mime },
    body: media.bytes as BodyInit,
  });
  const data = await jsonOrThrow<{ blob: BlobRef }>(res);
  return data.blob;
}

const VIDEO_SERVICE = "https://video.bsky.app";
/** Bluesky's own limits (2026-09): 50 MB and three minutes per video. */
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const VIDEO_MAX_SECONDS = 180;

interface VideoJob {
  jobId: string;
  state: string;
  blob?: BlobRef;
  error?: string;
  message?: string;
}

/**
 * Video does not go through `uploadBlob`: it is handed to Bluesky's video
 * service with a short-lived service token, transcoded there, and only then
 * does a blob exist to embed. The job is polled until it finishes, so a
 * publish of a 30-second clip takes a few seconds longer than a text post.
 * Docs: https://docs.bsky.app/blog/videos
 */
async function uploadVideo(pds: string, s: Session, media: LoadedMedia): Promise<BlobRef> {
  if (media.bytes.length > VIDEO_MAX_BYTES) {
    throw new ProviderError(`Bluesky takes videos up to 50 MB; this one is ${(media.bytes.length / 1024 / 1024).toFixed(1)} MB.`, false);
  }
  const host = new URL(pds).hostname;
  const auth = await getJson<{ token: string }>(
    `${xrpc(pds, "com.atproto.server.getServiceAuth")}?aud=${encodeURIComponent(`did:web:${host}`)}&lxm=com.atproto.repo.uploadBlob&exp=${Math.floor(Date.now() / 1000) + 30 * 60}`,
    bearer(s.accessJwt),
  );
  const name = media.item.name.replace(/[^A-Za-z0-9._-]+/g, "_") || "video.mp4";
  // Both uploadVideo and getJobStatus answer `{ jobStatus }`; older builds of
  // the service answered with the job itself, so take either.
  const started = await jsonOrThrow<{ jobStatus?: VideoJob } & Partial<VideoJob>>(
    await sfetch(`${VIDEO_SERVICE}/xrpc/app.bsky.video.uploadVideo?did=${encodeURIComponent(s.did)}&name=${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { ...bearer(auth.token), "Content-Type": media.item.mime || "video/mp4" },
      body: media.bytes as BodyInit,
    }),
  );
  let job: VideoJob = started.jobStatus ?? (started as VideoJob);
  if (!job?.jobId && !job?.blob) throw new ProviderError("Bluesky's video service did not start a job.", true);
  const deadline = Date.now() + 5 * 60_000;
  while (!job.blob && Date.now() < deadline) {
    if (job.state === "JOB_STATE_FAILED") {
      throw new ProviderError(`Bluesky could not process the video: ${job.error ?? job.message ?? "unknown reason"}.`, false);
    }
    await new Promise((r) => setTimeout(r, 2000));
    const status = await getJson<{ jobStatus: VideoJob }>(
      `${VIDEO_SERVICE}/xrpc/app.bsky.video.getJobStatus?jobId=${encodeURIComponent(job.jobId)}`,
      bearer(auth.token),
    );
    job = status.jobStatus ?? job;
  }
  if (!job.blob) throw new ProviderError("Bluesky is still processing the video — try again in a moment.", true);
  return job.blob;
}

async function resolveHandle(pds: string, handle: string): Promise<string | null> {
  try {
    const data = await getJson<{ did: string }>(
      `${xrpc(pds, "com.atproto.identity.resolveHandle")}?handle=${encodeURIComponent(handle)}`,
    );
    return data.did || null;
  } catch {
    return null;
  }
}

export async function buildFacets(pds: string, text: string): Promise<unknown[]> {
  const facets: unknown[] = [];
  for (const f of findFacets(text)) {
    const index = toByteRange(text, f.start, f.end);
    if (f.kind === "link") {
      facets.push({ index, features: [{ $type: "app.bsky.richtext.facet#link", uri: f.value }] });
    } else if (f.kind === "tag") {
      facets.push({ index, features: [{ $type: "app.bsky.richtext.facet#tag", tag: f.value }] });
    } else if (f.kind === "mention") {
      // Only handles with a domain part are Bluesky mentions ("@alice.bsky.social").
      if (!f.value.includes(".")) continue;
      const did = await resolveHandle(pds, f.value);
      if (did) facets.push({ index, features: [{ $type: "app.bsky.richtext.facet#mention", did }] });
    }
  }
  return facets;
}

interface RecordRef {
  uri: string;
  cid: string;
}

async function createPost(
  pds: string,
  s: Session,
  text: string,
  media: LoadedMedia[],
  reply: { root: RecordRef; parent: RecordRef } | null,
): Promise<RecordRef> {
  const images = media.filter((m) => m.item.mime.startsWith("image/")).slice(0, 4);
  const video = media.find((m) => m.item.mime.startsWith("video/"));
  const record: Record<string, unknown> = {
    $type: "app.bsky.feed.post",
    text,
    createdAt: new Date().toISOString(),
    facets: await buildFacets(pds, text),
  };
  if (images.length) {
    const uploaded = [];
    for (const img of images) {
      const blob = await uploadBlob(pds, s.accessJwt, img);
      const entry: Record<string, unknown> = { alt: img.alt ?? img.item.alt ?? "", image: blob };
      if (img.item.width && img.item.height) entry.aspectRatio = { width: img.item.width, height: img.item.height };
      uploaded.push(entry);
    }
    record.embed = { $type: "app.bsky.embed.images", images: uploaded };
  } else if (video) {
    // One or the other: an AT Protocol post embeds images or a video, never both.
    const blob = await uploadVideo(pds, s, video);
    const embed: Record<string, unknown> = { $type: "app.bsky.embed.video", video: blob };
    const alt = video.alt ?? video.item.alt;
    if (alt) embed.alt = alt;
    if (video.item.width && video.item.height) embed.aspectRatio = { width: video.item.width, height: video.item.height };
    record.embed = embed;
  }
  if (reply) record.reply = reply;
  try {
    return await postJson<RecordRef>(xrpc(pds, "com.atproto.repo.createRecord"), {
      repo: s.did,
      collection: "app.bsky.feed.post",
      record,
    }, bearer(s.accessJwt));
  } catch (err) {
    if (err instanceof HttpError) throw new ProviderError(`Bluesky: ${err.message}`, retryableStatus(err.status));
    throw err;
  }
}

export function postUrl(handle: string, uri: string): string {
  const rkey = uri.split("/").pop() ?? "";
  return `https://bsky.app/profile/${handle}/post/${rkey}`;
}

export const bluesky: Provider = {
  id: "bluesky",
  fields: [
    { key: "identifier", label: "Handle", placeholder: "you.bsky.social", hint: "Or the e-mail of the account." },
    { key: "password", label: "App password", placeholder: "xxxx-xxxx-xxxx-xxxx", secret: true },
    { key: "pds", label: "PDS host", placeholder: DEFAULT_PDS, optional: true, hint: "Leave empty for bsky.social." },
  ],
  async connect(values) {
    const pds = (values.pds || DEFAULT_PDS).trim().replace(/\/$/, "");
    const identifier = values.identifier?.trim().replace(/^@/, "") ?? "";
    const s = await createSession(pds, identifier, values.password?.trim() ?? "");
    const profile = await getJson<Profile>(
      `${xrpc(pds, "app.bsky.actor.getProfile")}?actor=${encodeURIComponent(s.did)}`,
      bearer(s.accessJwt),
    );
    return {
      channel: {
        provider: "bluesky",
        handle: `@${profile.handle}`,
        displayName: profile.displayName?.trim() || profile.handle,
        avatar: null,
        preferences: {},
        meta: { did: s.did, pds },
      },
      creds: { identifier, password: values.password?.trim() ?? "", pds, accessJwt: s.accessJwt, refreshJwt: s.refreshJwt },
      avatarUrl: profile.avatar ?? null,
    };
  },
  async verify(_channel, creds) {
    const { s } = await session(creds);
    return { ok: true, message: `Signed in as @${s.handle}.` };
  },
  async publish(input: PublishInput) {
    const { s, creds } = await session(input.creds);
    const pds = creds.pds || DEFAULT_PDS;
    const root = await createPost(pds, s, input.content.text, input.media, null);
    let parent = root;
    for (let i = 0; i < input.content.thread.length; i += 1) {
      const part = input.content.thread[i]!;
      if (!part.text.trim() && !(input.threadMedia[i]?.length ?? 0)) continue;
      parent = await createPost(pds, s, part.text, input.threadMedia[i] ?? [], { root, parent });
    }
    return { url: postUrl(s.handle, root.uri), remoteId: root.uri, creds };
  },
};
