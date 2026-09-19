/**
 * fal.ai — the queue API (checked 2026-09-18): submit to
 * `queue.fal.run/{endpoint}`, follow the `status_url` it returns, read the
 * result from `response_url`. Always the URLs from the answer: an app's path
 * can differ from its endpoint id.
 *
 * Endpoints disagree about how a size is said (`image_size` as a name or as
 * pixels, `aspect_ratio`, a `"1024x1024"` string) and whether they batch, so
 * the request is built from the endpoint's own published schema —
 * `api.fal.ai/v1/models?endpoint_id=…&expand=openapi-3.0`, public, verified
 * live — and falls back to a bare prompt when that cannot be read.
 */
import { call, closestRatio, closestSize, dimensions, download, json, poll, repeat } from "../http";
import { ProviderError, type AspectRatio, type GeneratedImage, type ImageModel, type ImageProvider, type ImageRequest } from "../types";

const QUEUE = "https://queue.fal.run";
const PLATFORM = "https://api.fal.ai/v1";
const NAME = "fal.ai";

interface Property {
  type?: string;
  enum?: (string | number)[];
  anyOf?: Property[];
  $ref?: string;
  maximum?: number;
}

export type FalInputSchema = Record<string, Property>;

interface ModelsResponse {
  models?: {
    endpoint_id: string;
    metadata?: { display_name?: string; description?: string };
    openapi?: { components?: { schemas?: Record<string, { properties?: FalInputSchema }> } };
  }[];
}

interface Submitted {
  request_id: string;
  status_url: string;
  response_url: string;
}

interface Status {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";
  queue_position?: number;
  error?: string | null;
  error_type?: string | null;
}

interface Result {
  images?: { url: string }[];
  image?: { url: string };
  seed?: number;
}

const NAMED_SIZE: Record<AspectRatio, string> = {
  "1:1": "square_hd",
  "4:3": "landscape_4_3",
  "3:2": "landscape_4_3",
  "16:9": "landscape_16_9",
  "3:4": "portrait_4_3",
  "2:3": "portrait_4_3",
  "9:16": "portrait_16_9",
};

function auth(key: string): Record<string, string> {
  return { Authorization: `Key ${key.trim()}` };
}

const schemas = new Map<string, Promise<FalInputSchema | null>>();

function inputSchema(endpoint: string, signal?: AbortSignal): Promise<FalInputSchema | null> {
  let cached = schemas.get(endpoint);
  if (!cached) {
    cached = call(`${PLATFORM}/models?endpoint_id=${encodeURIComponent(endpoint)}&expand=openapi-3.0`, { signal, purpose: "image model details" })
      .then((res) => json<ModelsResponse>(res, NAME))
      .then((body) => {
        const all = body.models?.[0]?.openapi?.components?.schemas ?? {};
        const name = Object.keys(all).find((k) => /Input$/.test(k));
        return name ? (all[name].properties ?? null) : null;
      })
      .catch(() => {
        schemas.delete(endpoint);
        return null;
      });
    schemas.set(endpoint, cached);
  }
  return cached;
}

/** Test hook. */
export function resetFalSchemas(): void {
  schemas.clear();
}

function enumValues(prop: Property | undefined): string[] {
  if (!prop) return [];
  const own = prop.enum ?? [];
  const nested = (prop.anyOf ?? []).flatMap((p) => p.enum ?? []);
  return [...own, ...nested].map(String);
}

/** The JSON body for one call, from what the endpoint's schema says it takes. */
export function falInput(
  schema: FalInputSchema | null,
  request: Pick<ImageRequest, "prompt" | "negativePrompt" | "aspect" | "seed" | "quality">,
  n: number,
): Record<string, unknown> {
  const input: Record<string, unknown> = { prompt: request.prompt };
  if (!schema) return input;
  if (schema.aspect_ratio) {
    const ratios = enumValues(schema.aspect_ratio).filter((r) => /^\d+:\d+$/.test(r));
    input.aspect_ratio = !ratios.length || ratios.includes(request.aspect) ? request.aspect : closestRatio(request.aspect, ratios);
  } else if (schema.image_size) {
    const values = enumValues(schema.image_size);
    const pixels = values.filter((v) => /^\d+x\d+$/.test(v));
    const takesObject = (schema.image_size.anyOf ?? []).some((p) => p.$ref || p.type === "object") || Boolean(schema.image_size.$ref);
    if (pixels.length) input.image_size = closestSize(request.aspect, pixels);
    else if (takesObject) input.image_size = dimensions(request.aspect, 1, 16);
    else if (values.includes(NAMED_SIZE[request.aspect])) input.image_size = NAMED_SIZE[request.aspect];
  }
  if (schema.resolution && request.quality === "high" && enumValues(schema.resolution).includes("2K")) input.resolution = "2K";
  if (n > 1 && schema.num_images && (schema.num_images.maximum ?? 1) >= n) input.num_images = n;
  if (request.seed != null && schema.seed) input.seed = request.seed;
  if (request.negativePrompt?.trim() && schema.negative_prompt) input.negative_prompt = request.negativePrompt.trim();
  const formats = enumValues(schema.output_format);
  if (formats.includes("png")) input.output_format = "png";
  return input;
}

export const fal: ImageProvider = {
  id: "fal",
  name: NAME,
  group: "cloud",
  blurb: "Fast hosted open models - FLUX.2, Z-Image, Qwen, Seedream, Ideogram, Recraft - billed by the picture.",
  keyUrl: "https://fal.ai/dashboard/keys",
  keyPlaceholder: "key-id:key-secret",
  needsKey: true,
  models: [
    { id: "fal-ai/flux/schnell", label: "FLUX.1 schnell", note: "Fast and cheap" },
    { id: "fal-ai/flux-2-pro", label: "FLUX.2 pro" },
    { id: "fal-ai/flux-2/klein/4b", label: "FLUX.2 klein 4B" },
    { id: "fal-ai/z-image/turbo", label: "Z-Image Turbo" },
    { id: "fal-ai/nano-banana-2", label: "Nano Banana 2" },
    { id: "fal-ai/qwen-image", label: "Qwen Image", note: "2¢ per megapixel" },
    { id: "fal-ai/bytedance/seedream/v4.5/text-to-image", label: "Seedream 4.5" },
    { id: "fal-ai/ideogram/v3", label: "Ideogram v3", note: "Text in pictures" },
    { id: "fal-ai/recraft/v3/text-to-image", label: "Recraft V3" },
  ],
  customModel: true,
  supportsNegative: true,
  supportsSeed: true,

  async listModels(creds, signal): Promise<ImageModel[]> {
    const out: ImageModel[] = [];
    let cursor = "";
    // Two pages of a hundred cover the active text-to-image catalogue today.
    for (let page = 0; page < 3; page++) {
      const res = await call(`${PLATFORM}/models?category=text-to-image&status=active&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, {
        headers: creds.apiKey.trim() ? auth(creds.apiKey) : undefined,
        signal,
        purpose: "image models list",
      });
      const body = await json<ModelsResponse & { next_cursor?: string | null; has_more?: boolean }>(res, NAME);
      for (const m of body.models ?? []) out.push({ id: m.endpoint_id, label: m.metadata?.display_name ?? m.endpoint_id });
      if (!body.has_more || !body.next_cursor) break;
      cursor = body.next_cursor;
    }
    return out;
  },

  async generate(request, model, creds): Promise<GeneratedImage[]> {
    const headers = auth(creds.apiKey);
    const schema = await inputSchema(model, request.signal);
    const batched = "num_images" in falInput(schema, request, request.count);

    const once = async (n: number): Promise<GeneratedImage[]> => {
      const submitted = await json<Submitted>(
        await call(`${QUEUE}/${model}`, { headers, signal: request.signal, body: falInput(schema, request, n) }),
        NAME,
      );
      await poll(async () => {
        const status = await json<Status>(await call(submitted.status_url, { headers, signal: request.signal }), NAME);
        if (status.status !== "COMPLETED") {
          request.onProgress?.({
            note: status.status === "IN_QUEUE" ? `Waiting in the queue${status.queue_position ? ` (${status.queue_position} ahead)` : ""}` : "Generating",
            fraction: null,
          });
          return null;
        }
        // "COMPLETED" is not "succeeded": a failed job completes with an error on it.
        if (status.error) throw new ProviderError(`${NAME}: ${status.error.slice(0, 300)}`, /content_policy|nsfw/i.test(status.error_type ?? "") ? "blocked" : "other");
        return status;
      }, { signal: request.signal, everyMs: 700, maxMs: 3000 });
      const result = await json<Result>(await call(submitted.response_url, { headers, signal: request.signal }), NAME);
      const urls = result.images?.map((i) => i.url) ?? (result.image ? [result.image.url] : []);
      if (!urls.length) throw new ProviderError(`${NAME} finished without a picture.`);
      return Promise.all(urls.map(async (url) => ({ blob: await download(url, NAME, request.signal), seed: result.seed ?? request.seed ?? null })));
    };
    return batched || request.count === 1 ? once(request.count) : repeat(request.count, () => once(1));
  },
};
