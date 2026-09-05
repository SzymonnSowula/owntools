import { HttpError, fileFromBytes, getJson, postJson, postMultipart } from "./http";
import { ProviderError, retryableStatus, type LoadedMedia, type Provider, type PublishInput } from "./types";

/**
 * Telegram Bot API: a bot the user created with @BotFather posts to a
 * channel or group it administers. Docs: https://core.telegram.org/bots/api
 */

const api = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;

interface TgResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface Chat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
}

interface Message {
  message_id: number;
  chat: Chat;
}

function unwrap<T>(res: TgResponse<T>): T {
  if (!res.ok || res.result === undefined) throw new ProviderError(`Telegram: ${res.description ?? "unknown error"}`, false);
  return res.result;
}

function messageUrl(chat: Chat, messageId: number): string | null {
  if (chat.username) return `https://t.me/${chat.username}/${messageId}`;
  // Private channels/supergroups: -100<id> → t.me/c/<id>/<message>
  const id = String(chat.id);
  if (id.startsWith("-100")) return `https://t.me/c/${id.slice(4)}/${messageId}`;
  return null;
}

async function call<T>(token: string, method: string, body: unknown): Promise<T> {
  try {
    return unwrap(await postJson<TgResponse<T>>(api(token, method), body));
  } catch (err) {
    if (err instanceof HttpError) {
      const retry = err.status === 429 || retryableStatus(err.status);
      throw new ProviderError(`Telegram: ${err.message}`, retry);
    }
    throw err;
  }
}

async function sendMedia<T>(token: string, method: string, field: string, media: LoadedMedia, extra: Record<string, string>): Promise<T> {
  const form = new FormData();
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  form.append(field, fileFromBytes(media.bytes, media.item.name, media.item.mime));
  try {
    return unwrap(await postMultipart<TgResponse<T>>(api(token, method), form));
  } catch (err) {
    if (err instanceof HttpError) throw new ProviderError(`Telegram: ${err.message}`, retryableStatus(err.status));
    throw err;
  }
}

export const telegram: Provider = {
  id: "telegram",
  fields: [
    { key: "token", label: "Bot token", placeholder: "123456789:AAExampleTokenFromBotFather", secret: true },
    { key: "chatId", label: "Channel or chat", placeholder: "@yourchannel or -1001234567890", hint: "The bot must be an admin there." },
  ],
  async connect(values) {
    const token = values.token?.trim() ?? "";
    const chatId = values.chatId?.trim() ?? "";
    if (!token || !chatId) throw new ProviderError("Both the bot token and the chat are needed.", false);
    const me = unwrap(await getJson<TgResponse<{ username?: string; first_name?: string }>>(api(token, "getMe")));
    const chat = await call<Chat>(token, "getChat", { chat_id: chatId });
    const title = chat.title || chat.first_name || chat.username || chatId;
    return {
      channel: {
        provider: "telegram",
        handle: chat.username ? `@${chat.username}` : `bot @${me.username ?? "bot"}`,
        displayName: title,
        avatar: null,
        preferences: { parseMode: "none" },
        meta: { chatId: String(chat.id), chatType: chat.type, chatUsername: chat.username ?? "", bot: me.username ?? "" },
      },
      creds: { token, chatId: String(chat.id) },
    };
  },
  async verify(_channel, creds) {
    const me = unwrap(await getJson<TgResponse<{ username?: string }>>(api(creds.token ?? "", "getMe")));
    return { ok: true, message: `Bot @${me.username ?? "?"} is alive.` };
  },
  async publish(input: PublishInput) {
    const token = input.creds.token ?? "";
    const chatId = input.creds.chatId ?? input.channel.meta.chatId ?? "";
    const parseMode = input.channel.preferences.parseMode;
    const modeExtra: Record<string, string> = parseMode && parseMode !== "none" ? { parse_mode: parseMode } : {};
    const text = input.content.text;
    const media = input.media.filter((m) => m.item.mime.startsWith("image/") || m.item.mime.startsWith("video/"));
    let msg: Message;
    if (media.length === 0) {
      msg = await call<Message>(token, "sendMessage", { chat_id: chatId, text, ...modeExtra });
    } else if (media.length === 1) {
      const m = media[0]!;
      const isVideo = m.item.mime.startsWith("video/");
      msg = await sendMedia<Message>(token, isVideo ? "sendVideo" : "sendPhoto", isVideo ? "video" : "photo", m, {
        chat_id: chatId,
        caption: text,
        ...modeExtra,
      });
    } else {
      // Album: files attach as attach://name, caption on the first item.
      const form = new FormData();
      form.append("chat_id", chatId);
      const group = media.slice(0, 10).map((m, i) => {
        const name = `file${i}`;
        form.append(name, fileFromBytes(m.bytes, m.item.name, m.item.mime));
        const entry: Record<string, string> = {
          type: m.item.mime.startsWith("video/") ? "video" : "photo",
          media: `attach://${name}`,
        };
        if (i === 0 && text) {
          entry.caption = text;
          if (modeExtra.parse_mode) entry.parse_mode = modeExtra.parse_mode;
        }
        return entry;
      });
      form.append("media", JSON.stringify(group));
      try {
        const msgs = unwrap(await postMultipart<TgResponse<Message[]>>(api(token, "sendMediaGroup"), form));
        msg = msgs[0]!;
      } catch (err) {
        if (err instanceof HttpError) throw new ProviderError(`Telegram: ${err.message}`, retryableStatus(err.status));
        throw err;
      }
    }
    return { url: messageUrl(msg.chat, msg.message_id), remoteId: String(msg.message_id) };
  },
};
