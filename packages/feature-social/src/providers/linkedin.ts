import { HttpError, bearer, describeResponse, getJson, postForm, sfetch } from "./http";
import { authorize } from "./oauth";
import { ProviderError, retryableStatus, type LoadedMedia, type Provider, type PublishInput } from "./types";

/**
 * LinkedIn member posts with the user's own app: OAuth 2.0 authorization
 * code (LinkedIn has no PKCE, the secret is required), `rest/posts` for the
 * post and `rest/images?action=initializeUpload` + PUT for one image.
 * Docs: https://learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api
 */

const AUTHORIZE = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN = "https://www.linkedin.com/oauth/v2/accessToken";
const SCOPE = "openid profile w_member_social";
/** Versioned API month; LinkedIn keeps a version live for about a year. */
export const LINKEDIN_VERSION = "202606";

const restHeaders = (token: string): Record<string, string> => ({
  ...bearer(token),
  "LinkedIn-Version": LINKEDIN_VERSION,
  "X-Restli-Protocol-Version": "2.0.0",
});

/** LinkedIn's "little" text format needs these escaped in `commentary`. */
export function escapeCommentary(text: string): string {
  return text.replace(/[\\|{}@[\]()<>*_~]/g, (c) => `\\${c}`);
}

interface UserInfo {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
}

async function uploadImage(token: string, owner: string, media: LoadedMedia): Promise<string> {
  const init = await sfetch("https://api.linkedin.com/rest/images?action=initializeUpload", {
    method: "POST",
    headers: { ...restHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ initializeUploadRequest: { owner } }),
  });
  if (!init.ok) throw new ProviderError(`LinkedIn image: ${await describeResponse(init)}`, retryableStatus(init.status));
  const { value } = (await init.json()) as { value: { uploadUrl: string; image: string } };
  const put = await sfetch(value.uploadUrl, {
    method: "PUT",
    headers: { ...bearer(token), "Content-Type": "application/octet-stream" },
    body: media.bytes as BodyInit,
  });
  if (!put.ok) throw new ProviderError(`LinkedIn image upload: ${await describeResponse(put)}`, retryableStatus(put.status));
  return value.image;
}

export const linkedin: Provider = {
  id: "linkedin",
  fields: [
    { key: "clientId", label: "Client ID", placeholder: "from the LinkedIn developer app" },
    { key: "clientSecret", label: "Client secret", placeholder: "required by LinkedIn", secret: true },
  ],
  async connect(values, progress) {
    const clientId = values.clientId?.trim() ?? "";
    const clientSecret = values.clientSecret?.trim() ?? "";
    if (!clientId || !clientSecret) throw new ProviderError("LinkedIn needs both the client id and the client secret.", false);
    const auth = await authorize({ authorizeUrl: AUTHORIZE, clientId, scope: SCOPE, pkce: false }, progress);
    progress("Exchanging the code for a token…");
    const t = await postForm<{ access_token: string; expires_in?: number }>(TOKEN, {
      grant_type: "authorization_code",
      code: auth.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: auth.redirectUri,
    });
    const me = await getJson<UserInfo>("https://api.linkedin.com/v2/userinfo", bearer(t.access_token));
    const name = me.name || [me.given_name, me.family_name].filter(Boolean).join(" ") || "LinkedIn member";
    return {
      channel: {
        provider: "linkedin",
        handle: name.toLowerCase().replace(/\s+/g, "-"),
        displayName: name,
        avatar: null,
        preferences: {},
        meta: { authorUrn: `urn:li:person:${me.sub}` },
      },
      creds: {
        clientId,
        clientSecret,
        accessToken: t.access_token,
        expiresAt: new Date(Date.now() + (t.expires_in ?? 60 * 24 * 3600) * 1000).toISOString(),
      },
      avatarUrl: me.picture ?? null,
    };
  },
  async verify(_channel, creds) {
    const me = await getJson<UserInfo>("https://api.linkedin.com/v2/userinfo", bearer(creds.accessToken ?? ""));
    return { ok: true, message: `Signed in as ${me.name ?? me.sub}.` };
  },
  async publish(input: PublishInput) {
    const token = input.creds.accessToken ?? "";
    if (input.creds.expiresAt && new Date(input.creds.expiresAt).getTime() <= Date.now()) {
      throw new ProviderError("The LinkedIn token expired (they last 60 days) — reconnect the channel.", false);
    }
    const author = input.channel.meta.authorUrn;
    if (!author) throw new ProviderError("This channel has no author URN — reconnect it.", false);
    const body: Record<string, unknown> = {
      author,
      commentary: escapeCommentary(input.content.text),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    };
    const image = input.media.find((m) => m.item.mime.startsWith("image/"));
    if (image) {
      const urn = await uploadImage(token, author, image);
      body.content = { media: { id: urn, altText: image.alt ?? image.item.alt ?? "" } };
    }
    let res: Response;
    try {
      res = await sfetch("https://api.linkedin.com/rest/posts", {
        method: "POST",
        headers: { ...restHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (err instanceof HttpError) throw new ProviderError(`LinkedIn: ${err.message}`, retryableStatus(err.status));
      throw err;
    }
    if (!res.ok) throw new ProviderError(`LinkedIn: ${await describeResponse(res)}`, retryableStatus(res.status));
    const id = res.headers.get("x-restli-id") ?? "";
    return { url: id ? `https://www.linkedin.com/feed/update/${id}/` : null, remoteId: id || null };
  },
};
