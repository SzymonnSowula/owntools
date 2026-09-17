import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { isTauri } from "@core/env";

/**
 * Offline license keys. The key is a few bytes the user paid for, so it is not
 * allowed to live only in WebView2's localStorage — clearing site data (or a
 * WebView2 reinstall) must not revoke a purchase. In the desktop app the Tauri
 * store `license.json` is the source of truth; localStorage keeps a copy so the
 * browser preview and any code that runs before `initLicense()` still work.
 *
 * A key is an Ed25519 signature, not a format: the site signs a short payload
 * with a private key only it has (web/lib/licenseKey.ts), and this file checks
 * the signature against the public half below - locally, with no request to
 * anyone. The source being public changes nothing: reading this tells you how
 * a key is checked, not how to make one. There is no registry of issued keys
 * and nothing counts installs; "one computer at a time" is the licence's
 * promise (terms, FAQ, the receipt), kept by people, not by code.
 */

ed.hashes.sha512 = sha512;

const STORAGE_KEY = "screeni-license";
const STORE_FILE = "license.json";
const STORE_KEY = "key";

export const LICENSE_KEY_PREFIX = "OWNT";
/** 32 symbols, no look-alikes: no I, O, 0 or 1. The prefix's O and I can never appear in a body. */
export const LICENSE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/**
 * The public half of the key that signs Pro keys (hex, 32 bytes). Its private
 * half is derived from LICENSE_KEY_SECRET on the site; `pnpm polar:setup`
 * checks that the two still belong together. Changing it here means every
 * key signed before stops opening this build - never do that after a sale.
 */
export const LICENSE_PUBLIC_KEY = "45f84e72eb43e8a2546ff079d4433fa1f974b517f9223a2d1508067b39b2e190";

const KEY_VERSION = 1;
const TAG_BYTES = 8;
const SIGNATURE_BYTES = 64;
const PAYLOAD_BYTES = 1 + TAG_BYTES + SIGNATURE_BYTES;
/** 73 bytes × 8 bits / 5 bits a symbol = 117 symbols; the last one carries a padding bit that must be 0. */
const BODY_LENGTH = Math.ceil((PAYLOAD_BYTES * 8) / 5);
const GROUP = 8;
const SIGNING_DOMAIN = "owntools-pro:";

export interface DecodedLicenseKey {
  /** The canonical spelling: OWNT- and the body in groups of eight. */
  key: string;
  version: number;
  tag: Uint8Array;
  signature: Uint8Array;
}

/**
 * The canonical spelling of whatever was pasted - upper case, groups of
 * eight - or null when it is not even the right shape (prefix + 117 symbols of
 * the alphabet). Dashes, spaces and line breaks are ignored on the way in, so
 * a key copied out of an e-mail with a wrap in it still works.
 */
export function normalizeLicenseKey(raw: string): string | null {
  const symbols = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!symbols.startsWith(LICENSE_KEY_PREFIX)) return null;
  const body = symbols.slice(LICENSE_KEY_PREFIX.length);
  if (body.length !== BODY_LENGTH) return null;
  for (const ch of body) if (!LICENSE_ALPHABET.includes(ch)) return null;
  const groups: string[] = [];
  for (let i = 0; i < body.length; i += GROUP) groups.push(body.slice(i, i + GROUP));
  return `${LICENSE_KEY_PREFIX}-${groups.join("-")}`;
}

/** Symbols → bytes, five bits each, most significant first; null unless the padding bits are zero. */
function decodeBase32(body: string, bytes: number): Uint8Array | null {
  const out = new Uint8Array(bytes);
  let acc = 0;
  let bits = 0;
  let n = 0;
  for (const ch of body) {
    const v = LICENSE_ALPHABET.indexOf(ch);
    if (v < 0) return null;
    acc = ((acc << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      if (n >= bytes) return null;
      out[n++] = (acc >> bits) & 0xff;
    }
  }
  if (n !== bytes) return null;
  // whatever is left is padding, and a canonical key pads with zeros
  if ((acc & ((1 << bits) - 1)) !== 0) return null;
  return out;
}

/** The parts of a well-formed key; null says nothing about the signature yet. */
export function decodeLicenseKey(raw: string): DecodedLicenseKey | null {
  const key = normalizeLicenseKey(raw);
  if (!key) return null;
  const payload = decodeBase32(key.slice(LICENSE_KEY_PREFIX.length + 1).replace(/-/g, ""), PAYLOAD_BYTES);
  if (!payload) return null;
  return {
    key,
    version: payload[0],
    tag: payload.slice(1, 1 + TAG_BYTES),
    signature: payload.slice(1 + TAG_BYTES),
  };
}

/**
 * Is this a key the site signed? Checked entirely on this machine. The public
 * key can be swapped for tests; the app always uses `LICENSE_PUBLIC_KEY`.
 */
export function isValidLicenseKey(raw: string, publicKeyHex: string = LICENSE_PUBLIC_KEY): boolean {
  const decoded = decodeLicenseKey(raw);
  if (!decoded || decoded.version !== KEY_VERSION) return false;
  try {
    const head = new Uint8Array(1 + TAG_BYTES);
    head[0] = decoded.version;
    head.set(decoded.tag, 1);
    return ed.verify(decoded.signature, concatBytes(utf8ToBytes(SIGNING_DOMAIN), head), hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

/** The canonical key when `raw` is one the site signed, else null. */
function validKey(raw: string): string | null {
  const key = normalizeLicenseKey(raw);
  return key && isValidLicenseKey(key) ? key : null;
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
    return key ? validKey(key) : null;
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
    return typeof raw === "string" ? validKey(raw) : null;
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
  const normalized = validKey(key);
  if (!normalized) return false;
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
 * `OWNT-K4M2ZQ7A-…-P3X9Z` → `OWNT-K4M2ZQ7A-…-•••9Z`: the first group (the
 * version and most of the tag) identifies the key well enough for support,
 * the last two characters confirm it is the one you meant, the rest stays
 * off-screen. Anything that is not a key is masked the plain way.
 */
export function maskLicenseKey(key: string): string {
  const canonical = normalizeLicenseKey(key);
  if (canonical) {
    const groups = canonical.split("-");
    const last = groups[groups.length - 1];
    return `${groups[0]}-${groups[1]}-…-${"•".repeat(last.length - 2)}${last.slice(-2)}`;
  }
  const k = key.trim().toUpperCase();
  if (k.length <= 6) return k;
  return `${k.slice(0, 4)}${"•".repeat(k.length - 6)}${k.slice(-2)}`;
}
