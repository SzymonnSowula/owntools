/**
 * Background removal, off the main thread.
 *
 * One dedicated worker holds onnxruntime-web and one model session. The main
 * thread hands it the model's bytes once (`load`) and then images (`run`);
 * each run decodes the image, resizes it to what the model wants, runs the
 * model, and answers with the matte as a full-size `ImageBitmap` whose alpha
 * *is* the matte — so the page composes with `destination-in` and never
 * loops over pixels on the thread that draws the UI.
 *
 * Backend: the WebGPU execution provider when the machine has an adapter
 * *and the model is known to be correct on it* (`model.backends` — MODNet is
 * not), otherwise the CPU path of the same wasm binary. A model that fails to
 * start or to run on the GPU (an operator the provider lacks, a lost device)
 * is rebuilt on the CPU and the run repeated once, so "GPU trouble" is slower,
 * never broken. Threads stay at 1 unless the page is cross-origin isolated —
 * SharedArrayBuffer is not available to the app's webview otherwise.
 */
import * as ort from "onnxruntime-web/webgpu";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import { edgeCurve, matteBounds, matteCoverage, modelInputSize, toMatte, toTensor, type Bounds, type EdgeStyle } from "./mask";
import type { MattingBackend, MattingModel } from "./models";

export type { MattingBackend };

export type WorkerRequest =
  | { type: "load"; model: MattingModel; bytes: ArrayBuffer; prefer: "auto" | "cpu" }
  /** `key` names the image: a second run with the same key only re-applies the edge curve. */
  | { type: "run"; job: number; key: string; image: Blob; edge: EdgeStyle }
  | { type: "release" };

export type WorkerReply =
  | { type: "loaded"; modelId: string; backend: MattingBackend; ms: number }
  | { type: "failed"; stage: "load" | "run"; job?: number; message: string }
  | {
      type: "done";
      job: number;
      mask: ImageBitmap;
      width: number;
      height: number;
      bounds: Bounds | null;
      coverage: number;
      ms: number;
      backend: MattingBackend;
    };

interface WorkerScope {
  postMessage(message: WorkerReply, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
}

const scope = self as unknown as WorkerScope;

ort.env.wasm.wasmPaths = { wasm: wasmUrl };
ort.env.wasm.numThreads =
  typeof crossOriginIsolated !== "undefined" && crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
ort.env.logLevel = "error";

interface Loaded {
  model: MattingModel;
  bytes: ArrayBuffer;
  session: ort.InferenceSession;
  backend: MattingBackend;
}

let loaded: Loaded | null = null;

/**
 * Mattes at model size, by image key. Changing the edge style is a new curve
 * over the same matte, and without a GPU the model is fifteen seconds a
 * picture — so the last few are kept (1 MB each) and only the cheap half of
 * the job is repeated.
 */
const MATTE_CACHE_LIMIT = 24;
const mattes = new Map<string, { data: Uint8ClampedArray; width: number; height: number }>();

function remember(key: string, matte: { data: Uint8ClampedArray; width: number; height: number }): void {
  mattes.delete(key);
  mattes.set(key, matte);
  while (mattes.size > MATTE_CACHE_LIMIT) {
    const oldest = mattes.keys().next().value;
    if (oldest === undefined) break;
    mattes.delete(oldest);
  }
}

async function hasGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown | null> } }).gpu;
    if (!gpu) return false;
    return (await gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

async function createSession(bytes: ArrayBuffer, backend: MattingBackend): Promise<ort.InferenceSession> {
  // onnxruntime copies the bytes into wasm memory; ours stay usable for a rebuild on the CPU.
  return ort.InferenceSession.create(new Uint8Array(bytes), {
    executionProviders: [backend],
    graphOptimizationLevel: "all",
    // Errors only: the "some nodes were assigned to the CPU" notice is normal and reads like a failure in the log.
    logSeverityLevel: 3,
  });
}

async function release(): Promise<void> {
  const session = loaded?.session;
  loaded = null;
  mattes.clear();
  if (session) await session.release().catch(() => undefined);
}

async function load(model: MattingModel, bytes: ArrayBuffer, prefer: "auto" | "cpu"): Promise<void> {
  const started = performance.now();
  await release();
  const gpuOk = prefer === "auto" && model.backends.includes("webgpu") && (await hasGpu());
  let backend: MattingBackend = gpuOk ? "webgpu" : "wasm";
  let session: ort.InferenceSession;
  try {
    session = await createSession(bytes, backend);
  } catch (err) {
    if (backend === "wasm") throw err;
    backend = "wasm";
    session = await createSession(bytes, backend);
  }
  loaded = { model, bytes, session, backend };
  scope.postMessage({ type: "loaded", modelId: model.id, backend, ms: Math.round(performance.now() - started) });
}

interface RawMatte {
  data: Float32Array;
  width: number;
  height: number;
}

async function infer(current: Loaded, tensor: Float32Array, width: number, height: number): Promise<RawMatte> {
  const input = new ort.Tensor("float32", tensor, [1, 3, height, width]);
  const outputs = await current.session.run({ [current.session.inputNames[0]]: input });
  const first = outputs[current.session.outputNames[0]];
  const data = first.data;
  if (!(data instanceof Float32Array)) throw new Error("The model answered with something other than a float matte.");
  // [1, 1, h, w] — a model is free to answer at its own size.
  const dims = first.dims;
  const outH = dims[dims.length - 2];
  const outW = dims[dims.length - 1];
  if (outH * outW !== data.length) throw new Error("The model's matte has an unexpected shape.");
  return { data, width: outW, height: outH };
}

/** Runs the model on `bitmap` and returns the matte at the model's own size. */
async function matteFor(bitmap: ImageBitmap): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  if (!loaded) throw new Error("No background-removal model is loaded.");
  const size = modelInputSize(loaded.model, { width: bitmap.width, height: bitmap.height });
  const canvas = new OffscreenCanvas(size.width, size.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("No 2D canvas in the worker.");
  // Transparent PNGs: judge them on white, the way they are usually seen.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  const tensor = toTensor(ctx.getImageData(0, 0, size.width, size.height).data, size, loaded.model);

  let out: RawMatte;
  try {
    out = await infer(loaded, tensor, size.width, size.height);
  } catch (err) {
    if (loaded.backend === "wasm") throw err;
    // The GPU path gave up mid-run: same model on the CPU, once.
    const { model, bytes } = loaded;
    await release();
    loaded = { model, bytes, session: await createSession(bytes, "wasm"), backend: "wasm" };
    out = await infer(loaded, tensor, size.width, size.height);
  }
  return { data: toMatte(out.data, loaded.model), width: out.width, height: out.height };
}

async function run(job: number, key: string, image: Blob, edge: EdgeStyle): Promise<void> {
  if (!loaded) throw new Error("No background-removal model is loaded.");
  const started = performance.now();
  const bitmap = await createImageBitmap(image);
  try {
    const full = { width: bitmap.width, height: bitmap.height };
    const cacheKey = `${loaded.model.id}:${key}`;
    let out = mattes.get(cacheKey);
    if (!out) {
      out = await matteFor(bitmap);
      remember(cacheKey, out);
    }
    const matte = out.data;

    // Matte → opaque greyscale at model size, so the upscale interpolates
    // grey values and not premultiplied alpha.
    const small = new OffscreenCanvas(out.width, out.height);
    const sctx = small.getContext("2d");
    if (!sctx) throw new Error("No 2D canvas in the worker.");
    const grey = new ImageData(out.width, out.height);
    for (let i = 0, p = 0; i < matte.length; i++, p += 4) {
      const v = matte[i];
      grey.data[p] = v;
      grey.data[p + 1] = v;
      grey.data[p + 2] = v;
      grey.data[p + 3] = 255;
    }
    sctx.putImageData(grey, 0, 0);

    const big = new OffscreenCanvas(full.width, full.height);
    const bctx = big.getContext("2d", { willReadFrequently: true });
    if (!bctx) throw new Error("No 2D canvas in the worker.");
    bctx.imageSmoothingEnabled = true;
    bctx.imageSmoothingQuality = "high";
    bctx.drawImage(small, 0, 0, full.width, full.height);
    const scaled = bctx.getImageData(0, 0, full.width, full.height);

    const lut = edgeCurve(edge);
    const alpha = new Uint8ClampedArray(full.width * full.height);
    const px = scaled.data;
    for (let i = 0, p = 0; i < alpha.length; i++, p += 4) {
      const a = lut[px[p]];
      alpha[i] = a;
      px[p] = 0;
      px[p + 1] = 0;
      px[p + 2] = 0;
      px[p + 3] = a;
    }
    const mask = await createImageBitmap(scaled);
    scope.postMessage(
      {
        type: "done",
        job,
        mask,
        width: full.width,
        height: full.height,
        bounds: matteBounds(alpha, full),
        coverage: matteCoverage(alpha),
        ms: Math.round(performance.now() - started),
        backend: loaded.backend,
      },
      [mask],
    );
  } finally {
    bitmap.close();
  }
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "Something went wrong in the background-removal worker.";
}

// One request at a time, in order: a `run` sent right after a `load` waits for it.
let queue: Promise<void> = Promise.resolve();

scope.onmessage = (event) => {
  const request = event.data;
  queue = queue.then(async () => {
    try {
      if (request.type === "load") await load(request.model, request.bytes, request.prefer);
      else if (request.type === "run") await run(request.job, request.key, request.image, request.edge);
      else await release();
    } catch (err) {
      scope.postMessage({
        type: "failed",
        stage: request.type === "run" ? "run" : "load",
        job: request.type === "run" ? request.job : undefined,
        message: messageOf(err),
      });
    }
  });
};
