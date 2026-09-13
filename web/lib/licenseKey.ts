import { createHmac } from "node:crypto";

/**
 * Pro keys for Polar orders, derived instead of stored.
 *
 * A key is `SCRN-XXXXX-XXXXX-XXXXX`: 14 symbols from a 32-letter alphabet (no
 * I, O, 0 or 1) plus one checksum symbol - the exact format
 * `packages/licensing/src/license.ts` accepts offline and
 * `scripts/generate-license.mjs` prints. The app never phones home, so the
 * only thing that matters is that a paying customer gets a key that passes.
 *
 * Deriving it from the order id means there is no database: the thank-you page
 * computes it when Polar says the order is paid, a lost key is recomputed from
 * the same order (`pnpm polar:key <email>`), and a webhook arriving twice can
 * never mint two keys. The HMAC secret (LICENSE_KEY_SECRET) only keeps keys
 * from being computable from an order id alone; changing it later breaks
 * nothing - keys already handed out still pass the app's check - it only means
 * a recovered key looks different from the first one.
 *
 * Web cannot import from packages/ (see CLAUDE.md), so the alphabet and the
 * checksum live here too; licenseKey.test.ts runs every derived key through
 * the app's own validator so the copies cannot drift.
 */

export const LICENSE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAYLOAD_LENGTH = 14;

/** The 15th symbol: a weighted sum of the 14 before it (weights 3, 7, 3, 7…). */
export function licenseChecksum(payload: string): string {
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    sum += LICENSE_ALPHABET.indexOf(payload[i]) * (i % 2 === 0 ? 3 : 7);
  }
  return LICENSE_ALPHABET[sum % LICENSE_ALPHABET.length];
}

/** The same order always gets the same key. */
export function licenseKeyForOrder(orderId: string, secret: string): string {
  const digest = createHmac("sha256", secret).update(`owntools-pro:${orderId.trim().toLowerCase()}`).digest();

  // 14 symbols x 5 bits = 70 bits, read most-significant first
  let payload = "";
  let acc = 0;
  let bits = 0;
  for (let i = 0; payload.length < PAYLOAD_LENGTH; i++) {
    acc = ((acc << 8) | digest[i]) & 0xffff;
    bits += 8;
    while (bits >= 5 && payload.length < PAYLOAD_LENGTH) {
      bits -= 5;
      payload += LICENSE_ALPHABET[(acc >> bits) & 0x1f];
    }
  }

  const body = payload + licenseChecksum(payload);
  return `SCRN-${body.slice(0, 5)}-${body.slice(5, 10)}-${body.slice(10, 15)}`;
}
