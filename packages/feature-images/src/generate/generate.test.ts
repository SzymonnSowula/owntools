import { beforeEach, describe, expect, it } from "vitest";
import { engineRequest, modelComplete, runtimeMatches } from "./device/engine";
import { DEVICE_MODELS, deviceModel, downloadBytes, ENGINE_RUNTIMES, SD_CPP_TAG } from "./device/models";
import { base64ToBlob, closestRatio, closestSize, dimensions, kindForStatus, messageFromBody, sniffMime } from "./http";
import { generateImages } from "./index";
import { provider } from "./providers";
import {
  configuredProviders,
  credsFor,
  DEFAULT_IMAGE_SETTINGS,
  DEVICE_SOURCE,
  IMAGE_SETTINGS_KEY,
  imageSettings,
  modelFor,
  normalizeImageSettings,
  providerConfigured,
  setImageSettings,
} from "./settings";
import { mergeModels } from "../components/ModelPicker";
import { fileStem } from "../components/GenerateImageModal";
import { normalizeMattingPrefs } from "../prefs";

beforeEach(() => localStorage.clear());

describe("sizes", () => {
  it("turns a shape into pixels on a grid", () => {
    expect(dimensions("1:1", 1, 16)).toEqual({ width: 1024, height: 1024 });
    expect(dimensions("16:9", 1, 16)).toEqual({ width: 1360, height: 768 });
    expect(dimensions("9:16", 1, 16)).toEqual({ width: 768, height: 1360 });
    expect(dimensions("3:2", 0.25, 64)).toEqual({ width: 640, height: 448 });
    expect(dimensions("1:1", 0.25, 64)).toEqual({ width: 512, height: 512 });
    // Never past the provider's longest edge.
    expect(dimensions("16:9", 4, 16, 1440).width).toBe(1440);
  });

  it("picks the nearest allowed size or ratio", () => {
    expect(closestSize("3:2", ["1024x1024", "1536x1024", "1024x1536"])).toBe("1536x1024");
    // 4:3 sits nearer 3:2 than 1:1 (the comparison is in log space, so 2:1 and 1:2 are equally far from square).
    expect(closestSize("4:3", ["1024x1024", "1536x1024"])).toBe("1536x1024");
    expect(closestSize("1:1", ["1536x1024", "1024x1024", "2048x2048"])).toBe("2048x2048");
    expect(closestRatio("4:3", ["1:1", "5:4", "3:2"])).toBe("5:4");
    expect(closestRatio("9:16", ["1x1", "9x16"], "x")).toBe("9x16");
  });
});

describe("answers", () => {
  it("finds the sentence in every error shape the providers use", () => {
    expect(messageFromBody({ error: { message: "bad key" } })).toBe("bad key");
    expect(messageFromBody({ error: "Invalid username or password." })).toBe("Invalid username or password.");
    expect(messageFromBody({ code: "invalid-argument", error: "Incorrect API key" })).toBe("Incorrect API key");
    expect(messageFromBody({ detail: "invalid key credentials" })).toBe("invalid key credentials");
    expect(messageFromBody({ detail: [{ loc: ["body", "prompt"], msg: "field required", type: "missing" }] })).toBe("field required");
    expect(messageFromBody({ id: "x", name: "bad_request", errors: ["prompt: too long"] })).toBe("prompt: too long");
    expect(messageFromBody({ errors: [{ code: "x", message: "Invalid model" }] })).toBe("Invalid model");
    expect(messageFromBody([{ error: { code: 400, message: "API key not valid" } }])).toBe("API key not valid");
    expect(messageFromBody({ title: "Unauthenticated", detail: "You did not pass a valid authentication token", status: 401 })).toBe(
      "You did not pass a valid authentication token",
    );
    expect(messageFromBody({})).toBeNull();
  });

  it("sorts failures into what the person can do about them", () => {
    expect(kindForStatus(400, "Incorrect API key provided")).toBe("auth");
    expect(kindForStatus(401, "nope")).toBe("auth");
    expect(kindForStatus(402, "Insufficient credits")).toBe("billing");
    expect(kindForStatus(429, "You exceeded your current quota, please check your plan and billing details")).toBe("billing");
    expect(kindForStatus(429, "Too many requests")).toBe("rate");
    expect(kindForStatus(400, "Your request was rejected by the safety system")).toBe("blocked");
    expect(kindForStatus(422, "size must be one of…")).toBe("input");
    expect(kindForStatus(500, "upstream")).toBe("other");
  });

  it("types a picture by its bytes, not by what it was labelled", () => {
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMime(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
    expect(sniffMime(new Uint8Array([1, 2, 3]))).toBe("image/png");
    expect(base64ToBlob("data:image/jpeg;base64,/9j/4AAQ").type).toBe("image/jpeg");
  });
});

describe("settings", () => {
  it("survives anything that was stored", () => {
    expect(normalizeImageSettings(null)).toEqual(DEFAULT_IMAGE_SETTINGS);
    expect(normalizeImageSettings({ source: "fireworks", count: 99, aspect: "7:1", quality: "ultra", keys: { openai: 5, fal: "k" } })).toEqual({
      ...DEFAULT_IMAGE_SETTINGS,
      keys: { fal: "k" },
    });
    localStorage.setItem(IMAGE_SETTINGS_KEY, "{not json");
    expect(imageSettings()).toEqual(DEFAULT_IMAGE_SETTINGS);
  });

  it("keeps a model per source and returns the same object until something changes", () => {
    const a = setImageSettings({ source: "openai", keys: { openai: "sk-x" } });
    expect(imageSettings()).toBe(a);
    expect(modelFor("openai", a)).toBe("gpt-image-2.5-flare");
    const b = setImageSettings({ models: { openai: "gpt-image-2" } });
    expect(modelFor("openai", b)).toBe("gpt-image-2");
    expect(modelFor(DEVICE_SOURCE, b)).toBe("flux2-klein-4b");
    expect(modelFor(DEVICE_SOURCE, { ...b, models: { device: "gone" } })).toBe("flux2-klein-4b");
    // The web UI's default model is "whatever is loaded", which is an empty id on purpose.
    expect(modelFor("a1111", b)).toBe("");
  });

  it("knows which providers can be called", () => {
    const s = normalizeImageSettings({ source: "openai", keys: { openai: "sk-x", cloudflare: "t" }, baseUrls: { comfyui: "http://127.0.0.1:8188" } });
    expect(providerConfigured(provider("openai")!, s)).toBe(true);
    expect(providerConfigured(provider("fal")!, s)).toBe(false);
    // A token without the account id is half a credential.
    expect(providerConfigured(provider("cloudflare")!, s)).toBe(false);
    expect(configuredProviders(s).map((p) => p.id)).toEqual(["openai", "comfyui"]);
    expect(credsFor(provider("a1111")!, s).baseUrl).toBe("http://127.0.0.1:7860");
  });

  it("refuses to run half set up, in words", async () => {
    await expect(generateImages({ prompt: "  ", aspect: "1:1", count: 1, quality: "standard" })).rejects.toMatchObject({ kind: "input" });
    const s = normalizeImageSettings({ source: "openai" });
    await expect(generateImages({ prompt: "x", aspect: "1:1", count: 1, quality: "standard" }, s)).rejects.toThrow(/OpenAI is not set up yet/);
  });
});

describe("the on-device catalogue", () => {
  it("pins every file to a revision, a size and a checksum", () => {
    for (const model of DEVICE_MODELS) {
      expect(model.files.length).toBeGreaterThan(0);
      for (const file of model.files) {
        expect(file.url).toMatch(/^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[0-9a-f]{40}\//);
        expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(file.bytes).toBeGreaterThan(100_000_000);
        expect(file.dest).toMatch(file.shared ? /^llm\/models\// : new RegExp(`^images/models/${model.id}/`));
      }
      // One file per role: the engine takes one path for each.
      expect(new Set(model.files.map((f) => f.role)).size).toBe(model.files.length);
    }
    for (const runtime of Object.values(ENGINE_RUNTIMES)) {
      expect(runtime.url).toContain(`/releases/download/${SD_CPP_TAG}/`);
      expect(runtime.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("does not count a text encoder the language model already brought", () => {
    const klein = deviceModel("flux2-klein-4b")!;
    const shared = klein.files.find((f) => f.shared)!;
    expect(shared.dest).toBe("llm/models/qwen3-4b-q4_k_m/Qwen3-4B-Q4_K_M.gguf");
    expect(downloadBytes(klein) - downloadBytes(klein, new Set([shared.dest]))).toBe(shared.bytes);
    expect(modelComplete(klein, new Set(klein.files.map((f) => f.dest)))).toBe(true);
    expect(modelComplete(klein, new Set([shared.dest]))).toBe(false);
  });

  it("builds the engine's request from the model's own numbers", () => {
    const klein = engineRequest(deviceModel("flux2-klein-4b")!, { prompt: "p", negativePrompt: "blur", aspect: "16:9", count: 2, quality: "standard", seed: 7 }, "img-1", false);
    expect(klein).toMatchObject({
      id: "img-1",
      files: {
        diffusion: "images/models/flux2-klein-4b/flux-2-klein-4b-Q4_0.gguf",
        vae: "images/models/flux2-klein-4b/flux2-small-decoder.safetensors",
        llm: "llm/models/qwen3-4b-q4_k_m/Qwen3-4B-Q4_K_M.gguf",
      },
      width: 1360,
      height: 768,
      steps: 4,
      cfgScale: 1,
      // FLUX has no negative prompt; sending one would be ignored at best.
      negative: null,
      seed: 7,
      count: 2,
      flashAttention: true,
      offloadToCpu: true,
      vaeTiling: true,
      cpuOnly: false,
    });
    const sd = engineRequest(deviceModel("sd15")!, { prompt: "p", negativePrompt: " blur ", aspect: "1:1", count: 1, quality: "high", seed: null }, "img-2", true);
    expect(sd).toMatchObject({ files: { model: "images/models/sd15/stable-diffusion-v1-5-Q8_0.gguf" }, width: 512, height: 512, steps: 30, cfgScale: 7, sampler: "euler_a", negative: "blur", cpuOnly: true, offloadToCpu: false, vaeTiling: false });
    expect(sd.seed).toBeGreaterThanOrEqual(0);
  });

  it("knows when the engine in place is not the one asked for", () => {
    const status = { runtime: true, build: "cpu" as const, vulkan: true, busy: null, dir: "", arch: "x86_64" };
    // jsdom's user agent is not Windows, so there is no build to match here; the rule is still "missing engine = no match".
    expect(runtimeMatches(null, "auto")).toBe(false);
    expect(runtimeMatches({ ...status, runtime: false }, "cpu")).toBe(false);
  });
});

describe("small things", () => {
  it("names a file after its prompt", () => {
    expect(fileStem("A lighthouse at dusk, oil paint!")).toBe("a-lighthouse-at-dusk-oil-paint");
    expect(fileStem("Żółta łódź — zachód słońca")).toBe("zo-ta-odz-zachod-s-onca");
    expect(fileStem("???")).toBe("image");
    expect(fileStem("x".repeat(200)).length).toBeLessThanOrEqual(48);
  });

  it("puts the curated models first and drops the ones the provider no longer lists", () => {
    const curated = [{ id: "a", label: "A", note: "n" }, { id: "gone", label: "Gone" }];
    expect(mergeModels(curated, [])).toEqual(curated);
    expect(mergeModels(curated, [{ id: "b", label: "b" }, { id: "a", label: "a" }])).toEqual([{ id: "a", label: "A", note: "n" }, { id: "b", label: "b" }]);
  });

  it("folds stored background-removal choices onto the current shape", () => {
    expect(normalizeMattingPrefs({ model: "fine", edge: "razor", backdrop: "blur", color: "red", trim: 1 })).toEqual({
      model: "general",
      edge: "balanced",
      backdrop: "blur",
      color: "#0a84ff",
      trim: false,
      format: "png",
      cpuOnly: false,
    });
  });
});
