/**
 * Replicate — `POST /v1/models/{owner}/{name}/predictions` with
 * `Prefer: wait` (checked 2026-09-18). Every model has its own inputs, so the
 * request is built from the model's published schema
 * (`latest_version.openapi_schema…Input.properties`): `aspect_ratio` when the
 * model has one, `width`/`height` when it has those, `num_outputs` only where
 * it exists — a model that draws one picture per call is simply called again.
 * A community model (no "official" flag) needs its version id, which the same
 * lookup provides. Outputs are URLs that die within the hour; they are
 * downloaded at once.
 */
import { bearer, call, closestRatio, dimensions, download, json, poll, repeat } from "../http";
import { ProviderError, type GeneratedImage, type ImageModel, type ImageProvider, type ImageRequest } from "../types";

const API = "https://api.replicate.com/v1";
const NAME = "Replicate";

interface SchemaProperty {
  type?: string;
  enum?: (string | number)[];
  allOf?: { enum?: (string | number)[] }[];
  maximum?: number;
}

interface ModelInfo {
  is_official?: boolean;
  latest_version?: {
    id?: string;
    openapi_schema?: { components?: { schemas?: Record<string, { enum?: (string | number)[]; properties?: Record<string, SchemaProperty> }> } };
  };
}

interface Prediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled" | "aborted";
  output?: string | string[] | null;
  error?: string | null;
  urls?: { get?: string };
}

interface Collection {
  models?: { owner: string; name: string; description?: string | null; run_count?: number }[];
}

const schemas = new Map<string, Promise<ModelInfo>>();

function modelInfo(model: string, key: string, signal?: AbortSignal): Promise<ModelInfo> {
  let cached = schemas.get(model);
  if (!cached) {
    cached = call(`${API}/models/${model}`, { headers: bearer(key), signal, purpose: "image model details" })
      .then((res) => json<ModelInfo>(res, NAME))
      .catch((err) => {
        schemas.delete(model);
        throw err;
      });
    schemas.set(model, cached);
  }
  return cached;
}

/** Test hook. */
export function resetReplicateSchemas(): void {
  schemas.clear();
}

function enumOf(info: ModelInfo, name: string): string[] | null {
  const all = info.latest_version?.openapi_schema?.components?.schemas ?? {};
  const prop = all.Input?.properties?.[name];
  if (!prop) return null;
  const direct = prop.enum ?? prop.allOf?.find((a) => a.enum)?.enum;
  // Cog publishes an enum as its own schema and points at it with allOf/$ref.
  const named = all[name]?.enum;
  const values = direct ?? named;
  return values ? values.map(String) : [];
}

/** The `input` object for one call, from what the model's schema says it takes. */
export function replicateInput(info: ModelInfo, request: Pick<ImageRequest, "prompt" | "negativePrompt" | "aspect" | "seed">, n: number): Record<string, unknown> {
  const props = info.latest_version?.openapi_schema?.components?.schemas?.Input?.properties ?? {};
  const has = (name: string) => name in props;
  const input: Record<string, unknown> = { prompt: request.prompt };
  if (has("aspect_ratio")) {
    const ratios = (enumOf(info, "aspect_ratio") ?? []).filter((r) => /^\d+:\d+$/.test(r));
    input.aspect_ratio = !ratios.length || ratios.includes(request.aspect) ? request.aspect : closestRatio(request.aspect, ratios);
  } else if (has("width") && has("height")) {
    const { width, height } = dimensions(request.aspect, 1, 32);
    input.width = width;
    input.height = height;
  }
  if (n > 1 && has("num_outputs")) input.num_outputs = n;
  if (request.seed != null && has("seed")) input.seed = request.seed;
  if (request.negativePrompt?.trim() && has("negative_prompt")) input.negative_prompt = request.negativePrompt.trim();
  if (has("output_format")) {
    const formats = enumOf(info, "output_format") ?? [];
    if (!formats.length || formats.includes("png")) input.output_format = "png";
  }
  return input;
}

function outputs(prediction: Prediction): string[] {
  const out = prediction.output;
  return out == null ? [] : Array.isArray(out) ? out : [out];
}

export const replicate: ImageProvider = {
  id: "replicate",
  name: NAME,
  group: "cloud",
  blurb: "Thousands of open models by id - FLUX, Seedream, Ideogram, Qwen, Z-Image and whatever came out this week.",
  keyUrl: "https://replicate.com/account/api-tokens",
  keyPlaceholder: "r8_…",
  needsKey: true,
  models: [
    { id: "black-forest-labs/flux-schnell", label: "FLUX schnell", note: "Fast and cheap · 0.3¢ a picture" },
    { id: "black-forest-labs/flux-2-pro", label: "FLUX.2 pro" },
    { id: "black-forest-labs/flux-2-klein-4b", label: "FLUX.2 klein 4B" },
    { id: "black-forest-labs/flux-1.1-pro", label: "FLUX 1.1 pro", note: "4¢ a picture" },
    { id: "google/nano-banana-2", label: "Nano Banana 2" },
    { id: "bytedance/seedream-4.5", label: "Seedream 4.5" },
    { id: "ideogram-ai/ideogram-v3-turbo", label: "Ideogram v3 Turbo", note: "Text in pictures · 3¢" },
    { id: "recraft-ai/recraft-v4.1", label: "Recraft V4.1" },
    { id: "qwen/qwen-image", label: "Qwen Image" },
    { id: "prunaai/z-image-turbo", label: "Z-Image Turbo" },
  ],
  customModel: true,
  supportsNegative: true,
  supportsSeed: true,

  async listModels(creds, signal): Promise<ImageModel[]> {
    const res = await call(`${API}/collections/text-to-image`, { headers: bearer(creds.apiKey), signal, purpose: "image models list" });
    const body = await json<Collection>(res, NAME);
    return (body.models ?? [])
      .sort((a, b) => (b.run_count ?? 0) - (a.run_count ?? 0))
      .map((m) => ({ id: `${m.owner}/${m.name}`, label: `${m.owner}/${m.name}`, note: m.description?.slice(0, 90) ?? undefined }));
  },

  async generate(request, model, creds): Promise<GeneratedImage[]> {
    const key = creds.apiKey;
    const [owner, name] = model.split(":")[0].split("/");
    if (!owner || !name) throw new ProviderError(`${NAME}: a model is written owner/name, e.g. black-forest-labs/flux-schnell.`, "input");
    const slug = `${owner}/${name}`;
    const info = await modelInfo(slug, key, request.signal);
    const pinned = model.includes(":") ? model.split(":")[1] : null;
    const version = pinned ?? (info.is_official ? null : (info.latest_version?.id ?? null));
    const batched = "num_outputs" in replicateInput(info, request, request.count);

    const once = async (n: number): Promise<GeneratedImage[]> => {
      const input = replicateInput(info, request, n);
      const res = await call(version ? `${API}/predictions` : `${API}/models/${slug}/predictions`, {
        headers: { ...bearer(key), Prefer: "wait" },
        signal: request.signal,
        body: version ? { version, input } : { input },
      });
      let prediction = await json<Prediction>(res, NAME);
      // `Prefer: wait` gives up after a minute and hands back a job to poll.
      // A file output can be there while the status still says "processing".
      if (!outputs(prediction).length && (prediction.status === "starting" || prediction.status === "processing")) {
        const statusUrl = prediction.urls?.get ?? `${API}/predictions/${prediction.id}`;
        request.onProgress?.({ note: "Waiting for Replicate", fraction: null });
        prediction = await poll(async () => {
          const next = await json<Prediction>(await call(statusUrl, { headers: bearer(key), signal: request.signal }), NAME);
          return outputs(next).length || !["starting", "processing"].includes(next.status) ? next : null;
        }, { signal: request.signal });
      }
      if (!outputs(prediction).length) {
        throw new ProviderError(`${NAME}: ${prediction.error?.slice(0, 300) || `the prediction ${prediction.status}.`}`, /nsfw|safety|flagged/i.test(prediction.error ?? "") ? "blocked" : "other");
      }
      return Promise.all(outputs(prediction).map(async (url) => ({ blob: await download(url, NAME, request.signal), seed: request.seed ?? null })));
    };
    return batched || request.count === 1 ? once(request.count) : repeat(request.count, () => once(1));
  },
};
