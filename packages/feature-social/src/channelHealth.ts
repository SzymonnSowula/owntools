import { logError } from "@core/errors";
import { nowIso } from "./model";
import { providerFor, ProviderError, type SaveCreds } from "./providers";
import { networkAvailable } from "./providers/http";
import { useSocialStore } from "./store";
import type { Channel, ChannelHealth, Post } from "./types";

/**
 * Whether a connected channel can actually publish. The runner and "Test
 * connection" write what they learn onto the channel (`channel.health`), and
 * the calendar shows it above the week — so a sign-in that died, or an X
 * account out of API credits, is visible before the next post fails the same
 * way instead of behind a "connected" pill.
 */

/** `saveCreds` for a provider: rotated tokens land in credentials.json the moment they exist. */
export function credentialSaver(channelId: string): SaveCreds {
  return async (creds) => {
    try {
      await useSocialStore.getState().saveCredentials(channelId, creds);
    } catch (err) {
      logError("social", `save rotated credentials for ${channelId}`, err);
    }
  };
}

/** The health note a failure leaves on its channel; null for failures about the post itself (too long, a 5xx). */
export function healthFromError(err: unknown, at = nowIso()): ChannelHealth | null {
  return err instanceof ProviderError && err.kind ? { kind: err.kind, message: err.message, at } : null;
}

/** A success (`null`) clears the note; a sign-in or billing failure writes it; anything else leaves the channel alone. */
export async function noteChannelHealth(channelId: string, outcome: unknown): Promise<void> {
  try {
    const store = useSocialStore.getState();
    if (outcome === null) await store.setChannelHealth(channelId, null);
    else {
      const health = healthFromError(outcome);
      if (health) await store.setChannelHealth(channelId, health);
    }
  } catch (err) {
    logError("social", `channel health for ${channelId}`, err);
  }
}

/** "Test connection": the provider's own check, with rotated tokens saved and the outcome noted on the channel. */
export async function checkChannel(channel: Channel): Promise<{ ok: boolean; message: string; tested: boolean }> {
  const { settings, credentials } = useSocialStore.getState();
  const provider = providerFor(channel.provider, settings.simulate || !networkAvailable());
  if (!provider.verify) return { ok: true, tested: false, message: "Webhook networks only answer when a message is sent." };
  try {
    const r = await provider.verify(channel, credentials[channel.id] ?? {}, credentialSaver(channel.id));
    if (r.ok) await noteChannelHealth(channel.id, null);
    return { ...r, tested: true };
  } catch (err) {
    logError("social", "verify", err);
    await noteChannelHealth(channel.id, err);
    return { ok: false, tested: true, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Scheduled posts (or ones waiting for review) that would go to this channel. */
export function waitingPosts(posts: Post[], channelId: string): number {
  return posts.filter((p) => (p.status === "scheduled" || p.status === "needs_review") && p.channelIds.includes(channelId)).length;
}

/** Where an X account buys API credits; the only network that bills today. */
export function billingUrl(channel: Pick<Channel, "provider">): string | null {
  return channel.provider === "x" ? "https://console.x.com" : null;
}
