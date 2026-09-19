/**
 * OpenAI — `POST /v1/images/generations` (checked against the docs on
 * 2026-09-18). GPT image models always answer with base64; `gpt-image-2` and
 * the 2.5 family take any `WxH` on a 16-pixel grid, the `gpt-image-1` family
 * only three sizes. `model` is always sent: the documented default is
 * `dall-e-2`, which no longer exists.
 */
import { base64ToBlob, bearer, call, closestSize, dimensions, json } from "../http";
import type { GeneratedImage, ImageModel, ImageProvider, ImageRequest, Quality } from "../types";

const API = "https://api.openai.com/v1";
const NAME = "OpenAI";
const LEGACY_SIZES = ["1024x1024", "1536x1024", "1024x1536"] as const;

const QUALITY: Record<Quality, string> = { draft: "low", standard: "medium", high: "high" };

/** `gpt-image-1`, `-1-mini`, `-1.5` and `chatgpt-image-latest` only know the three classic sizes. */
export function flexibleSizes(model: string): boolean {
  return !/^gpt-image-1(\b|[.-])/.test(model) && !/^chatgpt-image/.test(model) && !/^dall-e/.test(model);
}

export function openaiSize(model: string, request: Pick<ImageRequest, "aspect" | "quality">): string {
  if (!flexibleSizes(model)) return closestSize(request.aspect, LEGACY_SIZES);
  const { width, height } = dimensions(request.aspect, request.quality === "high" ? 2 : 1, 16, 3840);
  return `${width}x${height}`;
}

interface ImagesResponse {
  data?: { b64_json?: string; url?: string; revised_prompt?: string }[];
}

interface ModelsResponse {
  data?: { id: string; shutdown_date?: string | number | null }[];
}

function stillRunning(shutdown: string | number | null | undefined): boolean {
  if (shutdown == null) return true;
  const at = typeof shutdown === "number" ? shutdown * 1000 : Date.parse(shutdown);
  return Number.isNaN(at) || at > Date.now();
}

export const openai: ImageProvider = {
  id: "openai",
  name: NAME,
  group: "cloud",
  blurb: "GPT Image - strong at text in pictures and at following a long brief.",
  keyUrl: "https://platform.openai.com/api-keys",
  keyPlaceholder: "sk-…",
  needsKey: true,
  models: [
    { id: "gpt-image-2.5-flare", label: "GPT Image 2.5 Flare", note: "Fast, for everyday pictures · about 1¢ at standard quality" },
    { id: "gpt-image-2.5-sunburst", label: "GPT Image 2.5 Sunburst", note: "The most capable · about 5¢ at high quality" },
    { id: "gpt-image-2", label: "GPT Image 2", note: "The earlier model" },
  ],
  customModel: true,
  supportsNegative: false,
  supportsSeed: false,

  async listModels(creds, signal): Promise<ImageModel[]> {
    const res = await call(`${API}/models`, { headers: bearer(creds.apiKey), signal, purpose: "image models list" });
    const body = await json<ModelsResponse>(res, NAME);
    return (body.data ?? [])
      .filter((m) => /^gpt-image-/.test(m.id) && stillRunning(m.shutdown_date))
      // Dated snapshots are the same model under a longer name.
      .filter((m) => !/-\d{4}-\d{2}-\d{2}$/.test(m.id))
      .map((m) => ({ id: m.id, label: m.id }))
      .sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
  },

  async generate(request, model, creds): Promise<GeneratedImage[]> {
    const res = await call(`${API}/images/generations`, {
      headers: bearer(creds.apiKey),
      signal: request.signal,
      body: {
        model,
        prompt: request.prompt,
        n: request.count,
        size: openaiSize(model, request),
        quality: QUALITY[request.quality],
        output_format: "png",
      },
    });
    const body = await json<ImagesResponse>(res, NAME);
    return (body.data ?? [])
      .filter((d) => d.b64_json)
      .map((d) => ({ blob: base64ToBlob(d.b64_json as string), revisedPrompt: d.revised_prompt ?? null }));
  },
};
