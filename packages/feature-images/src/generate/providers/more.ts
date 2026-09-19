/**
 * Six more clouds whose APIs are one request in, one picture out (all checked
 * 2026-09-18). Each is small because `../http` does the rest; what is written
 * down here is only where they differ — and they all do.
 */
import { base64ToBlob, bearer, call, closestRatio, closestSize, dimensions, download, imageBody, json, repeat } from "../http";
import { ProviderError, type GeneratedImage, type ImageProvider } from "../types";

/* ---- Runware ------------------------------------------------------------ */

interface RunwareResponse {
  data?: { imageURL?: string; imageBase64Data?: string; seed?: number }[];
  errors?: { message?: string }[];
}

export const runware: ImageProvider = {
  id: "runware",
  name: "Runware",
  group: "cloud",
  blurb: "Very fast, very cheap inference - FLUX and any Civitai checkpoint by its AIR id.",
  keyUrl: "https://my.runware.ai/keys",
  needsKey: true,
  models: [
    { id: "runware:100@1", label: "FLUX.1 schnell" },
    { id: "runware:101@1", label: "FLUX.1 dev" },
    { id: "civitai:102438@133677", label: "SDXL base (Civitai)" },
  ],
  customModel: true,
  supportsNegative: true,
  supportsSeed: true,
  async generate(request, model, creds): Promise<GeneratedImage[]> {
    const { width, height } = dimensions(request.aspect, 1, 64, 2048);
    const task: Record<string, unknown> = {
      taskType: "imageInference",
      taskUUID: crypto.randomUUID(),
      positivePrompt: request.prompt,
      model,
      width,
      height,
      numberResults: request.count,
      deliveryMethod: "sync",
    };
    if (request.negativePrompt?.trim()) task.negativePrompt = request.negativePrompt.trim();
    if (request.seed != null) task.seed = request.seed;
    const res = await call("https://api.runware.ai/v1", { headers: bearer(creds.apiKey), signal: request.signal, body: [task] });
    const answer = await json<RunwareResponse>(res, "Runware");
    // A refused task is a 200 with `errors` in it.
    if (answer.errors?.length) throw new ProviderError(`Runware: ${answer.errors[0].message ?? "the task was refused."}`);
    const out: GeneratedImage[] = [];
    for (const item of answer.data ?? []) {
      if (item.imageBase64Data) out.push({ blob: base64ToBlob(item.imageBase64Data), seed: item.seed ?? null });
      else if (item.imageURL) out.push({ blob: await download(item.imageURL, "Runware", request.signal), seed: item.seed ?? null });
    }
    return out;
  },
};

/* ---- SiliconFlow -------------------------------------------------------- */

export const siliconflow: ImageProvider = {
  id: "siliconflow",
  name: "SiliconFlow",
  group: "cloud",
  blurb: "Qwen Image, Z-Image Turbo and FLUX.2 from a Chinese cloud with an international endpoint.",
  keyUrl: "https://cloud.siliconflow.com/account/ak",
  needsKey: true,
  models: [
    { id: "Tongyi-MAI/Z-Image-Turbo", label: "Z-Image Turbo" },
    { id: "Qwen/Qwen-Image", label: "Qwen Image" },
    { id: "black-forest-labs/FLUX.2-pro", label: "FLUX.2 pro" },
    { id: "black-forest-labs/FLUX.1-schnell", label: "FLUX.1 schnell" },
  ],
  customModel: true,
  supportsNegative: true,
  supportsSeed: true,
  async generate(request, model, creds): Promise<GeneratedImage[]> {
    const { width, height } = dimensions(request.aspect, 1, 16, 2048);
    const body: Record<string, unknown> = { model, prompt: request.prompt, image_size: `${width}x${height}`, batch_size: request.count };
    if (request.negativePrompt?.trim()) body.negative_prompt = request.negativePrompt.trim();
    if (request.seed != null) body.seed = request.seed;
    const res = await call("https://api.siliconflow.com/v1/images/generations", { headers: bearer(creds.apiKey), signal: request.signal, body });
    const answer = await json<{ images?: { url: string }[]; seed?: number }>(res, "SiliconFlow");
    // The URLs are good for an hour.
    return Promise.all((answer.images ?? []).map(async (i) => ({ blob: await download(i.url, "SiliconFlow", request.signal), seed: answer.seed ?? null })));
  },
};

/* ---- MiniMax ------------------------------------------------------------ */

const MINIMAX_RATIOS = ["1:1", "16:9", "4:3", "3:2", "2:3", "3:4", "9:16", "21:9"];

interface MiniMaxResponse {
  data?: { image_base64?: string[]; image_urls?: string[] };
  base_resp?: { status_code?: number; status_msg?: string };
}

export const minimax: ImageProvider = {
  id: "minimax",
  name: "MiniMax",
  group: "cloud",
  blurb: "image-01 - a capable all-rounder at a low price, up to nine pictures a call.",
  keyUrl: "https://platform.minimax.io/user-center/basic-information/interface-key",
  needsKey: true,
  models: [{ id: "image-01", label: "image-01" }],
  customModel: true,
  supportsNegative: false,
  supportsSeed: true,
  async generate(request, model, creds): Promise<GeneratedImage[]> {
    const body: Record<string, unknown> = {
      model,
      prompt: request.prompt.slice(0, 1500),
      aspect_ratio: closestRatio(request.aspect, MINIMAX_RATIOS),
      response_format: "base64",
      n: request.count,
    };
    if (request.seed != null) body.seed = request.seed;
    const res = await call("https://api.minimax.io/v1/image_generation", { headers: bearer(creds.apiKey), signal: request.signal, body });
    const answer = await json<MiniMaxResponse>(res, "MiniMax");
    // This API reports failure inside a 200: status_code 0 is the only success.
    const code = answer.base_resp?.status_code ?? 0;
    if (code !== 0) {
      const said = answer.base_resp?.status_msg ?? `error ${code}`;
      throw new ProviderError(`MiniMax: ${said}`, /key|auth|login/i.test(said) ? "auth" : /balance|insufficient/i.test(said) ? "billing" : /sensitive|safety/i.test(said) ? "blocked" : "other");
    }
    const images = answer.data?.image_base64 ?? [];
    if (images.length) return images.map((data) => ({ blob: base64ToBlob(data), seed: request.seed ?? null }));
    return Promise.all((answer.data?.image_urls ?? []).map(async (url) => ({ blob: await download(url, "MiniMax", request.signal), seed: request.seed ?? null })));
  },
};

/* ---- Cloudflare Workers AI ---------------------------------------------- */

export const cloudflare: ImageProvider = {
  id: "cloudflare",
  name: "Cloudflare Workers AI",
  group: "cloud",
  blurb: "FLUX schnell and SDXL on Cloudflare's network - a generous free allowance every day.",
  keyUrl: "https://dash.cloudflare.com/profile/api-tokens",
  needsKey: true,
  extra: { label: "Account ID", placeholder: "32 characters, from the dashboard's Workers AI page" },
  models: [
    { id: "@cf/black-forest-labs/flux-1-schnell", label: "FLUX.1 schnell" },
    { id: "@cf/stabilityai/stable-diffusion-xl-base-1.0", label: "SDXL base" },
    { id: "@cf/leonardo/lucid-origin", label: "Leonardo Lucid Origin" },
    { id: "@cf/leonardo/phoenix-1.0", label: "Leonardo Phoenix" },
  ],
  customModel: true,
  supportsNegative: false,
  supportsSeed: true,
  generate(request, model, creds): Promise<GeneratedImage[]> {
    const account = creds.extra.trim();
    if (!account) return Promise.reject(new ProviderError("Cloudflare needs the Account ID next to the token - it is on the Workers AI page of the dashboard.", "input"));
    const { width, height } = dimensions(request.aspect, 1, 16, 2048);
    return repeat(request.count, async (index) => {
      const body: Record<string, unknown> = { prompt: request.prompt.slice(0, 2048) };
      if (request.seed != null) body.seed = request.seed + index;
      // schnell has no size parameter; the others take pixels.
      if (!/flux-1-schnell/.test(model)) Object.assign(body, { width, height });
      const res = await call(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run/${model}`, {
        headers: bearer(creds.apiKey),
        signal: request.signal,
        body,
      });
      // FLUX answers JSON with a base64 JPEG in it; the SDXL family answers with the PNG itself.
      if ((res.headers.get("content-type") ?? "").startsWith("image/")) return [{ blob: await imageBody(res, "Cloudflare") }];
      const answer = await json<{ result?: { image?: string }; errors?: { message?: string }[] }>(res, "Cloudflare");
      const data = answer.result?.image;
      if (!data) throw new ProviderError(`Cloudflare: ${answer.errors?.[0]?.message ?? "no picture came back."}`);
      return [{ blob: base64ToBlob(data), seed: request.seed != null ? request.seed + index : null }];
    });
  },
};

/* ---- getimg.ai ---------------------------------------------------------- */

const GETIMG_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];

export const getimg: ImageProvider = {
  id: "getimg",
  name: "getimg.ai",
  group: "cloud",
  blurb: "A small, tidy API in front of Seedream and friends.",
  keyUrl: "https://dashboard.getimg.ai/api-keys",
  needsKey: true,
  models: [{ id: "seedream-5-lite", label: "Seedream 5 Lite" }],
  customModel: true,
  supportsNegative: false,
  supportsSeed: false,
  generate(request, model, creds): Promise<GeneratedImage[]> {
    return repeat(request.count, async () => {
      const res = await call("https://api.getimg.ai/v2/images/generations", {
        headers: bearer(creds.apiKey),
        signal: request.signal,
        body: {
          model,
          prompt: request.prompt.slice(0, 4096),
          aspect_ratio: closestRatio(request.aspect, GETIMG_RATIOS),
          resolution: request.quality === "high" ? "2K" : "1K",
          output_format: "png",
        },
      });
      const answer = await json<{ data?: { url?: string }[] }>(res, "getimg.ai");
      const url = answer.data?.[0]?.url;
      if (!url) throw new ProviderError("getimg.ai answered without a picture.");
      return [{ blob: await download(url, "getimg.ai", request.signal) }];
    });
  },
};

/* ---- Segmind ------------------------------------------------------------ */

const SEGMIND_SIZES = ["1024x1024", "1344x768", "768x1344", "1216x832", "832x1216", "1152x896", "896x1152"];

export const segmind: ImageProvider = {
  id: "segmind",
  name: "Segmind",
  group: "cloud",
  blurb: "Serverless open models by name - the body of the answer is the picture.",
  keyUrl: "https://cloud.segmind.com/console/api-keys",
  needsKey: true,
  models: [
    { id: "fast-flux-schnell", label: "Fast FLUX schnell" },
    { id: "flux-schnell", label: "FLUX schnell" },
  ],
  customModel: true,
  supportsNegative: false,
  supportsSeed: true,
  generate(request, model, creds): Promise<GeneratedImage[]> {
    const [width, height] = closestSize(request.aspect, SEGMIND_SIZES).split("x").map(Number);
    return repeat(request.count, async (index) => {
      const body: Record<string, unknown> = { prompt: request.prompt, width, height };
      if (request.seed != null) body.seed = request.seed + index;
      const res = await call(`https://api.segmind.com/v1/${encodeURIComponent(model)}`, {
        headers: { "x-api-key": creds.apiKey.trim() },
        signal: request.signal,
        body,
      });
      return [{ blob: await imageBody(res, "Segmind"), seed: request.seed != null ? request.seed + index : null }];
    });
  },
};
