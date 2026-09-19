/**
 * Polar's webhooks, verified by hand.
 *
 * Polar signs a delivery the Standard Webhooks way: three headers
 * (`webhook-id`, `webhook-timestamp`, `webhook-signature`) and an HMAC-SHA256
 * over `<id>.<timestamp>.<raw body>`. What differs is the HMAC *key*, and it
 * depends on when the endpoint's secret was made (Polar's docs, read
 * 2026-09-19):
 *
 * - secrets made on or after 8 September 2026: Standard Webhooks proper - the
 *   key is the base64 text after `whsec_`, decoded;
 * - older secrets: Polar's own scheme - the key is the UTF-8 bytes of the
 *   whole secret string.
 *
 * Polar's SDK tries both, and so does this: an endpoint made today and one made
 * last month both verify, and a wrong secret still fails both. It is forty
 * lines of node:crypto, so the site does not take on an SDK for it.
 *
 * The body has to be the *raw* request text - re-serialised JSON signs
 * differently.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** How far a delivery's timestamp may be from now, either way (replay protection). */
export const WEBHOOK_TOLERANCE_MS = 5 * 60_000;

export type WebhookRejection = "headers" | "stale" | "signature" | "body";

export class WebhookRejected extends Error {
  readonly reason: WebhookRejection;

  constructor(reason: WebhookRejection, detail: string) {
    super(`webhook rejected (${reason}): ${detail}`);
    this.name = "WebhookRejected";
    this.reason = reason;
  }
}

export interface PolarEvent {
  type: string;
  timestamp?: string;
  data: unknown;
}

/** Both keys a secret can mean; see the file comment. */
function candidateKeys(secret: string): Buffer[] {
  const keys = [Buffer.from(secret, "utf8")];
  const standard = /^whsec_(.+)$/.exec(secret)?.[1];
  if (standard) {
    const decoded = Buffer.from(standard, "base64");
    if (decoded.length > 0) keys.unshift(decoded);
  }
  return keys;
}

/** The `v1,<base64>` a delivery with this id, timestamp and body carries when signed with `secret`. */
export function signPolarWebhook(id: string, timestampSeconds: number, body: string, secret: string): string {
  const key = candidateKeys(secret)[0];
  return `v1,${createHmac("sha256", key).update(`${id}.${timestampSeconds}.${body}`).digest("base64")}`;
}

/**
 * The event inside a delivery, or a `WebhookRejected`. Nothing in the body is
 * looked at before the signature holds.
 */
export function verifyPolarWebhook(body: string, headers: Headers, secret: string, nowMs: number = Date.now()): PolarEvent {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatures = headers.get("webhook-signature");
  if (!id || !timestamp || !signatures) throw new WebhookRejected("headers", "a webhook-* header is missing");

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) throw new WebhookRejected("headers", "webhook-timestamp is not a number");
  if (Math.abs(nowMs - seconds * 1000) > WEBHOOK_TOLERANCE_MS) {
    throw new WebhookRejected("stale", "the timestamp is more than five minutes from now");
  }

  const signed = `${id}.${timestamp}.${body}`;
  const expected = candidateKeys(secret).map((key) => createHmac("sha256", key).update(signed).digest());
  // the header may carry several signatures (a secret being rotated), space separated
  const offered = signatures
    .split(" ")
    .map((part) => /^v1,(.+)$/.exec(part.trim())?.[1])
    .filter((sig): sig is string => !!sig)
    .map((sig) => Buffer.from(sig, "base64"));
  const matches = offered.some((sig) => expected.some((exp) => sig.length === exp.length && timingSafeEqual(sig, exp)));
  if (!matches) throw new WebhookRejected("signature", "no signature matches this endpoint's secret");

  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    throw new WebhookRejected("body", "the body is not JSON");
  }
  const type = (event as { type?: unknown } | null)?.type;
  if (typeof type !== "string") throw new WebhookRejected("body", "the event has no type");
  return event as PolarEvent;
}
