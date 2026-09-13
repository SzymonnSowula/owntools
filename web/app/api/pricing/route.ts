import { loadPricing } from "@/lib/polar";
import { pricingSnapshot } from "@/lib/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where the launch-price ladder stands, for the pricing section: which step is
 * current and how many keys it has left. The page itself stays static; this is
 * the only live number on it.
 *
 * Cached twice so a busy page never turns into Polar traffic: 15 s in this
 * instance (lib/polar.ts) and 15 s at the CDN, which may serve a stale answer
 * for a minute more while it refreshes. The checkout never trusts this - it
 * asks Polar again when the button is pressed.
 */
export async function GET() {
  try {
    const snapshot = await loadPricing();
    return Response.json(snapshot, {
      headers: { "Cache-Control": "public, max-age=0, s-maxage=15, stale-while-revalidate=60" },
    });
  } catch (err) {
    console.error("[pricing]", err);
    // the plan without counts, marked as not live, so the page can say less rather than lie
    return Response.json(
      { ...pricingSnapshot(null), error: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
