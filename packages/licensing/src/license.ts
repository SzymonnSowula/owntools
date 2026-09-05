import { isTauri } from "@core/env";

/**
 * Offline license keys. The key is a few bytes the user paid for, so it is not
 * allowed to live only in WebView2's localStorage — clearing site data (or a
 * WebView2 reinstall) must not revoke a purchase. In the desktop app the Tauri
 * store `license.json` is the source of truth; localStorage keeps a copy so the
 * browser preview and any code that runs before `initLicense()` still work.
 */

const STORAGE_KEY = "screeni-license";
const STORE_FILE = "license.json";
const STORE_KEY = "key";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Offline license key: SCRN-XXXXX-XXXXX-XXXXX where the last character is a
 * checksum over the preceding 14 payload characters. Keys are issued by the
 * store after purchase; this only has to keep honest people honest.
 */
export function isValidLicenseKey(raw: string): boolean {
  const key = raw.trim().toUpperCase();
  const match = /^SCRN-([A-Z2-9]{5})-([A-Z2-9]{5})-([A-Z2-9]{5})$/.exec(key);
  if (!match) return false;
  const payload = (match[1] + match[2] + match[3]).split("");
  const check = payload.pop()!;
  let sum = 0;
  payload.forEach((ch, i) => {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) sum = -1e9;
    sum += v * (i % 2 === 0 ? 3 : 7);
  });
  if (sum < 0) return false;
  return ALPHABET[sum % ALPHABET.length] === check;
}

function normalize(raw: string): string {
  return raw.trim().toUpperCase();
}

/* ------------------------------------------------------------------ */
/* Cache + listeners                                                    */
/* ------------------------------------------------------------------ */

/** `undefined` = nothing loaded yet; `null` = loaded, no license. */
let cached: string | null | undefined;
let initPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function setCached(next: string | null): void {
  const prev = cached ?? null;
  cached = next;
  if (prev === next) return;
  for (const cb of Array.from(listeners)) {
    try {
      cb();
    } catch {
      /* a broken listener must not take the others down */
    }
  }
}

/**
 * Populate the cache from localStorage so early/browser callers get an answer,
 * and kick off the real load so the store gets consulted even if nobody called
 * `initLicense()` yet (listeners hear about any difference).
 */
function ensureCache(): void {
  if (cached !== undefined) return;
  cached = readLocal();
  void initLicense();
}

/* ------------------------------------------------------------------ */
/* Backends                                                             */
/* ------------------------------------------------------------------ */

function readLocal(): string | null {
  try {
    const key = localStorage.getItem(STORAGE_KEY);
    return key && isValidLicenseKey(key) ? normalize(key) : null;
  } catch {
    return null;
  }
}

function writeLocal(key: string | null): boolean {
  try {
    if (key) localStorage.setItem(STORAGE_KEY, key);
    else localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

interface LicenseStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  save(): Promise<void>;
}

let lazyStore: LicenseStore | null = null;

async function tauriStore(): Promise<LicenseStore | null> {
  if (!isTauri()) return null;
  if (lazyStore) return lazyStore;
  try {
    const { LazyStore } = await import("@tauri-apps/plugin-store");
    lazyStore = new LazyStore(STORE_FILE);
    return lazyStore;
  } catch {
    return null;
  }
}

async function readStore(store: LicenseStore): Promise<string | null> {
  try {
    const raw = await store.get<unknown>(STORE_KEY);
    return typeof raw === "string" && isValidLicenseKey(raw) ? normalize(raw) : null;
  } catch {
    return null;
  }
}

async function writeStore(store: LicenseStore, key: string | null): Promise<boolean> {
  try {
    if (key) await store.set(STORE_KEY, key);
    else await store.delete(STORE_KEY);
    await store.save();
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                           */
/* ------------------------------------------------------------------ */

/**
 * Load the license once at startup. Order: Tauri store → (migrate from)
 * localStorage → none. Safe to call more than once; later calls share the
 * first load. Never rejects — the cache falls back to localStorage.
 */
export function initLicense(): Promise<void> {
  if (!initPromise) {
    initPromise = loadLicense().catch(() => {
      ensureCache();
    });
  }
  return initPromise;
}

async function loadLicense(): Promise<void> {
  const local = readLocal();
  const store = await tauriStore();
  if (!store) {
    setCached(local);
    return;
  }
  const fromStore = await readStore(store);
  if (fromStore) {
    // Store wins; keep the localStorage mirror in step for the fallback path.
    if (local !== fromStore) writeLocal(fromStore);
    setCached(fromStore);
    return;
  }
  if (local) {
    // Pre-store install: the key only ever lived in localStorage. Move it over.
    await writeStore(store, local);
    setCached(local);
    return;
  }
  setCached(null);
}

/** Sync — answers from the cache (lazily seeded from localStorage). */
export function getLicense(): string | null {
  ensureCache();
  return cached ?? null;
}

/** Sync — true when a valid key is cached. */
export function isPro(): boolean {
  return getLicense() !== null;
}

/**
 * Validate and persist a key. Resolves true when the key is valid and at least
 * one backend accepted it; listeners fire before it resolves.
 */
export async function activateLicense(key: string): Promise<boolean> {
  if (!isValidLicenseKey(key)) return false;
  const normalized = normalize(key);
  const store = await tauriStore();
  const storeOk = store ? await writeStore(store, normalized) : false;
  const localOk = writeLocal(normalized);
  if (!storeOk && !localOk) return false;
  setCached(normalized);
  return true;
}

/** Remove the key from every backend and drop to Free. */
export async function deactivateLicense(): Promise<void> {
  const store = await tauriStore();
  if (store) await writeStore(store, null);
  writeLocal(null);
  setCached(null);
}

/** Subscribe to activations/deactivations (and the async initial load). */
export function onLicenseChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * `SCRN-AB3F4-QWERT-ZXC89` → `SCRN-AB3F4-•••••-•••89`: the prefix and first
 * payload group identify the key well enough for support, the last two
 * characters confirm it is the one you meant, the rest stays off-screen.
 */
export function maskLicenseKey(key: string): string {
  const k = normalize(key);
  const groups = k.split("-");
  if (groups.length >= 3) {
    const head = groups.slice(0, 2);
    const rest = groups.slice(2);
    const masked = rest.map((g, i) => {
      if (i < rest.length - 1) return "•".repeat(g.length);
      const keep = Math.min(2, g.length);
      return "•".repeat(g.length - keep) + g.slice(g.length - keep);
    });
    return [...head, ...masked].join("-");
  }
  if (k.length <= 6) return k;
  return `${k.slice(0, 4)}${"•".repeat(k.length - 6)}${k.slice(-2)}`;
}
