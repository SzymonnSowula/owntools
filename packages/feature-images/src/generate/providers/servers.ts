/**
 * Image servers people already run on their own machine. Nothing leaves the
 * desk: the address is loopback (or a box on the LAN), the network log files
 * these requests under "stayed on this machine", and Offline mode lets them
 * through.
 *
 *   AUTOMATIC1111 / Forge / SD.Next / Draw Things   `/sdapi/v1/txt2img`
 *   ComfyUI                                         `/prompt` + `/history` + `/view`
 *
 * Checked 2026-09-18 against the servers' own sources. ComfyUI refuses a
 * request whose Origin is not its own host, and the app's HTTP layer stamps
 * the webview's — so every call here goes out with no Origin at all.
 */
import { base64ToBlob, call, dimensions, imageBody, json, poll, trimBase } from "../http";
import { ProviderError, type GeneratedImage, type ImageModel, type ImageProvider, type ProviderCreds } from "../types";

/** `user:password` in the key field → HTTP Basic, which is what `--api-auth` wants. */
function basicAuth(creds: ProviderCreds): Record<string, string> {
  const pair = creds.apiKey.trim();
  return pair.includes(":") ? { Authorization: `Basic ${btoa(pair)}` } : {};
}

/* ---- AUTOMATIC1111 family ----------------------------------------------- */

interface Txt2ImgResponse {
  images?: string[];
  info?: string;
}

export const a1111: ImageProvider = {
  id: "a1111",
  name: "AUTOMATIC1111 / Forge",
  group: "server",
  blurb: "A Stable Diffusion web UI running on your machine (started with --api) - also SD.Next and Draw Things.",
  needsKey: false,
  keyPlaceholder: "user:password, only if the server was started with --api-auth",
  baseUrl: {
    default: "http://127.0.0.1:7860",
    label: "Server address",
    hint: "Start the web UI with --api. SD.Next needs no flag; Draw Things: switch on its HTTP API server.",
  },
  models: [{ id: "", label: "Whatever the server has loaded" }],
  customModel: false,
  supportsNegative: true,
  supportsSeed: true,

  async listModels(creds, signal): Promise<ImageModel[]> {
    const res = await call(`${trimBase(creds.baseUrl)}/sdapi/v1/sd-models`, { headers: basicAuth(creds), signal, noOrigin: true, purpose: "image models list" });
    const all = await json<{ title: string; model_name?: string }[]>(res, "The web UI");
    return [{ id: "", label: "Whatever the server has loaded" }, ...all.map((m) => ({ id: m.title, label: m.model_name ?? m.title }))];
  },

  async generate(request, model, creds): Promise<GeneratedImage[]> {
    // 768 px suits SD 1.5 and SDXL alike on a desktop GPU; "high" asks for SDXL's native megapixel.
    const { width, height } = dimensions(request.aspect, request.quality === "high" ? 1 : 0.5625, 64, 2048);
    const body: Record<string, unknown> = {
      prompt: request.prompt,
      negative_prompt: request.negativePrompt?.trim() ?? "",
      width,
      height,
      steps: request.quality === "draft" ? 12 : request.quality === "high" ? 30 : 20,
      cfg_scale: 7,
      seed: request.seed ?? -1,
      batch_size: request.count,
      send_images: true,
      save_images: false,
    };
    // Naming a checkpoint makes the server load it first (slow) and put the old one back after.
    if (model) body.override_settings = { sd_model_checkpoint: model };
    const res = await call(`${trimBase(creds.baseUrl)}/sdapi/v1/txt2img`, { headers: basicAuth(creds), signal: request.signal, body, noOrigin: true });
    const answer = await json<Txt2ImgResponse>(res, "The web UI");
    let seeds: number[] = [];
    try {
      seeds = (JSON.parse(answer.info ?? "{}") as { all_seeds?: number[] }).all_seeds ?? [];
    } catch {
      /* info is a courtesy */
    }
    // With a batch the web UI may prepend a contact-sheet grid; the pictures are the last `count`.
    const images = (answer.images ?? []).slice(-request.count);
    return images.map((data, i) => ({ blob: base64ToBlob(data), seed: seeds[i] ?? null }));
  },
};

/* ---- ComfyUI ------------------------------------------------------------ */

interface HistoryEntry {
  outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>;
  status?: { status_str?: string; completed?: boolean; messages?: unknown[] };
}

/**
 * ComfyUI's own minimal text-to-image graph (its `basic_api_example`), in API
 * format: a checkpoint, two prompts, an empty latent, a sampler, a decoder, a
 * save. It fits classic checkpoints — SD 1.5, SDXL and their fine-tunes. FLUX
 * and SD3 need other graphs, which is what ComfyUI's own window is for.
 */
export function comfyWorkflow(options: {
  checkpoint: string;
  prompt: string;
  negative: string;
  width: number;
  height: number;
  count: number;
  steps: number;
  seed: number;
}): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  return {
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: options.checkpoint } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: options.prompt, clip: ["4", 1] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: options.negative, clip: ["4", 1] } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: options.width, height: options.height, batch_size: options.count } },
    "3": {
      class_type: "KSampler",
      inputs: {
        seed: options.seed,
        steps: options.steps,
        cfg: 7,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
    },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: "owntools", images: ["8", 0] } },
  };
}

export const comfyui: ImageProvider = {
  id: "comfyui",
  name: "ComfyUI",
  group: "server",
  blurb: "A ComfyUI running on your machine - owntools sends its basic text-to-image graph to the checkpoint you pick.",
  needsKey: false,
  baseUrl: {
    default: "http://127.0.0.1:8188",
    label: "Server address",
    hint: "Works with SD 1.5 and SDXL checkpoints. FLUX and SD3 need their own graphs - build those in ComfyUI.",
  },
  models: [],
  customModel: true,
  supportsNegative: true,
  supportsSeed: true,

  async listModels(creds, signal): Promise<ImageModel[]> {
    const res = await call(`${trimBase(creds.baseUrl)}/models/checkpoints`, { signal, noOrigin: true, purpose: "image models list" });
    const names = await json<string[]>(res, "ComfyUI");
    return names.map((name) => ({ id: name, label: name.replace(/\.(safetensors|ckpt)$/i, "") }));
  },

  async generate(request, model, creds): Promise<GeneratedImage[]> {
    const base = trimBase(creds.baseUrl);
    if (!model) throw new ProviderError("ComfyUI: pick a checkpoint first - the list comes from your server.", "input");
    const { width, height } = dimensions(request.aspect, request.quality === "high" ? 1 : 0.5625, 64, 2048);
    const seed = request.seed ?? Math.floor(Math.random() * 2 ** 32);
    const graph = comfyWorkflow({
      checkpoint: model,
      prompt: request.prompt,
      negative: request.negativePrompt?.trim() ?? "",
      width,
      height,
      count: request.count,
      steps: request.quality === "draft" ? 12 : request.quality === "high" ? 30 : 20,
      seed,
    });
    const queued = await json<{ prompt_id: string; node_errors?: Record<string, unknown> }>(
      await call(`${base}/prompt`, { signal: request.signal, body: { prompt: graph, client_id: "owntools" }, noOrigin: true }),
      "ComfyUI",
    );
    let entry: HistoryEntry;
    try {
      entry = await poll(async () => {
        const history = await json<Record<string, HistoryEntry>>(await call(`${base}/history/${queued.prompt_id}`, { signal: request.signal, noOrigin: true }), "ComfyUI");
        // `{}` until the prompt has run.
        return history[queued.prompt_id] ?? null;
      }, { signal: request.signal, everyMs: 600, maxMs: 2000, timeoutMs: 30 * 60 * 1000 });
    } catch (err) {
      // Cancelled here: tell the server too, or it keeps sampling for nobody.
      if (request.signal?.aborted) void call(`${base}/interrupt`, { method: "POST", body: { prompt_id: queued.prompt_id }, noOrigin: true }).catch(() => undefined);
      throw err;
    }
    if (entry.status?.status_str === "error") throw new ProviderError("ComfyUI: the graph failed - its own window shows which node and why.");
    const files = entry.outputs?.["9"]?.images ?? [];
    if (!files.length) throw new ProviderError("ComfyUI finished without a picture.");
    return Promise.all(
      files.map(async (file, i) => {
        const query = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder, type: file.type });
        const res = await call(`${base}/view?${query}`, { signal: request.signal, noOrigin: true });
        return { blob: await imageBody(res, "ComfyUI"), seed: seed + i };
      }),
    );
  },
};
