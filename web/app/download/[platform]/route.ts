import { NextResponse, type NextRequest } from "next/server";
import { downloadFallback, isDownloadPlatform, latestInstaller } from "@/lib/download";
import { downloadUrl, downloadUrlMac, repoUrl } from "@/lib/site";

export const runtime = "nodejs";
// Asked afresh on every miss; the one cache is the CDN's five minutes below.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ platform: string }> };

/**
 * `/download/windows` and `/download/mac`: what every download button points
 * at. It redirects to the installer of the latest published release, so the
 * link on the page never names a version (lib/download.ts says why). A
 * platform without a configured download goes back to the plans, where the
 * button says "launching soon" instead.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { platform } = await params;
  const configured = platform === "windows" ? downloadUrl : platform === "mac" ? downloadUrlMac : undefined;
  if (!isDownloadPlatform(platform) || !configured) {
    return NextResponse.redirect(new URL("/#pricing", req.nextUrl.origin), 302);
  }
  const target = (await latestInstaller(repoUrl, platform)) ?? downloadFallback(configured, repoUrl);
  return NextResponse.redirect(target, {
    status: 302,
    // the answer changes with every release; a shared cache may keep it a few minutes, no longer
    headers: { "cache-control": "public, max-age=0, s-maxage=300" },
  });
}
