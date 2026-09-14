import type { Channel, ChannelCredentials, MediaItem, NetworkId, PostContent } from "../types";

/**
 * What every network adapter implements. Connecting is a two-step
 * conversation driven by the Add-channel form: `fields` describe what to ask
 * for, `connect` turns the answers into a channel + its secrets (possibly
 * after an OAuth round trip). Publishing gets the resolved content and the
 * media bytes and returns where the post lives.
 */

export interface ConnectField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  hint?: string;
  optional?: boolean;
}

/** A media item with its bytes loaded. */
export interface LoadedMedia {
  item: MediaItem;
  bytes: Uint8Array;
  alt?: string;
}

/**
 * Stores credentials a provider has just rotated. Called the moment a refresh
 * succeeds, before anything else can fail: X and Bluesky retire the refresh
 * token they were handed, so credentials returned only at the end of a
 * successful publish were lost with the first error after a refresh — and
 * every retry then presented a dead token. Implementations never throw.
 */
export type SaveCreds = (creds: ChannelCredentials) => Promise<void>;

export interface PublishInput {
  channel: Channel;
  creds: ChannelCredentials;
  /** Override-resolved content; the text already carries the signature. */
  content: PostContent;
  /** Main post media. */
  media: LoadedMedia[];
  /** Media per thread part (same order as content.thread). */
  threadMedia: LoadedMedia[][];
  saveCreds?: SaveCreds;
}

export interface PublishOutput {
  url: string | null;
  remoteId: string | null;
  /** Rotated credentials to store (refreshed tokens). */
  creds?: ChannelCredentials;
}

export interface ConnectOutput {
  channel: Omit<Channel, "id" | "createdAt" | "updatedAt" | "collection" | "disabled">;
  creds: ChannelCredentials;
  /** Avatar to download and store, when the network gives us one. */
  avatarUrl?: string | null;
}

/** Progress callback while connecting (OAuth: "waiting for the browser…"). */
export type ConnectProgress = (message: string) => void;

export interface Provider {
  id: NetworkId;
  fields: ConnectField[];
  /** For OAuth providers: opens the browser and waits; for the rest: verifies the keys. */
  connect(values: Record<string, string>, progress: ConnectProgress): Promise<ConnectOutput>;
  publish(input: PublishInput): Promise<PublishOutput>;
  /** Re-check the stored credentials (used by "Test connection"). */
  verify?(channel: Channel, creds: ChannelCredentials, saveCreds?: SaveCreds): Promise<{ ok: boolean; message: string }>;
}

/**
 * What kind of trouble a failure is, when it is about the channel rather
 * than the post: `auth` = the stored sign-in stopped working (reconnect),
 * `billing` = the network's API account refuses to pay for the call (X's
 * credits). Either one is written onto the channel, so the calendar can say
 * so before the next scheduled post fails the same way.
 */
export type ProviderErrorKind = "auth" | "billing";

export class ProviderError extends Error {
  constructor(
    message: string,
    /** True when retrying later could help (rate limit, 5xx, network). */
    public readonly retryable: boolean,
    public readonly kind?: ProviderErrorKind,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}
