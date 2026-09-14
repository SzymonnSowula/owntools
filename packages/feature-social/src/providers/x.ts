import type { ChannelCredentials } from "../types";
import { HttpError, bearer, describeResponse, fileFromBytes, getJson, postForm, postJson, sfetch } from "./http";
import { authorize, basicAuth } from "./oauth";
import { ProviderError, retryableStatus, type LoadedMedia, type Provider, type PublishInput, type SaveCreds } from "./types";

/**
 * X (Twitter) with the user's own developer app: OAuth 2.0 + PKCE, tweets
 * and threads through `POST /2/tweets`, media through the v2 chunked upload
 * (`/2/media/upload/initialize` → `/{id}/append` → `/{id}/finalize`).
 * Docs: https://docs.x.com/x-api/posts/creation-of-a-post ·
 * https://docs.x.com/x-api/media/quickstart/media-upload-chunked
 *
 * The API is pay-per-use: the developer account behind the app holds
 * credits, and a call made on an empty balance answers 402. The OAuth token
 * endpoint is not billed, which is how a refresh could succeed right before
 * the media upload was refused.
 */

const AUTHORIZE = "https://x.com/i/oauth2/authorize";
const TOKEN = "https://api.x.com/2/oauth2/token";
const API = "https://api.x.com/2";
const SCOPE = "tweet.read tweet.write users.read offline.access media.write";

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type: string;
}

interface Me {
  data: { id: string; username: string; name: string; profile_image_url?: string };
}

/** What an HTTP failure from X means to the person reading the post's error line. */
export function xError(err: unknown, label: string): unknown {
  if (!(err instanceof HttpError)) return err;
  if (err.status === 402) {
    return new ProviderError(
      `Your X developer account is out of API credits (${err.message}) — top up or raise the spending limit at console.x.com, then try again.`,
      false,
      "billing",
    );
  }
  if (err.status === 401) {
    return new ProviderError(`X no longer accepts this sign-in (${err.message}) — reconnect the channel.`, false, "auth");
  }
  return new ProviderError(`${label}: ${err.message}`, retryableStatus(err.status));
}

function tokenHeaders(creds: { clientId?: string; clientSecret?: string }): Record<string, string> {
  return creds.clientSecret ? { Authorization: basicAuth(creds.clientId ?? "", creds.clientSecret) } : {};
}

function withExpiry(creds: ChannelCredentials, t: TokenResponse): ChannelCredentials {
  const next: ChannelCredentials = { ...creds, accessToken: t.access_token };
  if (t.refresh_token) next.refreshToken = t.refresh_token;
  next.expiresAt = new Date(Date.now() + ((t.expires_in ?? 7200) - 120) * 1000).toISOString();
  return next;
}

/*
 * X rotates refresh tokens: a refresh answers with a new one and the one just
 * used stops working. So a refresh is never made twice with the same token —
 * a second caller waits for the first (`inflight`), and a caller still holding
 * a copy from before a rotation is handed the rotated set (`rotated`, old
 * refresh token → what replaced it). "Publish all now" on the catch-up sheet
 * starts every missed post at once, which is exactly two refreshes of one
 * token.
 */
const inflight = new Map<string, Promise<ChannelCredentials>>();
const rotated = new Map<string, ChannelCredentials>();
const ROTATIONS_KEPT = 32;

function remember(used: string, next: ChannelCredentials): void {
  if (!next.refreshToken || next.refreshToken === used) return;
  rotated.set(used, next);
  while (rotated.size > ROTATIONS_KEPT) rotated.delete(rotated.keys().next().value as string);
}

function latest(creds: ChannelCredentials): ChannelCredentials {
  let current = creds;
  for (let hop = 0; hop < ROTATIONS_KEPT && current.refreshToken && rotated.has(current.refreshToken); hop += 1) {
    current = rotated.get(current.refreshToken)!;
  }
  return current;
}

async function refresh(creds: ChannelCredentials, refreshToken: string): Promise<ChannelCredentials> {
  try {
    const t = await postForm<TokenResponse>(
      TOKEN,
      { grant_type: "refresh_token", refresh_token: refreshToken, client_id: creds.clientId ?? "" },
      tokenHeaders(creds),
    );
    const next = withExpiry(creds, t);
    remember(refreshToken, next);
    return next;
  } catch (err) {
    if (err instanceof HttpError && (err.status === 400 || err.status === 401)) {
      throw new ProviderError(`X refused to refresh the session (${err.message}) — reconnect the channel.`, false, "auth");
    }
    throw xError(err, "X session refresh");
  }
}

/** Fresh credentials: refreshes when the access token is (about to be) expired, and stores what it got at once. */
export async function freshCreds(creds: ChannelCredentials, save?: SaveCreds): Promise<ChannelCredentials> {
  const current = latest(creds);
  const expired = !current.expiresAt || new Date(current.expiresAt).getTime() <= Date.now();
  if (!expired) return current;
  const refreshToken = current.refreshToken;
  if (!refreshToken) throw new ProviderError("The X session expired — reconnect the channel.", false, "auth");
  let pending = inflight.get(refreshToken);
  if (!pending) {
    pending = refresh(current, refreshToken).finally(() => inflight.delete(refreshToken));
    inflight.set(refreshToken, pending);
  }
  const next = await pending;
  await save?.(next);
  return next;
}

function category(media: LoadedMedia): string {
  if (media.item.mime === "image/gif") return "tweet_gif";
  if (media.item.mime.startsWith("video/")) return "tweet_video";
  return "tweet_image";
}

async function uploadMedia(token: string, media: LoadedMedia): Promise<string> {
  const h = bearer(token);
  try {
    const init = await postJson<{ data: { id: string } }>(
      `${API}/media/upload/initialize`,
      { media_type: media.item.mime, total_bytes: media.bytes.length, media_category: category(media) },
      h,
    );
    const id = init.data.id;
    const CHUNK = 4 * 1024 * 1024;
    for (let i = 0, seg = 0; i < media.bytes.length; i += CHUNK, seg += 1) {
      const form = new FormData();
      form.append("segment_index", String(seg));
      form.append("media", fileFromBytes(media.bytes.subarray(i, i + CHUNK), media.item.name, media.item.mime));
      const res = await sfetch(`${API}/media/upload/${id}/append`, { method: "POST", headers: h, body: form });
      if (!res.ok) throw new HttpError(res.status, await describeResponse(res), "");
    }
    const fin = await postJson<{ data: { id: string; processing_info?: { state: string; check_after_secs?: number } } }>(
      `${API}/media/upload/${id}/finalize`,
      {},
      h,
    );
    let info = fin.data.processing_info;
    for (let i = 0; info && info.state !== "succeeded" && i < 20; i += 1) {
      if (info.state === "failed") throw new ProviderError("X could not process the media.", false);
      const wait = (info.check_after_secs ?? 2) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      const st = await getJson<{ data: { processing_info?: { state: string; check_after_secs?: number } } }>(
        `${API}/media/upload?command=STATUS&media_id=${id}`,
        h,
      );
      info = st.data.processing_info;
    }
    if (media.alt ?? media.item.alt) {
      await postJson(`${API}/media/metadata`, { id, metadata: { alt_text: { text: (media.alt ?? media.item.alt ?? "").slice(0, 1000) } } }, h).catch(() => undefined);
    }
    return id;
  } catch (err) {
    throw xError(err, "X media upload");
  }
}

async function tweet(token: string, text: string, media: LoadedMedia[], replyTo: string | null): Promise<string> {
  const body: Record<string, unknown> = { text };
  if (media.length) {
    const ids: string[] = [];
    for (const m of media.slice(0, 4)) ids.push(await uploadMedia(token, m));
    body.media = { media_ids: ids };
  }
  if (replyTo) body.reply = { in_reply_to_tweet_id: replyTo };
  try {
    const out = await postJson<{ data: { id: string } }>(`${API}/tweets`, body, bearer(token));
    return out.data.id;
  } catch (err) {
    throw xError(err, "X");
  }
}

export const x: Provider = {
  id: "x",
  fields: [
    { key: "clientId", label: "OAuth 2.0 Client ID", placeholder: "from the X developer portal" },
    { key: "clientSecret", label: "Client secret", placeholder: "only for confidential clients", secret: true, optional: true },
  ],
  async connect(values, progress) {
    const clientId = values.clientId?.trim() ?? "";
    if (!clientId) throw new ProviderError("The client id from your X developer app is needed.", false);
    const clientSecret = values.clientSecret?.trim() ?? "";
    const auth = await authorize({ authorizeUrl: AUTHORIZE, clientId, scope: SCOPE, pkce: true }, progress);
    progress("Exchanging the code for a token…");
    const t = await postForm<TokenResponse>(
      TOKEN,
      {
        grant_type: "authorization_code",
        code: auth.code,
        client_id: clientId,
        redirect_uri: auth.redirectUri,
        code_verifier: auth.verifier ?? "",
      },
      tokenHeaders({ clientId, clientSecret }),
    ).catch((err: unknown) => {
      throw xError(err, "X sign-in");
    });
    const creds = withExpiry({ clientId, clientSecret }, t);
    const me = await getJson<Me>(`${API}/users/me?user.fields=profile_image_url`, bearer(creds.accessToken ?? "")).catch((err: unknown) => {
      throw xError(err, "X account lookup");
    });
    return {
      channel: {
        provider: "x",
        handle: `@${me.data.username}`,
        displayName: me.data.name,
        avatar: null,
        preferences: {},
        meta: { userId: me.data.id, username: me.data.username },
      },
      creds,
      avatarUrl: me.data.profile_image_url?.replace("_normal", "_400x400") ?? null,
    };
  },
  async verify(_channel, creds, saveCreds) {
    const fresh = await freshCreds(creds, saveCreds);
    const me = await getJson<Me>(`${API}/users/me`, bearer(fresh.accessToken ?? "")).catch((err: unknown) => {
      throw xError(err, "X account lookup");
    });
    return { ok: true, message: `Signed in as @${me.data.username}.` };
  },
  async publish(input: PublishInput) {
    const creds = await freshCreds(input.creds, input.saveCreds);
    const token = creds.accessToken ?? "";
    const rootId = await tweet(token, input.content.text, input.media, null);
    let parent = rootId;
    for (let i = 0; i < input.content.thread.length; i += 1) {
      const part = input.content.thread[i]!;
      if (!part.text.trim() && !(input.threadMedia[i]?.length ?? 0)) continue;
      parent = await tweet(token, part.text, input.threadMedia[i] ?? [], parent);
    }
    const username = input.channel.meta.username || input.channel.handle.replace(/^@/, "");
    return { url: `https://x.com/${username}/status/${rootId}`, remoteId: rootId, creds };
  },
};
