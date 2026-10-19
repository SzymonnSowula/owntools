import type { NextRequest } from "next/server";
import { allowRequest, clientAddress } from "@/lib/rateLimit";
import type { ShareConfig } from "@/lib/share";
import {
  MAX_PARTS,
  MAX_POSTER_BYTES,
  abortMultipart,
  allowedOrigin,
  buildMeta,
  cleanName,
  completeMultipart,
  deleteObject,
  finiteNumber,
  headObject,
  isPendingStale,
  isValidId,
  json,
  loadPending,
  loadShare,
  looksLikeJpeg,
  looksLikeVideo,
  mediaUrl,
  notConfigured,
  noteUsage,
  objectKey,
  preflight,
  putJson,
  readHead,
  sha256Hex,
  shareConfig,
  timingSafeEqualHex,
  viewUrl,
} from "@/lib/share";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** Reads of a share's description. Every miss is a storage lookup, so scanning has a ceiling. */
const LOOKUPS_PER_MINUTE = 60;
/** Completions and take-downs. A wrong owner token should not be worth trying twice. */
const WRITES_PER_MINUTE = 20;

/** Public description of a share, for the player page and embeds. */
export async function GET(req: NextRequest, { params }: Params) {
  const origin = allowedOrigin(req.headers.get("origin"));
  if (!allowRequest(`share:get:${clientAddress(req.headers)}`, LOOKUPS_PER_MINUTE, 60_000)) {
    return json({ error: "rate_limited", message: "Too many requests." }, 429, origin);
  }
  const { id } = await params;
  const share = await loadShare(id);
  if (!share) return json({ error: "not_found", message: "This link doesn't exist or has expired." }, 404, origin);
  const { meta } = share;
  return json(
    {
      id: meta.id,
      name: meta.name,
      bytes: meta.bytes,
      contentType: meta.contentType,
      width: meta.width,
      height: meta.height,
      duration: meta.duration,
      createdAt: meta.createdAt,
      expiresAt: meta.expiresAt,
      viewUrl: viewUrl(meta.id),
      videoUrl: mediaUrl(meta.id, `video.${meta.ext}`),
      posterUrl: meta.poster ? mediaUrl(meta.id, "poster.jpg") : null,
    },
    200,
    origin,
  );
}

/** Everything this share owns, gone. Used when a completion is refused. */
async function discard(cfg: ShareConfig, id: string, key: string, bytes: number): Promise<void> {
  await Promise.all([
    deleteObject(cfg, key),
    deleteObject(cfg, objectKey(id, "poster.jpg")),
    deleteObject(cfg, objectKey(id, "pending.json")),
  ]);
  // The bucket just shrank; hand the room back rather than hold the ceiling
  // closed until the next listing.
  noteUsage(cfg, { bytes: -bytes, pending: -1 });
}

/**
 * Step 2: every part has been PUT, the app hands back the ETags and the
 * storage stitches the file together. Only then does meta.json exist, which
 * is what makes the link resolve.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const origin = allowedOrigin(req.headers.get("origin"));
  const reply = (data: unknown, status = 200) => json(data, status, origin);

  const cfg = shareConfig();
  if (!cfg) return notConfigured(origin);
  if (!allowRequest(`share:write:${clientAddress(req.headers)}`, WRITES_PER_MINUTE, 60_000)) {
    return reply({ error: "rate_limited", message: "Too many requests." }, 429);
  }
  const { id } = await params;
  if (!isValidId(id)) return reply({ error: "not_found", message: "Unknown share." }, 404);

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const ownerToken = typeof body?.ownerToken === "string" ? body.ownerToken : "";
  const parts = Array.isArray(body?.parts)
    ? (body!.parts as unknown[])
        .slice(0, MAX_PARTS)
        .map((p) => (typeof p === "object" && p !== null ? (p as { partNumber?: unknown; etag?: unknown }) : null))
        .filter((p): p is { partNumber: number; etag: string } => Boolean(p) && typeof p!.partNumber === "number" && typeof p!.etag === "string" && p!.etag.length > 0 && p!.etag.length <= 128)
    : [];
  if (!ownerToken || !parts.length) return reply({ error: "bad_request", message: "ownerToken and parts are required." }, 400);

  const pending = await loadPending(cfg, id);
  if (!pending) return reply({ error: "not_found", message: "This upload was never started or already finished." }, 404);
  if (!timingSafeEqualHex(await sha256Hex(ownerToken), pending.ownerHash)) {
    return reply({ error: "forbidden", message: "That token doesn't own this upload." }, 403);
  }
  // A plan outlives its presigned URLs by nothing: an upload left open longer
  // than that is swept, not stitched into a live link hours later.
  if (isPendingStale(pending)) {
    await abortMultipart(cfg, pending.key, pending.uploadId);
    await discard(cfg, id, pending.key, pending.bytes);
    return reply({ error: "expired", message: "This upload took too long and was cancelled. Try sharing again." }, 410);
  }

  try {
    await completeMultipart(cfg, pending.key, pending.uploadId, parts);
  } catch (err) {
    await abortMultipart(cfg, pending.key, pending.uploadId);
    await deleteObject(cfg, objectKey(id, "pending.json"));
    return reply({ error: "storage", message: err instanceof Error ? err.message : "Storage error." }, 502);
  }

  const head = await headObject(cfg, pending.key);
  const bytes = head.exists ? head.size : pending.bytes;
  // A presigned part URL does not bound the size of what is PUT to it, so the
  // cap is checked on what actually landed, not on what step 1 was told.
  if (bytes > cfg.maxBytes) {
    await discard(cfg, id, pending.key, pending.bytes);
    const mb = Math.round(cfg.maxBytes / 1024 / 1024);
    return reply({ error: "too_large", message: `Shares are limited to ${mb} MB.`, maxBytes: cfg.maxBytes }, 413);
  }
  // …and the storage cannot tell a video from a renamed archive, so neither
  // could anyone downloading one from us. A file that is not a video container
  // never gets a meta.json, which is what would have made it reachable.
  const firstBytes = await readHead(cfg, pending.key);
  if (firstBytes && !looksLikeVideo(firstBytes)) {
    await discard(cfg, id, pending.key, pending.bytes);
    return reply({ error: "not_a_video", message: "That file isn't a video, so it wasn't shared." }, 415);
  }

  const posterHead = body?.poster ? await headObject(cfg, objectKey(id, "poster.jpg")) : { exists: false, size: 0 };
  let poster = posterHead.exists && posterHead.size <= MAX_POSTER_BYTES;
  if (poster) {
    const posterBytes = await readHead(cfg, objectKey(id, "poster.jpg"), 8);
    if (posterBytes && !looksLikeJpeg(posterBytes)) poster = false;
  }
  if (posterHead.exists && !poster) await deleteObject(cfg, objectKey(id, "poster.jpg"));
  const meta = buildMeta(pending, {
    name: cleanName(body?.name),
    width: finiteNumber(body?.width),
    height: finiteNumber(body?.height),
    duration: finiteNumber(body?.duration),
    poster,
    bytes,
  });
  await putJson(cfg, objectKey(id, "meta.json"), meta);
  await deleteObject(cfg, objectKey(id, "pending.json"));
  // The promise made at step 1 becomes a real object of a known size.
  noteUsage(cfg, { bytes: bytes - pending.bytes, shares: 1, pending: -1 });

  return reply({
    id,
    viewUrl: viewUrl(id),
    videoUrl: mediaUrl(id, `video.${pending.ext}`),
    expiresAt: meta.expiresAt,
    bytes,
  });
}

/** The uploader can take a link down again; nobody else can. */
export async function DELETE(req: NextRequest, { params }: Params) {
  const origin = allowedOrigin(req.headers.get("origin"));
  const reply = (data: unknown, status = 200) => json(data, status, origin);

  const cfg = shareConfig();
  if (!cfg) return notConfigured(origin);
  if (!allowRequest(`share:write:${clientAddress(req.headers)}`, WRITES_PER_MINUTE, 60_000)) {
    return reply({ error: "rate_limited", message: "Too many requests." }, 429);
  }
  const { id } = await params;
  if (!isValidId(id)) return reply({ error: "not_found", message: "Unknown share." }, 404);

  const auth = req.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim();
  const body = (await req.json().catch(() => null)) as { ownerToken?: unknown } | null;
  const ownerToken = bearer || (typeof body?.ownerToken === "string" ? body.ownerToken : "");
  if (!ownerToken) return reply({ error: "forbidden", message: "An owner token is required." }, 403);

  const share = await loadShare(id);
  const pending = share ? null : await loadPending(cfg, id);
  const ownerHash = share?.meta.ownerHash ?? pending?.ownerHash;
  if (!ownerHash) return reply({ error: "not_found", message: "This link doesn't exist or has expired." }, 404);
  if (!timingSafeEqualHex(await sha256Hex(ownerToken), ownerHash)) {
    return reply({ error: "forbidden", message: "That token doesn't own this link." }, 403);
  }

  if (pending) await abortMultipart(cfg, pending.key, pending.uploadId);
  await Promise.all([
    deleteObject(cfg, objectKey(id, "video.mp4")),
    deleteObject(cfg, objectKey(id, "video.webm")),
    deleteObject(cfg, objectKey(id, "poster.jpg")),
    deleteObject(cfg, objectKey(id, "meta.json")),
    deleteObject(cfg, objectKey(id, "pending.json")),
  ]);
  noteUsage(cfg, {
    bytes: -(share?.meta.bytes ?? pending?.bytes ?? 0),
    shares: share ? -1 : 0,
    pending: pending ? -1 : 0,
  });
  return reply({ ok: true });
}

export function OPTIONS(req: NextRequest) {
  return preflight(req);
}
