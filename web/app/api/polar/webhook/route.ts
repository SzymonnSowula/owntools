import { NextResponse } from "next/server";
import { emailConfig } from "@/lib/email";
import { deliverOrderKey } from "@/lib/keyMail";
import { polarConfig } from "@/lib/polar";
import { WebhookRejected, verifyPolarWebhook } from "@/lib/polarWebhook";

export const dynamic = "force-dynamic";

/**
 * Polar → here, when an order is paid: the buyer's key goes to their inbox.
 *
 * /thanks already shows the key, but only to a buyer who reaches it - a closed
 * tab or a payment that clears minutes later (3-D Secure, a bank transfer) used
 * to mean an e-mail to support. This is the copy nobody has to ask for.
 *
 * The status codes are the contract with Polar's retry loop (10 tries, then the
 * endpoint is switched off and the organization is e-mailed):
 * - 2xx: done, or nothing to do for this event - do not retry;
 * - 403: the signature does not hold - not Polar, or the wrong secret;
 * - 5xx: a setting is missing or a provider is down - retry, and the e-mail
 *   goes out by itself once that is fixed. Failing loudly beats dropping a
 *   paid order's e-mail without a trace.
 *
 * The body is only trusted for *which* order to look at; whether it is paid,
 * whose it is and where the e-mail goes is read back from Polar (lib/keyMail).
 * A delivery that arrives twice sends one e-mail: the idempotency key is the
 * order id.
 */
export async function POST(request: Request) {
  const secret = process.env.POLAR_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error("[webhook] POLAR_WEBHOOK_SECRET is not set: a delivery was refused");
    return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
  }

  const body = await request.text();
  let event;
  try {
    event = verifyPolarWebhook(body, request.headers, secret);
  } catch (err) {
    if (!(err instanceof WebhookRejected)) throw err;
    console.warn(`[webhook] ${err.message}`);
    return NextResponse.json({ error: "rejected", reason: err.reason }, { status: 403 });
  }

  if (event.type !== "order.paid") return NextResponse.json({ ignored: event.type }, { status: 202 });
  const orderId = (event.data as { id?: unknown } | null)?.id;
  if (typeof orderId !== "string") return NextResponse.json({ ignored: "no order id" }, { status: 202 });

  try {
    const delivery = await deliverOrderKey(orderId);
    if (delivery.state === "sent") {
      console.log(`[webhook] key e-mailed for order ${orderId}${delivery.duplicate ? " (already sent before)" : ""}`);
      return NextResponse.json({ sent: true, duplicate: delivery.duplicate });
    }
    if (delivery.state === "ignored") {
      console.log(`[webhook] order ${orderId}: nothing to send (${delivery.why})`);
      return NextResponse.json({ ignored: delivery.why }, { status: 202 });
    }
    console.error(`[webhook] order ${orderId} is paid but no e-mail could be sent: ${delivery.missing} is not configured`);
    return NextResponse.json({ error: `${delivery.missing}_not_configured` }, { status: 503 });
  } catch (err) {
    console.error(`[webhook] order ${orderId}:`, err);
    return NextResponse.json({ error: "delivery_failed" }, { status: 500 });
  }
}

/**
 * What this server has for e-mailing keys - booleans only, no values. It is
 * how `pnpm polar:setup` can say "the host is missing RESEND_API_KEY" instead
 * of leaving that to be found out by a buyer.
 */
export function GET() {
  return NextResponse.json(
    {
      webhook: Boolean(process.env.POLAR_WEBHOOK_SECRET?.trim()),
      email: emailConfig() !== null,
      signing: Boolean(process.env.LICENSE_KEY_SECRET?.trim()),
      polar: polarConfig() !== null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
