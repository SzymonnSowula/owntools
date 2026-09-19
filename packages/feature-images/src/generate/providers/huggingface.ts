/**
 * Hugging Face Inference Providers — one HF token, routed to whoever serves
 * the model (checked 2026-09-18 against the docs and the huggingface.js
 * source, which is where the route shapes are actually written down).
 *
 * "auto" is resolved on the client: the model's `inferenceProviderMapping`
 * says who serves it, and the first live text-to-image entry among the routes
 * implemented here wins. Every route takes `Authorization: Bearer hf_…`, fal's
 * included. One picture per call.
 */
import { base64ToBlob, bearer, call, dimensions, download, imageBody, json, poll, repeat } from "../http";
import { ProviderError, type GeneratedImage, type ImageModel, type ImageProvider, type ImageRequest } from "../types";

const ROUTER = "https://router.huggingface.co";
const HUB = "https://huggingface.co/api";
const NAME = "Hugging Face";

type Route = "fal-ai" | "replicate" | "nscale" | "together" | "hf-inference";
/** Preference order: the routes that answer fastest for the popular base models first. */
const ROUTES: Route[] = ["fal-ai", "replicate", "nscale", "together", "hf-inference"];

interface MappingEntry {
  provider?: string;
  providerId: string;
  status?: string;
  task?: string;
  adapter?: string | null;
}

interface HubModel {
  id: string;
  likes?: number;
  inferenceProviderMapping?: Record<string, MappingEntry> | MappingEntry[];
}

function entries(model: HubModel): (MappingEntry & { provider: string })[] {
  const mapping = model.inferenceProviderMapping;
  if (!mapping) return [];
  const list = Array.isArray(mapping)
    ? mapping.map((m) => ({ ...m, provider: m.provider ?? "" }))
    : Object.entries(mapping).map(([provider, m]) => ({ ...m, provider }));
  return list.filter((m) => m.task === "text-to-image" && m.status === "live" && !m.adapter);
}

/** Which implemented route serves this model, and under what id. */
export function pickRoute(model: HubModel): { route: Route; providerId: string } | null {
  const live = entries(model);
  for (const route of ROUTES) {
    const hit = live.find((m) => m.provider === route);
    if (hit) return { route, providerId: hit.providerId };
  }
  return null;
}

async function viaFal(providerId: string, request: ImageRequest, headers: Record<string, string>): Promise<Blob> {
  const submit = await json<{ request_id: string; response_url: string }>(
    await call(`${ROUTER}/fal-ai/${providerId}?_subdomain=queue`, {
      headers,
      signal: request.signal,
      // fal's endpoints read `image_size`; width/height at the top level are ignored.
      body: { prompt: request.prompt, image_size: dimensions(request.aspect, 1, 16), ...(request.seed != null ? { seed: request.seed } : {}) },
    }),
    NAME,
  );
  const path = new URL(submit.response_url).pathname;
  await poll(async () => {
    const status = await json<{ status: string; error?: string | null }>(
      await call(`${ROUTER}/fal-ai${path}/status?_subdomain=queue`, { headers, signal: request.signal }),
      NAME,
    );
    if (status.status !== "COMPLETED") return null;
    if (status.error) throw new ProviderError(`${NAME} (fal): ${status.error.slice(0, 300)}`);
    return status;
  }, { signal: request.signal, everyMs: 700, maxMs: 3000 });
  const result = await json<{ images?: { url: string }[] }>(await call(`${ROUTER}/fal-ai${path}?_subdomain=queue`, { headers, signal: request.signal }), NAME);
  const url = result.images?.[0]?.url;
  if (!url) throw new ProviderError(`${NAME} (fal) finished without a picture.`);
  return download(url, NAME, request.signal);
}

async function viaReplicate(providerId: string, request: ImageRequest, headers: Record<string, string>): Promise<Blob> {
  const versioned = providerId.includes(":");
  const input = { prompt: request.prompt, ...(request.seed != null ? { seed: request.seed } : {}) };
  const prediction = await json<{ output?: string | string[] | null; error?: string | null; status?: string }>(
    await call(versioned ? `${ROUTER}/replicate/v1/predictions` : `${ROUTER}/replicate/v1/models/${providerId}/predictions`, {
      headers: { ...headers, Prefer: "wait" },
      signal: request.signal,
      body: versioned ? { version: providerId.split(":")[1], input } : { input },
    }),
    NAME,
  );
  const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (!url) {
    // The router does not proxy Replicate's polling URL, so a job longer than the minute `Prefer: wait` allows is lost to us.
    throw new ProviderError(`${NAME} (Replicate): ${prediction.error?.slice(0, 300) || "the model took longer than a minute - use a Replicate key for this one."}`);
  }
  return download(url, NAME, request.signal);
}

async function viaOpenAiShape(route: "nscale" | "together", providerId: string, request: ImageRequest, headers: Record<string, string>): Promise<Blob> {
  const { width, height } = dimensions(request.aspect, 1, 16);
  const body =
    route === "together"
      ? { model: providerId, prompt: request.prompt, width, height, response_format: "base64" }
      : { model: providerId, prompt: request.prompt, size: `${width}x${height}`, response_format: "b64_json" };
  const answer = await json<{ data?: { b64_json?: string }[] }>(
    await call(`${ROUTER}/${route}/v1/images/generations`, { headers, signal: request.signal, body }),
    NAME,
  );
  const data = answer.data?.[0]?.b64_json;
  if (!data) throw new ProviderError(`${NAME} (${route}) answered without a picture.`);
  return base64ToBlob(data);
}

async function viaHfInference(model: string, request: ImageRequest, headers: Record<string, string>): Promise<Blob> {
  const { width, height } = dimensions(request.aspect, 1, 16);
  const parameters: Record<string, unknown> = { width, height };
  if (request.seed != null) parameters.seed = request.seed;
  if (request.negativePrompt?.trim()) parameters.negative_prompt = request.negativePrompt.trim();
  const res = await call(`${ROUTER}/hf-inference/models/${model}`, { headers, signal: request.signal, body: { inputs: request.prompt, parameters } });
  return imageBody(res, NAME);
}

export const huggingface: ImageProvider = {
  id: "huggingface",
  name: NAME,
  group: "cloud",
  blurb: "One token, any open model a partner serves - FLUX, Qwen Image, Z-Image, SD 3.5. A little free credit each month.",
  keyUrl: "https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained",
  keyPlaceholder: "hf_…",
  needsKey: true,
  models: [
    { id: "black-forest-labs/FLUX.1-schnell", label: "FLUX.1 schnell" },
    { id: "black-forest-labs/FLUX.1-dev", label: "FLUX.1 dev" },
    { id: "Qwen/Qwen-Image", label: "Qwen Image" },
    { id: "Tongyi-MAI/Z-Image-Turbo", label: "Z-Image Turbo" },
    { id: "stabilityai/stable-diffusion-3.5-large", label: "Stable Diffusion 3.5 Large" },
    { id: "black-forest-labs/FLUX.1-Krea-dev", label: "FLUX.1 Krea dev" },
  ],
  customModel: true,
  supportsNegative: false,
  supportsSeed: true,

  async listModels(_creds, signal): Promise<ImageModel[]> {
    const res = await call(
      `${HUB}/models?inference_provider=all&pipeline_tag=text-to-image&sort=likes30d&limit=60&expand[]=inferenceProviderMapping`,
      { signal, purpose: "image models list" },
    );
    const all = await json<HubModel[]>(res, NAME);
    // Most rows are LoRA adapters on someone else's base model; keep what a route here can actually run.
    return all.filter((m) => pickRoute(m) !== null).map((m) => ({ id: m.id, label: m.id }));
  },

  async generate(request, model, creds): Promise<GeneratedImage[]> {
    const headers = bearer(creds.apiKey);
    const info = await json<HubModel>(
      await call(`${HUB}/models/${model}?expand[]=inferenceProviderMapping`, { headers, signal: request.signal, purpose: "image model details" }),
      NAME,
    );
    const picked = pickRoute(info);
    if (!picked) {
      throw new ProviderError(`${NAME}: no inference provider serves ${model} for text-to-image right now. Pick another model from the list.`, "input");
    }
    return repeat(request.count, async () => {
      const blob =
        picked.route === "fal-ai"
          ? await viaFal(picked.providerId, request, headers)
          : picked.route === "replicate"
            ? await viaReplicate(picked.providerId, request, headers)
            : picked.route === "hf-inference"
              ? await viaHfInference(model, request, headers)
              : await viaOpenAiShape(picked.route, picked.providerId, request, headers);
      return [{ blob, seed: request.seed ?? null }];
    });
  },
};
