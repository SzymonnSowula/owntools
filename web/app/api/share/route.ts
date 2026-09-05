import type { NextRequest } from "next/server";
import {
  MAX_PARTS,
  PART_SIZE,
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
 * Step 1 of a share: the desktop app says what it is about to upload and gets
 * back one presigned PUT URL per 8 MB part (plus one for the poster). Nothing
 * is public until step 2 (POST /api/share/[id]) completes the upload.
 */
export async function POST(req: NextRequest) {
  const cfg = shareConfig();
  if (!cfg) return notConfigured();

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

  let uploadId: string;
  try {
    uploadId = await createMultipart(cfg, key, contentType);
  } catch (err) {
    return json({ error: "storage", message: err instanceof Error ? err.message : "Storage error." }, 502);
  }

  const partUrls = await Promise.all(
    Array.from({ length: partCount }, (_, i) =>
      presign(cfg, key, "PUT", { partNumber: String(i + 1), uploadId }),
    ),
  );
  const posterUrl = body.poster ? await presign(cfg, objectKey(id, "poster.jpg"), "PUT") : null;

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
    name: cleanName(body.name),
  });
}

export function OPTIONS() {
  return preflight();
}
