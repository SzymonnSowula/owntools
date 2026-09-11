import { llmJson, llmStatus } from "@core/llm";
import { charLimit, measure, truncateToLimit } from "./limits";
import { networkById } from "./networks";
import type { Channel } from "./types";

/**
 * One text, one version per network. `adapt_post` over MCP and the
 * composer's "fit to each network" both come through here.
 *
 * Two paths, same answer shape. With a language model set up in
 * Settings → Intelligence the model rewrites the text for each network
 * inside its limit (purpose "post variants", so the privacy log names it).
 * Without one — or when the model's answer does not fit — a rule does the
 * shortening: trailing sentences are dropped until the text fits, and a
 * single sentence that is still too long is cut on a word boundary. The
 * answer says which path produced it (`model: "rules"`), never an error.
 */

export interface Variant {
  channelId: string;
  channel: string;
  network: string;
  text: string;
  characters: number;
  /** 0 = the network has no limit. */
  limit: number;
  fits: boolean;
  /** True when the text differs from what came in. */
  changed: boolean;
}

export interface AdaptResult {
  variants: Variant[];
  /** "rules", or the model that wrote the variants. */
  model: string;
}

export function splitSentences(text: string): string[] {
  return text
    .trim()
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** `text` inside `limit` for that network: whole trailing sentences go first, then a word-boundary cut. */
export function fitToLimit(networkId: string, text: string, limit: number): string {
  if (!limit || !Number.isFinite(limit) || measure(networkId, text) <= limit) return text;
  const sentences = splitSentences(text);
  for (let n = sentences.length - 1; n >= 1; n -= 1) {
    const candidate = sentences.slice(0, n).join(" ");
    if (measure(networkId, candidate) <= limit) return candidate;
  }
  return truncateToLimit(networkId, sentences[0] ?? text, limit);
}

function limitFor(channel: Channel): number {
  const net = networkById(channel.provider);
  const limit = charLimit(net, channel);
  return Number.isFinite(limit) ? limit : 0;
}

function variant(channel: Channel, original: string, text: string): Variant {
  const net = networkById(channel.provider);
  const limit = limitFor(channel);
  const characters = measure(net.id, text);
  return {
    channelId: channel.id,
    channel: channel.displayName,
    network: net.id,
    text,
    characters,
    limit,
    fits: !limit || characters <= limit,
    changed: text !== original,
  };
}

/** The rule-based path: every channel gets the text cut to its limit, nothing else touched. */
export function adaptRules(text: string, channels: Channel[], channelIds: string[]): Variant[] {
  const targets = channelIds.map((id) => channels.find((c) => c.id === id)).filter((c): c is Channel => Boolean(c));
  return targets.map((ch) => variant(ch, text, fitToLimit(networkById(ch.provider).id, text, limitFor(ch))));
}

interface ModelAnswer {
  variants: { channelId: string; text: string }[];
}

export function isModelAnswer(v: unknown): v is ModelAnswer {
  if (typeof v !== "object" || v === null) return false;
  const list = (v as { variants?: unknown }).variants;
  return Array.isArray(list) && list.every((x) => typeof x === "object" && x !== null && typeof (x as ModelAnswer["variants"][number]).channelId === "string" && typeof (x as ModelAnswer["variants"][number]).text === "string");
}

/**
 * Per-network variants of `text` for `channelIds`. Model-backed when a model
 * is available, rules otherwise; a model answer that misses a channel or
 * overruns its limit is corrected by the rules for that channel.
 */
export async function adaptPost(text: string, channelIds: string[], channels: Channel[], voice = ""): Promise<AdaptResult> {
  const rules = adaptRules(text, channels, channelIds);
  if (!rules.length) return { variants: [], model: "rules" };
  let status;
  try {
    status = await llmStatus();
  } catch {
    return { variants: rules, model: "rules" };
  }
  if (!status.available) return { variants: rules, model: "rules" };
  const brief = rules.map((v) => `- channelId "${v.channelId}": ${networkById(v.network).name}, ${v.limit ? `up to ${v.limit} characters` : "no character limit"}`).join("\n");
  try {
    const answer = await llmJson<ModelAnswer>(
      {
        system: [
          "You adapt one social post for several networks. Keep the meaning and the author's voice; do not add hashtags, emoji or claims that are not in the text.",
          "Answer with JSON only: {\"variants\":[{\"channelId\":\"…\",\"text\":\"…\"}]} — one entry per channel, in the same order.",
          voice.trim() ? `The author's brand voice:\n${voice.trim()}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
        prompt: `Networks:\n${brief}\n\nPost:\n${text}`,
        maxTokens: 1200,
        temperature: 0.3,
        purpose: "post variants",
      },
      isModelAnswer,
    );
    const variants = rules.map((r) => {
      const ch = channels.find((c) => c.id === r.channelId)!;
      const fromModel = answer.variants.find((v) => v.channelId === r.channelId)?.text.trim();
      if (!fromModel) return r;
      const fitted = fitToLimit(r.network, fromModel, r.limit);
      return variant(ch, text, fitted);
    });
    return { variants, model: status.model ?? status.provider ?? "model" };
  } catch {
    return { variants: rules, model: "rules" };
  }
}
