import { networkById, type NetworkDef } from "../networks";
import type { NetworkId } from "../types";
import { devto, medium } from "./articles";
import { bluesky } from "./bluesky";
import { linkedin } from "./linkedin";
import { mastodon } from "./mastodon";
import { telegram } from "./telegram";
import { ProviderError, type ConnectField, type Provider, type PublishInput } from "./types";
import { discord, mattermost, slack } from "./webhooks";
import { x } from "./x";

/**
 * Registry. Live networks map to a real adapter; "bring your own app"
 * networks without one yet get a key form that stores the secrets and a
 * publish that says so — the channel is marked `stub` so the calendar never
 * schedules into the void.
 */

const LIVE: Partial<Record<NetworkId, Provider>> = {
  bluesky,
  mastodon,
  telegram,
  discord,
  slack,
  mattermost,
  devto,
  medium,
  x,
  linkedin,
};

function stubFields(net: NetworkDef): ConnectField[] {
  const name: ConnectField = { key: "name", label: "Name shown in shipshape", placeholder: `my ${net.name} account` };
  switch (net.auth) {
    case "oauth-pkce":
      return [
        name,
        { key: "clientId", label: "Client ID", placeholder: "from the developer app" },
        { key: "clientSecret", label: "Client secret", placeholder: "kept on this device", secret: true, optional: true },
      ];
    case "api-key":
      return [
        name,
        { key: "endpoint", label: "Site / instance URL", placeholder: "https://…", optional: net.id !== "lemmy" && net.id !== "wordpress" && net.id !== "ghost" },
        { key: "apiKey", label: "API key / token", placeholder: "kept on this device", secret: true },
      ];
    case "webhook":
      return [name, { key: "webhook", label: "Webhook URL", placeholder: "https://…", secret: true }];
    default:
      return [name];
  }
}

function stubProvider(net: NetworkDef): Provider {
  return {
    id: net.id,
    fields: stubFields(net),
    async connect(values) {
      const label = values.name?.trim() || net.name;
      const creds: Record<string, string> = {};
      for (const f of this.fields) if (f.key !== "name" && values[f.key]?.trim()) creds[f.key] = values[f.key]!.trim();
      return {
        channel: {
          provider: net.id,
          handle: label.toLowerCase().replace(/\s+/g, "-"),
          displayName: label,
          avatar: null,
          preferences: {},
          meta: {},
          stub: true,
        },
        creds,
      };
    },
    async publish() {
      throw new ProviderError(`${net.name} publishing is not wired up in this build yet; the keys are saved for when it is.`, false);
    },
  };
}

/** Browser preview: nothing leaves the machine, every call succeeds after a short pause. */
function simulatedProvider(net: NetworkDef): Provider {
  return {
    id: net.id,
    fields: [{ key: "name", label: "Name", placeholder: `demo ${net.name}` }],
    async connect(values) {
      const label = values.name?.trim() || `demo ${net.name.toLowerCase()}`;
      return {
        channel: {
          provider: net.id,
          handle: `@${label.toLowerCase().replace(/[^a-z0-9]+/g, "")}`,
          displayName: label,
          avatar: null,
          preferences: {},
          meta: { simulated: "true" },
        },
        creds: {},
      };
    },
    async publish(input: PublishInput) {
      await new Promise((r) => setTimeout(r, 600));
      return { url: null, remoteId: `sim_${Date.now()}_${input.channel.id.slice(-4)}` };
    },
  };
}

export function providerFor(id: string, simulate = false): Provider {
  const net = networkById(id);
  if (simulate) return simulatedProvider(net);
  return LIVE[net.id] ?? stubProvider(net);
}

export function isLive(id: string): boolean {
  return Boolean(LIVE[networkById(id).id]);
}

export { ProviderError } from "./types";
export type { ConnectField, ConnectOutput, LoadedMedia, Provider, PublishInput, PublishOutput } from "./types";
export { NeedsCode } from "./mastodon";
