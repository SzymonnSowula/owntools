import {
  cloudConfigured,
  DEFAULT_CLOUD_MODELS,
  lastKnownLlmStatus,
  llmComplete,
  llmSettings,
  llmStatus,
} from "@core/llm";
import { adoptSocialAiSettings } from "@feature-llm/migrate";
import { networkById } from "./networks";
import type { AiSettings } from "./types";

/**
 * In-app AI for the composer — a thin adapter over `@core/llm`, the one
 * model every tool shares (on-device llama.cpp when a model is installed,
 * the person's own cloud key otherwise, chosen once in Settings →
 * Intelligence). The composer's call sites are unchanged: they still pass
 * social's old `settings.ai`, which is now only read once, to carry a key
 * configured here over to the shared settings (`adoptSocialAiSettings`).
 */

/** Kept for the settings copy that used to name these; the shared defaults. */
export const DEFAULT_MODELS: Record<Exclude<AiSettings["provider"], "none">, string> = DEFAULT_CLOUD_MODELS;

/**
 * Synchronous on purpose — it gates a button in render. The last status the
 * shared module resolved wins; before the first one arrives (it is being
 * fetched right here), a plausible guess from the settings so the button is
 * not disabled on the first frame for nothing. `complete` still checks for
 * real and answers with the reason when the guess was wrong.
 */
export function aiConfigured(ai: AiSettings): boolean {
  adoptSocialAiSettings(ai);
  void llmStatus();
  const known = lastKnownLlmStatus();
  if (known) return known.available;
  const shared = llmSettings();
  return shared.prefer !== "off" && (cloudConfigured(shared.cloud) || Boolean(shared.local.model));
}

export async function complete(ai: AiSettings, system: string, prompt: string, maxTokens = 1024): Promise<string> {
  adoptSocialAiSettings(ai);
  const out = await llmComplete({ system, prompt, maxTokens, purpose: "post writing" });
  return stripFences(out);
}

/** Models like to wrap answers in quotes or code fences; the post should not carry them. */
export function stripFences(text: string): string {
  let t = text.trim();
  t = t.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "").trim();
  if (t.length > 1 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("“") && t.endsWith("”")))) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

const VOICE =
  "You write social media posts for a person who will review every word before it is published. " +
  "Plain language, no hype, no emoji unless the source text has them, no hashtags unless asked. " +
  "Return only the post text — no preamble, no quotes, no explanation.";

export interface AiTask {
  kind: "draft" | "rewrite" | "shorten" | "hashtags" | "improve";
  /** The brief (draft) or the current text (everything else). */
  text: string;
  /** Network id the result is for; drives limits and tone. */
  networkId?: string;
  /** Character limit to honour. */
  limit?: number;
}

export function buildPrompt(task: AiTask): { system: string; prompt: string; maxTokens: number } {
  const net = task.networkId ? networkById(task.networkId) : null;
  const limitLine = task.limit && Number.isFinite(task.limit) ? `Hard limit: ${task.limit} characters.` : "";
  const where = net ? `The post is for ${net.name}.` : "";
  switch (task.kind) {
    case "draft":
      return {
        system: VOICE,
        prompt: `Write one post from this brief. ${where} ${limitLine}\n\nBrief:\n${task.text}`,
        maxTokens: 1024,
      };
    case "rewrite":
      return {
        system: VOICE,
        prompt: `Rewrite this post so it reads naturally on ${net?.name ?? "this network"}, keeping every fact. ${limitLine}\n\nPost:\n${task.text}`,
        maxTokens: 1024,
      };
    case "shorten":
      return {
        system: VOICE,
        prompt: `Shorten this post to fit within ${task.limit ?? 280} characters without losing the point. ${where}\n\nPost:\n${task.text}`,
        maxTokens: 512,
      };
    case "improve":
      return {
        system: VOICE,
        prompt: `Tighten this post: clearer, shorter sentences, same meaning and tone. ${where} ${limitLine}\n\nPost:\n${task.text}`,
        maxTokens: 1024,
      };
    case "hashtags":
      return {
        system:
          "You suggest hashtags for social media posts. Return 3 to 6 hashtags on one line, separated by spaces, each starting with #, lowercase, no explanation.",
        prompt: `Post:\n${task.text}`,
        maxTokens: 128,
      };
  }
}

export async function runAiTask(ai: AiSettings, task: AiTask): Promise<string> {
  const { system, prompt, maxTokens } = buildPrompt(task);
  const out = await complete(ai, system, prompt, maxTokens);
  if (task.kind === "hashtags") {
    const tags = out.match(/#[\p{L}\p{N}_]+/gu) ?? [];
    return Array.from(new Set(tags.map((t) => t.toLowerCase()))).join(" ");
  }
  return out;
}
