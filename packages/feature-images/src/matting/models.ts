/**
 * The background-removal catalogue: two segmentation models, each one ONNX
 * file pinned to a Hugging Face **revision** (a commit hash, never `main`)
 * with the size and SHA-256 from the repository's LFS pointer, so the
 * checksum belongs to this exact file for as long as the repo exists.
 *
 * They run in the webview through onnxruntime-web (`worker.ts`) — WebGPU
 * where the machine has it, the same binary's CPU path where it does not —
 * which is why they are fp32: an fp16 file only runs on the GPU path and an
 * int8 one only on the CPU path, and "it works on this laptop but not that
 * one" is a worse product than a bigger download.
 *
 * Licences were read before anything was pinned, because owntools is sold:
 * MODNet is Apache-2.0 and the ISNet conversion is AGPL-3.0 like owntools
 * itself. BRIA's RMBG models are the usual pick in demos and are deliberately
 * absent — their licence is non-commercial.
 *
 * Every number and every `backends` entry below was measured in the webview
 * (2026-09-18, i5-10300H + GTX 1650 Ti, onnxruntime-web 1.30), not assumed:
 *   ISNet    WebGPU 0.55 s per image (1.1 s the first time), CPU 14 s,
 *            identical mattes on both.
 *   MODNet   CPU 2.3–2.9 s. On WebGPU it runs in 0.2 s and returns a matte
 *            full of holes — a provider bug for this network — so it is pinned
 *            to the CPU path; fast and wrong is not a feature.
 * Tried and left out: BiRefNet lite (MIT, the best edges) fails its first run
 * on WebGPU and runs out of wasm's 4 GB on the CPU path at 1024 px; ISNet
 * int8 (44 MB) is only a third faster on the CPU and visibly drifts.
 */

export type MattingModelId = "portrait" | "general";

export type MattingBackend = "webgpu" | "wasm";

export interface MattingModel {
  id: MattingModelId;
  label: string;
  /** What it was trained by / on, for the row's meta line. */
  family: string;
  /** One line: what to use it for. */
  goodFor: string;
  /** One line: what it costs. */
  cost: string;
  file: string;
  url: string;
  bytes: number;
  sha256: string;
  license: string;
  /**
   * `fixed`: the image is stretched to `size`×`size` (what the model was
   * trained on; the mask is stretched back). `shortest`: the shortest edge
   * becomes `size`, both edges rounded to `multiple`, the longest capped at
   * `maxSide` — for fully convolutional models that keep the aspect ratio.
   */
  input: { mode: "fixed"; size: number } | { mode: "shortest"; size: number; multiple: number; maxSide: number };
  /** Pixel → tensor: `(v * scale - mean[c]) / std[c]` with v in 0..255. */
  scale: number;
  mean: [number, number, number];
  std: [number, number, number];
  /** What the raw output needs before it is an alpha value. */
  activation: "none" | "sigmoid";
  /** Stretch the output to 0..1 by its own min / max (what rembg does for U²-Net-family models). */
  normalizeOutput: boolean;
  /** Execution providers this model is known to be *correct* on, best first. */
  backends: MattingBackend[];
  tags: ("recommended" | "people")[];
}

const HF = "https://huggingface.co";

export const MATTING_MODELS: MattingModel[] = [
  {
    id: "general",
    label: "General",
    family: "ISNet · DIS",
    goodFor: "Products, people, animals, objects - the one to start with.",
    cost: "176 MB · half a second per image on a GPU, 10-15 s without one.",
    file: "isnet-general.onnx",
    url: `${HF}/onnx-community/ISNet-ONNX/resolve/3fe6e3db3e32c69aadde61fe388ddb1a0574440c/onnx/model.onnx`,
    bytes: 176114856,
    sha256: "8bc7e049e30cdda79a47e111673d3620096993b7c751ca2cb474591c23bfe4b5",
    license: "AGPL-3.0",
    input: { mode: "fixed", size: 1024 },
    scale: 1,
    mean: [128, 128, 128],
    std: [256, 256, 256],
    activation: "none",
    normalizeOutput: true,
    backends: ["webgpu", "wasm"],
    tags: ["recommended"],
  },
  {
    id: "portrait",
    label: "Portrait",
    family: "MODNet",
    goodFor: "People only - keeps hair and soft edges, and it is a small download.",
    cost: "26 MB · 2-3 s per image on any machine.",
    file: "modnet-portrait.onnx",
    url: `${HF}/Xenova/modnet/resolve/fa2fa546052fba4c08921230a26cc69a333fca12/onnx/model.onnx`,
    bytes: 25888640,
    sha256: "07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9",
    license: "Apache-2.0",
    input: { mode: "shortest", size: 512, multiple: 32, maxSide: 1024 },
    scale: 1 / 255,
    mean: [0.5, 0.5, 0.5],
    std: [0.5, 0.5, 0.5],
    activation: "none",
    normalizeOutput: false,
    backends: ["wasm"],
    tags: ["people"],
  },
];

export const DEFAULT_MATTING_MODEL: MattingModelId = "general";

export function mattingModel(id: string): MattingModel | undefined {
  return MATTING_MODELS.find((m) => m.id === id);
}

/** Where a model's file lives, relative to AppData (and the key in the browser cache). */
export function mattingModelDest(model: MattingModel): string {
  return `images/matting/${model.file}`;
}

/** "26 MB", "176 MB" — decimal units, as download pages quote them. */
export function formatModelBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} kB`;
  return `${Math.max(0, Math.round(bytes))} B`;
}
