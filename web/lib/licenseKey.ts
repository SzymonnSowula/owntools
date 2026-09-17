import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";

/**
 * Pro keys for Polar orders: signed, derived, never stored.
 *
 * The source is public, so a key cannot be "a format the app checks" any more
 * - anyone could print one. A key is an Ed25519 *signature*: the site signs
 * a short payload with a private key nobody else has, and the app verifies it
 * with the matching public key baked into `packages/licensing/src/license.ts`
 * (`LICENSE_PUBLIC_KEY`). Reading the app's source tells you how a key is
 * checked, not how to make one; the app still never phones home.
 *
 * The private key is derived from LICENSE_KEY_SECRET (one secret, the same
 * one the shop already had), so nothing new has to be kept anywhere - but
 * that also means the secret must never change once a key has been sold: a
 * new secret is a new public key, and every key signed with the old one
 * stops opening the *next* build. `pnpm polar:setup` checks that the app's
 * constant matches the secret at hand.
 *
 * Payload (73 bytes): 1 version byte, an 8-byte tag (for an order: the first
 * bytes of a hash of the Polar order id, so the same order always gets the
 * same key and `pnpm polar:key` can recompute a lost one; for a gift: random)
 * and the 64-byte signature over "owntools-pro:" + version + tag. Encoded in
 * a 32-letter alphabet with no look-alikes (no I, O, 0, 1) as 117 symbols in
 * groups of eight behind the OWNT- prefix. Long, but nobody types it: it is
 * copied from /thanks or the receipt.
 *
 * Web cannot import from packages/ (see CLAUDE.md), so the alphabet and the
 * base-32 codec live on both sides; packages/licensing/src/license.test.ts
 * runs keys made here through the app's own validator so the two cannot
 * drift.
 */

ed.hashes.sha512 = sha512;

export const LICENSE_KEY_PREFIX = "OWNT";
export const LICENSE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const LICENSE_KEY_VERSION = 1;
export const LICENSE_TAG_BYTES = 8;
const SIGNATURE_BYTES = 64;
const PAYLOAD_BYTES = 1 + LICENSE_TAG_BYTES + SIGNATURE_BYTES;
/** Symbols in a key body: 73 bytes × 8 bits / 5 bits a symbol, rounded up. */
export const LICENSE_BODY_LENGTH = Math.ceil((PAYLOAD_BYTES * 8) / 5);
const GROUP = 8;

const SIGNING_DOMAIN = "owntools-pro:";
const SEED_DOMAIN = "owntools-license-signing:";
const ORDER_DOMAIN = "owntools-pro-order:";

/** Thrown when there is no LICENSE_KEY_SECRET: a key signed with nothing would not open the app. */
export class LicenseSecretMissing extends Error {
  constructor() {
    super("LICENSE_KEY_SECRET is not set - keys cannot be issued without it.");
    this.name = "LicenseSecretMissing";
  }
}

/** The Ed25519 private key (32-byte seed) behind a secret. */
export function signingSeed(secret: string): Uint8Array {
  const trimmed = secret.trim();
  if (!trimmed) throw new LicenseSecretMissing();
  return sha256(utf8ToBytes(SEED_DOMAIN + trimmed));
}

/** The public half, hex - what `LICENSE_PUBLIC_KEY` in the app has to be. */
export function licensePublicKey(secret: string): string {
  return bytesToHex(ed.getPublicKey(signingSeed(secret)));
}

/** The 8-byte tag an order gets: the same order, the same tag, whatever the id's case. */
export function orderTag(orderId: string): Uint8Array {
  return sha256(utf8ToBytes(ORDER_DOMAIN + orderId.trim().toLowerCase())).slice(0, LICENSE_TAG_BYTES);
}

/** A key for any 8-byte tag, signed with the secret's key. */
export function licenseKeyForTag(tag: Uint8Array, secret: string): string {
  if (tag.length !== LICENSE_TAG_BYTES) throw new Error(`a license tag is ${LICENSE_TAG_BYTES} bytes, got ${tag.length}`);
  const seed = signingSeed(secret);
  const head = new Uint8Array(1 + LICENSE_TAG_BYTES);
  head[0] = LICENSE_KEY_VERSION;
  head.set(tag, 1);
  const signature = ed.sign(concatBytes(utf8ToBytes(SIGNING_DOMAIN), head), seed);
  return formatLicenseKey(encodeBase32(concatBytes(head, signature)));
}

/** The same order always gets the same key. */
export function licenseKeyForOrder(orderId: string, secret: string): string {
  return licenseKeyForTag(orderTag(orderId), secret);
}

/** A key with a random tag - gifts, giveaways, a reviewer. Nothing records it; note it down. */
export function mintLicenseKey(secret: string): string {
  return licenseKeyForTag(randomBytes(LICENSE_TAG_BYTES), secret);
}

/** `OWNT-` + the body in groups of eight. */
export function formatLicenseKey(body: string): string {
  const groups: string[] = [];
  for (let i = 0; i < body.length; i += GROUP) groups.push(body.slice(i, i + GROUP));
  return `${LICENSE_KEY_PREFIX}-${groups.join("-")}`;
}

/** Bytes → symbols, five bits each, most significant first, no padding. */
export function encodeBase32(bytes: Uint8Array): string {
  let out = "";
  let acc = 0;
  let bits = 0;
  for (const byte of bytes) {
    acc = ((acc << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += LICENSE_ALPHABET[(acc >> bits) & 0x1f];
    }
  }
  if (bits > 0) out += LICENSE_ALPHABET[(acc << (5 - bits)) & 0x1f];
  return out;
}
