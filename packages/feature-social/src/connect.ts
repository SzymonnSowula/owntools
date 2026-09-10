import type { NetworkId } from "./types";

/**
 * "Paste anything." Connecting an account is the step where people give up:
 * every network hides its credential somewhere else and calls it something
 * else. So instead of asking which network first and what the token is
 * second, we take whatever is on the clipboard — a webhook URL, a bot
 * token, a handle, an instance address, a profile link — and work out both.
 *
 * Everything here is a pure function over the pasted text: no network, no
 * store, no DOM. `detectPaste` returns the network plus the connect-form
 * values it could fill in; the dialog decides what is still missing.
 */

export interface PasteMatch {
  network: NetworkId;
  /** Values keyed the way that provider's `fields` are keyed. */
  values: Record<string, string>;
  /** What was recognised, in the user's words: "a Discord webhook". */
  what: string;
  /**
   * `exact` = the credential itself was in the paste (we can connect right
   * away when nothing else is required); `hint` = only a link or a handle,
   * so this opens the right form with a head start.
   */
  confidence: "exact" | "hint";
}

/** Hosts that identify a network on their own, for links people paste. */
const HOSTS: { test: RegExp; network: NetworkId; what: string }[] = [
  { test: /(^|\.)x\.com$|(^|\.)twitter\.com$/i, network: "x", what: "an X link" },
  { test: /(^|\.)bsky\.app$|(^|\.)bsky\.social$/i, network: "bluesky", what: "a Bluesky link" },
  { test: /(^|\.)threads\.(net|com)$/i, network: "threads", what: "a Threads link" },
  { test: /(^|\.)instagram\.com$/i, network: "instagram", what: "an Instagram link" },
  { test: /(^|\.)facebook\.com$|(^|\.)fb\.com$/i, network: "facebook", what: "a Facebook link" },
  { test: /(^|\.)linkedin\.com$/i, network: "linkedin", what: "a LinkedIn link" },
  { test: /(^|\.)reddit\.com$/i, network: "reddit", what: "a Reddit link" },
  { test: /(^|\.)t\.me$|(^|\.)telegram\.me$/i, network: "telegram", what: "a Telegram link" },
  { test: /(^|\.)dev\.to$/i, network: "devto", what: "a Dev.to link" },
  { test: /(^|\.)medium\.com$/i, network: "medium", what: "a Medium link" },
  { test: /(^|\.)hashnode\.(com|dev)$/i, network: "hashnode", what: "a Hashnode link" },
  { test: /(^|\.)tumblr\.com$/i, network: "tumblr", what: "a Tumblr link" },
  { test: /(^|\.)tiktok\.com$/i, network: "tiktok", what: "a TikTok link" },
  { test: /(^|\.)youtube\.com$|(^|\.)youtu\.be$/i, network: "youtube", what: "a YouTube link" },
  { test: /(^|\.)pinterest\.[a-z.]+$/i, network: "pinterest", what: "a Pinterest link" },
  { test: /(^|\.)warpcast\.com$|(^|\.)farcaster\.xyz$/i, network: "farcaster", what: "a Farcaster link" },
  { test: /(^|\.)dribbble\.com$/i, network: "dribbble", what: "a Dribbble link" },
  { test: /(^|\.)vk\.com$/i, network: "vk", what: "a VK link" },
];

/** Instance hosts that are Mastodon often enough to guess from the name alone. */
const MASTODON_HINT = /^(mastodon|mstdn|mas|social|toot|fosstodon|hachyderm|infosec|chaos|tech|indieweb|ruby|hci|floss|scholar|mathstodon|sfba|typo|kolektiva|todon|troet|norden|climatejustice|piaille|framapiaf|pouet|mamot|social\.)/i;

function firstUrl(text: string): URL | null {
  const m = text.match(/https?:\/\/[^\s<>"')\]]+/i);
  if (!m) return null;
  try {
    return new URL(m[0].replace(/[.,;]+$/, ""));
  } catch {
    return null;
  }
}

function hostNetwork(host: string): { network: NetworkId; what: string } | null {
  for (const h of HOSTS) if (h.test.test(host)) return { network: h.network, what: h.what };
  return null;
}

/** `@name.bsky.social`, `name.bsky.social`, or the handle out of a profile link. */
function blueskyHandle(text: string): string | null {
  const url = firstUrl(text);
  const fromUrl = url?.pathname.match(/^\/profile\/([^/]+)/i)?.[1];
  if (fromUrl) return fromUrl.replace(/^@/, "");
  const bare = text.match(/@?\b([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:bsky\.social|bsky\.team))\b/i)?.[1];
  if (bare) return bare;
  return null;
}

function normalizeHost(raw: string): string {
  return raw.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
}

/**
 * Work out which network a pasted string belongs to and what of the connect
 * form it already answers. Returns null when nothing recognisable is there.
 */
export function detectPaste(raw: string): PasteMatch | null {
  const text = raw.trim();
  if (!text || text.length > 4000) return null;

  // 1. Webhooks — the URL is the whole credential, so these are exact.
  const discord = text.match(/https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d+\/[\w-]+/i);
  if (discord) {
    return { network: "discord", values: { webhook: discord[0] }, what: "a Discord webhook", confidence: "exact" };
  }
  const slack = text.match(/https:\/\/hooks\.slack\.com\/(?:services|workflows|triggers)\/[\w/+-]+/i);
  if (slack) {
    return { network: "slack", values: { webhook: slack[0] }, what: "a Slack incoming webhook", confidence: "exact" };
  }

  // 2. Telegram bot token — `<digits>:<35ish chars>`, unmistakable.
  const tg = text.match(/\b(\d{6,12}):([A-Za-z0-9_-]{30,})\b/);
  if (tg) {
    const values: Record<string, string> = { token: tg[0] };
    const chat =
      text.match(/https?:\/\/t\.me\/([A-Za-z][\w]{3,})/i)?.[1] ??
      text.match(/(?:^|\s)@([A-Za-z][\w]{3,})\b/)?.[1] ??
      text.match(/(?:^|\s)(-100\d{5,})\b/)?.[1];
    if (chat) values.chatId = chat.startsWith("-") ? chat : `@${chat}`;
    return { network: "telegram", values, what: "a Telegram bot token", confidence: "exact" };
  }

  // 3. Bluesky app password (`xxxx-xxxx-xxxx-xxxx`), with the handle when it came along.
  const appPassword = text.match(/\b([a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})\b/i);
  if (appPassword) {
    const values: Record<string, string> = { password: appPassword[1]! };
    const handle = blueskyHandle(text);
    if (handle) values.identifier = handle;
    return { network: "bluesky", values, what: "a Bluesky app password", confidence: "exact" };
  }

  // 4. Mattermost / self-hosted incoming webhook: any URL with /hooks/<id>.
  const url = firstUrl(text);
  if (url && /\/hooks\/[\w-]{16,}/i.test(url.pathname)) {
    return { network: "mattermost", values: { webhook: url.toString() }, what: "an incoming webhook", confidence: "exact" };
  }

  // 5. `@user@instance` — the fediverse address people actually share.
  const fedi = text.match(/@([\w.-]+)@([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i);
  if (fedi) {
    const host = fedi[2]!.toLowerCase();
    if (/bsky\.social$/i.test(host)) {
      return { network: "bluesky", values: { identifier: `${fedi[1]}.${host}` }, what: "a Bluesky handle", confidence: "hint" };
    }
    return {
      network: "mastodon",
      values: { instance: `https://${host}` },
      what: `a fediverse address on ${host}`,
      confidence: "hint",
    };
  }

  // 6. A link we know the host of.
  if (url) {
    const known = hostNetwork(url.hostname);
    if (known) {
      const values: Record<string, string> = {};
      if (known.network === "bluesky") {
        const h = blueskyHandle(text);
        if (h) values.identifier = h;
      }
      if (known.network === "telegram") {
        const chat = url.pathname.match(/^\/([A-Za-z][\w]{3,})/)?.[1];
        if (chat) values.chatId = `@${chat}`;
      }
      return { network: known.network, values, what: known.what, confidence: "hint" };
    }
    // A Mastodon-shaped profile URL: https://instance/@user
    if (/^\/@[\w.-]+\/?$/.test(url.pathname) || /^\/users\/[\w.-]+\/?$/.test(url.pathname) || MASTODON_HINT.test(url.hostname)) {
      return {
        network: "mastodon",
        values: { instance: `${url.protocol}//${url.hostname}` },
        what: `a Mastodon instance (${url.hostname})`,
        confidence: "hint",
      };
    }
  }

  // 7. A bare handle that names its own network.
  const bsky = blueskyHandle(text);
  if (bsky) return { network: "bluesky", values: { identifier: bsky }, what: "a Bluesky handle", confidence: "hint" };

  // 8. A bare host that looks like a fediverse instance.
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+\/?$/i.test(text) && MASTODON_HINT.test(text)) {
    const host = normalizeHost(text);
    return { network: "mastodon", values: { instance: `https://${host}` }, what: `a Mastodon instance (${host})`, confidence: "hint" };
  }

  return null;
}

/**
 * Which required fields a match still leaves empty — the dialog uses this to
 * decide between "Connect" and "one more thing".
 */
export function missingFields(
  values: Record<string, string>,
  fields: { key: string; optional?: boolean; label: string }[],
): string[] {
  return fields.filter((f) => !f.optional && !values[f.key]?.trim()).map((f) => f.label);
}
