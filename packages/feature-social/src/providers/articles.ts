import { HttpError, bearer, getJson, postJson } from "./http";
import { ProviderError, retryableStatus, type Provider, type PublishInput } from "./types";

/**
 * Article networks: the post text is Markdown, the first line (or the title
 * field) is the title. Dev.to: https://developers.forem.com/api ·
 * Medium: https://github.com/Medium/medium-api-docs
 */

function titleOf(input: PublishInput): string {
  const t = input.content.title?.trim();
  if (t) return t;
  const first = input.content.text.split("\n").find((l) => l.trim());
  return (first ?? "Untitled").replace(/^#+\s*/, "").slice(0, 120);
}

function bodyOf(input: PublishInput): string {
  const text = input.content.text;
  if (input.content.title?.trim()) return text;
  // The first line became the title; keep the rest.
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.trim());
  return lines.slice(i + 1).join("\n").trim() || text;
}

interface DevtoUser {
  id: number;
  username: string;
  name: string;
  profile_image: string;
}

export const devto: Provider = {
  id: "devto",
  fields: [{ key: "apiKey", label: "API key", placeholder: "from Settings → Extensions", secret: true }],
  async connect(values) {
    const apiKey = values.apiKey?.trim() ?? "";
    if (!apiKey) throw new ProviderError("Paste your Dev.to API key.", false);
    const me = await getJson<DevtoUser>("https://dev.to/api/users/me", { "api-key": apiKey });
    return {
      channel: {
        provider: "devto",
        handle: `@${me.username}`,
        displayName: me.name || me.username,
        avatar: null,
        preferences: { publishAsDraft: false },
        meta: { userId: String(me.id), profile: `https://dev.to/${me.username}` },
      },
      creds: { apiKey },
      avatarUrl: me.profile_image ?? null,
    };
  },
  async verify(_channel, creds) {
    const me = await getJson<DevtoUser>("https://dev.to/api/users/me", { "api-key": creds.apiKey ?? "" });
    return { ok: true, message: `Signed in as @${me.username}.` };
  },
  async publish(input: PublishInput) {
    const tags = (input.channel.preferences.defaultTags ?? []).slice(0, 4);
    const article: Record<string, unknown> = {
      title: titleOf(input),
      body_markdown: bodyOf(input),
      published: !input.channel.preferences.publishAsDraft,
      tags,
    };
    try {
      const out = await postJson<{ id: number; url: string }>("https://dev.to/api/articles", { article }, { "api-key": input.creds.apiKey ?? "" });
      return { url: out.url ?? null, remoteId: String(out.id) };
    } catch (err) {
      if (err instanceof HttpError) throw new ProviderError(`Dev.to: ${err.message}`, retryableStatus(err.status));
      throw err;
    }
  },
};

interface MediumMe {
  data: { id: string; username: string; name: string; url: string; imageUrl: string };
}

export const medium: Provider = {
  id: "medium",
  fields: [{ key: "token", label: "Integration token", placeholder: "from Settings → Security and apps", secret: true }],
  async connect(values) {
    const token = values.token?.trim() ?? "";
    if (!token) throw new ProviderError("Paste your Medium integration token.", false);
    const me = await getJson<MediumMe>("https://api.medium.com/v1/me", bearer(token));
    return {
      channel: {
        provider: "medium",
        handle: `@${me.data.username}`,
        displayName: me.data.name || me.data.username,
        avatar: null,
        preferences: { publishAsDraft: false },
        meta: { userId: me.data.id, profile: me.data.url },
      },
      creds: { token },
      avatarUrl: me.data.imageUrl ?? null,
    };
  },
  async verify(_channel, creds) {
    const me = await getJson<MediumMe>("https://api.medium.com/v1/me", bearer(creds.token ?? ""));
    return { ok: true, message: `Signed in as @${me.data.username}.` };
  },
  async publish(input: PublishInput) {
    const userId = input.channel.meta.userId;
    try {
      const out = await postJson<{ data: { id: string; url: string } }>(
        `https://api.medium.com/v1/users/${userId}/posts`,
        {
          title: titleOf(input),
          contentFormat: "markdown",
          content: `# ${titleOf(input)}\n\n${bodyOf(input)}`,
          publishStatus: input.channel.preferences.publishAsDraft ? "draft" : "public",
          tags: (input.channel.preferences.defaultTags ?? []).slice(0, 5),
        },
        bearer(input.creds.token ?? ""),
      );
      return { url: out.data.url ?? null, remoteId: out.data.id };
    } catch (err) {
      if (err instanceof HttpError) throw new ProviderError(`Medium: ${err.message}`, retryableStatus(err.status));
      throw err;
    }
  },
};
