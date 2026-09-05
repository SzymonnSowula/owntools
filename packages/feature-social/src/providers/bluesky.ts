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
