/**
 * Together AI — `POST /v1/images/generations` (checked 2026-09-18). Note the
 * spelling: `response_format` is `"base64"` here, not `"b64_json"`, though the
 * answer still carries `b64_json`. The docs give no parameters for the models
 * Together resells (Google, OpenAI, Ideogram), so those get the prompt and a
 * size and nothing else.
 */
import { base64ToBlob, bearer, call, dimensions, download, json } from "../http";
import type { GeneratedImage, ImageModel, ImageProvider } from "../types";

const API = "https://api.together.ai/v1";
const NAME = "Together AI";

interface ImagesResponse {
  data?: { b64_json?: string; url?: string }[];
}

interface ListedModel {
  id: string;
  type?: string;
  display_name?: string;
}

/** Models hosted by Together itself take the full parameter set; resold ones are undocumented. */
export function takesExtras(model: string): boolean {
  return !/^(google|openai|ideogram)\//i.test(model);
}

export const together: ImageProvider = {
  id: "together",
  name: NAME,
  group: "cloud",
  blurb: "FLUX.2, Qwen Image, Seedream and Juggernaut by the megapixel - the cheap way to run open models.",
  keyUrl: "https://api.together.ai/settings/api-keys",
  needsKey: true,
  models: [
    { id: "black-forest-labs/FLUX.2-dev", label: "FLUX.2 dev", note: "1.5¢ per megapixel" },
    { id: "black-forest-labs/FLUX.2-pro", label: "FLUX.2 pro", note: "3¢ per megapixel" },
    { id: "Qwen/Qwen-Image", label: "Qwen Image", note: "0.6¢ per megapixel" },
    { id: "ByteDance-Seed/Seedream-4.0", label: "Seedream 4.0", note: "3¢ per megapixel" },
    { id: "Rundiffusion/Juggernaut-Lightning-Flux", label: "Juggernaut Lightning", note: "0.2¢ per megapixel" },
    { id: "black-forest-labs/FLUX.1.1-pro", label: "FLUX 1.1 pro", note: "4¢ per megapixel" },
  ],
  customModel: true,
  supportsNegative: true,
  supportsSeed: true,

  async listModels(creds, signal): Promise<ImageModel[]> {
    const res = await call(`${API}/models`, { headers: bearer(creds.apiKey), signal, purpose: "image models list" });
    const body = await json<ListedModel[] | { data?: ListedModel[] }>(res, NAME);
    const all = Array.isArray(body) ? body : (body.data ?? []);
    return all.filter((m) => m.type === "image").map((m) => ({ id: m.id, label: m.display_name ?? m.id }));
  },

  async generate(request, model, creds): Promise<GeneratedImage[]> {
    const { width, height } = dimensions(request.aspect, request.quality === "high" ? 2 : 1, 16, 2048);
    const body: Record<string, unknown> = { model, prompt: request.prompt, width, height, response_format: "base64" };
    if (request.count > 1) body.n = request.count;
    if (takesExtras(model)) {
      body.output_format = "png";
      if (request.seed != null) body.seed = request.seed;
      if (request.negativePrompt?.trim()) body.negative_prompt = request.negativePrompt.trim();
    }
    const res = await call(`${API}/images/generations`, { headers: bearer(creds.apiKey), signal: request.signal, body });
    const answer = await json<ImagesResponse>(res, NAME);
    const out: GeneratedImage[] = [];
    for (const item of answer.data ?? []) {
      if (item.b64_json) out.push({ blob: base64ToBlob(item.b64_json), seed: request.seed ?? null });
      // Together's CDN answers 403 to a request without a User-Agent.
      else if (item.url) out.push({ blob: await download(item.url, NAME, request.signal, { "User-Agent": "owntools" }), seed: request.seed ?? null });
    }
    return out;
  },
};
