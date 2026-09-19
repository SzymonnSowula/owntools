/**
 * What every provider needs around its one interesting request: the tracked
 * fetch (so each call shows up in Settings → Privacy with its purpose and is
 * refused in Offline mode), error bodies turned into a sentence, base64 and
 * result URLs turned into blobs, polling, and aspect ratio → pixels.
 */
import { isOfflineMode, trackedFetch } from "@core/net";
import { ProviderError, type AspectRatio, type ProviderErrorKind } from "./types";

export const PURPOSE = "image generation";

/** A long-running image can take two minutes on a busy provider; the person has Cancel for anything longer. */
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

export interface CallInit {
  method?: "GET" | "POST" | "PUT";
  headers?: Record<string, string>;
  /** An object is sent as JSON. FormData and strings go as they are. */
  body?: unknown;
  signal?: AbortSignal;
  /**
   * Servers on the person's own machine (ComfyUI) refuse a request whose
   * Origin is not theirs, and the app's HTTP layer stamps the webview's. An
   * empty Origin makes it send none.
   */
  noOrigin?: boolean;
  purpose?: string;
}

function timeoutSignal(signal?: AbortSignal): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("The provider took too long to answer.", "TimeoutError")), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

/** One request. Network failures and Offline mode come back as `ProviderError`s; an HTTP error is the caller's to read. */
export async function call(url: string, init: CallInit = {}): Promise<Response> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  let body: BodyInit | undefined;
  if (init.body instanceof FormData || typeof init.body === "string") {
    body = init.body;
  } else if (init.body !== undefined) {
    body = JSON.stringify(init.body);
    headers["Content-Type"] ??= "application/json";
  }
  if (init.noOrigin) headers.Origin = "";
  const guard = timeoutSignal(init.signal);
  try {
    return await trackedFetch(url, {
      method: init.method ?? (body === undefined ? "GET" : "POST"),
      headers,
      body,
      signal: guard.signal,
      purpose: init.purpose ?? PURPOSE,
    });
  } catch (err) {
    if (init.signal?.aborted) throw new DOMException("The generation was cancelled.", "AbortError");
    if (isOfflineMode(err)) {
      throw new ProviderError("Offline mode is on, so nothing was sent. Switch it off in Settings → Privacy, or use the on-device model.", "offline");
    }
    if (err instanceof DOMException && err.name === "TimeoutError") throw new ProviderError(err.message);
    if (guard.signal.aborted) throw new ProviderError("The provider took too long to answer.");
    const host = (() => {
      try {
        return new URL(url).host;
      } catch {
        return url;
      }
    })();
    throw new ProviderError(`Could not reach ${host}. Check the connection${/^(localhost|127\.|192\.168\.|10\.)/.test(host) ? " and that the server is running" : ""}.`);
  } finally {
    guard.done();
  }
}

/* ------------------------------------------------------------------------- */
/* Errors                                                                    */
/* ------------------------------------------------------------------------- */

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * The sentence inside an error body. Providers agree on nothing, so this
 * reads every shape met in their docs: `{error:{message}}` (OpenAI family,
 * OpenRouter, Together, getimg), `{error:"…"}` (Hugging Face, Ideogram,
 * DeepInfra), `{code,error}` (xAI), `{detail}` as a string or a validation
 * array (fal, Replicate, DeepInfra, BFL, A1111), `{errors:[…]}` of strings
 * (Stability) or objects (Runware), `{message}` (Alibaba-style), and the
 * array-wrapped `[{error}]` Google sometimes answers with.
 */
export function messageFromBody(body: unknown): string | null {
  if (Array.isArray(body)) return body.length ? messageFromBody(body[0]) : null;
  if (!body || typeof body !== "object") return typeof body === "string" ? firstString(body) : null;
  const b = body as Record<string, unknown>;
  if (b.error && typeof b.error === "object") {
    const e = b.error as Record<string, unknown>;
    const found = firstString(e.message, e.detail, e.type);
    if (found) return found;
  }
  if (Array.isArray(b.detail)) {
    const parts = b.detail
      .map((d) => (d && typeof d === "object" ? firstString((d as Record<string, unknown>).msg, (d as Record<string, unknown>).message) : firstString(d)))
      .filter((s): s is string => Boolean(s));
    if (parts.length) return parts.slice(0, 3).join(" · ");
  }
  if (Array.isArray(b.errors)) {
    const parts = b.errors
      .map((e) => (e && typeof e === "object" ? firstString((e as Record<string, unknown>).message) : firstString(e)))
      .filter((s): s is string => Boolean(s));
    if (parts.length) return parts.slice(0, 3).join(" · ");
  }
  return firstString(b.error, b.detail, b.message, b.title, b.name);
}

export function kindForStatus(status: number, message: string): ProviderErrorKind {
  const text = message.toLowerCase();
  if (/api key|api_key|unauthenticated|unauthorized|credentials|invalid token|incorrect key/.test(text)) return "auth";
  if (/moderat|safety|content policy|content_policy|nsfw|prohibited|flagged/.test(text)) return "blocked";
  if (status === 402 || /credit|balance|billing|quota|insufficient|spend limit|payment/.test(text)) return "billing";
  if (status === 401) return "auth";
  if (status === 429) return "rate";
  if (status === 403) return "auth";
  if (status === 400 || status === 404 || status === 422) return "input";
  return "other";
}

const KIND_HINT: Partial<Record<ProviderErrorKind, string>> = {
  auth: "Check the key in Settings → Intelligence.",
  billing: "The account behind this key is out of credit or has no billing set up.",
  rate: "The provider is rate-limiting this key - wait a moment and try again.",
  blocked: "The provider's content filter refused this prompt.",
};

/** Turns a failed response into a `ProviderError` that names the provider and says what to do. */
export async function failure(res: Response, provider: string): Promise<ProviderError> {
  const text = await res.text().catch(() => "");
  let message: string | null = null;
  try {
    message = messageFromBody(JSON.parse(text));
  } catch {
    message = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240) || null;
  }
  const said = message ?? `HTTP ${res.status}`;
  const kind = kindForStatus(res.status, said);
  const hint = KIND_HINT[kind];
  return new ProviderError(`${provider}: ${said.slice(0, 300)}${hint ? ` ${hint}` : ""}`, kind, res.status);
}

/** `res.json()` for a success; a `ProviderError` otherwise. */
export async function json<T>(res: Response, provider: string): Promise<T> {
  if (!res.ok) throw await failure(res, provider);
  try {
    return (await res.json()) as T;
  } catch {
    throw new ProviderError(`${provider} answered with something that is not JSON.`);
  }
}

/* ------------------------------------------------------------------------- */
/* Pictures                                                                  */
/* ------------------------------------------------------------------------- */

/** PNG / JPEG / WebP / GIF by their first bytes — providers label base64 results carelessly. */
export function sniffMime(bytes: Uint8Array, fallback = "image/png"): string {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "image/webp";
  }
  if (bytes.length >= 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  return fallback;
}

export function bytesToBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes as BlobPart], { type: sniffMime(bytes) });
}

/** Raw base64 or a whole `data:` URL → a blob with the type its bytes say it is. */
export function base64ToBlob(data: string): Blob {
  const comma = data.startsWith("data:") ? data.indexOf(",") : -1;
  const raw = atob((comma >= 0 ? data.slice(comma + 1) : data).replace(/\s+/g, ""));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytesToBlob(bytes);
}

/** Downloads a result a provider handed over as a URL. Most expire within the hour, so this happens at once. */
export async function download(url: string, provider: string, signal?: AbortSignal, headers?: Record<string, string>): Promise<Blob> {
  if (url.startsWith("data:")) return base64ToBlob(url);
  const res = await call(url, { signal, headers, purpose: `${PURPOSE} (download)` });
  if (!res.ok) throw await failure(res, provider);
  return bytesToBlob(new Uint8Array(await res.arrayBuffer()));
}

/** A response whose body *is* the picture. */
export async function imageBody(res: Response, provider: string): Promise<Blob> {
  if (!res.ok) throw await failure(res, provider);
  return bytesToBlob(new Uint8Array(await res.arrayBuffer()));
}

/* ------------------------------------------------------------------------- */
/* Waiting                                                                   */
/* ------------------------------------------------------------------------- */

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("The generation was cancelled.", "AbortError"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("The generation was cancelled.", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface PollOptions {
  signal?: AbortSignal;
  /** First wait; grows by half each round up to `maxMs`. */
  everyMs?: number;
  maxMs?: number;
  timeoutMs?: number;
}

/** Calls `check` until it returns something other than `null`. */
export async function poll<T>(check: () => Promise<T | null>, options: PollOptions = {}): Promise<T> {
  const started = Date.now();
  let wait = options.everyMs ?? 1000;
  const max = options.maxMs ?? 4000;
  const timeout = options.timeoutMs ?? 10 * 60 * 1000;
  for (;;) {
    const result = await check();
    if (result !== null) return result;
    if (Date.now() - started > timeout) throw new ProviderError("The provider did not finish in ten minutes - the job may still complete on their side.");
    await sleep(wait, options.signal);
    wait = Math.min(max, Math.round(wait * 1.5));
  }
}

/** Runs `make` `count` times, two at a time, keeping order — for providers that draw one picture per call. */
export async function repeat<T>(count: number, make: (index: number) => Promise<T[]>): Promise<T[]> {
  const out: T[][] = [];
  for (let i = 0; i < count; i += 2) {
    const batch = await Promise.all([make(i), ...(i + 1 < count ? [make(i + 1)] : [])]);
    out.push(...batch);
  }
  return out.flat();
}

/* ------------------------------------------------------------------------- */
/* Sizes                                                                     */
/* ------------------------------------------------------------------------- */

const RATIO: Record<AspectRatio, [number, number]> = {
  "1:1": [1, 1],
  "3:2": [3, 2],
  "2:3": [2, 3],
  "4:3": [4, 3],
  "3:4": [3, 4],
  "16:9": [16, 9],
  "9:16": [9, 16],
};

export function ratioOf(aspect: AspectRatio): number {
  const [w, h] = RATIO[aspect];
  return w / h;
}

/**
 * Pixels for an aspect ratio at roughly `megapixels`, both edges a multiple
 * of `multiple` — what width/height APIs and diffusion models want. 1 MP and
 * 16 give 1024×1024, 1360×768 for 16:9, 1248×832 for 3:2.
 */
export function dimensions(aspect: AspectRatio, megapixels = 1, multiple = 16, maxEdge = 4096): { width: number; height: number } {
  const ratio = ratioOf(aspect);
  const area = megapixels * 1024 * 1024;
  const snap = (v: number) => Math.max(multiple, Math.min(maxEdge - (maxEdge % multiple), Math.round(v / multiple) * multiple));
  return { width: snap(Math.sqrt(area * ratio)), height: snap(Math.sqrt(area / ratio)) };
}

/** The entry of `allowed` ("WxH" strings) whose shape is closest to `aspect`; ties go to the larger picture. */
export function closestSize(aspect: AspectRatio, allowed: readonly string[]): string {
  const target = Math.log(ratioOf(aspect));
  let best = allowed[0];
  let bestScore = Infinity;
  let bestArea = 0;
  for (const size of allowed) {
    const [w, h] = size.split(/[x*]/).map(Number);
    if (!w || !h) continue;
    const score = Math.abs(Math.log(w / h) - target);
    if (score < bestScore - 1e-9 || (Math.abs(score - bestScore) < 1e-9 && w * h > bestArea)) {
      best = size;
      bestScore = score;
      bestArea = w * h;
    }
  }
  return best;
}

/** The entry of `allowed` ("16:9" strings) closest to `aspect` — for APIs whose ratio list is not ours. */
export function closestRatio(aspect: AspectRatio, allowed: readonly string[], separator = ":"): string {
  const target = Math.log(ratioOf(aspect));
  let best = allowed[0];
  let bestScore = Infinity;
  for (const entry of allowed) {
    const [w, h] = entry.split(separator).map(Number);
    if (!w || !h) continue;
    const score = Math.abs(Math.log(w / h) - target);
    if (score < bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
}

export function bearer(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key.trim()}` };
}

export function trimBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}
