/**
 * One language model for every tool.
 *
 * The contract every tool codes against: `llmStatus()` says whether a model
 * is usable right now and where it runs, `llmComplete()` / `llmJson()` ask it
 * something. Tools never pick a provider themselves — the person does, once,
 * in Settings → Intelligence — and every caller has to degrade gracefully when
 * `available` is false (show what you would have done, offer the Settings
 * link via `openIntelligenceSettings()`, never throw at the person).
 *
 * Providers, in the order "auto" tries them:
 *   local  — llama.cpp's server kept resident by Rust (`llm.rs`), a pinned
 *            GGUF under `<AppData>/llm/models`, spoken to over loopback as an
 *            OpenAI-compatible endpoint. Nothing leaves the machine.
 *   cloud  — the person's own Anthropic key or any OpenAI-compatible endpoint
 *            (OpenAI, OpenRouter, Ollama, LM Studio…). This *does* leave the
 *            machine and every request is logged in Settings → Privacy with
 *            its `purpose`.
 *
 * Settings live in one localStorage JSON (`LLM_SETTINGS_KEY`); `LLM_EVENT`
 * fires on every change so the pill window and the main window agree.
 *
 * Implementation notes: the status is cached for `STATUS_TTL_MS` because
 * several tools ask at once when a view opens, and it is invalidated on
 * `LLM_EVENT` (settings, an install finishing, a model removed). Rust does
 * the local HTTP, so the webview never talks to the server itself — no CSP
 * or plugin scope to widen. Cloud calls go through `cloudFetch` below.
 */

import { isTauri } from "./env";
import { logError, logInfo } from "./errors";
import { openSettings } from "./navigation";

export type LlmProvider = "local" | "anthropic" | "openai";

export interface LlmCloudSettings {
  provider: "anthropic" | "openai";
  apiKey: string;
  /** OpenAI-compatible base URL, e.g. https://api.openai.com/v1 or http://127.0.0.1:11434/v1 */
  baseUrl: string;
  model: string;
}

export interface LlmSettings {
  /**
   * auto  → local when a model is installed, else cloud when configured.
   * local → only the on-device model (cloud never used, even if configured).
   * cloud → only the configured cloud provider.
   * off   → no model; every tool shows its "set up a model" state.
   */
  prefer: "auto" | "local" | "cloud" | "off";
  cloud: LlmCloudSettings;
  local: {
    /** Catalogue id of the installed model to run (see `@feature-llm/models`). */
    model: string;
  };
}

export interface LlmStatus {
  available: boolean;
  provider: LlmProvider | null;
  /** Model name as the provider knows it (catalogue id for local). */
  model: string | null;
  /** Why it is unavailable, in words a person can act on. */
  reason?: string;
  local: {
    runtime: boolean;
    model: boolean;
    server: "off" | "loading" | "ready";
    installing: boolean;
  };
}

export interface LlmRequest {
  system?: string;
  prompt: string;
  maxTokens?: number;
  /** 0–1; defaults to 0.3 (these are editing jobs, not creative writing). */
  temperature?: number;
  /** Ask the model for one JSON value and nothing else. */
  json?: boolean;
  signal?: AbortSignal;
  /**
   * What this is for, in a few words — "meeting summary", "post variants",
   * "video chapters". It is the line the privacy log shows when the request
   * leaves the machine, so write it for the person, not the developer.
   */
  purpose: string;
}

export const LLM_SETTINGS_KEY = "owntools-llm-settings";
export const LLM_EVENT = "owntools:llm-changed";

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  prefer: "auto",
  cloud: { provider: "anthropic", apiKey: "", baseUrl: "", model: "" },
  local: { model: "" },
};

/** What a cloud provider gets when the model field is left empty. */
export const DEFAULT_CLOUD_MODELS: Record<LlmCloudSettings["provider"], string> = {
  anthropic: "claude-opus-5",
  openai: "gpt-4.1-mini",
};

export class LlmUnavailable extends Error {
  constructor(public readonly status: LlmStatus) {
    super(status.reason ?? "No language model is set up yet.");
    this.name = "LlmUnavailable";
  }
}

/* ------------------------------------------------------------------------- */
/* Settings                                                                  */
/* ------------------------------------------------------------------------- */

export function llmSettings(): LlmSettings {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(LLM_SETTINGS_KEY);
    if (!raw) return DEFAULT_LLM_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<LlmSettings>;
    return {
      ...DEFAULT_LLM_SETTINGS,
      ...parsed,
      cloud: { ...DEFAULT_LLM_SETTINGS.cloud, ...(parsed.cloud ?? {}) },
      local: { ...DEFAULT_LLM_SETTINGS.local, ...(parsed.local ?? {}) },
    };
  } catch {
    return DEFAULT_LLM_SETTINGS;
  }
}

export function setLlmSettings(patch: Partial<LlmSettings>): LlmSettings {
  const current = llmSettings();
  const next: LlmSettings = {
    ...current,
    ...patch,
    cloud: { ...current.cloud, ...(patch.cloud ?? {}) },
    local: { ...current.local, ...(patch.local ?? {}) },
  };
  try {
    localStorage.setItem(LLM_SETTINGS_KEY, JSON.stringify(next));
  } catch {
    /* private mode / tests */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(LLM_EVENT));
  return next;
}

/** Fires on a settings change in this window and on a `storage` event from another. */
export function onLlmChange(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === LLM_SETTINGS_KEY) cb();
  };
  window.addEventListener(LLM_EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(LLM_EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Tells every window that something about the model changed without a
 * settings write — an install finished, a model was removed. Same event as
 * a settings change, so one subscription covers both.
 */
export function notifyLlmChange(): void {
  invalidateLlmStatus();
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(LLM_EVENT));
}

/** A cloud block counts as configured when it can be called at all. */
export function cloudConfigured(cloud: LlmCloudSettings): boolean {
  if (cloud.provider === "anthropic") return Boolean(cloud.apiKey.trim());
  // Local OpenAI-compatible servers (Ollama, LM Studio) often need no key.
  return Boolean(cloud.baseUrl.trim());
}

/* ------------------------------------------------------------------------- */
/* What Rust reports                                                         */
/* ------------------------------------------------------------------------- */

/** Mirrors `LlmBackendStatus` in `src-tauri/src/llm.rs`. */
export interface LlmBackendStatus {
  runtime: boolean;
  models: { id: string; installed: boolean; bytes: number }[];
  server: "off" | "loading" | "ready";
  serverModel: string | null;
  dir: string;
  /** `std::env::consts::ARCH`: "x86_64" / "aarch64". */
  arch: string;
}

/** Mirrors `CompleteResult` in `src-tauri/src/llm.rs`. */
export interface LlmLocalResult {
  text: string;
  ms: number;
  loadMs: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
  warm: boolean;
}

/** Raw backend status; `null` outside the desktop app or when Rust fails. */
export async function llmBackendStatus(): Promise<LlmBackendStatus | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<LlmBackendStatus>("llm_status");
  } catch (err) {
    logError("llm", "status", err);
    return null;
  }
}

/* ------------------------------------------------------------------------- */
/* Status                                                                    */
/* ------------------------------------------------------------------------- */

const STATUS_TTL_MS = 2000;
let cached: { at: number; status: LlmStatus } | null = null;
let inflight: Promise<LlmStatus> | null = null;
let lastStatus: LlmStatus | null = null;
let installing = false;

/** Forget the cached status; the next `llmStatus()` asks Rust again. */
export function invalidateLlmStatus(): void {
  cached = null;
}

/**
 * The most recent status without waiting — for a render that cannot be
 * async (a button's disabled state). `null` before the first `llmStatus()`.
 */
export function lastKnownLlmStatus(): LlmStatus | null {
  return lastStatus;
}

/** The install session (feature-llm) flags a download in progress here. */
export function setLlmInstalling(on: boolean): void {
  if (installing === on) return;
  installing = on;
  notifyLlmChange();
}

/** The local model that would run: the chosen one when installed, else the first installed. */
export function localModelFor(settings: LlmSettings, backend: LlmBackendStatus | null): string | null {
  if (!backend) return null;
  const installed = backend.models.filter((m) => m.installed).map((m) => m.id);
  if (settings.local.model && installed.includes(settings.local.model)) return settings.local.model;
  return installed[0] ?? null;
}

const SETTINGS_HINT = "Settings → Intelligence";

/**
 * Pure: settings + what Rust reports → the status every tool sees. Exported
 * so the resolution rules are tested without a backend.
 */
export function resolveLlmStatus(
  settings: LlmSettings,
  backend: LlmBackendStatus | null,
  options: { installing?: boolean; inApp?: boolean } = {},
): LlmStatus {
  const inApp = options.inApp ?? backend !== null;
  const localModel = backend?.runtime ? localModelFor(settings, backend) : null;
  const local: LlmStatus["local"] = {
    runtime: Boolean(backend?.runtime),
    model: localModel !== null,
    server: backend?.server ?? "off",
    installing: Boolean(options.installing),
  };
  const cloudOk = cloudConfigured(settings.cloud);
  const cloudModel = settings.cloud.model.trim() || DEFAULT_CLOUD_MODELS[settings.cloud.provider];

  const unavailable = (reason: string): LlmStatus => ({ available: false, provider: null, model: null, reason, local });
  const asLocal = (): LlmStatus => ({ available: true, provider: "local", model: localModel, local });
  const asCloud = (): LlmStatus => ({ available: true, provider: settings.cloud.provider, model: cloudModel, local });

  const localReason = !inApp
    ? `On-device models run in the desktop app. Add a cloud key in ${SETTINGS_HINT} to use one here.`
    : local.installing
      ? "The model is still downloading — it will be ready the moment the download finishes."
      : `No on-device model yet — install one in ${SETTINGS_HINT} (one download, then it runs offline).`;
  const cloudReason = `Add an API key for a cloud provider in ${SETTINGS_HINT}.`;

  switch (settings.prefer) {
    case "off":
      return unavailable(`The language model is switched off in ${SETTINGS_HINT}.`);
    case "local":
      return localModel ? asLocal() : unavailable(localReason);
    case "cloud":
      return cloudOk ? asCloud() : unavailable(cloudReason);
    default:
      if (localModel) return asLocal();
      if (cloudOk) return asCloud();
      return unavailable(localReason);
  }
}

export async function llmStatus(): Promise<LlmStatus> {
  if (cached && Date.now() - cached.at < STATUS_TTL_MS) return cached.status;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const backend = await llmBackendStatus();
      const status = resolveLlmStatus(llmSettings(), backend, { installing, inApp: isTauri() });
      cached = { at: Date.now(), status };
      lastStatus = status;
      return status;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/* ------------------------------------------------------------------------- */
/* Completion                                                                */
/* ------------------------------------------------------------------------- */

export interface LlmTiming {
  provider: LlmProvider;
  model: string;
  /** Wall-clock milliseconds for the whole answer. */
  ms: number;
  /** Local only: how much of `ms` was loading the model (0 when resident). */
  loadMs: number;
  completionTokens: number | null;
  purpose: string;
  at: number;
}

let lastTiming: LlmTiming | null = null;

/** What the last answer cost, so the Settings card can print a real number. */
export function lastLlmTiming(): LlmTiming | null {
  return lastTiming;
}

function abortError(): Error {
  return typeof DOMException !== "undefined"
    ? new DOMException("The request was cancelled.", "AbortError")
    : Object.assign(new Error("The request was cancelled."), { name: "AbortError" });
}

/** Rejects as soon as `signal` aborts; the underlying work may still finish on its own. */
function withAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export async function llmComplete(req: LlmRequest): Promise<string> {
  const status = await llmStatus();
  if (!status.available || !status.provider || !status.model) throw new LlmUnavailable(status);
  if (req.signal?.aborted) throw abortError();
  const started = Date.now();
  try {
    const answer =
      status.provider === "local"
        ? await completeLocal(status.model, req)
        : await completeCloud(llmSettings().cloud, status.model, req);
    lastTiming = {
      provider: status.provider,
      model: status.model,
      ms: Date.now() - started,
      loadMs: answer.loadMs,
      completionTokens: answer.completionTokens,
      purpose: req.purpose,
      at: Date.now(),
    };
    logInfo(
      "llm",
      `${req.purpose}: ${status.provider} · ${status.model} · ${lastTiming.ms} ms${
        answer.completionTokens !== null ? ` · ${answer.completionTokens} tokens` : ""
      }`,
    );
    return answer.text;
  } catch (err) {
    if (!(err instanceof Error && err.name === "AbortError")) logError("llm", req.purpose, err);
    throw err;
  }
}

interface Answer {
  text: string;
  loadMs: number;
  completionTokens: number | null;
}

function chatMessages(req: LlmRequest): { role: string; content: string }[] {
  const messages: { role: string; content: string }[] = [];
  if (req.system?.trim()) messages.push({ role: "system", content: req.system.trim() });
  messages.push({ role: "user", content: req.prompt });
  return messages;
}

async function completeLocal(model: string, req: LlmRequest): Promise<Answer> {
  const { invoke } = await import("@tauri-apps/api/core");
  const call = invoke<LlmLocalResult>("llm_complete", {
    request: {
      model,
      messages: chatMessages(req),
      maxTokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.3,
      json: Boolean(req.json),
    },
  });
  const result = await withAbort(call, req.signal);
  return { text: result.text.trim(), loadMs: result.loadMs, completionTokens: result.completionTokens ?? null };
}

/**
 * Loads the on-device model ahead of a request, so the first answer of a
 * tool that is about to need it does not also pay the load. No-op when the
 * active provider is not local.
 */
export async function warmUpLlm(): Promise<void> {
  const status = await llmStatus();
  if (status.provider !== "local" || !status.model || !isTauri()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("llm_ensure_server", { model: status.model });
    invalidateLlmStatus();
  } catch (err) {
    logError("llm", "warm-up", err);
  }
}

/* ------------------------------------------------------------------------- */
/* Cloud                                                                     */
/* ------------------------------------------------------------------------- */

/**
 * Every cloud request leaves through here so it can be logged and refused
 * in Offline mode.
 *
 * TODO(@core/net): switch to `trackedFetch(url, { ...init, purpose })` from
 * `packages/core/src/net.ts` (privacy agent) once it lands — until then the
 * Tauri HTTP plugin (no CORS, capability-scoped) does the request and
 * `purpose` is carried for the log line only.
 */
async function cloudFetch(url: string, init: RequestInit, purpose: string): Promise<Response> {
  void purpose;
  if (isTauri()) {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return tauriFetch(url, init);
  }
  return fetch(url, init);
}

/** Error text for a failed response — the JSON `error`/`message` when there is one. */
async function describeResponse(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const candidates = [
      j.message,
      j.error,
      j.detail,
      (j.error as { message?: string } | undefined)?.message,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) return `${res.status}: ${c.trim().slice(0, 300)}`;
    }
  } catch {
    /* not JSON */
  }
  const short = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return short ? `${res.status}: ${short}` : `HTTP ${res.status}`;
}

const JSON_ONLY = "Answer with a single JSON value and nothing else — no prose, no code fence.";

async function completeCloud(cloud: LlmCloudSettings, model: string, req: LlmRequest): Promise<Answer> {
  const text =
    cloud.provider === "anthropic" ? await anthropicComplete(cloud, model, req) : await openaiComplete(cloud, model, req);
  return { text: text.trim(), loadMs: 0, completionTokens: null };
}

/**
 * Anthropic Messages API, raw HTTP on purpose: the request has to travel
 * through the Tauri fetch (and later the privacy log), which the SDK's own
 * transport does not. Current Opus-tier models reject `temperature`, so it
 * is not sent; thinking stays at the model's default.
 */
async function anthropicComplete(cloud: LlmCloudSettings, model: string, req: LlmRequest): Promise<string> {
  const system = [req.system?.trim(), req.json ? JSON_ONLY : ""].filter(Boolean).join("\n\n");
  const res = await cloudFetch(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": cloud.apiKey.trim(),
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: req.maxTokens ?? 1024,
        ...(system ? { system } : {}),
        messages: [{ role: "user", content: req.prompt }],
      }),
      signal: req.signal,
    },
    req.purpose,
  );
  if (!res.ok) throw new Error(`Anthropic ${await describeResponse(res)}`);
  const data = (await res.json()) as {
    content?: { type: string; text?: string }[];
    stop_reason?: string;
    stop_details?: { explanation?: string } | null;
  };
  if (data.stop_reason === "refusal") {
    throw new Error(data.stop_details?.explanation?.trim() || "The model declined this request.");
  }
  return (data.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
}

/** Any OpenAI-compatible `/chat/completions`: OpenAI, OpenRouter, Ollama, LM Studio… */
async function openaiComplete(cloud: LlmCloudSettings, model: string, req: LlmRequest): Promise<string> {
  const base = cloud.baseUrl.trim().replace(/\/+$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cloud.apiKey.trim()) headers.Authorization = `Bearer ${cloud.apiKey.trim()}`;
  const messages = chatMessages(req.json ? { ...req, system: [req.system?.trim(), JSON_ONLY].filter(Boolean).join("\n\n") } : req);
  const res = await cloudFetch(
    `${base}/chat/completions`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        max_tokens: req.maxTokens ?? 1024,
        temperature: req.temperature ?? 0.3,
        messages,
        ...(req.json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: req.signal,
    },
    req.purpose,
  );
  if (!res.ok) throw new Error(`AI endpoint ${await describeResponse(res)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return stripThink(data.choices?.[0]?.message?.content ?? "").trim();
}

/** A "thinking" model behind an OpenAI-compatible endpoint may narrate first; drop it. */
export function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/<think>[\s\S]*$/, "").trim();
}

/* ------------------------------------------------------------------------- */
/* JSON                                                                      */
/* ------------------------------------------------------------------------- */

/**
 * `llmComplete` with `json: true`, parsed and checked by `guard`. One retry
 * with the parse error fed back, then it throws — callers decide what a
 * missing summary means for them.
 */
export async function llmJson<T>(req: LlmRequest, guard: (v: unknown) => v is T): Promise<T> {
  const first = await llmComplete({ ...req, json: true });
  const value = parseLooseJson(first);
  if (guard(value)) return value;
  const why = value === null ? "it was not valid JSON" : "it did not have the shape that was asked for";
  const second = await llmComplete({
    ...req,
    json: true,
    prompt: `${req.prompt}\n\nYour previous answer could not be used (${why}). Answer again with only the JSON value asked for.`,
  });
  const retry = parseLooseJson(second);
  if (guard(retry)) return retry;
  throw new Error("The model answered with something other than the JSON asked for.");
}

/** Pulls the first JSON object/array out of an answer that may be wrapped in prose or a code fence. */
export function parseLooseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.search(/[[{]/);
    if (start < 0) return null;
    const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/**
 * Rough token estimate for chunking long transcripts before a summary:
 * ~4 characters per token for English, closer to 3 for Polish. Deliberately
 * pessimistic.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.2);
}

/**
 * Splits `text` into chunks under `maxTokens`, on paragraph then sentence
 * boundaries, so a map-reduce summary never cuts a sentence in half.
 */
export function chunkForModel(text: string, maxTokens = 3000): string[] {
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";
  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };
  for (const p of paragraphs) {
    if (estimateTokens(current + "\n\n" + p) <= maxTokens) {
      current = current ? `${current}\n\n${p}` : p;
      continue;
    }
    push();
    if (estimateTokens(p) <= maxTokens) {
      current = p;
      continue;
    }
    // One paragraph larger than the budget: split on sentences.
    for (const s of p.split(/(?<=[.!?…])\s+/)) {
      if (estimateTokens(current + " " + s) > maxTokens) push();
      current = current ? `${current} ${s}` : s;
    }
  }
  push();
  return chunks;
}

/* ------------------------------------------------------------------------- */
/* Navigation                                                                */
/* ------------------------------------------------------------------------- */

// The event lives in ./navigation with the rest of the shell's jumps; it is
// re-exported here because the model card's callers already import it from llm.
export { OPEN_SETTINGS_SECTION_EVENT } from "./navigation";

/**
 * Takes the person to Settings → Intelligence (the model card). In another
 * window (the pill) the event goes nowhere, so callers there should say
 * "open owntools → Settings".
 */
export function openIntelligenceSettings(): void {
  openSettings("intelligence");
}

// A settings write anywhere (this window or another) makes the cached
// status stale: forget it, the next asker gets a fresh one.
onLlmChange(invalidateLlmStatus);
