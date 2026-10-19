import { NextResponse, type NextRequest } from "next/server";
import { allowRequest, clientAddress } from "@/lib/rateLimit";
import { loadShare, mediaKey, publicUrl, serveAsFor } from "@/lib/share";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string; file: string }> };

/**
 * Hits one network may make on a share's media in a minute. A view costs two
 * (the poster and the video) and a chat app's preview a couple more; seeking
 * costs nothing here, because range requests go to the storage the redirect
 * pointed at. Set high enough that a link opened by a whole office behind one
 * address still plays, low enough that a script is not free: each request is a
 * storage lookup plus a signature, and both are ours to pay for.
 */
const MEDIA_PER_MINUTE = 120;

function gone(status: number, text: string): NextResponse {
  return new NextResponse(text, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

/**
 * `/v/<id>/video.mp4` and `/v/<id>/poster.jpg`: the addresses the player page,
 * link previews and the download button use. The bucket stays private; each
 * request checks the share still exists and has not expired, then redirects
 * to a signed URL made for this request. HEAD is answered from this too.
 */
export async function GET(req: NextRequest, { params }: Params) {
  if (!allowRequest(`media:${clientAddress(req.headers)}`, MEDIA_PER_MINUTE, 60_000)) {
    return gone(429, "Too many requests. Try again in a minute.");
  }
  const { id, file } = await params;
  const share = await loadShare(id);
  const key = share ? mediaKey(share.meta, file) : null;
  if (!share || !key) return gone(404, "This link doesn't exist or has expired.");
  // The signature carries the type and disposition the storage must answer
  // with, so what a browser is handed is decided here and not by whatever
  // ended up in the bucket.
  return NextResponse.redirect(await publicUrl(share.cfg, key, serveAsFor(share.meta, file)), {
    status: 302,
    // a signed URL is private to this request; never let a cache hand it out later
    headers: {
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}
