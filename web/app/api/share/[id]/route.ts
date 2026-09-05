import type { NextRequest } from "next/server";
import {
  abortMultipart,
  buildMeta,
  cleanName,
  completeMultipart,
  deleteObject,
  finiteNumber,
  headObject,
  isValidId,
  json,
  loadPending,
  loadShare,
  notConfigured,
  objectKey,
  preflight,
  publicUrl,
  putJson,
  sha256Hex,
  shareConfig,
  viewUrl,
} from "@/lib/share";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** Public description of a share, for the player page and embeds. */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const share = await loadShare(id);
  if (!share) return json({ error: "not_found", message: "This link doesn't exist or has expired." }, 404);
  const { cfg, meta } = share;
  return json({
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
    videoUrl: await publicUrl(cfg, objectKey(meta.id, `video.${meta.ext}`)),
    posterUrl: meta.poster ? await publicUrl(cfg, objectKey(meta.id, "poster.jpg")) : null,
  });
}

/**
 * Step 2: every part has been PUT, the app hands back the ETags and the
 * storage stitches the file together. Only then does meta.json exist, which
 * is what makes the link resolve.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const cfg = shareConfig();
  if (!cfg) return notConfigured();
  const { id } = await params;
  if (!isValidId(id)) return json({ error: "not_found", message: "Unknown share." }, 404);

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const ownerToken = typeof body?.ownerToken === "string" ? body.ownerToken : "";
  const parts = Array.isArray(body?.parts)
    ? (body!.parts as unknown[])
        .map((p) => (typeof p === "object" && p !== null ? (p as { partNumber?: unknown; etag?: unknown }) : null))
        .filter((p): p is { partNumber: number; etag: string } => Boolean(p) && typeof p!.partNumber === "number" && typeof p!.etag === "string" && p!.etag.length > 0)
    : [];
  if (!ownerToken || !parts.length) return json({ error: "bad_request", message: "ownerToken and parts are required." }, 400);

  const pending = await loadPending(cfg, id);
  if (!pending) return json({ error: "not_found", message: "This upload was never started or already finished." }, 404);
  if ((await sha256Hex(ownerToken)) !== pending.ownerHash) {
    return json({ error: "forbidden", message: "That token doesn't own this upload." }, 403);
  }

  try {
    await completeMultipart(cfg, pending.key, pending.uploadId, parts);
  } catch (err) {
    await abortMultipart(cfg, pending.key, pending.uploadId);
    await deleteObject(cfg, objectKey(id, "pending.json"));
    return json({ error: "storage", message: err instanceof Error ? err.message : "Storage error." }, 502);
  }

  const head = await headObject(cfg, pending.key);
  const bytes = head.exists ? head.size : pending.bytes;
  const poster = Boolean(body?.poster) && (await headObject(cfg, objectKey(id, "poster.jpg"))).exists;
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

  return json({
    id,
    viewUrl: viewUrl(id),
    videoUrl: await publicUrl(cfg, pending.key),
    expiresAt: meta.expiresAt,
    bytes,
  });
}

/** The uploader can take a link down again; nobody else can. */
export async function DELETE(req: NextRequest, { params }: Params) {
  const cfg = shareConfig();
  if (!cfg) return notConfigured();
  const { id } = await params;
  if (!isValidId(id)) return json({ error: "not_found", message: "Unknown share." }, 404);

  const auth = req.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim();
  const body = (await req.json().catch(() => null)) as { ownerToken?: unknown } | null;
  const ownerToken = bearer || (typeof body?.ownerToken === "string" ? body.ownerToken : "");
  if (!ownerToken) return json({ error: "forbidden", message: "An owner token is required." }, 403);

  const share = await loadShare(id);
  const pending = share ? null : await loadPending(cfg, id);
  const ownerHash = share?.meta.ownerHash ?? pending?.ownerHash;
  if (!ownerHash) return json({ error: "not_found", message: "This link doesn't exist or has expired." }, 404);
  if ((await sha256Hex(ownerToken)) !== ownerHash) {
    return json({ error: "forbidden", message: "That token doesn't own this link." }, 403);
  }

  if (pending) await abortMultipart(cfg, pending.key, pending.uploadId);
  await Promise.all([
    deleteObject(cfg, objectKey(id, "video.mp4")),
    deleteObject(cfg, objectKey(id, "video.webm")),
    deleteObject(cfg, objectKey(id, "poster.jpg")),
    deleteObject(cfg, objectKey(id, "meta.json")),
    deleteObject(cfg, objectKey(id, "pending.json")),
  ]);
  return json({ ok: true });
}

export function OPTIONS() {
  return preflight();
}
