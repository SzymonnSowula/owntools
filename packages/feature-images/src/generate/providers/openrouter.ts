/**
 * OpenRouter — the dedicated Image API, `POST /api/v1/images` (checked
 * 2026-09-18), one key in front of ~50 image models from a dozen labs.
 *
 * What a model accepts differs by model and OpenRouter refuses a parameter
 * its endpoint does not know, so the request is built against the model's own
 * `supported_parameters` from `/images/models` (public, cached for the
 * session): a parameter is only sent when the model lists it, with a value
 * from its list. Google's models draw one picture per call; a batch for them
 * is several calls.
 */
import { base64ToBlob, bearer, call, closestRatio, json, repeat } from "../http";
import type { GeneratedImage, ImageModel, ImageProvider, ImageRequest, Quality } from "../types";

const API = "https://openrouter.ai/api/v1";
const NAME = "OpenRouter";
/** App attribution, as OpenRouter's docs ask of every integration. */
const ATTRIBUTION = { "HTTP-Referer": "https://owntools.app", "X-OpenRouter-Title": "owntools" };

type Supported =
  | { type: "enum"; values: (string | number)[] }
  | { type: "range"; min: number; max: number }
  | { type: "boolean" };

export interface RouterModel {
  id: string;
  name?: string;
  supported_parameters?: Record<string, Supported>;
}

interface ListResponse {
  data?: RouterModel[];
}

interface ImagesResponse {
  data?: { b64_json?: string; media_type?: string }[];
}

let catalogue: Promise<RouterModel[]> | null = null;

async function fetchCatalogue(signal?: AbortSignal): Promise<RouterModel[]> {
  const res = await call(`${API}/images/models`, { headers: ATTRIBUTION, signal, purpose: "image models list" });
  return (await json<ListResponse>(res, NAME)).data ?? [];
}

function models(signal?: AbortSignal): Promise<RouterModel[]> {
  if (!catalogue) {
    catalogue = fetchCatalogue(signal).catch((err) => {
      catalogue = null;
      throw err;
    });
  }
  return catalogue;
}

/** Test hook. */
export function resetOpenRouterCatalogue(): void {
  catalogue = null;
}

const QUALITY: Record<Quality, string[]> = {
  draft: ["low", "auto"],
  standard: ["medium", "auto"],
  high: ["high", "medium", "auto"],
};

/** The body for one call: only what `model` says it takes. Unknown model → the two fields every model has. */
export function routerBody(
  model: RouterModel | undefined,
  id: string,
  request: Pick<ImageRequest, "prompt" | "aspect" | "quality" | "seed">,
  n: number,
): Record<string, unknown> {
  const body: Record<string, unknown> = { model: id, prompt: request.prompt };
  const supported = model?.supported_parameters;
  if (!supported) return body;
  const enumOf = (key: string): string[] | null => {
    const p = supported[key];
    return p && p.type === "enum" ? p.values.map(String) : null;
  };
  const ratios = enumOf("aspect_ratio");
  if (ratios?.length) {
    const usable = ratios.filter((r) => /^\d+(\.\d+)?:\d+(\.\d+)?$/.test(r));
    if (usable.length) body.aspect_ratio = usable.includes(request.aspect) ? request.aspect : closestRatio(request.aspect, usable);
  }
  const qualities = enumOf("quality");
  if (qualities) {
    const pick = QUALITY[request.quality].find((q) => qualities.includes(q));
    if (pick) body.quality = pick;
  }
  const resolutions = enumOf("resolution");
  if (resolutions && request.quality === "high" && resolutions.includes("2K")) body.resolution = "2K";
  const count = supported.n;
  if (n > 1 && count && count.type === "range" && count.max >= n) body.n = n;
  if (request.seed != null && supported.seed) body.seed = request.seed;
  return body;
}

export const openrouter: ImageProvider = {
  id: "openrouter",
  name: NAME,
  group: "cloud",
  blurb: "One key for some fifty image models - GPT Image, Nano Banana, FLUX.2, Seedream, Recraft, Qwen.",
  keyUrl: "https://openrouter.ai/settings/keys",
  keyPlaceholder: "sk-or-…",
  needsKey: true,
  models: [
    { id: "google/gemini-3.1-flash-image", label: "Nano Banana 2", note: "Google · about 7¢" },
    { id: "openai/gpt-image-2.5-flare", label: "GPT Image 2.5 Flare", note: "OpenAI" },
    { id: "black-forest-labs/flux.2-pro", label: "FLUX.2 pro", note: "Black Forest Labs · 3¢ per megapixel" },
    { id: "black-forest-labs/flux.2-klein-4b", label: "FLUX.2 klein 4B", note: "The cheap fast one · 1.4¢ per megapixel" },
    { id: "bytedance-seed/seedream-4.5", label: "Seedream 4.5", note: "ByteDance · 4¢" },
    { id: "qwen/qwen-image-3", label: "Qwen Image 3", note: "Alibaba · 3¢" },
    { id: "recraft/recraft-v4.1", label: "Recraft V4.1", note: "Design and illustration · 3.5¢" },
    { id: "x-ai/grok-imagine-image-2.0", label: "Grok Imagine 2.0", note: "xAI · 4¢" },
  ],
  customModel: true,
  supportsNegative: false,
  supportsSeed: true,

  async listModels(_creds, signal): Promise<ImageModel[]> {
    return (await models(signal)).map((m) => ({ id: m.id, label: m.name ?? m.id }));
  },

  async generate(request, model, creds): Promise<GeneratedImage[]> {
    // The catalogue is a nicety: without it the request still goes out, just bare.
    const known = await models(request.signal)
      .then((all) => all.find((m) => m.id === model))
      .catch(() => undefined);
    const batched = "n" in routerBody(known, model, request, request.count);
    const once = async (n: number): Promise<GeneratedImage[]> => {
      const res = await call(`${API}/images`, {
        headers: { ...bearer(creds.apiKey), ...ATTRIBUTION },
        signal: request.signal,
        body: routerBody(known, model, request, n),
      });
      const answer = await json<ImagesResponse>(res, NAME);
      return (answer.data ?? []).filter((d) => d.b64_json).map((d) => ({ blob: base64ToBlob(d.b64_json as string), seed: request.seed ?? null }));
    };
    return batched || request.count === 1 ? once(request.count) : repeat(request.count, () => once(1));
  },
};
