/**
 * Getting a key to its buyer's inbox - the two roads, both without a database.
 *
 * `deliverOrderKey` runs when Polar says an order was paid (the `order.paid`
 * webhook, and /thanks as a second road for the first hour). `resendKeys` runs
 * when someone asks on /key. Polar is the only record of who bought what, the
 * key is derived from the order id as everywhere else, and Resend's
 * idempotency keys are what keep "at most one e-mail" true across webhook
 * retries, racing requests and server instances that share no memory.
 *
 * Nothing here decides from what a request *said*: the order is read back from
 * Polar by id, and a recovery e-mail goes only to the address Polar has on the
 * order - the person typing an address into /key learns nothing from the
 * answer, not even whether that address ever bought anything.
 */

import { createHash } from "node:crypto";
import { emailConfig, sendEmail } from "./email";
import { purchaseEmail, recoveryEmail, type MailLinks } from "./keyEmail";
import { licenseKeyForOrder } from "./licenseKey";
import { fetchOrder, findProduct, keyOrdersForEmail, orderHoldsKey, polarConfig } from "./polar";
import { REFUND_DAYS, contactEmail, downloadHref, downloadHrefMac, siteUrl } from "./site";

/** What is missing on this server for keys to be e-mailed. */
export type Missing = "polar" | "signing" | "email";

export function mailLinks(): MailLinks {
  const site = siteUrl.replace(/\/+$/, "");
  return {
    site,
    contact: contactEmail,
    downloadWindows: downloadHref ? `${site}${downloadHref}` : undefined,
    downloadMac: downloadHrefMac ? `${site}${downloadHrefMac}` : undefined,
    refundDays: REFUND_DAYS,
  };
}

/** Which of the three settings an e-mailed key needs is not there; null when all are. */
export function keyMailMissing(): Missing | null {
  if (!polarConfig()) return "polar";
  if (!process.env.LICENSE_KEY_SECRET?.trim()) return "signing";
  if (!emailConfig()) return "email";
  return null;
}

export type Delivery =
  | { state: "sent"; duplicate: boolean }
  /** Nothing to send, and nothing will change that: answer 2xx so Polar stops retrying. */
  | { state: "ignored"; why: "not-found" | "not-a-key-order" | "no-address" }
  /** A setting is missing: answer 5xx so Polar retries once it is there. */
  | { state: "unconfigured"; missing: Missing };

/** E-mails the key of one paid order to the address that paid. Safe to call twice for the same order. */
export async function deliverOrderKey(orderId: string): Promise<Delivery> {
  const missing = keyMailMissing();
  if (missing) return { state: "unconfigured", missing };
  const cfg = polarConfig()!;
  const mail = emailConfig()!;
  const secret = process.env.LICENSE_KEY_SECRET!.trim();

  const [order, product] = await Promise.all([fetchOrder(cfg, orderId), findProduct(cfg)]);
  if (!order) return { state: "ignored", why: "not-found" };
  if (!product || !orderHoldsKey(order, product.id)) return { state: "ignored", why: "not-a-key-order" };
  const to = order.customer?.email?.trim();
  if (!to) return { state: "ignored", why: "no-address" };

  const links = mailLinks();
  const message = purchaseEmail({
    ...links,
    key: licenseKeyForOrder(order.id, secret),
    thanksUrl: order.checkout_id ? `${links.site}/thanks?checkout_id=${order.checkout_id}` : undefined,
  });
  const sent = await sendEmail(mail, { to, ...message, idempotencyKey: `owntools-order-${order.id}`, kind: "purchase" });
  return { state: "sent", duplicate: sent.duplicate };
}

/** How long one address waits between recovery e-mails. Resend forgets an idempotency key after 24 h; this divides it. */
export const RECOVERY_WINDOW_MS = 6 * 60 * 60_000;

/** The idempotency key for a recovery e-mail: one per address per window, the address itself never in it. */
export function recoveryKey(email: string, now: number): string {
  const who = createHash("sha256").update(`owntools-recover:${email}`).digest("hex").slice(0, 32);
  return `owntools-recover-${who}-${Math.floor(now / RECOVERY_WINDOW_MS)}`;
}

export type Recovery =
  /** `sent` is for the log only - the page never tells the visitor which it was. */
  | { state: "done"; sent: boolean }
  | { state: "unconfigured"; missing: Missing };

/** Sends every key bought under `email` to that address - and to no one else, whoever asked. */
export async function resendKeys(email: string, now: number = Date.now()): Promise<Recovery> {
  const missing = keyMailMissing();
  if (missing) return { state: "unconfigured", missing };
  const cfg = polarConfig()!;
  const mail = emailConfig()!;
  const secret = process.env.LICENSE_KEY_SECRET!.trim();

  const address = email.trim().toLowerCase();
  const orders = await keyOrdersForEmail(cfg, address);
  if (orders.length === 0) return { state: "done", sent: false };

  // the address on Polar's record, not the one that was typed
  const to = orders.find((o) => o.customer?.email)?.customer?.email?.trim() || address;
  const message = recoveryEmail({
    ...mailLinks(),
    keys: orders.map((o) => ({ key: licenseKeyForOrder(o.id, secret), bought: o.created_at.slice(0, 10) })),
  });
  await sendEmail(mail, { to, ...message, idempotencyKey: recoveryKey(address, now), kind: "recovery" });
  return { state: "done", sent: true };
}
