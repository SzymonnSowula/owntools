import type { ChannelCredentials } from "../types";
import { HttpError, bearer, describeResponse, fileFromBytes, getJson, postForm, postJson, sfetch } from "./http";
import { authorize, basicAuth } from "./oauth";
import { ProviderError, retryableStatus, type LoadedMedia, type Provider, type PublishInput } from "./types";

/**
 * X (Twitter) with the user's own developer app: OAuth 2.0 + PKCE, tweets
 * and threads through `POST /2/tweets`, media through the v2 chunked upload
 * (`/2/media/upload/initialize` → `/{id}/append` → `/{id}/finalize`).
 * Docs: https://docs.x.com/x-api/posts/creation-of-a-post ·
 * https://docs.x.com/x-api/media/quickstart/media-upload-chunked
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

function tokenHeaders(creds: { clientId?: string; clientSecret?: string }): Record<string, string> {
  return creds.clientSecret ? { Authorization: basicAuth(creds.clientId ?? "", creds.clientSecret) } : {};
}

function withExpiry(creds: ChannelCredentials, t: TokenResponse): ChannelCredentials {
  const next: ChannelCredentials = { ...creds, accessToken: t.access_token };
  if (t.refresh_token) next.refreshToken = t.refresh_token;
  next.expiresAt = new Date(Date.now() + ((t.expires_in ?? 7200) - 120) * 1000).toISOString();
  return next;
}

/** Fresh credentials: refreshes when the access token is (about to be) expired. */
async function freshCreds(creds: ChannelCredentials): Promise<ChannelCredentials> {
  const expired = !creds.expiresAt || new Date(creds.expiresAt).getTime() <= Date.now();
  if (!expired) return creds;
  if (!creds.refreshToken) throw new ProviderError("The X session expired — reconnect the channel.", false);
  try {
    const t = await postForm<TokenResponse>(
      TOKEN,
      { grant_type: "refresh_token", refresh_token: creds.refreshToken, client_id: creds.clientId ?? "" },
      tokenHeaders(creds),
    );
    return withExpiry(creds, t);
  } catch (err) {
    if (err instanceof HttpError && (err.status === 400 || err.status === 401)) {
      throw new ProviderError("X refused to refresh the session — reconnect the channel.", false);
    }
    throw err;
  }
}

function category(media: LoadedMedia): string {
  if (media.item.mime === "image/gif") return "tweet_gif";
  if (media.item.mime.startsWith("video/")) return "tweet_video";
  return "tweet_image";
}

async function uploadMedia(token: string, media: LoadedMedia): Promise<string> {
  const h = bearer(token);
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
    if (!res.ok) throw new ProviderError(`X media upload: ${await describeResponse(res)}`, retryableStatus(res.status));
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
    if (err instanceof HttpError) throw new ProviderError(`X: ${err.message}`, retryableStatus(err.status));
    throw err;
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
    );
    const creds = withExpiry({ clientId, clientSecret }, t);
    const me = await getJson<Me>(`${API}/users/me?user.fields=profile_image_url`, bearer(creds.accessToken ?? ""));
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
  async verify(_channel, creds) {
    const fresh = await freshCreds(creds);
    const me = await getJson<Me>(`${API}/users/me`, bearer(fresh.accessToken ?? ""));
    return { ok: true, message: `Signed in as @${me.data.username}.` };
  },
  async publish(input: PublishInput) {
    const creds = await freshCreds(input.creds);
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
