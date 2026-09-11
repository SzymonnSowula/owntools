import { SHARE_API_URL } from "@core/branding";
import { trackedFetch } from "@core/net";
import type { ShareLink } from "../types";

/**
 * Share links, from the app's side. An export is uploaded in 8 MB parts
 * through presigned URLs the site hands out, then the site stitches the file
 * and the link resolves at `${SITE_URL}/v/<id>`. The owner token that comes
 * back is what lets this machine delete the link later; it never leaves the
 * project file.
 *
 * In the desktop app the requests go through the native HTTP client, so
 * neither the API nor the bucket needs a CORS rule for the webview's origin.
 */

export type SharePhase = "creating" | "uploading" | "finishing";

export interface ShareUploadInput {
  blob: Blob;
  ext: "mp4" | "webm";
  name: string;
  width: number;
  height: number;
  duration: number;
  /** JPEG poster, shown before play and as the link preview. */
  poster?: Blob | null;
}

export class ShareError extends Error {
  code: string;
  constructor(message: string, code = "share_failed") {
    super(message);
    this.name = "ShareError";
    this.code = code;
  }
}

interface UploadPlan {
  id: string;
  ownerToken: string;
  partSize: number;
  partUrls: string[];
  posterUrl: string | null;
  viewUrl: string;
  expiresAt: number | null;
}

/** Every share request goes out through `@core/net`: logged in Settings → Privacy, refused in Offline mode. */
async function httpFetch(input: string, init: RequestInit, purpose: string): Promise<Response> {
  return trackedFetch(input, { ...init, purpose });
}

async function errorFrom(res: Response, fallback: string): Promise<ShareError> {
  let message = fallback;
  let code = "share_failed";
  try {
    const data = (await res.json()) as { message?: string; error?: string };
    if (data.message) message = data.message;
    if (data.error) code = data.error;
  } catch {
    /* not JSON */
  }
  if (res.status === 503 && code === "share_failed") code = "sharing_not_configured";
  return new ShareError(message, code);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

export async function createShareLink(
  input: ShareUploadInput,
  onProgress?: (phase: SharePhase, fraction: number) => void,
  signal?: AbortSignal,
): Promise<ShareLink> {
  const contentType = input.ext === "mp4" ? "video/mp4" : "video/webm";
  onProgress?.("creating", 0);
  const created = await httpFetch(
    SHARE_API_URL,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        bytes: input.blob.size,
        contentType,
        width: input.width,
        height: input.height,
        duration: input.duration,
        poster: Boolean(input.poster),
      }),
      signal,
    },
    "share link: create",
  );
  if (!created.ok) throw await errorFrom(created, "Couldn't start the upload.");
  const plan = (await created.json()) as UploadPlan;

  const parts: { partNumber: number; etag: string }[] = [];
  const total = plan.partUrls.length;
  for (let i = 0; i < total; i++) {
    throwIfAborted(signal);
    const slice = input.blob.slice(i * plan.partSize, Math.min(input.blob.size, (i + 1) * plan.partSize));
    const body = new Uint8Array(await slice.arrayBuffer());
    const res = await httpFetch(
      plan.partUrls[i],
      {
        method: "PUT",
        headers: { "content-type": contentType },
        body,
        signal,
      },
      "share link upload",
    );
    if (!res.ok) throw new ShareError(`Uploading part ${i + 1} of ${total} failed (${res.status}).`, "upload_failed");
    const etag = res.headers.get("etag") ?? res.headers.get("ETag") ?? "";
    if (!etag) throw new ShareError("The storage returned no ETag for a part — the bucket may hide response headers.", "upload_failed");
    parts.push({ partNumber: i + 1, etag });
    onProgress?.("uploading", (i + 1) / total);
  }

  if (input.poster && plan.posterUrl) {
    throwIfAborted(signal);
    const res = await httpFetch(
      plan.posterUrl,
      {
        method: "PUT",
        headers: { "content-type": "image/jpeg" },
        body: new Uint8Array(await input.poster.arrayBuffer()),
        signal,
      },
      "share link upload",
    );
    if (!res.ok) {
      // A missing poster only costs the preview image; the video still shares.
      input.poster = null;
    }
  }

  onProgress?.("finishing", 1);
  const done = await httpFetch(
    `${SHARE_API_URL}/${plan.id}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerToken: plan.ownerToken,
        parts,
        name: input.name,
        width: input.width,
        height: input.height,
        duration: input.duration,
        poster: Boolean(input.poster),
      }),
      signal,
    },
    "share link: finish",
  );
  if (!done.ok) throw await errorFrom(done, "Couldn't finish the upload.");
  const result = (await done.json()) as { viewUrl: string; expiresAt: number | null; bytes: number };

  return {
    id: plan.id,
    url: result.viewUrl || plan.viewUrl,
    ownerToken: plan.ownerToken,
    createdAt: Date.now(),
    bytes: result.bytes || input.blob.size,
    expiresAt: result.expiresAt ?? plan.expiresAt ?? undefined,
  };
}

export async function deleteShareLink(link: ShareLink): Promise<void> {
  const res = await httpFetch(
    `${SHARE_API_URL}/${link.id}`,
    {
      method: "DELETE",
      headers: { authorization: `Bearer ${link.ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ ownerToken: link.ownerToken }),
    },
    "share link: remove",
  );
  // A link that is already gone counts as deleted.
  if (!res.ok && res.status !== 404) throw await errorFrom(res, "Couldn't remove the link.");
}

export function describeShareError(err: unknown): string {
  if (err instanceof ShareError) {
    if (err.code === "sharing_not_configured") {
      return "Sharing isn't switched on for owntools.app yet — save the file and send it the usual way for now.";
    }
    return err.message;
  }
  if (err instanceof Error && err.message) {
    return /fetch|network|ENOTFOUND|ECONN/i.test(err.message)
      ? "Couldn't reach owntools.app. Check the connection and try again."
      : err.message;
  }
  return "Sharing failed.";
}

export function isShareExpired(link: ShareLink): boolean {
  return Boolean(link.expiresAt && Date.now() > link.expiresAt);
}
