import { NextResponse, type NextRequest } from "next/server";
import { attributionFrom, openCheckout, polarConfig, publicIp } from "@/lib/polar";
import { allowRequest, clientAddress } from "@/lib/rateLimit";
import { checkoutUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "get the pro key" lands here and leaves for Polar a moment later, at the
 * cheapest launch step that still has keys (lib/polar.ts `openCheckout`).
 *
 * A plain GET on purpose: the button is an ordinary link, so it works without
 * JavaScript and from the desktop app, and `?utm_source=…` on it is carried
 * into the order's metadata. Anything that goes wrong sends the buyer back to
 * the pricing section with a notice instead of an error page - nothing has
 * been charged at this point.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const back = (reason: string) => NextResponse.redirect(new URL(`/?checkout=${reason}#pricing`, origin), 303);

  if (!polarConfig()) {
    // phase-0 fallback: a checkout link pasted by hand into the environment
    return checkoutUrl ? NextResponse.redirect(checkoutUrl, 303) : back("soon");
  }

  if (!allowRequest(`checkout:${clientAddress(req.headers)}`, 10, 60_000)) return back("busy");

  try {
    const { url } = await openCheckout({
      origin,
      customerIp: publicIp(req.headers.get("x-forwarded-for"), req.headers.get("x-real-ip")),
      attribution: attributionFrom(req.nextUrl.searchParams),
    });
    return NextResponse.redirect(url, 303);
  } catch (err) {
    console.error("[checkout]", err);
    return back("unavailable");
  }
}
