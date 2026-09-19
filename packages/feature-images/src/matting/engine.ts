/**
 * The page's side of background removal: owns the worker, loads a model into
 * it once, and turns "this image" into a matte.
 *
 * The worker (and the few hundred MB of model and runtime inside it) exists
 * only while something needs it: `cutOut` starts it on demand and
 * `releaseMatting()` — called when the tool closes — terminates it, which is
 * the one reliable way to hand wasm memory back.
 */
import { logError, logInfo } from "@core/errors";
import { readModel } from "./files";
import type { Bounds, EdgeStyle } from "./mask";
import { mattingModel, type MattingBackend, type MattingModelId } from "./models";
import type { WorkerReply, WorkerRequest } from "./worker";

export interface Matte {
  /** Full-size bitmap whose alpha channel is the matte; compose with `destination-in`. */
  mask: ImageBitmap;
  width: number;
  height: number;
  /** Box around the subject, or null when nothing was kept. */
  bounds: Bounds | null;
  /** Share of the frame that was kept, 0..1. */
  coverage: number;
  /** Decode + model + matte, in milliseconds. */
  ms: number;
  backend: MattingBackend;
}

export interface LoadedModel {
  id: MattingModelId;
  backend: MattingBackend;
  /** How long the model took to start, in milliseconds. */
  ms: number;
}

interface Pending {
  resolve(matte: Matte): void;
  reject(err: Error): void;
}

let worker: Worker | null = null;
let current: LoadedModel | null = null;
let loading: { id: MattingModelId; prefer: "auto" | "cpu"; promise: Promise<LoadedModel> } | null = null;
let loadWaiter: { resolve(model: LoadedModel): void; reject(err: Error): void } | null = null;
let preference: "auto" | "cpu" = "auto";
const pending = new Map<number, Pending>();
let nextJob = 1;

function post(request: WorkerRequest, transfer: Transferable[] = []): void {
  worker?.postMessage(request, transfer);
}

function failEverything(err: Error): void {
  loadWaiter?.reject(err);
  loadWaiter = null;
  for (const job of pending.values()) job.reject(err);
  pending.clear();
}

function startWorker(): Worker {
  const started = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "owntools-matting" });
  started.onmessage = (event: MessageEvent<WorkerReply>) => {
    const reply = event.data;
    if (reply.type === "loaded") {
      const model: LoadedModel = { id: reply.modelId as MattingModelId, backend: reply.backend, ms: reply.ms };
      current = model;
      logInfo("images", `background removal: ${reply.modelId} on ${reply.backend} in ${reply.ms} ms`);
      loadWaiter?.resolve(model);
      loadWaiter = null;
      return;
    }
    if (reply.type === "done") {
      // The run may have fallen back to the CPU; remember what is true now.
      if (current) current = { ...current, backend: reply.backend };
      pending.get(reply.job)?.resolve({
        mask: reply.mask,
        width: reply.width,
        height: reply.height,
        bounds: reply.bounds,
        coverage: reply.coverage,
        ms: reply.ms,
        backend: reply.backend,
      });
      pending.delete(reply.job);
      return;
    }
    const err = new Error(reply.message);
    logError("images", `background removal (${reply.stage})`, err);
    if (reply.stage === "load") {
      current = null;
      loadWaiter?.reject(err);
      loadWaiter = null;
    } else if (reply.job !== undefined) {
      pending.get(reply.job)?.reject(err);
      pending.delete(reply.job);
    }
  };
  started.onerror = (event) => {
    const err = new Error(event.message || "The background-removal worker stopped.");
    logError("images", "background removal worker", err);
    releaseMatting();
    failEverything(err);
  };
  return started;
}

/** Loads `id` into the worker unless it is the model already there. */
export function ensureModel(id: MattingModelId, prefer: "auto" | "cpu" = preference): Promise<LoadedModel> {
  if (current && current.id === id && prefer === preference) return Promise.resolve(current);
  if (loading && loading.id === id && loading.prefer === prefer) return loading.promise;
  const model = mattingModel(id);
  if (!model) return Promise.reject(new Error(`Unknown background-removal model: ${id}`));
  const promise = (async () => {
    const bytes = await readModel(model);
    if (!worker) worker = startWorker();
    current = null;
    preference = prefer;
    const ready = new Promise<LoadedModel>((resolve, reject) => {
      loadWaiter = { resolve, reject };
    });
    post({ type: "load", model, bytes, prefer }, [bytes]);
    return ready;
  })().finally(() => {
    loading = null;
  });
  loading = { id, prefer, promise };
  return promise;
}

export interface CutOutOptions {
  model: MattingModelId;
  /**
   * Names the image for the worker's matte cache: a second call with the same
   * key (another edge style) skips the model. Leave it out for a one-off.
   */
  key?: string;
  edge?: EdgeStyle;
  /** "cpu" skips the GPU even when there is one (a driver that misbehaves). */
  prefer?: "auto" | "cpu";
}

/** The matte for one image. The model is started first when it is not the one loaded. */
export async function cutOut(image: Blob, options: CutOutOptions): Promise<Matte> {
  await ensureModel(options.model, options.prefer ?? preference);
  const job = nextJob++;
  return new Promise<Matte>((resolve, reject) => {
    pending.set(job, { resolve, reject });
    post({ type: "run", job, key: options.key ?? `job-${job}`, image, edge: options.edge ?? "balanced" });
  });
}

/** What is loaded right now, for a status line. */
export function loadedModel(): LoadedModel | null {
  return current;
}

/** Stops the worker and frees the model. Safe to call when nothing is running. */
export function releaseMatting(): void {
  worker?.terminate();
  worker = null;
  current = null;
  loading = null;
  failEverything(new Error("Background removal was closed."));
}
