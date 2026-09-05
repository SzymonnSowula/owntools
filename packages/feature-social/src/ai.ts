import { networkById } from "./networks";
import { describeResponse, sfetch } from "./providers/http";
import type { AiSettings } from "./types";

/**
 * In-app AI for the composer. Nothing runs unless the user configured a
 * provider and a key in Settings; then the text goes straight from this
 * machine to that provider (Anthropic, or any OpenAI-compatible endpoint —
 * OpenAI, Ollama, LM Studio, OpenRouter…). Raw HTTP on purpose: requests
 * have to travel through the Tauri fetch (no CORS, capability-scoped), which
 * the vendor SDKs do not do out of the box.
 */

export const DEFAULT_MODELS: Record<Exclude<AiSettings["provider"], "none">, string> = {
  anthropic: "claude-opus-5",
  openai: "gpt-4.1-mini",
};

export function aiConfigured(ai: AiSettings): boolean {
  if (ai.provider === "none") return false;
  if (ai.provider === "anthropic") return Boolean(ai.apiKey.trim());
  // Local OpenAI-compatible servers often need no key.
  return Boolean(ai.baseUrl.trim());
}

async function anthropicComplete(ai: AiSettings, system: string, prompt: string, maxTokens: number): Promise<string> {
  const res = await sfetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ai.apiKey.trim(),
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: ai.model.trim() || DEFAULT_MODELS.anthropic,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${await describeResponse(res)}`);
  const data = (await res.json()) as { content?: { type: string; text?: string }[]; stop_reason?: string };
  if (data.stop_reason === "refusal") throw new Error("The model declined this request.");
  return (data.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
}

async function openaiComplete(ai: AiSettings, system: string, prompt: string, maxTokens: number): Promise<string> {
  const base = ai.baseUrl.trim().replace(/\/+$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ai.apiKey.trim()) headers.Authorization = `Bearer ${ai.apiKey.trim()}`;
  const res = await sfetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: ai.model.trim() || DEFAULT_MODELS.openai,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`AI endpoint ${await describeResponse(res)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return (data.choices?.[0]?.message?.content ?? "").trim();
}

export async function complete(ai: AiSettings, system: string, prompt: string, maxTokens = 1024): Promise<string> {
  if (!aiConfigured(ai)) throw new Error("Set up an AI provider in Settings first.");
  const out = ai.provider === "anthropic" ? await anthropicComplete(ai, system, prompt, maxTokens) : await openaiComplete(ai, system, prompt, maxTokens);
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
