import { NextResponse, type NextRequest } from "next/server";
import { loadShare, mediaKey, publicUrl } from "@/lib/share";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string; file: string }> };

/**
 * `/v/<id>/video.mp4` and `/v/<id>/poster.jpg`: the addresses the player page,
 * link previews and the download button use. The bucket stays private; each
 * request checks the share still exists and has not expired, then redirects
 * to a signed URL made for this request. HEAD is answered from this too.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id, file } = await params;
  const share = await loadShare(id);
  const key = share ? mediaKey(share.meta, file) : null;
  if (!share || !key) {
    return new NextResponse("This link doesn't exist or has expired.", {
      status: 404,
      headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
    });
  }
  return NextResponse.redirect(await publicUrl(share.cfg, key), {
    status: 302,
    // a signed URL is private to this request; never let a cache hand it out later
    headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer" },
  });
}
