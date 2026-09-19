import { NextResponse } from "next/server";
import { looksLikeEmail } from "@/lib/email";
import { resendKeys } from "@/lib/keyMail";
import { allowRequest, clientAddress } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * "I lost my key", answered without a person: the form on /key posts an
 * address here, and if Polar has a paid order under it, the key is e-mailed
 * *to that address*. The key never appears in the response, and the response is
 * the same whether the address bought anything or not - so the form cannot be
 * used to read someone's key, or to find out who is a customer.
 *
 * What someone can do with another person's address is make them receive their
 * own key again. That is capped three ways: per caller and per address here (in
 * memory, so per server instance), and once per address per six hours by the
 * e-mail's idempotency key, which holds across instances (lib/keyMail.ts).
 *
 * What a flood of made-up addresses can spend is not e-mail - an address
 * without an order never reaches Resend - but **Polar's request budget** (500 a
 * minute for the whole organization), which the checkout needs too. Callers
 * that rotate addresses and IPs get past the two limits above, so there is a
 * ceiling for the whole instance as well: past it the form says "try again in
 * a moment" and Polar is not asked. Real use is a handful of requests a day.
 * The layer that holds across instances is the host's: one Vercel Firewall
 * rate-limit rule on this path and /checkout (docs/payments.md).
 */
const INSTANCE_LOOKUPS_PER_MINUTE = 30;

export async function POST(request: Request) {
  // The page posts JSON. A plain form post is what is left when its script did
  // not run (blocked, failed to load): it is answered with a redirect back to
  // the page, never with the address in a URL.
  const plainForm = (request.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded");
  const answer = (state: State, status: number) =>
    plainForm
      ? NextResponse.redirect(new URL(`/key?state=${state}`, request.url), 303)
      : NextResponse.json({ state }, { status });

  let email = "";
  try {
    const value = plainForm ? (await request.formData()).get("email") : ((await request.json()) as { email?: unknown }).email;
    if (typeof value === "string") email = value.trim().toLowerCase();
  } catch {
    /* falls through to "invalid" */
  }
  if (!looksLikeEmail(email)) return answer("invalid", 400);

  const caller = clientAddress(request.headers);
  if (!allowRequest(`key:ip:${caller}`, 5, 10 * 60_000) || !allowRequest(`key:to:${email}`, 3, 60 * 60_000)) {
    return answer("busy", 429);
  }
  // after the two above, so one noisy caller is stopped by its own limit and does not use up everyone's
  if (!allowRequest("key:all", INSTANCE_LOOKUPS_PER_MINUTE, 60_000)) {
    console.warn("[key] the instance-wide ceiling was reached: is someone flooding /api/key?");
    return answer("busy", 429);
  }

  try {
    const result = await resendKeys(email);
    if (result.state === "unconfigured") {
      console.warn(`[key] asked for a key, but ${result.missing} is not configured here`);
      return answer("unconfigured", 503);
    }
    // which of the two it was stays in the log
    console.log(`[key] recovery asked: ${result.sent ? "sent" : "no order under that address"}`);
    return answer("sent", 200);
  } catch (err) {
    console.error("[key]", err);
    return answer("error", 502);
  }
}

type State = "sent" | "invalid" | "busy" | "unconfigured" | "error";
