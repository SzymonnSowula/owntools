/**
 * The labs that sell their own models over their own APIs, each with a shape
 * of its own (all checked 2026-09-18 against the vendors' OpenAPI files):
 *
 *   Stability AI       multipart form in, the picture itself out;
 *   Black Forest Labs  a job id and a `polling_url`, then a signed URL that
 *                      lives ten minutes;
 *   Ideogram           multipart form in, URLs out — and 4.0 is a different
 *                      form from 3.0 (`text_prompt`, a resolution, one
 *                      picture per call).
 */
import { bearer, call, closestRatio, closestSize, dimensions, download, failure, imageBody, json, poll, repeat } from "../http";
import { ProviderError, type GeneratedImage, type ImageProvider, type ImageRequest, type Quality } from "../types";

/* ---- Stability AI ------------------------------------------------------- */

const STABILITY_RATIOS = ["21:9", "16:9", "3:2", "5:4", "1:1", "4:5", "2:3", "9:16", "9:21"];

/** Which of the three endpoints a model id belongs to. */
export function stabilityEndpoint(model: string): "ultra" | "core" | "sd3" {
  return model === "ultra" || model === "core" ? model : "sd3";
}

export function stabilityForm(model: string, request: Pick<ImageRequest, "prompt" | "negativePrompt" | "aspect" | "seed">): FormData {
  const form = new FormData();
  form.set("prompt", request.prompt);
  form.set("aspect_ratio", closestRatio(request.aspect, STABILITY_RATIOS));
  form.set("output_format", "png");
  if (request.negativePrompt?.trim()) form.set("negative_prompt", request.negativePrompt.trim());
  // 0 means "random" to this API, so a real 0 is left out rather than misread.
  if (request.seed) form.set("seed", String(request.seed % 4294967295));
  if (stabilityEndpoint(model) === "sd3") form.set("model", model);
  return form;
}

export const stability: ImageProvider = {
  id: "stability",
  name: "Stability AI",
  group: "cloud",
  blurb: "Stable Image Ultra and Core, and Stable Diffusion 3.5 - the house that started open image models.",
  keyUrl: "https://platform.stability.ai/account/keys",
  keyPlaceholder: "sk-…",
  needsKey: true,
  models: [
    { id: "core", label: "Stable Image Core", note: "3¢ a picture" },
    { id: "ultra", label: "Stable Image Ultra", note: "8¢ a picture" },
    { id: "sd3.5-large", label: "Stable Diffusion 3.5 Large", note: "6.5¢" },
    { id: "sd3.5-large-turbo", label: "SD 3.5 Large Turbo", note: "4¢" },
    { id: "sd3.5-medium", label: "SD 3.5 Medium", note: "3.5¢" },
  ],
  customModel: false,
  supportsNegative: true,
  supportsSeed: true,
  generate(request, model, creds): Promise<GeneratedImage[]> {
    return repeat(request.count, async (index) => {
      // The form is built per call: a FormData body is consumed by the request that sends it.
      const seeded = request.seed != null ? { ...request, seed: request.seed + index } : request;
      const res = await call(`https://api.stability.ai/v2beta/stable-image/generate/${stabilityEndpoint(model)}`, {
        headers: { ...bearer(creds.apiKey), Accept: "image/*" },
        signal: request.signal,
        body: stabilityForm(model, seeded),
      });
      if (!res.ok) throw await failure(res, "Stability AI");
      // A filtered picture comes back as a 200 with a blur in it; the header is the only tell.
      if (res.headers.get("finish-reason") === "CONTENT_FILTERED") {
        throw new ProviderError("Stability AI: the content filter blurred this picture, so it was not kept.", "blocked");
      }
      const seed = Number(res.headers.get("seed"));
      return [{ blob: await imageBody(res, "Stability AI"), seed: Number.isFinite(seed) && seed > 0 ? seed : null }];
    });
  },
};

/* ---- Black Forest Labs -------------------------------------------------- */

const BFL = "https://api.bfl.ai/v1";

interface BflCreated {
  id: string;
  polling_url: string;
}

interface BflStatus {
  status: string;
  result?: { sample?: string } | null;
  details?: Record<string, unknown> | null;
}

/** Ultra and Kontext take a ratio; every other model takes pixels, on its own grid. */
export function bflBody(model: string, request: Pick<ImageRequest, "prompt" | "aspect" | "seed" | "quality">): Record<string, unknown> {
  const body: Record<string, unknown> = { prompt: request.prompt, output_format: "png" };
  if (request.seed != null) body.seed = request.seed;
  if (/ultra|kontext/.test(model)) {
    body.aspect_ratio = request.aspect;
    return body;
  }
  const legacy = /^flux-(pro-1\.1|dev)$/.test(model);
  // FLUX 1.1 pro: 256–1440 px on a 32 px grid. FLUX.2: up to 4 MP.
  const size = legacy ? dimensions(request.aspect, 1, 32, 1440) : dimensions(request.aspect, request.quality === "high" ? 2 : 1, 16, 2048);
  body.width = size.width;
  body.height = size.height;
  return body;
}

export const bfl: ImageProvider = {
  id: "bfl",
  name: "Black Forest Labs",
  group: "cloud",
  blurb: "FLUX from the people who make it - FLUX.2 pro, max, flex and the quick klein.",
  keyUrl: "https://dashboard.bfl.ai/keys",
  needsKey: true,
  models: [
    { id: "flux-2-pro", label: "FLUX.2 pro", note: "From 3¢ a picture" },
    { id: "flux-2-klein-4b", label: "FLUX.2 klein 4B", note: "From 1.4¢ · the quick one" },
    { id: "flux-2-klein-9b", label: "FLUX.2 klein 9B", note: "From 1.5¢" },
    { id: "flux-2-flex", label: "FLUX.2 flex", note: "From 5¢" },
    { id: "flux-2-max", label: "FLUX.2 max", note: "From 7¢ · the best" },
    { id: "flux-pro-1.1", label: "FLUX 1.1 pro", note: "4¢" },
    { id: "flux-pro-1.1-ultra", label: "FLUX 1.1 pro Ultra", note: "6¢ · 4 MP" },
  ],
  customModel: true,
  supportsNegative: false,
  supportsSeed: true,
  generate(request, model, creds): Promise<GeneratedImage[]> {
    const headers = { "x-key": creds.apiKey.trim() };
    return repeat(request.count, async (index) => {
      const seeded = request.seed != null ? { ...request, seed: request.seed + index } : request;
      const created = await json<BflCreated>(await call(`${BFL}/${model}`, { headers, signal: request.signal, body: bflBody(model, seeded) }), "Black Forest Labs");
      const done = await poll(async () => {
        // The polling URL may be on a regional host; it is the one to use.
        const status = await json<BflStatus>(await call(created.polling_url, { headers, signal: request.signal }), "Black Forest Labs");
        if (status.status === "Ready") return status;
        if (/Moderated/.test(status.status)) throw new ProviderError("Black Forest Labs: the content filter refused this prompt.", "blocked");
        if (/Error|Failed|not found/i.test(status.status)) throw new ProviderError(`Black Forest Labs: the job ended with "${status.status}".`);
        request.onProgress?.({ note: status.status === "Pending" ? "Waiting in the queue" : "Generating", fraction: null });
        return null;
      }, { signal: request.signal, everyMs: 800, maxMs: 2500 });
      const url = done.result?.sample;
      if (!url) throw new ProviderError("Black Forest Labs finished without a picture.");
      return [{ blob: await download(url, "Black Forest Labs", request.signal), seed: seeded.seed ?? null }];
    });
  },
};

/* ---- Ideogram ----------------------------------------------------------- */

const IDEOGRAM_V4_SIZES = ["1024x1024", "1280x720", "720x1280", "1248x832", "832x1248", "1152x864", "864x1152", "1120x896", "896x1120", "1280x800", "800x1280"];
const IDEOGRAM_V4_SIZES_2K = ["2048x2048", "2560x1440", "1440x2560", "2496x1664", "1664x2496", "2304x1728", "1728x2304", "2240x1792", "1792x2240", "2560x1600", "1600x2560"];
const IDEOGRAM_SPEED: Record<Quality, string> = { draft: "TURBO", standard: "DEFAULT", high: "QUALITY" };

interface IdeogramResponse {
  data?: { url: string | null; is_image_safe?: boolean; seed?: number }[];
}

export function ideogramForm(model: string, request: Pick<ImageRequest, "prompt" | "negativePrompt" | "aspect" | "seed" | "quality" | "count">): FormData {
  const form = new FormData();
  form.set("rendering_speed", IDEOGRAM_SPEED[request.quality]);
  if (model === "ideogram-v4") {
    // 4.0: another field name, a resolution instead of a ratio, no batch, no seed, no negative prompt.
    form.set("text_prompt", request.prompt);
    form.set("resolution", closestSize(request.aspect, request.quality === "high" ? IDEOGRAM_V4_SIZES_2K : IDEOGRAM_V4_SIZES));
    return form;
  }
  form.set("prompt", request.prompt);
  form.set("aspect_ratio", request.aspect.replace(":", "x"));
  form.set("num_images", String(request.count));
  if (request.negativePrompt?.trim()) form.set("negative_prompt", request.negativePrompt.trim());
  if (request.seed != null) form.set("seed", String(request.seed % 2147483647));
  return form;
}

export const ideogram: ImageProvider = {
  id: "ideogram",
  name: "Ideogram",
  group: "cloud",
  blurb: "The one that spells - posters, logos, covers, anything with words in it.",
  keyUrl: "https://ideogram.ai/manage-api",
  needsKey: true,
  models: [
    { id: "ideogram-v3", label: "Ideogram 3.0", note: "Batches, seeds and a negative prompt" },
    { id: "ideogram-v4", label: "Ideogram 4.0", note: "The newest · one picture per call" },
  ],
  customModel: false,
  supportsNegative: true,
  supportsSeed: true,
  async generate(request, model, creds): Promise<GeneratedImage[]> {
    const v4 = model === "ideogram-v4";
    const once = async (): Promise<GeneratedImage[]> => {
      const res = await call(`https://api.ideogram.ai/v1/${v4 ? "ideogram-v4" : "ideogram-v3"}/generate`, {
        headers: { "Api-Key": creds.apiKey.trim() },
        signal: request.signal,
        body: ideogramForm(model, request),
      });
      const answer = await json<IdeogramResponse>(res, "Ideogram");
      const safe = (answer.data ?? []).filter((d) => d.url);
      if (!safe.length) throw new ProviderError("Ideogram: the safety check held the picture back.", "blocked");
      return Promise.all(safe.map(async (d) => ({ blob: await download(d.url as string, "Ideogram", request.signal), seed: d.seed ?? null })));
    };
    return v4 ? repeat(request.count, once) : once();
  },
};
