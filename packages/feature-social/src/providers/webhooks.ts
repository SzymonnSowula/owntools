import { HttpError, describeResponse, fileFromBytes, getJson, sfetch } from "./http";
import { ProviderError, retryableStatus, type Provider, type PublishInput } from "./types";

/**
 * Webhook networks. Discord channel webhooks take text + file attachments;
 * Slack and Mattermost incoming webhooks take text only.
 */

function assertWebhook(url: string, host: RegExp, name: string): string {
  const u = url.trim();
  if (!/^https:\/\//i.test(u) || !host.test(u)) throw new ProviderError(`That does not look like a ${name} webhook URL.`, false);
  return u;
}

interface DiscordWebhook {
  id: string;
  name: string;
  avatar: string | null;
  channel_id: string;
  guild_id: string;
}

export const discord: Provider = {
  id: "discord",
  fields: [
    { key: "webhook", label: "Webhook URL", placeholder: "https://discord.com/api/webhooks/…", secret: true },
    { key: "name", label: "Name shown in owntools", placeholder: "#announcements", optional: true },
  ],
  async connect(values) {
    const url = assertWebhook(values.webhook ?? "", /^https:\/\/(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)\/api\/webhooks\//i, "Discord");
    const info = await getJson<DiscordWebhook>(url);
    const avatarUrl = info.avatar ? `https://cdn.discordapp.com/avatars/${info.id}/${info.avatar}.png?size=128` : null;
    return {
      channel: {
        provider: "discord",
        handle: `#${(values.name || info.name || "channel").replace(/^#/, "")}`,
        displayName: values.name?.trim() || info.name || "Discord webhook",
        avatar: null,
        preferences: {},
        meta: { channelId: info.channel_id, guildId: info.guild_id, webhookId: info.id },
      },
      creds: { webhook: url },
      avatarUrl,
    };
  },
  async verify(_channel, creds) {
    const info = await getJson<DiscordWebhook>(creds.webhook ?? "");
    return { ok: true, message: `Webhook "${info.name}" is reachable.` };
  },
  async publish(input: PublishInput) {
    const url = `${input.creds.webhook}?wait=true`;
    const text = input.content.text.slice(0, 2000);
    const files = input.media.slice(0, 10);
    let res: Response;
    if (files.length === 0) {
      res = await sfetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: text }) });
    } else {
      const form = new FormData();
      form.append("payload_json", JSON.stringify({ content: text, attachments: files.map((f, i) => ({ id: i, filename: f.item.name })) }));
      files.forEach((f, i) => form.append(`files[${i}]`, fileFromBytes(f.bytes, f.item.name, f.item.mime)));
      res = await sfetch(url, { method: "POST", body: form });
    }
    if (!res.ok) throw new ProviderError(`Discord: ${await describeResponse(res)}`, retryableStatus(res.status));
    const msg = (await res.json().catch(() => ({}))) as { id?: string; channel_id?: string };
    const guild = input.channel.meta.guildId;
    const link = msg.id && msg.channel_id && guild ? `https://discord.com/channels/${guild}/${msg.channel_id}/${msg.id}` : null;
    return { url: link, remoteId: msg.id ?? null };
  },
};

function textOnlyWebhook(id: "slack" | "mattermost", host: RegExp, name: string, placeholder: string): Provider {
  return {
    id,
    fields: [
      { key: "webhook", label: "Incoming webhook URL", placeholder, secret: true },
      { key: "name", label: "Name shown in owntools", placeholder: "#general", optional: true },
    ],
    async connect(values) {
      const url = assertWebhook(values.webhook ?? "", host, name);
      const label = values.name?.trim() || `${name} webhook`;
      return {
        channel: {
          provider: id,
          handle: `#${label.replace(/^#/, "")}`,
          displayName: label,
          avatar: null,
          preferences: {},
          meta: {},
        },
        creds: { webhook: url },
      };
    },
    async publish(input: PublishInput) {
      const text = input.content.text;
      try {
        const res = await sfetch(input.creds.webhook ?? "", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) throw new ProviderError(`${name}: ${await describeResponse(res)}`, retryableStatus(res.status));
      } catch (err) {
        if (err instanceof HttpError) throw new ProviderError(`${name}: ${err.message}`, retryableStatus(err.status));
        throw err;
      }
      return { url: null, remoteId: null };
    },
  };
}

export const slack = textOnlyWebhook("slack", /^https:\/\/hooks\.slack\.com\/services\//i, "Slack", "https://hooks.slack.com/services/…");
export const mattermost = textOnlyWebhook("mattermost", /^https:\/\/.+\/hooks\/.+/i, "Mattermost", "https://your-mattermost/hooks/…");
