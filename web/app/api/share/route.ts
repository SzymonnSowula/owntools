import type { NextRequest } from "next/server";
import { allowRequest, clientAddress } from "@/lib/rateLimit";
import {
  MAX_PARTS,
  PART_SIZE,
  attachmentDisposition,
  cleanName,
  createMultipart,
  finiteNumber,
  json,
  newId,
  newToken,
  notConfigured,
  objectKey,
  preflight,
  presign,
  savePending,
  sha256Hex,
  shareConfig,
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
 * Step 1 of a share: the desktop app says what it is about to upload and gets
 * back one presigned PUT URL per 8 MB part (plus one for the poster). Nothing
 * is public until step 2 (POST /api/share/[id]) completes the upload.
 */
export async function POST(req: NextRequest) {
  const cfg = shareConfig();
  if (!cfg) return notConfigured();
  if (!allowRequest(`share:${clientAddress(req.headers)}`, SHARES_PER_HOUR, 3_600_000)) {
    return json(
      { error: "rate_limited", message: "Too many links from this network in the last hour. Try again later." },
      429,
    );
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: "bad_request", message: "Send a JSON body." }, 400);

  const bytes = finiteNumber(body.bytes);
  const contentType = body.contentType === "video/webm" ? "video/webm" : body.contentType === "video/mp4" ? "video/mp4" : null;
  if (!contentType || bytes <= 0) {
    return json({ error: "bad_request", message: "A video/mp4 or video/webm upload with a size is required." }, 400);
  }
  if (bytes > cfg.maxBytes) {
    return json(
      {
        error: "too_large",
        message: `Shares are limited to ${Math.round(cfg.maxBytes / 1024 / 1024)} MB.`,
        maxBytes: cfg.maxBytes,
      },
      413,
    );
  }
  const partCount = Math.max(1, Math.ceil(bytes / PART_SIZE));
  if (partCount > MAX_PARTS) return json({ error: "too_large", message: "That file has too many parts." }, 413);

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
    return json({ error: "storage", message: err instanceof Error ? err.message : "Storage error." }, 502);
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

  return json({
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

export function OPTIONS() {
  return preflight();
}
