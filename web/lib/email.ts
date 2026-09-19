/**
 * Outgoing e-mail, through Resend's HTTP API - one POST, no SDK.
 *
 * Only two e-mails ever leave this site: the Pro key right after a purchase
 * (the `order.paid` webhook) and the same key again when its buyer asks for it
 * on /key. Both are transactional and go only to an address that paid.
 *
 * Every send carries an `Idempotency-Key`. Resend remembers a key for 24 hours
 * and answers a repeat with the first response instead of sending again, which
 * is what lets this site stay without a database: Polar may deliver a webhook
 * twice, /thanks may race the webhook, a buyer may press the button five times
 * - and one e-mail goes out. (Resend's docs, read 2026-09-19: a repeat with a
 * different body is a 409 `invalid_idempotent_request`, one that arrives while
 * the first is still in flight a 409 `concurrent_idempotent_requests`. Both
 * mean "this e-mail is taken care of".)
 */

import { contactEmail } from "./site";

const RESEND_BASE = "https://api.resend.com";

export interface EmailConfig {
  apiKey: string;
  /** `owntools <hello@owntools.app>` - the domain has to be verified in Resend. */
  from: string;
  replyTo: string;
  base: string;
}

/** Null until RESEND_API_KEY is set: the site then sells exactly as before, without the e-mail copy. */
export function emailConfig(): EmailConfig | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return null;
  const from = process.env.LICENSE_EMAIL_FROM?.trim() || `owntools <${contactEmail}>`;
  // RESEND_API_URL exists for local tests against a stand-in server only
  const base = (process.env.RESEND_API_URL?.trim() || RESEND_BASE).replace(/\/+$/, "");
  return { apiKey, from, replyTo: contactEmail, base };
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** At most 256 characters; the same key within 24 hours never sends twice. */
  idempotencyKey: string;
  /** Shows up in Resend's dashboard as a filter: "purchase" or "recovery". */
  kind: "purchase" | "recovery";
}

export class EmailError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    const name = (body as { name?: unknown } | null)?.name;
    super(`Resend answered ${status}${typeof name === "string" ? ` (${name})` : ""}`);
    this.name = "EmailError";
    this.status = status;
    this.body = body;
  }
}

export interface SendResult {
  /** Resend's id for the e-mail; null when an earlier request already sent it. */
  id: string | null;
  /** True when Resend said this idempotency key was already used: the e-mail went out before. */
  duplicate: boolean;
}

export async function sendEmail(cfg: EmailConfig, mail: OutgoingEmail): Promise<SendResult> {
  const res = await fetch(`${cfg.base}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": mail.idempotencyKey.slice(0, 256),
      // Resend sits behind a filter that answers a request without one with a 403 (error 1010)
      "User-Agent": "owntools-site/1 (+https://owntools.app)",
    },
    body: JSON.stringify({
      from: cfg.from,
      to: [mail.to],
      reply_to: cfg.replyTo,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      tags: [{ name: "kind", value: mail.kind }],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (res.status === 409) return { id: null, duplicate: true };
  if (!res.ok) throw new EmailError(res.status, data);
  const id = (data as { id?: unknown } | null)?.id;
  return { id: typeof id === "string" ? id : null, duplicate: false };
}

/** Loose on purpose: the real test of an address is whether Polar has an order under it. */
export function looksLikeEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}
