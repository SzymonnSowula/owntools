import { repoSlug } from "@/lib/download";
import { GithubRefused, fetchDownloadCounts } from "@/lib/downloads";
import { repoUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * How many times the app has been downloaded, from GitHub's own per-file
 * counts (lib/downloads.ts says what that number is and is not).
 *
 * One cache layer, the CDN's: fifteen minutes, with a stale answer allowed
 * for an hour more while it refreshes. That also keeps us inside GitHub's
 * anonymous budget of 60 calls an hour per address - and when it is spent
 * anyway, this answers 503 and the page shows nothing rather than a number
 * that is wrong.
 */
export async function GET() {
  const slug = repoSlug(repoUrl);
  if (!slug) return Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  try {
    const counts = await fetchDownloadCounts(slug, { token: process.env.GITHUB_TOKEN });
    return Response.json(counts, {
      headers: { "Cache-Control": "public, max-age=0, s-maxage=900, stale-while-revalidate=3600" },
    });
  } catch (err) {
    if (err instanceof GithubRefused) console.warn("[downloads]", err.message);
    else console.error("[downloads]", err);
    return Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
