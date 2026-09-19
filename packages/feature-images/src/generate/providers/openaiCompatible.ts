/**
 * Providers that kept OpenAI's `POST …/images/generations` shape — model,
 * prompt, `size: "WxH"`, `n`, `response_format` — and differ only in the
 * address, the model list and which sizes they take: DeepInfra, Recraft,
 * BytePlus (Seedream), LocalAI and whatever else speaks the dialect through
 * "Custom endpoint". One implementation, a few lines of difference each.
 */
import { base64ToBlob, bearer, call, closestSize, dimensions, download, json, repeat, trimBase } from "../http";
import type { GeneratedImage, ImageModel, ImageProvider, ImageRequest, ProviderCreds } from "../types";

interface ImagesResponse {
  data?: { b64_json?: string; url?: string; revised_prompt?: string }[];
}

interface Dialect {
  name: string;
  endpoint: (creds: ProviderCreds) => string;
  size: (model: string, request: ImageRequest) => string | null;
  /** Extra body fields (negative prompt under this provider's name, a seed, a watermark switch…). */
  extras?: (model: string, request: ImageRequest) => Record<string, unknown>;
  /** "b64_json" unless the provider only hands out URLs. */
  responseFormat?: "b64_json" | "url" | null;
  /** False when the API has no `n`: a batch is then one call per picture. */
  batch?: boolean;
}

function generator(dialect: Dialect): ImageProvider["generate"] {
  const once = async (request: ImageRequest, model: string, creds: ProviderCreds, n: number | null): Promise<GeneratedImage[]> => {
    const body: Record<string, unknown> = { model, prompt: request.prompt };
    if (n !== null) body.n = n;
    const size = dialect.size(model, request);
    if (size) body.size = size;
    if (dialect.responseFormat !== null) body.response_format = dialect.responseFormat ?? "b64_json";
    Object.assign(body, dialect.extras?.(model, request) ?? {});
    const res = await call(dialect.endpoint(creds), {
      headers: creds.apiKey.trim() ? bearer(creds.apiKey) : undefined,
      signal: request.signal,
      body,
    });
    const answer = await json<ImagesResponse>(res, dialect.name);
    const out: GeneratedImage[] = [];
    for (const item of answer.data ?? []) {
      if (item.b64_json) out.push({ blob: base64ToBlob(item.b64_json), seed: request.seed ?? null, revisedPrompt: item.revised_prompt ?? null });
      else if (item.url) out.push({ blob: await download(item.url, dialect.name, request.signal), seed: request.seed ?? null });
    }
    return out;
  };
  return (request, model, creds) =>
    dialect.batch === false ? repeat(request.count, () => once(request, model, creds, null)) : once(request, model, creds, request.count);
}

const pixels = (request: ImageRequest, multiple = 16, maxEdge = 2048): string => {
  const { width, height } = dimensions(request.aspect, request.quality === "high" ? 2 : 1, multiple, maxEdge);
  return `${width}x${height}`;
};

/* ---- DeepInfra ---------------------------------------------------------- */

interface DeepInfraModel {
  model_name: string;
  type?: string;
  deprecated?: unknown;
  description?: string;
}

/** The text-to-image category also holds editors and upscalers; they need a picture, not a prompt. */
const NOT_GENERATORS = /edit|erase|upscal|clarity|remove|expand|inpaint|kontext|fill|redux|restor|enhance/i;

export const deepinfra: ImageProvider = {
  id: "deepinfra",
  name: "DeepInfra",
  group: "cloud",
  blurb: "Open models at close to cost - FLUX schnell at a twentieth of a cent.",
  keyUrl: "https://deepinfra.com/dash/api_keys",
  needsKey: true,
  models: [
    { id: "black-forest-labs/FLUX-1-schnell", label: "FLUX.1 schnell", note: "0.05¢ a picture" },
    { id: "black-forest-labs/FLUX-2-dev", label: "FLUX.2 dev", note: "1¢" },
    { id: "black-forest-labs/FLUX-2-klein-4b", label: "FLUX.2 klein 4B", note: "1.4¢" },
    { id: "black-forest-labs/FLUX-2-pro", label: "FLUX.2 pro", note: "1.5¢" },
    { id: "ByteDance/Seedream-4.5", label: "Seedream 4.5", note: "4¢" },
    { id: "stabilityai/sdxl-turbo", label: "SDXL Turbo", note: "0.02¢" },
  ],
  customModel: true,
  supportsNegative: false,
  supportsSeed: false,
  async listModels(_creds, signal): Promise<ImageModel[]> {
    const res = await call("https://api.deepinfra.com/models/list", { signal, purpose: "image models list" });
    const all = await json<DeepInfraModel[]>(res, "DeepInfra");
    return all
      .filter((m) => m.type === "text-to-image" && !m.deprecated && !NOT_GENERATORS.test(m.model_name))
      .map((m) => ({ id: m.model_name, label: m.model_name }));
  },
  generate: generator({
    name: "DeepInfra",
    endpoint: () => "https://api.deepinfra.com/v1/openai/images/generations",
    size: (_model, request) => pixels(request, 16, 1920),
  }),
};

/* ---- Recraft ------------------------------------------------------------ */

const RECRAFT_V4 = ["1024x1024", "1344x768", "768x1344", "1280x832", "832x1280", "1216x896", "896x1216", "1152x896", "896x1152", "1536x768", "768x1536"];
const RECRAFT_V4_PRO = RECRAFT_V4.map((s) => s.split("x").map((v) => Number(v) * 2).join("x"));
const RECRAFT_V3 = ["1024x1024", "1820x1024", "1024x1820", "1365x1024", "1024x1365", "1536x1024", "1024x1536"];

export function recraftSize(model: string, request: Pick<ImageRequest, "aspect">): string {
  if (/^recraftv[23]/.test(model)) return closestSize(request.aspect, RECRAFT_V3);
  return closestSize(request.aspect, /_pro/.test(model) ? RECRAFT_V4_PRO : RECRAFT_V4);
}

export const recraft: ImageProvider = {
  id: "recraft",
  name: "Recraft",
  group: "cloud",
  blurb: "Made for design work - illustration, brand imagery, long text set properly.",
  keyUrl: "https://www.recraft.ai/profile/api",
  needsKey: true,
  models: [
    { id: "recraftv4_1", label: "Recraft V4.1", note: "3.5¢ a picture" },
    { id: "recraftv4_1_pro", label: "Recraft V4.1 Pro", note: "2K output · 21¢" },
    { id: "recraftv3", label: "Recraft V3", note: "4¢ · takes a negative prompt" },
  ],
  customModel: true,
  supportsNegative: true,
  supportsSeed: true,
  generate: generator({
    name: "Recraft",
    endpoint: () => "https://external.api.recraft.ai/v1/images/generations",
    size: recraftSize,
    extras: (model, request) => ({
      ...(request.seed != null ? { random_seed: request.seed } : {}),
      // Only V2 and V3 know the field; V4 refuses it.
      ...(request.negativePrompt?.trim() && /^recraftv[23]/.test(model) ? { negative_prompt: request.negativePrompt.trim() } : {}),
    }),
  }),
};

/* ---- BytePlus ModelArk (Seedream) --------------------------------------- */

export const byteplus: ImageProvider = {
  id: "byteplus",
  name: "BytePlus (Seedream)",
  group: "cloud",
  blurb: "ByteDance's Seedream from its own cloud - sharp 2K pictures, good with layouts and posters.",
  keyUrl: "https://console.byteplus.com/ark/region:ark+ap-southeast-1/apiKey",
  needsKey: true,
  models: [
    { id: "seedream-5-0-260128", label: "Seedream 5.0" },
    { id: "dola-seedream-5-0-pro-260628", label: "Seedream 5.0 Pro" },
  ],
  customModel: true,
  supportsNegative: false,
  supportsSeed: false,
  generate: generator({
    name: "BytePlus",
    endpoint: () => "https://ark.ap-southeast.bytepluses.com/api/v3/images/generations",
    // Seedream's floor is 2K; it draws one picture per call unless asked to tell a sequence.
    size: (_model, request) => {
      const { width, height } = dimensions(request.aspect, 4, 16, 4096);
      return `${width}x${height}`;
    },
    extras: () => ({ watermark: false }),
    batch: false,
  }),
};

/* ---- Custom endpoint / LocalAI ------------------------------------------ */

export const custom: ImageProvider = {
  id: "custom",
  name: "Custom endpoint",
  group: "server",
  blurb: "Anything that answers OpenAI's /images/generations - LocalAI, LiteLLM, a gateway at work.",
  needsKey: false,
  baseUrl: {
    default: "http://localhost:8080/v1",
    label: "Base URL",
    hint: "LocalAI: http://localhost:8080/v1 · the key is optional",
  },
  models: [],
  customModel: true,
  supportsNegative: false,
  supportsSeed: false,
  async listModels(creds, signal): Promise<ImageModel[]> {
    const res = await call(`${trimBase(creds.baseUrl)}/models`, {
      headers: creds.apiKey.trim() ? bearer(creds.apiKey) : undefined,
      signal,
      purpose: "image models list",
    });
    const body = await json<{ data?: { id: string }[] }>(res, "The endpoint");
    return (body.data ?? []).map((m) => ({ id: m.id, label: m.id }));
  },
  generate: generator({
    name: "The endpoint",
    endpoint: (creds) => `${trimBase(creds.baseUrl)}/images/generations`,
    size: (_model, request) => pixels(request, 64, 1536),
  }),
};
