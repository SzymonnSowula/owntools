/**
 * The one door out of the machine.
 *
 * "Never phones home" is only worth saying if the person can check it, so
 * every HTTP request the app makes goes through `trackedFetch`: it performs
 * the request (Tauri's HTTP plugin in the app, `window.fetch` in the browser
 * preview), writes one line about it to the network log behind Settings →
 * Privacy (`net_log` in Rust, an in-memory list outside Tauri), and refuses
 * to send anything non-local while Offline mode is on.
 *
 * What is logged is *about* the request, never its contents: host, method,
 * payload size, answer size, status, and the `purpose` the caller wrote for
 * the person ("post to Bluesky", "YouTube transcript", "meeting summary").
 * Loopback and private-LAN hosts are `kind: "local"` — the local model
 * server, sherpa-onnx, an Ollama on the desk — and never count as "left
 * this machine".
 *
 * Offline mode is one flag file in Rust (`<AppData>/privacy/offline`, read by
 * `download_file` too); the localStorage key here is a mirror so the check
 * before a request is synchronous, and `syncOfflineMode()` reconciles it at
 * start-up. Rust egress (`downloader.rs`) records through `netlog::record`
 * itself; the updater plugin's traffic is noted from `shell/updater.ts` with
 * `noteRequest`.
 */
import { isTauri } from "./env";

export type NetKind = "cloud" | "local";

export interface NetEntry {
  /** Epoch milliseconds, stamped when the request was sent. */
  ts: number;
  host: string;
  method: string;
  /** Request payload in bytes when the body's size is knowable; null for a stream. */
  bytesOut: number | null;
  /** Content-Length of the answer; null when the server did not say. */
  bytesIn: number | null;
  /** What it was for, in the person's words. */
  purpose: string;
  ok: boolean;
  /** HTTP status; null when no answer arrived or the layer did not report one. */
  status: number | null;
  kind: NetKind;
}

export interface NetInit extends RequestInit {
  /** What this request is for — the line the Privacy card shows. */
  purpose: string;
  /**
   * Where the request really goes when `input` is a relay (the dev server's
   * `/__proxy?url=`). Logged instead of `input`'s host.
   */
  destination?: string | URL;
}

/** Thrown before a non-local request is sent while Offline mode is on. */
export class OfflineMode extends Error {
  readonly purpose: string;
  constructor(purpose: string) {
    super(`Offline mode is on — '${purpose}' was not sent.`);
    this.name = "OfflineMode";
    this.purpose = purpose;
  }
}

export function isOfflineMode(err: unknown): err is OfflineMode {
  return err instanceof OfflineMode || (err instanceof Error && err.name === "OfflineMode");
}

/** localStorage mirror of the Rust flag file — read synchronously before every request. */
export const OFFLINE_KEY = "owntools-offline";
/** Fired in this window when Offline mode flips (other windows see the `storage` event). */
export const OFFLINE_EVENT = "owntools:offline-changed";
/** Fired in this window after a request was noted (the Privacy card refreshes on it). */
export const NET_LOG_EVENT = "owntools:net-log";

/* ------------------------------------------------------------------------- */
/* Classification                                                            */
/* ------------------------------------------------------------------------- */

function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function parseV4(host: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number) as [number, number, number, number];
  return parts.every((n) => n <= 255) ? parts : null;
}

/** localhost, *.localhost, 127/8, ::1 — the machine talking to itself. */
export function isLoopback(url: URL): boolean {
  const host = hostOf(url);
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "::" || host === "0.0.0.0") return true;
  const v4 = parseV4(host);
  return v4 !== null && v4[0] === 127;
}

/** 10/8, 172.16/12, 192.168/16, 169.254/16, fc00::/7, fe80::/10 — a device on the same desk, not a cloud. */
export function isPrivateNetwork(url: URL): boolean {
  const host = hostOf(url);
  const v4 = parseV4(host);
  if (v4) {
    const [a, b] = v4;
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  return /^f[cd][0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host);
}

export function classify(url: URL): NetKind {
  return isLoopback(url) || isPrivateNetwork(url) ? "local" : "cloud";
}

function resolveUrl(input: string | URL): URL | null {
  if (input instanceof URL) return input;
  try {
    return new URL(input, typeof location !== "undefined" ? location.href : undefined);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------- */
/* Sizes                                                                     */
/* ------------------------------------------------------------------------- */

function utf8Length(s: string): number {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s).byteLength;
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i += 1;
    } else n += 3;
  }
  return n;
}

/**
 * Payload bytes of a request body — what the person typed, uploaded or
 * posted; not the wire size with headers. Null for a stream, whose length is
 * unknowable up front.
 */
export function bodySize(body: BodyInit | null | undefined): number | null {
  if (body == null) return 0;
  if (typeof body === "string") return utf8Length(body);
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return utf8Length(body.toString());
  if (typeof Blob !== "undefined" && body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    let n = 0;
    for (const [name, value] of body.entries()) {
      n += utf8Length(name);
      n += typeof value === "string" ? utf8Length(value) : value.size;
    }
    return n;
  }
  return null;
}

function contentLength(res: Response): number | null {
  const raw = res.headers.get("content-length");
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/* ------------------------------------------------------------------------- */
/* Offline mode                                                              */
/* ------------------------------------------------------------------------- */

let offlineCache: boolean | null = null;
let watchingStorage = false;
let blockedCount = 0;

function readMirror(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(OFFLINE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeMirror(on: boolean): void {
  try {
    localStorage.setItem(OFFLINE_KEY, on ? "1" : "0");
  } catch {
    /* private mode / tests */
  }
}

/** Another window (the pill) may flip the flag; follow the mirror so the cache never goes stale. */
function watchStorage(): void {
  if (watchingStorage || typeof window === "undefined") return;
  watchingStorage = true;
  window.addEventListener("storage", (e) => {
    if (e.key === null || e.key === OFFLINE_KEY) offlineCache = readMirror();
  });
}

/** Synchronous: the mirror, cached. The Rust flag file is the source of truth (`syncOfflineMode`). */
export function offlineMode(): boolean {
  watchStorage();
  if (offlineCache === null) offlineCache = readMirror();
  return offlineCache;
}

function applyOffline(on: boolean): void {
  const changed = offlineCache !== on;
  offlineCache = on;
  writeMirror(on);
  if (changed && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(OFFLINE_EVENT, { detail: { on } }));
  }
}

export async function setOfflineMode(on: boolean): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("privacy_offline_set", { on });
  }
  applyOffline(on);
}

/**
 * Reconciles the cached flag with Rust's flag file. Call once at start-up
 * (App.tsx) and whenever the Privacy card mounts; a no-op outside Tauri.
 */
export async function syncOfflineMode(): Promise<boolean> {
  if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      applyOffline(await invoke<boolean>("privacy_offline_get"));
    } catch (err) {
      console.warn("[net] could not read the offline flag", err);
    }
  }
  return offlineMode();
}

export function onOfflineChange(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === OFFLINE_KEY) {
      offlineCache = readMirror();
      cb();
    }
  };
  window.addEventListener(OFFLINE_EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(OFFLINE_EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** Requests Offline mode refused since this window started. */
export function offlineBlockedCount(): number {
  return blockedCount;
}

/* ------------------------------------------------------------------------- */
/* Recording                                                                 */
/* ------------------------------------------------------------------------- */

const MEMORY_LIMIT = 1000;
const memoryLog: NetEntry[] = [];
let warnedLog = false;

/** This window's entries, oldest first — the whole log outside Tauri, a bounded echo inside it. */
export function memoryEntries(): readonly NetEntry[] {
  return memoryLog;
}

export function clearMemoryLog(): void {
  memoryLog.length = 0;
}

function emitLogEvent(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(NET_LOG_EVENT));
}

export type NoteInput = Omit<NetEntry, "ts" | "kind"> & { ts?: number; kind?: NetKind };

/**
 * Writes one line to the network log. Fire-and-forget: never blocks or fails
 * the request it describes. For traffic the app did not send through
 * `trackedFetch` itself (the updater plugin); `trackedFetch` calls it too.
 */
export function noteRequest(input: NoteInput): NetEntry {
  const kind = input.kind ?? classify(resolveUrl(`https://${input.host}`) ?? new URL("https://cloud.invalid"));
  const entry: NetEntry = {
    ts: input.ts ?? Date.now(),
    host: input.host,
    method: input.method.toUpperCase(),
    bytesOut: input.bytesOut,
    bytesIn: input.bytesIn,
    purpose: input.purpose,
    ok: input.ok,
    status: input.status,
    kind,
  };
  memoryLog.push(entry);
  if (memoryLog.length > MEMORY_LIMIT) memoryLog.splice(0, memoryLog.length - MEMORY_LIMIT);
  if (isTauri()) {
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("net_log", { entry }))
      .catch((err) => {
        if (!warnedLog) {
          warnedLog = true;
          console.warn("[net] could not write the network log", err);
        }
      })
      .finally(emitLogEvent);
  } else {
    emitLogEvent();
  }
  return entry;
}

/** Prefer this over `onOfflineChange` when a view shows the log itself: fires after every noted request. */
export function onNetLog(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(NET_LOG_EVENT, cb);
  return () => window.removeEventListener(NET_LOG_EVENT, cb);
}

/* ------------------------------------------------------------------------- */
/* The fetch                                                                 */
/* ------------------------------------------------------------------------- */

async function performFetch(input: string | URL, init: RequestInit): Promise<Response> {
  if (isTauri()) {
    // The plugin does the request natively: no CORS, no CSP, and a caller
    // that passes `Origin: ""` gets none sent at all (plugin built with
    // `unsafe-headers`; YouTube refuses any foreign Origin).
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return tauriFetch(input, init);
  }
  return globalThis.fetch(input, init);
}

/**
 * `fetch` with a purpose. Throws `OfflineMode` *before* sending when the
 * target is not local and Offline mode is on; otherwise performs the request
 * and notes it — including a request that never got an answer (`ok: false`,
 * `status: null`), because it did leave.
 */
export async function trackedFetch(input: string | URL, init: NetInit): Promise<Response> {
  const { purpose, destination, ...rest } = init;
  const target = resolveUrl(destination ?? input);
  const kind: NetKind = target ? classify(target) : "cloud";
  const host = target ? hostOf(target) : String(destination ?? input);
  if (kind === "cloud" && offlineMode()) {
    blockedCount += 1;
    emitLogEvent();
    throw new OfflineMode(purpose);
  }
  const method = (rest.method ?? "GET").toUpperCase();
  const bytesOut = bodySize(rest.body);
  const ts = Date.now();
  let res: Response;
  try {
    res = await performFetch(input, rest);
  } catch (err) {
    noteRequest({ ts, host, method, bytesOut, bytesIn: null, purpose, ok: false, status: null, kind });
    throw err;
  }
  noteRequest({ ts, host, method, bytesOut, bytesIn: contentLength(res), purpose, ok: res.ok, status: res.status, kind });
  return res;
}

/* ------------------------------------------------------------------------- */
/* Summaries (the TS twin of netlog.rs, for the browser preview and tests)   */
/* ------------------------------------------------------------------------- */

export interface HostRow {
  host: string;
  purpose: string;
  kind: NetKind;
  requests: number;
  failed: number;
  bytesOut: number;
  bytesIn: number;
  /** Requests whose answer size the server did not state. */
  unknownIn: number;
  /** Epoch ms of the newest request in the row. */
  last: number;
}

export interface NetSummary {
  /** "YYYY-MM" in local time. */
  month: string;
  /** Headline: requests that left this machine (cloud only). */
  requests: number;
  bytesOut: number;
  bytesIn: number;
  unknownIn: number;
  cloudRequests: number;
  localRequests: number;
  failed: number;
  /** Cloud rows, biggest first. */
  byHost: HostRow[];
  /** Loopback / LAN rows — stayed on this machine. */
  local: HostRow[];
}

/** "YYYY-MM" of an epoch-ms timestamp in local time — the month the person's calendar shows. */
export function monthOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** `shiftMonth("2026-01", -1)` → "2025-12". */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, (m ?? 1) - 1 + by, 1);
  return monthOf(d.getTime());
}

function rowSort(a: HostRow, b: HostRow): number {
  return b.bytesOut + b.bytesIn - (a.bytesOut + a.bytesIn) || b.requests - a.requests || a.host.localeCompare(b.host);
}

export function summarize(entries: readonly NetEntry[], month: string): NetSummary {
  const rows = new Map<string, HostRow>();
  const out: NetSummary = {
    month,
    requests: 0,
    bytesOut: 0,
    bytesIn: 0,
    unknownIn: 0,
    cloudRequests: 0,
    localRequests: 0,
    failed: 0,
    byHost: [],
    local: [],
  };
  for (const e of entries) {
    if (monthOf(e.ts) !== month) continue;
    const key = `${e.kind} ${e.host} ${e.purpose}`;
    let row = rows.get(key);
    if (!row) {
      row = { host: e.host, purpose: e.purpose, kind: e.kind, requests: 0, failed: 0, bytesOut: 0, bytesIn: 0, unknownIn: 0, last: 0 };
      rows.set(key, row);
    }
    row.requests += 1;
    if (!e.ok) row.failed += 1;
    row.bytesOut += e.bytesOut ?? 0;
    if (e.bytesIn === null) row.unknownIn += 1;
    else row.bytesIn += e.bytesIn;
    row.last = Math.max(row.last, e.ts);
    if (e.kind === "local") {
      out.localRequests += 1;
      continue;
    }
    out.requests += 1;
    out.cloudRequests += 1;
    out.bytesOut += e.bytesOut ?? 0;
    if (e.bytesIn === null) out.unknownIn += 1;
    else out.bytesIn += e.bytesIn;
    if (!e.ok) out.failed += 1;
  }
  for (const row of rows.values()) (row.kind === "local" ? out.local : out.byHost).push(row);
  out.byHost.sort(rowSort);
  out.local.sort(rowSort);
  return out;
}
