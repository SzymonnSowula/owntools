import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROVIDERS, provider } from "./index";
import { resetFalSchemas, falInput } from "./fal";
import { pickImage, supportsImageSize } from "./google";
import { pickRoute } from "./huggingface";
import { flexibleSizes, openaiSize } from "./openai";
import { recraftSize } from "./openaiCompatible";
import { resetOpenRouterCatalogue, routerBody } from "./openrouter";
import { replicateInput, resetReplicateSchemas } from "./replicate";
import { comfyWorkflow } from "./servers";
import { bflBody, ideogramForm, stabilityEndpoint, stabilityForm } from "./studios";
import { takesExtras } from "./together";
import { ProviderError, type ImageRequest } from "../types";

/**
 * No provider here has been called with a real key from this repository. What
 * these tests pin is the other half: that each request has the address, the
 * auth header and the body its provider's documentation asked for on
 * 2026-09-18, and that each documented answer becomes pictures.
 */

// 1×1 PNG
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const pngBytes = () => Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0));

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let calls: Call[] = [];
let answer: (call: Call) => Response | Promise<Response>;

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const imageResponse = (headers: Record<string, string> = {}) => new Response(pngBytes(), { status: 200, headers: { "content-type": "image/png", ...headers } });

function headersOf(init?: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

beforeEach(() => {
  calls = [];
  resetFalSchemas();
  resetOpenRouterCatalogue();
  resetReplicateSchemas();
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const raw = init?.body;
      let body: unknown = raw;
      if (typeof raw === "string") {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      } else if (raw instanceof FormData) {
        body = Object.fromEntries(raw.entries());
      }
      const call: Call = { url: String(input), method: (init?.method ?? "GET").toUpperCase(), headers: headersOf(init), body };
      calls.push(call);
      return answer(call);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const request = (patch: Partial<ImageRequest> = {}): ImageRequest => ({
  prompt: "a lighthouse at dusk",
  aspect: "16:9",
  count: 1,
  quality: "standard",
  seed: null,
  ...patch,
});
const creds = (apiKey = "KEY", baseUrl = "", extra = "") => ({ apiKey, baseUrl, extra });
const posts = () => calls.filter((c) => c.method === "POST");

describe("the catalogue", () => {
  it("has unique ids and a usable default for every provider", () => {
    const ids = new Set(PROVIDERS.map((p) => p.id));
    expect(ids.size).toBe(PROVIDERS.length);
    for (const p of PROVIDERS) {
      expect(p.blurb.length).toBeGreaterThan(20);
      // A provider either ships a model list or lets one be typed / fetched.
      expect(p.models.length > 0 || p.customModel || Boolean(p.listModels)).toBe(true);
      if (p.needsKey) expect(p.keyUrl).toMatch(/^https:\/\//);
    }
    expect(provider("openai")?.name).toBe("OpenAI");
    expect(provider("fireworks")).toBeUndefined();
  });
});

describe("OpenAI", () => {
  it("sends model, size on the 16 px grid, quality and asks for png", async () => {
    answer = () => jsonResponse({ data: [{ b64_json: PNG }, { b64_json: PNG }] });
    const out = await provider("openai")!.generate(request({ count: 2 }), "gpt-image-2.5-flare", creds("sk-x"));
    expect(out).toHaveLength(2);
    expect(out[0].blob.type).toBe("image/png");
    expect(calls[0].url).toBe("https://api.openai.com/v1/images/generations");
    expect(calls[0].headers.authorization).toBe("Bearer sk-x");
    expect(calls[0].body).toEqual({ model: "gpt-image-2.5-flare", prompt: "a lighthouse at dusk", n: 2, size: "1360x768", quality: "medium", output_format: "png" });
  });

  it("keeps the older models on their three sizes", () => {
    expect(flexibleSizes("gpt-image-2.5-sunburst")).toBe(true);
    expect(flexibleSizes("gpt-image-1.5")).toBe(false);
    expect(flexibleSizes("gpt-image-1-mini")).toBe(false);
    expect(openaiSize("gpt-image-1", { aspect: "16:9", quality: "high" })).toBe("1536x1024");
    expect(openaiSize("gpt-image-1", { aspect: "9:16", quality: "standard" })).toBe("1024x1536");
    expect(openaiSize("gpt-image-2", { aspect: "1:1", quality: "standard" })).toBe("1024x1024");
  });

  it("lists image models only, without dated snapshots or retired ones", async () => {
    answer = () =>
      jsonResponse({
        data: [
          { id: "gpt-4.1-mini" },
          { id: "gpt-image-2.5-flare" },
          { id: "gpt-image-2.5-flare-2026-09-08" },
          { id: "gpt-image-1", shutdown_date: "2020-01-01" },
          { id: "gpt-image-2" },
        ],
      });
    const models = await provider("openai")!.listModels!(creds());
    expect(models.map((m) => m.id)).toEqual(["gpt-image-2.5-flare", "gpt-image-2"]);
  });

  it("says a refused prompt is a refusal, and a bad key is a key problem", async () => {
    answer = () => jsonResponse({ error: { type: "image_generation_user_error", code: "moderation_blocked", message: "Your request was rejected by the safety system." } }, 400);
    await expect(provider("openai")!.generate(request(), "gpt-image-2", creds())).rejects.toMatchObject({ kind: "blocked" });
    answer = () => jsonResponse({ error: { message: "Incorrect API key provided: sk-x.", code: "invalid_api_key" } }, 401);
    const err = await provider("openai")!.generate(request(), "gpt-image-2", creds()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).kind).toBe("auth");
    expect((err as ProviderError).message).toContain("Settings → Intelligence");
  });
});

describe("Google Gemini", () => {
  it("calls generateContent once per picture and skips thought images", async () => {
    answer = () =>
      jsonResponse({ candidates: [{ content: { parts: [{ inlineData: { data: "AAAA" }, thought: true }, { text: "here" }, { inlineData: { mimeType: "image/png", data: PNG } }] } }] });
    const out = await provider("google")!.generate(request({ count: 2, quality: "high" }), "gemini-3.1-flash-image", creds("AIza"));
    expect(out).toHaveLength(2);
    expect(posts()).toHaveLength(2);
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent");
    expect(calls[0].headers["x-goog-api-key"]).toBe("AIza");
    expect(calls[0].body).toEqual({
      contents: [{ parts: [{ text: "a lighthouse at dusk" }] }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "2K" } },
    });
  });

  it("only asks for 2K where the model has it", () => {
    expect(supportsImageSize("gemini-3.1-flash-image")).toBe(true);
    expect(supportsImageSize("gemini-3-pro-image")).toBe(true);
    expect(supportsImageSize("gemini-3.1-flash-lite-image")).toBe(false);
    expect(supportsImageSize("gemini-2.5-flash-image")).toBe(false);
    expect(pickImage({ candidates: [{ content: { parts: [{ text: "no" }] } }] })).toBeNull();
  });

  it("reports a blocked prompt with Google's own reason", async () => {
    answer = () => jsonResponse({ candidates: [{ finishReason: "IMAGE_SAFETY", content: { parts: [] } }] });
    await expect(provider("google")!.generate(request(), "gemini-3.1-flash-image", creds())).rejects.toMatchObject({ kind: "blocked" });
    // A wrong key is a 400 here, not a 401.
    answer = () => jsonResponse({ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }, 400);
    await expect(provider("google")!.generate(request(), "gemini-3.1-flash-image", creds())).rejects.toMatchObject({ kind: "auth" });
  });
});

describe("xAI", () => {
  it("speaks aspect_ratio and resolution, and quality only to 2.0", async () => {
    answer = () => jsonResponse({ data: [{ b64_json: PNG }] });
    await provider("xai")!.generate(request({ quality: "high" }), "grok-imagine-image-2.0", creds());
    expect(calls[0].url).toBe("https://api.x.ai/v1/images/generations");
    expect(calls[0].body).toEqual({ model: "grok-imagine-image-2.0", prompt: "a lighthouse at dusk", n: 1, aspect_ratio: "16:9", resolution: "2k", response_format: "b64_json", quality: "medium" });
    await provider("xai")!.generate(request(), "grok-imagine-image", creds());
    expect(calls[1].body).not.toHaveProperty("quality");
  });

  it("reads its flat error shape, where a bad key is a 400", async () => {
    answer = () => jsonResponse({ code: "invalid-argument", error: "Incorrect API key provided: xa***." }, 400);
    await expect(provider("xai")!.generate(request(), "grok-imagine-image-2.0", creds())).rejects.toMatchObject({ kind: "auth" });
  });
});

describe("OpenRouter", () => {
  const catalogue = {
    data: [
      {
        id: "google/gemini-3.1-flash-image",
        name: "Nano Banana 2",
        supported_parameters: { aspect_ratio: { type: "enum", values: ["1:1", "16:9", "auto"] }, resolution: { type: "enum", values: ["1K", "2K"] }, n: { type: "range", min: 1, max: 1 } },
      },
      {
        id: "openai/gpt-image-2.5-flare",
        supported_parameters: { quality: { type: "enum", values: ["auto", "low", "medium", "high"] }, n: { type: "range", min: 1, max: 10 }, seed: { type: "range", min: 0, max: 99 } },
      },
    ],
  };

  it("sends only what the model says it takes", () => {
    const [banana, flare] = catalogue.data as never[];
    expect(routerBody(banana, "google/gemini-3.1-flash-image", request({ quality: "high", seed: 5 }), 3)).toEqual({
      model: "google/gemini-3.1-flash-image",
      prompt: "a lighthouse at dusk",
      aspect_ratio: "16:9",
      resolution: "2K",
    });
    expect(routerBody(flare, "openai/gpt-image-2.5-flare", request({ quality: "draft", seed: 5 }), 3)).toEqual({
      model: "openai/gpt-image-2.5-flare",
      prompt: "a lighthouse at dusk",
      quality: "low",
      n: 3,
      seed: 5,
    });
    expect(routerBody(undefined, "new/model", request(), 2)).toEqual({ model: "new/model", prompt: "a lighthouse at dusk" });
  });

  it("uses the Image API and calls a one-picture model once per picture", async () => {
    answer = (call) => (call.url.endsWith("/images/models") ? jsonResponse(catalogue) : jsonResponse({ data: [{ b64_json: PNG }] }));
    const out = await provider("openrouter")!.generate(request({ count: 2 }), "google/gemini-3.1-flash-image", creds("sk-or"));
    expect(out).toHaveLength(2);
    expect(posts()).toHaveLength(2);
    expect(posts()[0].url).toBe("https://openrouter.ai/api/v1/images");
    expect(posts()[0].headers.authorization).toBe("Bearer sk-or");
    expect(posts()[0].headers["x-openrouter-title"]).toBe("owntools");
  });

  it("says out of credit when it is", async () => {
    answer = (call) => (call.url.endsWith("/images/models") ? jsonResponse(catalogue) : jsonResponse({ error: { code: 402, message: "Insufficient credits." } }, 402));
    await expect(provider("openrouter")!.generate(request(), "openai/gpt-image-2.5-flare", creds())).rejects.toMatchObject({ kind: "billing", status: 402 });
  });
});

describe("Replicate", () => {
  const official = (properties: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    is_official: true,
    latest_version: { id: "v".repeat(64), openapi_schema: { components: { schemas: { Input: { properties }, ...extra } } } },
  });

  it("builds the input from the model's schema", () => {
    const schnell = official(
      { prompt: {}, aspect_ratio: { allOf: [{ $ref: "#/x" }] }, num_outputs: {}, seed: {}, output_format: { enum: ["webp", "jpg", "png"] } },
      { aspect_ratio: { enum: ["1:1", "16:9", "21:9"] } },
    );
    expect(replicateInput(schnell as never, request({ seed: 7, negativePrompt: "blur" }), 3)).toEqual({
      prompt: "a lighthouse at dusk",
      aspect_ratio: "16:9",
      num_outputs: 3,
      seed: 7,
      output_format: "png",
    });
    const zimage = official({ prompt: {}, width: {}, height: {}, negative_prompt: {} });
    expect(replicateInput(zimage as never, request({ negativePrompt: "blur" }), 2)).toEqual({ prompt: "a lighthouse at dusk", width: 1376, height: 768, negative_prompt: "blur" });
  });

  it("runs an official model by name with Prefer: wait and downloads the output", async () => {
    answer = (call) => {
      if (call.url.endsWith("/models/black-forest-labs/flux-1.1-pro")) return jsonResponse(official({ prompt: {}, aspect_ratio: {} }));
      if (call.url.endsWith("/predictions")) return jsonResponse({ id: "p1", status: "succeeded", output: "https://replicate.delivery/x/out.png" });
      return imageResponse();
    };
    const out = await provider("replicate")!.generate(request({ count: 2 }), "black-forest-labs/flux-1.1-pro", creds("r8_x"));
    expect(out).toHaveLength(2);
    const post = posts()[0];
    expect(post.url).toBe("https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro/predictions");
    expect(post.headers.prefer).toBe("wait");
    expect(post.headers.authorization).toBe("Bearer r8_x");
    expect(post.body).toEqual({ input: { prompt: "a lighthouse at dusk", aspect_ratio: "16:9" } });
    // One picture per call for a model without num_outputs.
    expect(posts()).toHaveLength(2);
  });

  it("gives a community model its version and polls a job that outlives the wait", async () => {
    let polls = 0;
    answer = (call) => {
      if (call.url.endsWith("/models/someone/sdxl-thing")) return jsonResponse({ is_official: false, latest_version: { id: "abc123", openapi_schema: { components: { schemas: { Input: { properties: { prompt: {} } } } } } } });
      if (call.method === "POST") return jsonResponse({ id: "p2", status: "processing", output: null, urls: { get: "https://api.replicate.com/v1/predictions/p2" } });
      if (call.url.endsWith("/predictions/p2")) return jsonResponse(++polls < 2 ? { id: "p2", status: "processing" } : { id: "p2", status: "succeeded", output: ["https://replicate.delivery/a.png"] });
      return imageResponse();
    };
    vi.useFakeTimers();
    const pending = provider("replicate")!.generate(request(), "someone/sdxl-thing", creds());
    await vi.advanceTimersByTimeAsync(10_000);
    const out = await pending;
    vi.useRealTimers();
    expect(out).toHaveLength(1);
    expect(posts()[0].url).toBe("https://api.replicate.com/v1/predictions");
    expect(posts()[0].body).toEqual({ version: "abc123", input: { prompt: "a lighthouse at dusk" } });
    expect(polls).toBe(2);
  });

  it("passes a failed prediction's own words on", async () => {
    answer = (call) =>
      call.method === "POST" ? jsonResponse({ id: "p3", status: "failed", output: null, error: "NSFW content detected" }) : jsonResponse(official({ prompt: {} }));
    await expect(provider("replicate")!.generate(request(), "a/b", creds())).rejects.toMatchObject({ kind: "blocked" });
  });
});

describe("fal.ai", () => {
  it("says a size the way the endpoint's schema wants it", () => {
    const flux = { image_size: { anyOf: [{ $ref: "#/components/schemas/ImageSize" }, { enum: ["square_hd", "landscape_16_9"], type: "string" }] }, num_images: { maximum: 4 }, seed: {}, output_format: { enum: ["jpeg", "png"] } };
    expect(falInput(flux, request({ seed: 3 }), 2)).toEqual({ prompt: "a lighthouse at dusk", image_size: { width: 1360, height: 768 }, num_images: 2, seed: 3, output_format: "png" });
    const banana = { aspect_ratio: { anyOf: [{ enum: ["auto", "16:9", "1:1"] }, { type: "null" }] }, resolution: { enum: ["1K", "2K"] }, num_images: { maximum: 4 } };
    expect(falInput(banana, request({ quality: "high" }), 1)).toEqual({ prompt: "a lighthouse at dusk", aspect_ratio: "16:9", resolution: "2K" });
    const gpt = { image_size: { enum: ["1024x1024", "1536x1024", "1024x1536"] } };
    expect(falInput(gpt, request({ aspect: "9:16" }), 1)).toEqual({ prompt: "a lighthouse at dusk", image_size: "1024x1536" });
    expect(falInput(null, request(), 4)).toEqual({ prompt: "a lighthouse at dusk" });
  });

  it("submits to the queue, follows the URLs it was given, and downloads the result", async () => {
    answer = (call) => {
      if (call.url.startsWith("https://api.fal.ai/v1/models")) {
        return jsonResponse({ models: [{ endpoint_id: "fal-ai/flux/schnell", openapi: { components: { schemas: { FluxSchnellInput: { properties: { image_size: { anyOf: [{ $ref: "#/x" }] }, num_images: { maximum: 4 } } } } } } }] });
      }
      if (call.url === "https://queue.fal.run/fal-ai/flux/schnell") {
        return jsonResponse({ request_id: "r1", status_url: "https://queue.fal.run/fal-ai/flux/requests/r1/status", response_url: "https://queue.fal.run/fal-ai/flux/requests/r1" });
      }
      if (call.url.endsWith("/status")) return jsonResponse({ status: "COMPLETED" });
      if (call.url.endsWith("/requests/r1")) return jsonResponse({ images: [{ url: "https://v3.fal.media/a.png" }, { url: "https://v3.fal.media/b.png" }], seed: 11 });
      return imageResponse();
    };
    const out = await provider("fal")!.generate(request({ count: 2 }), "fal-ai/flux/schnell", creds("id:secret"));
    expect(out.map((o) => o.seed)).toEqual([11, 11]);
    expect(posts()).toHaveLength(1);
    expect(posts()[0].headers.authorization).toBe("Key id:secret");
    expect(posts()[0].body).toEqual({ prompt: "a lighthouse at dusk", image_size: { width: 1360, height: 768 }, num_images: 2 });
  });

  it("does not take COMPLETED for success", async () => {
    answer = (call) => {
      if (call.url.startsWith("https://api.fal.ai")) return jsonResponse({ models: [] });
      if (call.method === "POST") return jsonResponse({ request_id: "r", status_url: "https://queue.fal.run/x/status", response_url: "https://queue.fal.run/x" });
      return jsonResponse({ status: "COMPLETED", error: "The prompt was flagged", error_type: "content_policy_violation" });
    };
    await expect(provider("fal")!.generate(request(), "fal-ai/any", creds())).rejects.toMatchObject({ kind: "blocked" });
  });
});

describe("Together AI", () => {
  it('asks for "base64" and leaves resold models alone', async () => {
    answer = () => jsonResponse({ data: [{ b64_json: PNG }] });
    await provider("together")!.generate(request({ seed: 4, negativePrompt: "blur" }), "black-forest-labs/FLUX.2-dev", creds());
    expect(calls[0].url).toBe("https://api.together.ai/v1/images/generations");
    expect(calls[0].body).toEqual({ model: "black-forest-labs/FLUX.2-dev", prompt: "a lighthouse at dusk", width: 1360, height: 768, response_format: "base64", output_format: "png", seed: 4, negative_prompt: "blur" });
    await provider("together")!.generate(request({ seed: 4 }), "google/imagen-4.0-fast", creds());
    expect(calls[1].body).toEqual({ model: "google/imagen-4.0-fast", prompt: "a lighthouse at dusk", width: 1360, height: 768, response_format: "base64" });
    expect(takesExtras("openai/gpt-image-2")).toBe(false);
  });

  it("filters its model list to images", async () => {
    answer = () => jsonResponse([{ id: "a/chat", type: "chat" }, { id: "b/img", type: "image", display_name: "B" }]);
    expect(await provider("together")!.listModels!(creds())).toEqual([{ id: "b/img", label: "B" }]);
  });
});

describe("the OpenAI-shaped ones", () => {
  it("DeepInfra", async () => {
    answer = () => jsonResponse({ data: [{ b64_json: PNG }] });
    await provider("deepinfra")!.generate(request({ count: 3 }), "black-forest-labs/FLUX-1-schnell", creds());
    expect(calls[0].url).toBe("https://api.deepinfra.com/v1/openai/images/generations");
    expect(calls[0].body).toEqual({ model: "black-forest-labs/FLUX-1-schnell", prompt: "a lighthouse at dusk", n: 3, size: "1360x768", response_format: "b64_json" });
  });

  it("DeepInfra lists generators, not editors", async () => {
    answer = () =>
      jsonResponse([
        { model_name: "black-forest-labs/FLUX-2-dev", type: "text-to-image" },
        { model_name: "Bria/erase", type: "text-to-image" },
        { model_name: "old/sd", type: "text-to-image", deprecated: 1700000000 },
        { model_name: "meta/llama", type: "text-generation" },
      ]);
    expect((await provider("deepinfra")!.listModels!(creds())).map((m) => m.id)).toEqual(["black-forest-labs/FLUX-2-dev"]);
  });

  it("Recraft picks a size its model has, and keeps negative prompts for V3", async () => {
    expect(recraftSize("recraftv4_1", { aspect: "16:9" })).toBe("1344x768");
    expect(recraftSize("recraftv4_1_pro", { aspect: "16:9" })).toBe("2688x1536");
    expect(recraftSize("recraftv3", { aspect: "16:9" })).toBe("1820x1024");
    answer = () => jsonResponse({ data: [{ b64_json: PNG }] });
    await provider("recraft")!.generate(request({ negativePrompt: "blur", seed: 9 }), "recraftv4_1", creds());
    expect(calls[0].url).toBe("https://external.api.recraft.ai/v1/images/generations");
    expect(calls[0].body).toEqual({ model: "recraftv4_1", prompt: "a lighthouse at dusk", n: 1, size: "1344x768", response_format: "b64_json", random_seed: 9 });
    await provider("recraft")!.generate(request({ negativePrompt: "blur" }), "recraftv3", creds());
    expect(calls[1].body).toMatchObject({ negative_prompt: "blur", size: "1820x1024" });
  });

  it("BytePlus has no n: one call per picture, 2K, no watermark", async () => {
    answer = () => jsonResponse({ data: [{ url: "data:image/png;base64," + PNG }] });
    const out = await provider("byteplus")!.generate(request({ count: 2, aspect: "1:1" }), "seedream-5-0-260128", creds());
    expect(out).toHaveLength(2);
    expect(posts()).toHaveLength(2);
    expect(posts()[0].body).toEqual({ model: "seedream-5-0-260128", prompt: "a lighthouse at dusk", size: "2048x2048", response_format: "b64_json", watermark: false });
  });

  it("a custom endpoint works without a key", async () => {
    answer = () => jsonResponse({ data: [{ b64_json: PNG }] });
    await provider("custom")!.generate(request({ aspect: "1:1" }), "stablediffusion", creds("", "http://localhost:8080/v1/"));
    expect(calls[0].url).toBe("http://localhost:8080/v1/images/generations");
    expect(calls[0].headers.authorization).toBeUndefined();
  });
});

describe("Hugging Face", () => {
  it("picks the first live text-to-image route it implements", () => {
    expect(
      pickRoute({
        id: "x",
        inferenceProviderMapping: {
          wavespeed: { providerId: "w", status: "live", task: "text-to-image" },
          replicate: { providerId: "black-forest-labs/flux-dev", status: "live", task: "text-to-image" },
          "fal-ai": { providerId: "fal-ai/flux/dev", status: "staging", task: "text-to-image" },
        },
      }),
    ).toEqual({ route: "replicate", providerId: "black-forest-labs/flux-dev" });
    // A LoRA adapter is not a model to run, and image-to-image is not this task.
    expect(pickRoute({ id: "x", inferenceProviderMapping: [{ provider: "fal-ai", providerId: "f", status: "live", task: "text-to-image", adapter: "lora" }] })).toBeNull();
    expect(pickRoute({ id: "x", inferenceProviderMapping: { "fal-ai": { providerId: "f", status: "live", task: "image-to-image" } } })).toBeNull();
  });

  it("routes through fal's queue with the HF token as a Bearer", async () => {
    answer = (call) => {
      if (call.url.startsWith("https://huggingface.co/api/models/")) return jsonResponse({ id: "m", inferenceProviderMapping: { "fal-ai": { providerId: "fal-ai/flux/schnell", status: "live", task: "text-to-image" } } });
      if (call.method === "POST") return jsonResponse({ request_id: "q", response_url: "https://queue.fal.run/fal-ai/flux/requests/q" });
      if (call.url.includes("/status")) return jsonResponse({ status: "COMPLETED" });
      if (call.url.includes("/requests/q")) return jsonResponse({ images: [{ url: "https://v3.fal.media/a.png" }] });
      return imageResponse();
    };
    const out = await provider("huggingface")!.generate(request(), "black-forest-labs/FLUX.1-schnell", creds("hf_x"));
    expect(out).toHaveLength(1);
    expect(posts()[0].url).toBe("https://router.huggingface.co/fal-ai/fal-ai/flux/schnell?_subdomain=queue");
    expect(posts()[0].headers.authorization).toBe("Bearer hf_x");
    expect(posts()[0].body).toEqual({ prompt: "a lighthouse at dusk", image_size: { width: 1360, height: 768 } });
    expect(calls.some((c) => c.url === "https://router.huggingface.co/fal-ai/fal-ai/flux/requests/q/status?_subdomain=queue")).toBe(true);
  });

  it("says so when nobody serves the model", async () => {
    answer = () => jsonResponse({ id: "m", inferenceProviderMapping: {} });
    await expect(provider("huggingface")!.generate(request(), "some/model", creds())).rejects.toMatchObject({ kind: "input" });
  });
});

describe("Stability AI", () => {
  it("sends a form to the right endpoint and reads the picture from the body", async () => {
    expect(stabilityEndpoint("core")).toBe("core");
    expect(stabilityEndpoint("sd3.5-large-turbo")).toBe("sd3");
    const form = Object.fromEntries(stabilityForm("sd3.5-large", request({ aspect: "4:3", negativePrompt: "blur", seed: 12 })).entries());
    // 4:3 is not on Stability's list; 5:4 is the nearest.
    expect(form).toEqual({ prompt: "a lighthouse at dusk", aspect_ratio: "5:4", output_format: "png", negative_prompt: "blur", seed: "12", model: "sd3.5-large" });
    answer = () => imageResponse({ "finish-reason": "SUCCESS", seed: "77" });
    const out = await provider("stability")!.generate(request(), "ultra", creds("sk-s"));
    expect(calls[0].url).toBe("https://api.stability.ai/v2beta/stable-image/generate/ultra");
    expect(calls[0].headers.accept).toBe("image/*");
    expect(calls[0].body).not.toHaveProperty("model");
    expect(out[0].seed).toBe(77);
  });

  it("does not keep a blurred picture as a success", async () => {
    answer = () => imageResponse({ "finish-reason": "CONTENT_FILTERED" });
    await expect(provider("stability")!.generate(request(), "core", creds())).rejects.toMatchObject({ kind: "blocked" });
    answer = () => jsonResponse({ id: "x", name: "content_moderation", errors: ["Your request was flagged by our content moderation system."] }, 403);
    await expect(provider("stability")!.generate(request(), "core", creds())).rejects.toMatchObject({ kind: "blocked" });
  });
});

describe("Black Forest Labs", () => {
  it("gives each model family the size it understands", () => {
    expect(bflBody("flux-2-pro", request({ seed: 1 }))).toEqual({ prompt: "a lighthouse at dusk", output_format: "png", seed: 1, width: 1360, height: 768 });
    expect(bflBody("flux-pro-1.1", request())).toEqual({ prompt: "a lighthouse at dusk", output_format: "png", width: 1376, height: 768 });
    expect(bflBody("flux-pro-1.1-ultra", request())).toEqual({ prompt: "a lighthouse at dusk", output_format: "png", aspect_ratio: "16:9" });
  });

  it("polls the URL it was given and downloads the sample at once", async () => {
    let polls = 0;
    answer = (call) => {
      if (call.method === "POST") return jsonResponse({ id: "j", polling_url: "https://api.eu.bfl.ai/v1/get_result?id=j" });
      if (call.url.includes("get_result")) return jsonResponse(++polls < 2 ? { status: "Pending" } : { status: "Ready", result: { sample: "https://delivery.eu.bfl.ai/x.png" } });
      return imageResponse();
    };
    vi.useFakeTimers();
    const pending = provider("bfl")!.generate(request(), "flux-2-pro", creds("bfl-key"));
    await vi.advanceTimersByTimeAsync(10_000);
    const out = await pending;
    vi.useRealTimers();
    expect(out).toHaveLength(1);
    expect(posts()[0].url).toBe("https://api.bfl.ai/v1/flux-2-pro");
    expect(posts()[0].headers["x-key"]).toBe("bfl-key");
    expect(calls.filter((c) => c.url.includes("api.eu.bfl.ai")).every((c) => c.headers["x-key"] === "bfl-key")).toBe(true);
  });

  it("calls moderation what it is", async () => {
    answer = (call) => (call.method === "POST" ? jsonResponse({ id: "j", polling_url: "https://api.bfl.ai/v1/get_result?id=j" }) : jsonResponse({ status: "Request Moderated", result: null }));
    await expect(provider("bfl")!.generate(request(), "flux-2-pro", creds())).rejects.toMatchObject({ kind: "blocked" });
  });
});

describe("Ideogram", () => {
  it("3.0 and 4.0 are different forms", () => {
    expect(Object.fromEntries(ideogramForm("ideogram-v3", request({ count: 3, seed: 5, negativePrompt: "blur", quality: "draft" })).entries())).toEqual({
      rendering_speed: "TURBO",
      prompt: "a lighthouse at dusk",
      aspect_ratio: "16x9",
      num_images: "3",
      negative_prompt: "blur",
      seed: "5",
    });
    expect(Object.fromEntries(ideogramForm("ideogram-v4", request({ count: 3, seed: 5, quality: "high" })).entries())).toEqual({
      rendering_speed: "QUALITY",
      text_prompt: "a lighthouse at dusk",
      resolution: "2560x1440",
    });
  });

  it("uses the Api-Key header and treats a withheld picture as a refusal", async () => {
    answer = (call) => (call.method === "POST" ? jsonResponse({ data: [{ url: "https://ideogram.ai/x.png", is_image_safe: true, seed: 8 }] }) : imageResponse());
    const out = await provider("ideogram")!.generate(request(), "ideogram-v3", creds("ik"));
    expect(posts()[0].url).toBe("https://api.ideogram.ai/v1/ideogram-v3/generate");
    expect(posts()[0].headers["api-key"]).toBe("ik");
    expect(out[0].seed).toBe(8);
    answer = () => jsonResponse({ data: [{ url: null, is_image_safe: false }] });
    await expect(provider("ideogram")!.generate(request(), "ideogram-v3", creds())).rejects.toMatchObject({ kind: "blocked" });
  });
});

describe("the small ones", () => {
  it("Runware: a task array, and errors inside a 200", async () => {
    answer = () => jsonResponse({ data: [{ imageURL: "data:image/png;base64," + PNG, seed: 2 }] });
    await provider("runware")!.generate(request({ count: 2, negativePrompt: "blur" }), "runware:100@1", creds());
    const task = (calls[0].body as Record<string, unknown>[])[0];
    expect(calls[0].url).toBe("https://api.runware.ai/v1");
    expect(task).toMatchObject({ taskType: "imageInference", positivePrompt: "a lighthouse at dusk", negativePrompt: "blur", model: "runware:100@1", width: 1344, height: 768, numberResults: 2, deliveryMethod: "sync" });
    expect(String(task.taskUUID)).toMatch(/^[0-9a-f-]{36}$/);
    answer = () => jsonResponse({ errors: [{ message: "Invalid model" }] });
    await expect(provider("runware")!.generate(request(), "x", creds())).rejects.toThrow("Invalid model");
  });

  it("MiniMax: success is status_code 0, whatever the HTTP status says", async () => {
    answer = () => jsonResponse({ data: { image_base64: [PNG, PNG] }, base_resp: { status_code: 0 } });
    expect(await provider("minimax")!.generate(request({ count: 2 }), "image-01", creds())).toHaveLength(2);
    expect(calls[0].body).toEqual({ model: "image-01", prompt: "a lighthouse at dusk", aspect_ratio: "16:9", response_format: "base64", n: 2 });
    answer = () => jsonResponse({ base_resp: { status_code: 1008, status_msg: "insufficient balance" } });
    await expect(provider("minimax")!.generate(request(), "image-01", creds())).rejects.toMatchObject({ kind: "billing" });
  });

  it("SiliconFlow, getimg.ai and Segmind each say a size their own way", async () => {
    answer = (call) => (call.method === "POST" ? jsonResponse({ images: [{ url: "data:image/png;base64," + PNG }], seed: 1 }) : imageResponse());
    await provider("siliconflow")!.generate(request({ count: 2 }), "Qwen/Qwen-Image", creds());
    expect(calls[0].body).toEqual({ model: "Qwen/Qwen-Image", prompt: "a lighthouse at dusk", image_size: "1360x768", batch_size: 2 });

    calls = [];
    answer = () => jsonResponse({ data: [{ url: "data:image/png;base64," + PNG }] });
    await provider("getimg")!.generate(request({ quality: "high" }), "seedream-5-lite", creds());
    expect(calls[0].url).toBe("https://api.getimg.ai/v2/images/generations");
    expect(calls[0].body).toEqual({ model: "seedream-5-lite", prompt: "a lighthouse at dusk", aspect_ratio: "16:9", resolution: "2K", output_format: "png" });

    calls = [];
    answer = () => imageResponse();
    await provider("segmind")!.generate(request({ seed: 3 }), "fast-flux-schnell", creds("seg"));
    expect(calls[0].url).toBe("https://api.segmind.com/v1/fast-flux-schnell");
    expect(calls[0].headers["x-api-key"]).toBe("seg");
    expect(calls[0].body).toEqual({ prompt: "a lighthouse at dusk", width: 1344, height: 768, seed: 3 });
  });

  it("Cloudflare needs the account id, and reads both of its answer shapes", async () => {
    await expect(provider("cloudflare")!.generate(request(), "@cf/black-forest-labs/flux-1-schnell", creds("t"))).rejects.toMatchObject({ kind: "input" });
    answer = () => jsonResponse({ result: { image: PNG }, success: true });
    const out = await provider("cloudflare")!.generate(request(), "@cf/black-forest-labs/flux-1-schnell", creds("t", "", "acc123"));
    expect(out).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.cloudflare.com/client/v4/accounts/acc123/ai/run/@cf/black-forest-labs/flux-1-schnell");
    expect(calls[0].body).toEqual({ prompt: "a lighthouse at dusk" });
    answer = () => imageResponse();
    await provider("cloudflare")!.generate(request(), "@cf/stabilityai/stable-diffusion-xl-base-1.0", creds("t", "", "acc123"));
    expect(calls[1].body).toEqual({ prompt: "a lighthouse at dusk", width: 1360, height: 768 });
  });
});

describe("servers on the desk", () => {
  it("AUTOMATIC1111: txt2img, no Origin, the checkpoint only when one was picked", async () => {
    answer = () => jsonResponse({ images: ["GRID", PNG, PNG], info: JSON.stringify({ all_seeds: [5, 6] }) });
    const out = await provider("a1111")!.generate(request({ count: 2, negativePrompt: "blur", aspect: "1:1" }), "", creds("", "http://127.0.0.1:7860/"));
    expect(calls[0].url).toBe("http://127.0.0.1:7860/sdapi/v1/txt2img");
    expect(calls[0].headers.origin).toBe("");
    expect(calls[0].body).toEqual({ prompt: "a lighthouse at dusk", negative_prompt: "blur", width: 768, height: 768, steps: 20, cfg_scale: 7, seed: -1, batch_size: 2, send_images: true, save_images: false });
    // The contact sheet the web UI prepends to a batch is not a picture.
    expect(out).toHaveLength(2);
    expect(out.map((o) => o.seed)).toEqual([5, 6]);
    await provider("a1111")!.generate(request(), "sdxl.safetensors [abc]", creds("me:pw", "http://127.0.0.1:7860"));
    expect(calls[1].body).toMatchObject({ override_settings: { sd_model_checkpoint: "sdxl.safetensors [abc]" } });
    expect(calls[1].headers.authorization).toBe(`Basic ${btoa("me:pw")}`);
  });

  it("ComfyUI: its own basic graph, wired the way its API format expects", () => {
    const graph = comfyWorkflow({ checkpoint: "sd15.safetensors", prompt: "p", negative: "n", width: 768, height: 512, count: 2, steps: 20, seed: 9 });
    expect(graph["4"]).toEqual({ class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd15.safetensors" } });
    expect(graph["6"].inputs).toEqual({ text: "p", clip: ["4", 1] });
    expect(graph["7"].inputs).toEqual({ text: "n", clip: ["4", 1] });
    expect(graph["5"].inputs).toEqual({ width: 768, height: 512, batch_size: 2 });
    expect(graph["3"].inputs).toMatchObject({ seed: 9, steps: 20, model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] });
    expect(graph["8"].inputs).toEqual({ samples: ["3", 0], vae: ["4", 2] });
    expect(graph["9"].inputs).toEqual({ filename_prefix: "owntools", images: ["8", 0] });
  });

  it("ComfyUI: queues, waits for history, fetches each file", async () => {
    let asked = 0;
    answer = (call) => {
      if (call.url.endsWith("/prompt")) return jsonResponse({ prompt_id: "pid", number: 1, node_errors: {} });
      if (call.url.endsWith("/history/pid")) {
        return jsonResponse(++asked < 2 ? {} : { pid: { status: { status_str: "success", completed: true }, outputs: { "9": { images: [{ filename: "owntools_00001_.png", subfolder: "", type: "output" }] } } } });
      }
      return imageResponse();
    };
    vi.useFakeTimers();
    const pending = provider("comfyui")!.generate(request({ seed: 9 }), "sd15.safetensors", creds("", "http://127.0.0.1:8188"));
    await vi.advanceTimersByTimeAsync(10_000);
    const out = await pending;
    vi.useRealTimers();
    expect(out).toHaveLength(1);
    expect(out[0].seed).toBe(9);
    expect(calls.every((c) => c.headers.origin === "")).toBe(true);
    expect(calls[calls.length - 1].url).toBe("http://127.0.0.1:8188/view?filename=owntools_00001_.png&subfolder=&type=output");
    await expect(provider("comfyui")!.generate(request(), "", creds("", "http://127.0.0.1:8188"))).rejects.toMatchObject({ kind: "input" });
  });
});
