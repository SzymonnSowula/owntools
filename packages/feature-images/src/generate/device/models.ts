/**
 * The on-device image catalogue: what "Install" in Settings → Intelligence
 * can fetch, and the stable-diffusion.cpp build that runs it.
 *
 * Every file is pinned — a Hugging Face **revision** (a commit hash, never
 * `main`) with the size and SHA-256 from the repository's LFS record, and a
 * stable-diffusion.cpp release tag with the digest GitHub publishes for each
 * asset — so the checksums belong to these exact bytes for as long as the
 * repositories exist. Read on 2026-09-18.
 *
 * Two of the three models read their prompt with **Qwen3 4B**, the same GGUF
 * Settings → Intelligence installs as the language model. It is named here by
 * the language-model catalogue's own entry and lives in that catalogue's
 * folder, so a person who has one gets 2.5 GB off the other.
 *
 * Licences, read before pinning because owntools is sold: FLUX.2 klein 4B,
 * its small-decoder VAE, Z-Image Turbo and Qwen3 are Apache-2.0; Stable
 * Diffusion 1.5 is CreativeML OpenRAIL-M (commercial use allowed, with use
 * restrictions that are the person's to read — the row links to them).
 */
import { platformOs } from "@core/env";
import { modelById as languageModel } from "@feature-llm/models";
import type { Quality } from "../types";

export type DeviceFileRole = "model" | "diffusion" | "vae" | "llm";

export interface DeviceFile {
  role: DeviceFileRole;
  /** Destination relative to AppData — also how the file is named to the engine. */
  dest: string;
  url: string;
  bytes: number;
  sha256: string;
  /** Lives in another tool's folder: never deleted with this model. */
  shared?: boolean;
  /** What the file is, for the install line. */
  label: string;
}

export type DeviceModelTag = "recommended" | "best" | "light";

export interface DeviceModel {
  id: string;
  label: string;
  maker: string;
  goodFor: string;
  /** What it needs from the machine, honestly. */
  needs: string;
  license: string;
  licenseUrl: string;
  files: DeviceFile[];
  /** Picture size the model was made for, in megapixels, and the grid its edges sit on. */
  megapixels: number;
  multiple: number;
  steps: Record<Quality, number>;
  cfgScale: number;
  sampler?: string;
  negativePrompt: boolean;
  /** Attention and memory switches this model wants (from stable-diffusion.cpp's own docs). */
  flashAttention: boolean;
  offloadToCpu: boolean;
  tags: DeviceModelTag[];
}

const HF = "https://huggingface.co";

function qwen3(): DeviceFile {
  const model = languageModel("qwen3-4b-q4_k_m");
  if (!model) throw new Error("The language-model catalogue lost Qwen3 4B - the image models share that file.");
  return {
    role: "llm",
    dest: `llm/models/${model.id}/${model.file}`,
    url: model.url,
    bytes: model.bytes,
    sha256: model.sha256,
    shared: true,
    label: "Qwen3 4B text encoder (shared with the language model)",
  };
}

export const DEVICE_MODELS: DeviceModel[] = [
  {
    id: "flux2-klein-4b",
    label: "FLUX.2 klein 4B",
    maker: "Black Forest Labs",
    goodFor: "The all-rounder: photographs, illustration, readable text - in four steps.",
    needs: "A graphics card with 4 GB or more makes it seconds; on a processor alone it is minutes.",
    license: "Apache-2.0",
    licenseUrl: "https://huggingface.co/black-forest-labs/FLUX.2-klein-4B",
    files: [
      {
        role: "diffusion",
        dest: "images/models/flux2-klein-4b/flux-2-klein-4b-Q4_0.gguf",
        url: `${HF}/leejet/FLUX.2-klein-4B-GGUF/resolve/3b1f5a9dc3abb32238b053aeb3d823c30afdacbd/flux-2-klein-4b-Q4_0.gguf`,
        bytes: 2460378560,
        sha256: "d1023499ef3f2f82ff7c50e6778495195c1b6cc34835741778868428111f9ff4",
        label: "FLUX.2 klein 4B",
      },
      {
        role: "vae",
        dest: "images/models/flux2-klein-4b/flux2-small-decoder.safetensors",
        url: `${HF}/black-forest-labs/FLUX.2-small-decoder/resolve/a3efc24f613ef42d9428af62fdbd6f5fd8856c4a/full_encoder_small_decoder.safetensors`,
        bytes: 249519092,
        sha256: "ea4273f02d1fafbf8e1d1c2cf6018ed8748652eb0bf34f2dd91171f16f15ab62",
        label: "FLUX.2 image decoder",
      },
      qwen3(),
    ],
    megapixels: 1,
    multiple: 16,
    steps: { draft: 4, standard: 4, high: 6 },
    cfgScale: 1,
    negativePrompt: false,
    flashAttention: true,
    offloadToCpu: true,
    tags: ["recommended"],
  },
  {
    id: "z-image-turbo",
    label: "Z-Image Turbo",
    maker: "Tongyi-MAI (Alibaba)",
    goodFor: "The most photographic of the three, and good with words in a picture - eight steps.",
    needs: "A bigger model: a graphics card is strongly advised.",
    license: "Apache-2.0",
    licenseUrl: "https://huggingface.co/Tongyi-MAI/Z-Image-Turbo",
    files: [
      {
        role: "diffusion",
        dest: "images/models/z-image-turbo/z_image_turbo-Q4_K.gguf",
        url: `${HF}/leejet/Z-Image-Turbo-GGUF/resolve/c61c0e422dc8b541b7548cf33a4ef8302b0f8085/z_image_turbo-Q4_K.gguf`,
        bytes: 3864250304,
        sha256: "14b375ab4f226bc5378f68f37e899ef3c2242b8541e61e2bc1aff40976086fbd",
        label: "Z-Image Turbo",
      },
      {
        role: "vae",
        dest: "images/models/z-image-turbo/ae.safetensors",
        url: `${HF}/Comfy-Org/z_image_turbo/resolve/08d04455279082882deaabc8d0d09fc914c071e1/split_files/vae/ae.safetensors`,
        bytes: 335304388,
        sha256: "afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38",
        label: "Image decoder",
      },
      qwen3(),
    ],
    megapixels: 1,
    multiple: 16,
    steps: { draft: 6, standard: 8, high: 9 },
    cfgScale: 1,
    negativePrompt: false,
    flashAttention: true,
    offloadToCpu: true,
    tags: ["best"],
  },
  {
    id: "sd15",
    label: "Stable Diffusion 1.5",
    maker: "Stability AI / Runway",
    goodFor: "The small classic: 512-pixel pictures on any laptop, and it takes a negative prompt.",
    needs: "Runs on a processor alone - about a minute a picture; a few seconds with a graphics card.",
    license: "CreativeML OpenRAIL-M",
    licenseUrl: "https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5",
    files: [
      {
        role: "model",
        dest: "images/models/sd15/stable-diffusion-v1-5-Q8_0.gguf",
        url: `${HF}/second-state/stable-diffusion-v1-5-GGUF/resolve/031b5f5df991f511b3f5fa8fed6d99048ababb69/stable-diffusion-v1-5-pruned-emaonly-Q8_0.gguf`,
        bytes: 1763578176,
        sha256: "d0555243938c62faeefb4ac93f6c7a053ad373a4290c5256bce229aeb193bf94",
        label: "Stable Diffusion 1.5",
      },
    ],
    megapixels: 0.25,
    multiple: 64,
    steps: { draft: 12, standard: 20, high: 30 },
    cfgScale: 7,
    sampler: "euler_a",
    negativePrompt: true,
    flashAttention: false,
    offloadToCpu: false,
    tags: ["light"],
  },
];

export const DEFAULT_DEVICE_MODEL = DEVICE_MODELS[0].id;

export function deviceModel(id: string): DeviceModel | undefined {
  return DEVICE_MODELS.find((m) => m.id === id);
}

/** Bytes this model adds to the disk, given which of its files are already there. */
export function downloadBytes(model: DeviceModel, present: ReadonlySet<string> = new Set()): number {
  return model.files.filter((f) => !present.has(f.dest)).reduce((n, f) => n + f.bytes, 0);
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} kB`;
  return `${Math.max(0, Math.round(bytes))} B`;
}

/* ------------------------------------------------------------------------- */
/* Runtime                                                                   */
/* ------------------------------------------------------------------------- */

/** Which stable-diffusion.cpp build: Vulkan runs on any GPU vendor's driver, "cpu" needs nothing, Metal is the macOS one. */
export type EngineBuild = "vulkan" | "cpu" | "metal";

export interface EngineRuntime {
  build: EngineBuild;
  label: string;
  url: string;
  bytes: number;
  sha256: string;
  /** Where the archive lands (relative to AppData) before Rust unpacks it. */
  archive: string;
}

export const SD_CPP_TAG = "master-872-cc515a0";
const RELEASE = `https://github.com/leejet/stable-diffusion.cpp/releases/download/${SD_CPP_TAG}`;

export const ENGINE_RUNTIMES: Record<EngineBuild, EngineRuntime> = {
  vulkan: {
    build: "vulkan",
    label: `stable-diffusion.cpp ${SD_CPP_TAG} · GPU (Vulkan)`,
    url: `${RELEASE}/sd-master-cc515a0-bin-win-vulkan-x64.zip`,
    bytes: 31858417,
    sha256: "b8c6538f8948dfaa1adc25c463fb1617098d1ff307032e38f29648d5891ead8d",
    archive: "images/engine/runtime.zip",
  },
  cpu: {
    build: "cpu",
    label: `stable-diffusion.cpp ${SD_CPP_TAG} · processor only`,
    url: `${RELEASE}/sd-master-cc515a0-bin-win-cpu-x64.zip`,
    bytes: 17108357,
    sha256: "43c9b5d2a2af61d65bf46e57c53b154067bccc82e84823eaee66ec4d20095875",
    archive: "images/engine/runtime.zip",
  },
  metal: {
    build: "metal",
    label: `stable-diffusion.cpp ${SD_CPP_TAG} · Apple Silicon`,
    url: `${RELEASE}/sd-master-cc515a0-bin-Darwin-macOS-26.6.2-arm64.zip`,
    bytes: 34092574,
    sha256: "39412a6abb2f19a18524903ccaa63ebbd21e4818540ce4a1d64ea5e55f474b6d",
    archive: "images/engine/runtime.zip",
  },
};

export type EnginePreference = "auto" | "gpu" | "cpu";

/**
 * The build for this machine, or `null` where there is none. On Windows
 * "auto" means the GPU build when a Vulkan loader is installed (any current
 * NVIDIA, AMD or Intel driver brings one) and the processor build otherwise;
 * macOS has one build, for Apple Silicon.
 */
export function runtimeFor(preference: EnginePreference, machine: { vulkan: boolean; arch?: string | null }): EngineRuntime | null {
  const os = platformOs();
  if (os === "macos") return machine.arch && machine.arch !== "aarch64" ? null : ENGINE_RUNTIMES.metal;
  if (os !== "windows") return null;
  if (preference === "cpu") return ENGINE_RUNTIMES.cpu;
  if (preference === "gpu") return ENGINE_RUNTIMES.vulkan;
  return machine.vulkan ? ENGINE_RUNTIMES.vulkan : ENGINE_RUNTIMES.cpu;
}
