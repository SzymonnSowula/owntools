import type { Channel } from "./types";

/**
 * Which account a channel is. Signing in again has to land on the channel
 * that is already there — a second channel for the same account would leave
 * every scheduled post pointing at the old id, still failing — and a reconnect
 * must refuse a different account (X signs in whoever the browser is logged
 * in as).
 */

type Identity = Pick<Channel, "provider" | "meta"> & { stub?: boolean };

/** The account behind a channel, from the facts its network gave at connect time; null where it gives none. */
export function accountKey(channel: Identity): string | null {
  if (channel.stub || channel.meta.simulated === "true") return null;
  const pick = (...keys: string[]): string | null =>
    keys.every((k) => channel.meta[k]) ? keys.map((k) => channel.meta[k]).join("|") : null;
  switch (channel.provider) {
    case "x":
    case "devto":
    case "medium":
      return pick("userId");
    case "bluesky":
      return pick("did");
    case "mastodon":
      return pick("instance", "accountId");
    case "linkedin":
      return pick("authorUrn");
    case "telegram":
      return pick("chatId");
    case "discord":
      return pick("channelId");
    default:
      return null;
  }
}

/** true = the same account, false = a different one, null = the network does not say. */
export function sameAccount(a: Identity, b: Identity): boolean | null {
  if (a.provider !== b.provider) return false;
  const ka = accountKey(a);
  const kb = accountKey(b);
  if (ka === null || kb === null) return null;
  return ka === kb;
}
