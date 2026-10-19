import type { NextRequest } from "next/server";
import { allowRequest, clientAddress } from "@/lib/rateLimit";
import {
  MAX_PARTS,
  PART_SIZE,
  abortMultipart,
  allowedOrigin,
  attachmentDisposition,
  bucketUsage,
  cleanName,
  createMultipart,
  deleteObject,
  finiteNumber,
  fullReason,
  json,
  newId,
  newToken,
  noteUpload,
  notConfigured,
  objectKey,
  preflight,
  presign,
  savePending,
  sha256Hex,
  shareConfig,
  uploadsPaused,
  viewUrl,
} from "@/lib/share";

export const runtime = "nodejs";

/**
 * Links one network may start per hour. Per server instance (lib/rateLimit.ts),
 * so a ceiling on a script hammering the endpoint rather than a quota - a
 * person sharing their afternoon's takes never gets near it.
 */
const SHARES_PER_HOUR = 30;

/**
 * And a ceiling for the whole instance, because the limit above is per address
 * and sees nothing of a flood spread over many of them. The same brake
 * /api/key needed once it turned out that per-caller limits do not add up to
 * one. Real use is a handful of links a day.
 */
const CREATES_PER_MINUTE = 20;

/**
 * Step 1 of a share: the desktop app says what it is about to upload and gets
 * back one presigned PUT URL per 8 MB part (plus one for the poster). Nothing
 * is public until step 2 (POST /api/share/[id]) completes the upload.
 */
export async function POST(req: NextRequest) {
  const origin = allowedOrigin(req.headers.get("origin"));
  const reply = (data: unknown, status = 200) => json(data, status, origin);

  const cfg = shareConfig();
  if (!cfg) return notConfigured(origin);
  if (cfg.uploadsOff) return uploadsPaused(origin);
  if (
    !allowRequest(`share:${clientAddress(req.headers)}`, SHARES_PER_HOUR, 3_600_000) ||
    !allowRequest("share:all", CREATES_PER_MINUTE, 60_000)
  ) {
    return reply(
      { error: "rate_limited", message: "Too many links started just now. Try again in a few minutes." },
      429,
    );
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return reply({ error: "bad_request", message: "Send a JSON body." }, 400);

  const bytes = finiteNumber(body.bytes);
  const contentType = body.contentType === "video/webm" ? "video/webm" : body.contentType === "video/mp4" ? "video/mp4" : null;
  if (!contentType || bytes <= 0) {
    return reply({ error: "bad_request", message: "A video/mp4 or video/webm upload with a size is required." }, 400);
  }
  if (bytes > cfg.maxBytes) {
    return reply(
      {
        error: "too_large",
        message: `Shares are limited to ${Math.round(cfg.maxBytes / 1024 / 1024)} MB.`,
        maxBytes: cfg.maxBytes,
      },
      413,
    );
  }
  const partCount = Math.max(1, Math.ceil(bytes / PART_SIZE));
  if (partCount > MAX_PARTS) return reply({ error: "too_large", message: "That file has too many parts." }, 413);

  // The ceiling that decides what this feature can ever cost. Measured from the
  // bucket's own listing and cached, so it is a page listing now and then, not
  // one per request.
  const full = fullReason(cfg, await bucketUsage(cfg), bytes);
  if (full) {
    return reply(
      {
        error: "sharing_full",
        message:
          full === "pending"
            ? "Too many uploads are in flight right now. Try again in a few minutes."
            : "Sharing is at its storage limit right now. Try again later, or send the file the usual way.",
      },
      503,
    );
  }

  const id = newId();
  const ownerToken = newToken();
  const ext = contentType === "video/mp4" ? "mp4" : "webm";
  const key = objectKey(id, `video.${ext}`);
  const createdAt = Date.now();
  const expiresAt = cfg.ttlDays > 0 ? createdAt + cfg.ttlDays * 86_400_000 : null;
  const name = cleanName(body.name);

  let uploadId: string;
  try {
    uploadId = await createMultipart(cfg, key, contentType, attachmentDisposition(name, ext));
  } catch (err) {
    return reply({ error: "storage", message: err instanceof Error ? err.message : "Storage error." }, 502);
  }

  const partUrls = await Promise.all(
    Array.from({ length: partCount }, (_, i) =>
      presign(cfg, key, "PUT", { partNumber: String(i + 1), uploadId }),
    ),
  );
  // The content type is signed: the poster URL cannot be used to store an HTML page
  // (or anything but a JPEG) on the storage domain.
  const posterUrl = body.poster
    ? await presign(cfg, objectKey(id, "poster.jpg"), "PUT", undefined, undefined, { "content-type": "image/jpeg" })
    : null;

  try {
    await savePending(cfg, {
      id,
      key,
      uploadId,
      ownerHash: await sha256Hex(ownerToken),
      contentType,
      ext,
      bytes,
      createdAt,
      expiresAt,
    });
  } catch (err) {
    // Nobody can finish an upload with no pending record, so leaving the
    // multipart open would only park parts in the bucket until the sweep.
    await abortMultipart(cfg, key, uploadId);
    await deleteObject(cfg, objectKey(id, "pending.json"));
    return reply({ error: "storage", message: err instanceof Error ? err.message : "Storage error." }, 502);
  }
  // Book it against the cached reading: a burst inside one cache window must
  // not walk past the ceiling just because the last listing is a minute old.
  noteUpload(cfg, bytes);

  return reply({
    id,
    ownerToken,
    uploadId,
    partSize: PART_SIZE,
    partUrls,
    posterUrl,
    viewUrl: viewUrl(id),
    expiresAt,
    maxBytes: cfg.maxBytes,
    name,
  });
}

export function OPTIONS(req: NextRequest) {
  return preflight(req);
}
