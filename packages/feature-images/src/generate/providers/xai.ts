/**
 * xAI — `POST /v1/images/generations` (checked 2026-09-18). OpenAI-shaped on
 * the way out, its own on the way in: `aspect_ratio` and `resolution` instead
 * of `size`, and `quality` on `grok-imagine-image-2.0` only. Result URLs are
 * "temporary", so base64 is asked for. A wrong key is a 400 here, not a 401 —
 * `failure()` reads the message, not just the status.
 */
import { base64ToBlob, bearer, call, download, json } from "../http";
import type { GeneratedImage, ImageModel, ImageProvider, Quality } from "../types";

const API = "https://api.x.ai/v1";
const NAME = "xAI";

const QUALITY: Record<Quality, string> = { draft: "low", standard: "medium", high: "medium" };

interface ImagesResponse {
  data?: { b64_json?: string; url?: string }[];
}

interface ListResponse {
  models?: { id: string; image_price?: number }[];
}

export const xai: ImageProvider = {
  id: "xai",
  name: NAME,
  group: "cloud",
  blurb: "Grok Imagine - fast, photographic, permissive.",
  keyUrl: "https://console.x.ai",
  keyPlaceholder: "xai-…",
  needsKey: true,
  models: [
    { id: "grok-imagine-image-2.0", label: "Grok Imagine 2.0", note: "The current model · about 4¢ a picture" },
    { id: "grok-imagine-image", label: "Grok Imagine 1.0", note: "About 2¢ a picture" },
  ],
  customModel: true,
  supportsNegative: false,
  supportsSeed: false,

  async listModels(creds, signal): Promise<ImageModel[]> {
    const res = await call(`${API}/image-generation-models`, { headers: bearer(creds.apiKey), signal, purpose: "image models list" });
    const body = await json<ListResponse>(res, NAME);
    return (body.models ?? []).map((m) => ({
      id: m.id,
      label: m.id,
      note: typeof m.image_price === "number" ? `About ${(m.image_price / 100).toFixed(2)} USD a picture` : undefined,
    }));
  },

  async generate(request, model, creds): Promise<GeneratedImage[]> {
    const body: Record<string, unknown> = {
      model,
      prompt: request.prompt,
      n: request.count,
      aspect_ratio: request.aspect,
      resolution: request.quality === "high" ? "2k" : "1k",
      response_format: "b64_json",
    };
    if (/^grok-imagine-image-2/.test(model)) body.quality = QUALITY[request.quality];
    const res = await call(`${API}/images/generations`, { headers: bearer(creds.apiKey), signal: request.signal, body });
    const answer = await json<ImagesResponse>(res, NAME);
    const out: GeneratedImage[] = [];
    for (const item of answer.data ?? []) {
      if (item.b64_json) out.push({ blob: base64ToBlob(item.b64_json) });
      else if (item.url) out.push({ blob: await download(item.url, NAME, request.signal) });
    }
    return out;
  },
};
