import type { ChannelCredentials } from "../types";
import { HttpError, bearer, fileFromBytes, getJson, postForm, postJson, postMultipart } from "./http";
import { ProviderError, retryableStatus, type LoadedMedia, type Provider, type PublishInput } from "./types";

/**
 * Mastodon (and anything speaking its API — GoToSocial, Pleroma, Akkoma…).
 * Connect = register an app on the instance with the out-of-band redirect,
 * send the user to /oauth/authorize, paste the code back, swap it for a
 * token. Docs: https://docs.joinmastodon.org/methods/apps/ · /statuses/ · /media/
 */

export const OOB = "urn:ietf:wg:oauth:2.0:oob";
const SCOPES = "read:accounts write:statuses write:media";

export function normalizeInstance(raw: string): string {
  let s = raw.trim();
  if (!s) throw new ProviderError("Enter your instance, e.g. mastodon.social.", false);
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s.replace(/\/+$/, "");
}

interface App {
  client_id: string;
  client_secret: string;
}

interface Account {
  id: string;
  username: string;
  acct: string;
  display_name: string;
  avatar: string;
  url: string;
}

export async function registerApp(instance: string): Promise<App> {
  return postJson<App>(`${instance}/api/v1/apps`, {
    client_name: "shipshape social",
    redirect_uris: OOB,
    scopes: SCOPES,
    website: "https://shipshape.app",
  });
}

export function authorizeUrl(instance: string, clientId: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: OOB,
    response_type: "code",
  });
  return `${instance}/oauth/authorize?${q.toString()}`;
}

export async function exchangeCode(instance: string, app: App, code: string): Promise<string> {
  const data = await postForm<{ access_token: string }>(`${instance}/oauth/token`, {
    grant_type: "authorization_code",
    code: code.trim(),
    client_id: app.client_id,
    client_secret: app.client_secret,
    redirect_uri: OOB,
    scope: SCOPES,
  });
  if (!data.access_token) throw new ProviderError("The instance did not return a token.", false);
  return data.access_token;
}

export async function verifyCredentials(instance: string, token: string): Promise<Account> {
  return getJson<Account>(`${instance}/api/v1/accounts/verify_credentials`, bearer(token));
}

/** Character limit the instance advertises (defaults to 500). */
export async function instanceLimit(instance: string): Promise<number> {
  try {
    const info = await getJson<{ configuration?: { statuses?: { max_characters?: number } } }>(`${instance}/api/v2/instance`);
    const n = info.configuration?.statuses?.max_characters;
    return typeof n === "number" && n > 0 ? n : 500;
  } catch {
    return 500;
  }
}

async function uploadMedia(instance: string, token: string, media: LoadedMedia): Promise<string> {
  const form = new FormData();
  form.append("file", fileFromBytes(media.bytes, media.item.name, media.item.mime));
  const alt = media.alt ?? media.item.alt;
  if (alt) form.append("description", alt);
  const data = await postMultipart<{ id: string }>(`${instance}/api/v2/media`, form, bearer(token));
  // 202 = still processing; a short wait is enough for images.
  await new Promise((r) => setTimeout(r, 800));
  return data.id;
}

interface Status {
  id: string;
  url: string;
  uri: string;
}

async function postStatus(
  instance: string,
  token: string,
  text: string,
  media: LoadedMedia[],
  inReplyTo: string | null,
  visibility: string,
): Promise<Status> {
  const mediaIds: string[] = [];
  for (const m of media.slice(0, 4)) mediaIds.push(await uploadMedia(instance, token, m));
  const body: Record<string, unknown> = { status: text, visibility };
  if (mediaIds.length) body.media_ids = mediaIds;
  if (inReplyTo) body.in_reply_to_id = inReplyTo;
  try {
    return await postJson<Status>(`${instance}/api/v1/statuses`, body, {
      ...bearer(token),
      "Idempotency-Key": `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
  } catch (err) {
    if (err instanceof HttpError) throw new ProviderError(`Mastodon: ${err.message}`, retryableStatus(err.status));
    throw err;
  }
}

/**
 * The Add-channel form drives this provider in two steps; `connect` receives
 * either {instance} (step 1 → returns the URL to open through a thrown
 * `NeedsCode`) or {instance, code, clientId, clientSecret} (step 2).
 */
export class NeedsCode extends Error {
  constructor(
    public readonly url: string,
    public readonly app: App,
  ) {
    super("needs-code");
    this.name = "NeedsCode";
  }
}

export const mastodon: Provider = {
  id: "mastodon",
  fields: [
    { key: "instance", label: "Instance", placeholder: "mastodon.social" },
    { key: "code", label: "Authorisation code", placeholder: "paste the code from the browser", optional: true },
  ],
  async connect(values, progress) {
    const instance = normalizeInstance(values.instance ?? "");
    let app: App;
    if (values.clientId && values.clientSecret) {
      app = { client_id: values.clientId, client_secret: values.clientSecret };
    } else {
      progress("Registering shipshape on the instance…");
      app = await registerApp(instance);
    }
    if (!values.code?.trim()) throw new NeedsCode(authorizeUrl(instance, app.client_id), app);
    progress("Exchanging the code for a token…");
    const token = await exchangeCode(instance, app, values.code);
    const account = await verifyCredentials(instance, token);
    const limit = await instanceLimit(instance);
    const host = instance.replace(/^https?:\/\//, "");
    return {
      channel: {
        provider: "mastodon",
        handle: `@${account.username}@${host}`,
        displayName: account.display_name?.trim() || account.username,
        avatar: null,
        preferences: limit !== 500 ? { charLimit: limit } : {},
        meta: { instance, accountId: account.id, accountUrl: account.url },
      },
      creds: { instance, token, clientId: app.client_id, clientSecret: app.client_secret },
      avatarUrl: account.avatar ?? null,
    };
  },
  async verify(_channel, creds: ChannelCredentials) {
    const account = await verifyCredentials(creds.instance ?? "", creds.token ?? "");
    return { ok: true, message: `Signed in as @${account.acct}.` };
  },
  async publish(input: PublishInput) {
    const instance = input.creds.instance ?? "";
    const token = input.creds.token ?? "";
    const visibility = input.channel.preferences.visibility ?? "public";
    const root = await postStatus(instance, token, input.content.text, input.media, null, visibility);
    let parent = root.id;
    for (let i = 0; i < input.content.thread.length; i += 1) {
      const part = input.content.thread[i]!;
      if (!part.text.trim() && !(input.threadMedia[i]?.length ?? 0)) continue;
      const s = await postStatus(instance, token, part.text, input.threadMedia[i] ?? [], parent, visibility);
      parent = s.id;
    }
    return { url: root.url || root.uri, remoteId: root.id };
  },
};
