import { AwsClient } from "aws4fetch";
import { NextResponse } from "next/server";
import { siteUrl } from "./site";

/**
 * Shareable links for screeni exports. The desktop app uploads the rendered
 * video straight into an S3-compatible bucket (Cloudflare R2, MinIO, AWS S3…)
 * through presigned multipart URLs, and the website serves a player page at
 * /v/<id>. There is no database: each share is a folder in the bucket with
 * the video, an optional poster and a meta.json. Whoever holds the owner
 * token (kept on the machine that uploaded) can delete it again.
 *
 * Everything here runs on the server only. Configuration is env-driven and
 * an unset bucket makes every endpoint answer "not configured" instead of
 * failing halfway through an upload.
 */

export const PART_SIZE = 8 * 1024 * 1024;
export const MAX_PARTS = 1000;
/** A poster is one JPEG frame; anything bigger than this is not one and is dropped. */
export const MAX_POSTER_BYTES = 5 * 1024 * 1024;
/**
 * Presigned URLs stay valid this long - enough for a 200 MB upload on a slow
 * line (27 minutes at 1 Mbit), and no longer. A plan handed out is a licence
 * to write into the bucket: a part URL cannot bound the size of what is PUT to
 * it, and parts that are never stitched together sit there until the bucket's
 * "abort incomplete multipart uploads" rule sweeps them. Every hour of life
 * here is an hour of that window.
 */
const PRESIGN_SECONDS = 2 * 3600;
/**
 * An upload nobody finished within this long is not finished later: the
 * completion is refused and the parts aborted. Without it a plan from last
 * week could still be stitched into a live link.
 */
export const PENDING_MAX_AGE_MS = 6 * 3600_000;
/**
 * How long the signed URL behind /v/<id>/video.mp4 lives. Every request to the
 * stable address signs a new one, so this only has to outlast one sitting: a
 * browser keeps reading a video from wherever the redirect sent it.
 */
const MEDIA_SECONDS = 12 * 3600;
const META_VERSION = 1;

export interface ShareConfig {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Public base URL of the bucket (CDN / custom domain). Without it, reads are presigned. */
  publicBase?: string;
  maxBytes: number;
  /** 0 = links never expire. */
  ttlDays: number;
  /**
   * The ceiling that turns an unknown bill into a known one. Storage is the
   * only line R2 charges that a flood can grow (egress is free there), so new
   * uploads are refused once the `shares/` prefix holds this many bytes.
   * Cloudflare has budget *alerts* but no spending cap, so the cap is here.
   */
  maxTotalBytes: number;
  /** …and a second ceiling on the count, so many small files cost the same thought as few big ones. */
  maxShares: number;
  /**
   * How many uploads may be open at once. Each one holds up to `maxBytes` of
   * parts that no listing shows and no ceiling above counts, until the
   * bucket's abort rule sweeps them - so this is what bounds that window.
   */
  maxPending: number;
  /** New uploads refused, everything already shared keeps playing. */
  uploadsOff: boolean;
}

export interface ShareMeta {
  version: number;
  id: string;
  name: string;
  bytes: number;
  contentType: string;
  ext: "mp4" | "webm";
  width: number;
  height: number;
  duration: number;
  createdAt: number;
  expiresAt: number | null;
  poster: boolean;
  ownerHash: string;
}

interface PendingUpload {
  id: string;
  key: string;
  uploadId: string;
  ownerHash: string;
  contentType: string;
  ext: "mp4" | "webm";
  bytes: number;
  createdAt: number;
  expiresAt: number | null;
}

const env = (value: string | undefined): string | undefined => {
  const v = value?.trim();
  return v ? v : undefined;
};

const DEFAULT_MAX_MB = 200;
const DEFAULT_TTL_DAYS = 30;
const DEFAULT_MAX_TOTAL_GB = 20;
const DEFAULT_MAX_SHARES = 2000;
const DEFAULT_MAX_PENDING = 40;

/** A positive number from the environment, or the fallback when it is missing or nonsense. */
function envNumber(value: string | undefined, fallback: number): number {
  const n = Number(env(value) ?? String(fallback));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** An environment switch: `1`, `true`, `yes` and `on` all mean on. */
function envFlag(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(env(value) ?? "");
}

/** Link lifetime in days (0 = until removed) - also what the privacy page and the terms say. */
export function shareTtlDays(): number {
  const ttl = Number(env(process.env.SHARE_TTL_DAYS) ?? String(DEFAULT_TTL_DAYS));
  return Number.isFinite(ttl) && ttl >= 0 ? ttl : DEFAULT_TTL_DAYS;
}

export function shareConfig(): ShareConfig | null {
  const endpoint = env(process.env.SHARE_S3_ENDPOINT);
  const bucket = env(process.env.SHARE_S3_BUCKET);
  const accessKeyId = env(process.env.SHARE_S3_ACCESS_KEY_ID);
  const secretAccessKey = env(process.env.SHARE_S3_SECRET_ACCESS_KEY);
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    bucket,
    region: env(process.env.SHARE_S3_REGION) ?? "auto",
    accessKeyId,
    secretAccessKey,
    publicBase: env(process.env.SHARE_PUBLIC_BASE)?.replace(/\/+$/, ""),
    maxBytes: envNumber(process.env.SHARE_MAX_MB, DEFAULT_MAX_MB) * 1024 * 1024,
    ttlDays: shareTtlDays(),
    maxTotalBytes: envNumber(process.env.SHARE_MAX_TOTAL_GB, DEFAULT_MAX_TOTAL_GB) * 1024 * 1024 * 1024,
    maxShares: Math.floor(envNumber(process.env.SHARE_MAX_SHARES, DEFAULT_MAX_SHARES)),
    maxPending: Math.floor(envNumber(process.env.SHARE_MAX_PENDING, DEFAULT_MAX_PENDING)),
    uploadsOff: envFlag(process.env.SHARE_UPLOADS_OFF),
  };
}

function client(cfg: ShareConfig): AwsClient {
  return new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: "s3",
    region: cfg.region,
    // aws4fetch retries a 500 or a 429 ten times by default, backing off up to
    // ~51 seconds in total. A storage that is refusing calls because it is
    // being hammered would then hold one of our functions open for the whole
    // of it, per request - the flood's own amplifier. Two tries and a short
    // wait: a blip is absorbed, a bad minute is reported instead of waited out.
    retries: 2,
    initRetryMs: 50,
  });
}

export function objectKey(id: string, file: string): string {
  return `shares/${id}/${file}`;
}

/** The bucket itself, for operations that address no object (listing). */
function bucketUrl(cfg: ShareConfig, query?: Record<string, string>): string {
  const url = new URL(`${cfg.endpoint}/${cfg.bucket}`);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  return url.toString();
}

/** Path-style URL: works for R2, MinIO and S3 alike. */
function objectUrl(cfg: ShareConfig, key: string, query?: Record<string, string>): string {
  const url = new URL(`${cfg.endpoint}/${cfg.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  return url.toString();
}

async function s3(
  cfg: ShareConfig,
  key: string,
  init: RequestInit & { query?: Record<string, string> } = {},
): Promise<Response> {
  const { query, ...rest } = init;
  return client(cfg).fetch(objectUrl(cfg, key, query), rest);
}

/**
 * A URL the uploader can PUT (or a viewer can GET) without credentials, for a
 * limited time. `headers` become part of the signature, so the storage refuses
 * a request that sends anything else (R2 answers 403 SignatureDoesNotMatch).
 */
export async function presign(
  cfg: ShareConfig,
  key: string,
  method: "PUT" | "GET",
  query?: Record<string, string>,
  expiresSeconds = PRESIGN_SECONDS,
  headers?: Record<string, string>,
): Promise<string> {
  const url = objectUrl(cfg, key, { ...(query ?? {}), "X-Amz-Expires": String(expiresSeconds) });
  const signed = await client(cfg).sign(url, {
    method,
    headers,
    // aws4fetch leaves content-type out of a signature unless told to sign every header given
    aws: { signQuery: true, allHeaders: Boolean(headers) },
  });
  return signed.url;
}

function xmlValue(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  return m ? m[1] : null;
}

export async function createMultipart(
  cfg: ShareConfig,
  key: string,
  contentType: string,
  contentDisposition?: string,
): Promise<string> {
  const headers: Record<string, string> = { "content-type": contentType };
  if (contentDisposition) headers["content-disposition"] = contentDisposition;
  const res = await s3(cfg, key, { method: "POST", query: { uploads: "" }, headers });
  const text = await res.text();
  const uploadId = res.ok ? xmlValue(text, "UploadId") : null;
  if (!uploadId) throw new Error(`Storage refused the upload (${res.status}).`);
  return uploadId;
}

export async function completeMultipart(
  cfg: ShareConfig,
  key: string,
  uploadId: string,
  parts: { partNumber: number; etag: string }[],
): Promise<void> {
  const body = `<CompleteMultipartUpload>${parts
    .slice()
    .sort((a, b) => a.partNumber - b.partNumber)
    .map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${escapeXml(p.etag)}</ETag></Part>`)
    .join("")}</CompleteMultipartUpload>`;
  const res = await s3(cfg, key, {
    method: "POST",
    query: { uploadId },
    headers: { "content-type": "application/xml" },
    body,
  });
  const text = await res.text();
  if (!res.ok || /<Error>/.test(text)) {
    throw new Error(`Storage could not finish the upload (${res.status}${xmlValue(text, "Code") ? `, ${xmlValue(text, "Code")}` : ""}).`);
  }
}

export async function abortMultipart(cfg: ShareConfig, key: string, uploadId: string): Promise<void> {
  await s3(cfg, key, { method: "DELETE", query: { uploadId } }).catch(() => undefined);
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** One page of a ListObjectsV2 answer. Pure, so the paging above it can be tested without a bucket. */
export function parseListing(xml: string): { keys: { key: string; size: number }[]; next: string | null } {
  const keys: { key: string; size: number }[] = [];
  const re = /<Contents>([\s\S]*?)<\/Contents>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const key = xmlValue(m[1], "Key");
    if (!key) continue;
    keys.push({ key, size: Number(xmlValue(m[1], "Size") ?? 0) || 0 });
  }
  const truncated = xmlValue(xml, "IsTruncated") === "true";
  const token = xmlValue(xml, "NextContinuationToken");
  return { keys, next: truncated && token ? token : null };
}

export interface BucketUsage {
  bytes: number;
  /** Shares that resolve: one `meta.json` each. */
  shares: number;
  /** Uploads started and not finished: one `pending.json` each. */
  pending: number;
  /** False when the walk stopped early because a ceiling was already passed. */
  complete: boolean;
  at: number;
}

/** At most this many pages per measurement, so the check stays cheap on a bucket that grew. */
const MAX_LIST_PAGES = 16;

/**
 * What the `shares/` prefix holds right now, measured with the bucket's own
 * listing - no second credential, no Cloudflare account token, and it works
 * the same on R2, MinIO or S3. The walk stops the moment a ceiling is passed,
 * because "how far over" changes nothing we do about it.
 */
export async function measureUsage(cfg: ShareConfig): Promise<BucketUsage | null> {
  let bytes = 0;
  let shares = 0;
  let pending = 0;
  let token: string | null = null;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const query: Record<string, string> = { "list-type": "2", prefix: "shares/", "max-keys": "1000" };
    if (token) query["continuation-token"] = token;
    const res = await client(cfg).fetch(bucketUrl(cfg, query), { method: "GET" });
    if (!res.ok) return null;
    const { keys, next } = parseListing(await res.text());
    for (const item of keys) {
      bytes += item.size;
      if (item.key.endsWith("/meta.json")) shares++;
      else if (item.key.endsWith("/pending.json")) pending++;
    }
    if (bytes >= cfg.maxTotalBytes || shares >= cfg.maxShares || pending >= cfg.maxPending) {
      return { bytes, shares, pending, complete: false, at: Date.now() };
    }
    if (!next) return { bytes, shares, pending, complete: true, at: Date.now() };
    token = next;
  }
  // More pages than the ceilings should ever need: treat it as full rather than paging on.
  return { bytes, shares, pending, complete: false, at: Date.now() };
}

let usageCache: { key: string; usage: BucketUsage } | null = null;

/** Re-measured often near a ceiling, rarely when there is room. */
function usageTtl(cfg: ShareConfig, usage: BucketUsage): number {
  const fullest = Math.max(
    usage.bytes / cfg.maxTotalBytes,
    usage.shares / cfg.maxShares,
    usage.pending / cfg.maxPending,
  );
  return fullest >= 0.8 ? 60_000 : 10 * 60_000;
}

const usageKey = (cfg: ShareConfig): string => `${cfg.endpoint}/${cfg.bucket}`;

/**
 * The cached reading, refreshed when it is stale. A listing costs a Class A
 * operation per page, so this must never run per request: between refreshes
 * `noteUpload` keeps the estimate moving, which is what stops a burst inside
 * one cache window from walking straight past the ceiling.
 */
export async function bucketUsage(cfg: ShareConfig): Promise<BucketUsage | null> {
  const key = usageKey(cfg);
  const cached = usageCache?.key === key ? usageCache.usage : null;
  if (cached && Date.now() - cached.at < usageTtl(cfg, cached)) return cached;
  const fresh = await measureUsage(cfg);
  // A listing that failed must not switch the ceiling off: keep the last reading.
  if (!fresh) return cached;
  usageCache = { key, usage: fresh };
  return fresh;
}

/**
 * Moves the cached reading by what just happened, so the ceiling holds between
 * measurements - and so a create/remove loop cannot force a fresh listing (and
 * its operations) on every turn.
 */
export function noteUsage(cfg: ShareConfig, delta: { bytes?: number; shares?: number; pending?: number }): void {
  const key = usageKey(cfg);
  if (usageCache?.key !== key) return;
  const u = usageCache.usage;
  const at = (n: number, d = 0) => Math.max(0, n + d);
  usageCache = {
    key,
    usage: {
      ...u,
      bytes: at(u.bytes, delta.bytes),
      shares: at(u.shares, delta.shares),
      pending: at(u.pending, delta.pending),
    },
  };
}

/** An upload just started: its bytes are promised and a pending slot is taken. */
export function noteUpload(cfg: ShareConfig, bytes: number): void {
  noteUsage(cfg, { bytes: Math.max(0, bytes), pending: 1 });
}

/** Test seam: forget what was measured. */
export function resetUsageCache(): void {
  usageCache = null;
}

export type FullReason = "bytes" | "shares" | "pending" | null;

/** Which ceiling a reading has reached, if any. */
export function fullReason(cfg: ShareConfig, usage: BucketUsage | null, incomingBytes = 0): FullReason {
  if (!usage) return null;
  if (usage.bytes + Math.max(0, incomingBytes) > cfg.maxTotalBytes) return "bytes";
  if (usage.shares >= cfg.maxShares) return "shares";
  if (usage.pending >= cfg.maxPending) return "pending";
  return null;
}

export async function headObject(cfg: ShareConfig, key: string): Promise<{ exists: boolean; size: number }> {
  const res = await s3(cfg, key, { method: "HEAD" });
  if (!res.ok) return { exists: false, size: 0 };
  return { exists: true, size: Number(res.headers.get("content-length") ?? 0) };
}

/** The first bytes of a stored object, for a container check. One Class B operation. */
export async function readHead(cfg: ShareConfig, key: string, length = 32): Promise<Uint8Array | null> {
  const res = await s3(cfg, key, { method: "GET", headers: { range: `bytes=0-${length - 1}` } }).catch(() => null);
  if (!res || !res.ok) return null;
  return new Uint8Array(await res.arrayBuffer());
}

/** Top-level boxes an ISO base media file (MP4/MOV) is allowed to open with. */
const MP4_BOXES = ["ftyp", "styp", "moov", "mdat", "free", "skip", "wide", "pnot", "junk", "uuid"];

/**
 * Does this actually look like a video container?
 *
 * The storage cannot tell: a presigned PUT stores whatever body it is given
 * under the content type the plan chose, so without this check the bucket is
 * a file host that answers `video/mp4` for a renamed archive or installer.
 * Checked once on the finished object, and a file that fails is deleted
 * rather than published. Deliberately lenient about which container it is -
 * the question is "a video at all", not "the extension we expected".
 */
export function looksLikeVideo(bytes: Uint8Array | null): boolean {
  if (!bytes || bytes.length < 12) return false;
  // Matroska / WebM: an EBML header.
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return true;
  const box = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
  return MP4_BOXES.includes(box);
}

/** A poster is a JPEG frame; a presigned PUT signed for `image/jpeg` still accepts any bytes. */
export function looksLikeJpeg(bytes: Uint8Array | null): boolean {
  return Boolean(bytes && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff);
}

/**
 * Compares two hex digests without letting the time taken say how much of the
 * value was right. Both are SHA-256 of an owner token, so a mismatch is the
 * normal case and must stay uninformative.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function putJson(cfg: ShareConfig, key: string, data: unknown): Promise<void> {
  const res = await s3(cfg, key, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Storage refused to write ${key} (${res.status}).`);
}

export async function getJson<T>(cfg: ShareConfig, key: string): Promise<T | null> {
  const res = await s3(cfg, key, { method: "GET" });
  if (!res.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function deleteObject(cfg: ShareConfig, key: string): Promise<void> {
  await s3(cfg, key, { method: "DELETE" }).catch(() => undefined);
}

const ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/**
 * 12 symbols of a 31-letter alphabet is about 2^59 - the link *is* the
 * password, and guessing is the only way in. Ten was 2^49; older ids stay
 * valid, `isValidId` takes 6 to 32.
 */
export function newId(length = 12): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
}

export function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function isValidId(id: string): boolean {
  return /^[a-z0-9]{6,32}$/.test(id);
}

export function viewUrl(id: string): string {
  return `${siteUrl}/v/${id}`;
}

/**
 * The address of a share's video or poster on the site itself
 * (`/v/<id>/video.mp4`, `/v/<id>/poster.jpg`). It never changes: every request
 * is answered with a redirect to a freshly signed storage URL, so a link
 * preview fetched a day later, or a download button pressed after lunch, still
 * works - a signed URL written into the page would have died after an hour.
 */
export function mediaUrl(id: string, file: string): string {
  return `${viewUrl(id)}/${file}`;
}

/** The storage key behind a `/v/<id>/<file>` address, or null for anything the share does not have. */
export function mediaKey(meta: Pick<ShareMeta, "id" | "ext" | "poster">, file: string): string | null {
  if (file === `video.${meta.ext}`) return objectKey(meta.id, file);
  if (file === "poster.jpg" && meta.poster) return objectKey(meta.id, file);
  return null;
}

/**
 * Stored on the video itself: opened directly (the download button), it saves
 * under the share's name instead of playing in a bare tab. A `<video>` element
 * ignores the header, and the `download` attribute alone does nothing for a
 * file on another origin. The quoted name is the ASCII fallback, `filename*`
 * the real one (RFC 6266).
 */
export function attachmentDisposition(name: string, ext: string): string {
  const base = name.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "recording";
  const ascii = base
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .replace(/[^ -~]/g, "_");
  const encoded = encodeURIComponent(`${base}.${ext}`).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}.${ext}"; filename*=UTF-8''${encoded}`;
}

export function isExpired(meta: Pick<ShareMeta, "expiresAt">): boolean {
  return meta.expiresAt !== null && Date.now() > meta.expiresAt;
}

/** An upload left open longer than a plan lives is not finished later, it is swept. */
export function isPendingStale(pending: Pick<PendingUpload, "createdAt">, now = Date.now()): boolean {
  return now - pending.createdAt > PENDING_MAX_AGE_MS;
}

/**
 * Where `/v/<id>/<file>` redirects: the public bucket when there is one, a
 * signed URL otherwise.
 *
 * `serveAs` is signed into the URL, and the storage answers with exactly those
 * headers whatever the object was stored with. That is the last link in the
 * chain that keeps a share from being served as anything but a video or a
 * JPEG: the type a browser sees no longer depends on what an uploader managed
 * to put in the bucket.
 */
export async function publicUrl(
  cfg: ShareConfig,
  key: string,
  serveAs?: { type: string; disposition?: string },
): Promise<string> {
  if (cfg.publicBase) return `${cfg.publicBase}/${key}`;
  const query: Record<string, string> = {};
  if (serveAs?.type) query["response-content-type"] = serveAs.type;
  if (serveAs?.disposition) query["response-content-disposition"] = serveAs.disposition;
  return presign(cfg, key, "GET", Object.keys(query).length ? query : undefined, MEDIA_SECONDS);
}

/** How a share's video and poster must be served, whatever landed in the bucket. */
export function serveAsFor(meta: ShareMeta, file: string): { type: string; disposition?: string } {
  return file === "poster.jpg"
    ? { type: "image/jpeg", disposition: "inline" }
    : { type: meta.contentType, disposition: attachmentDisposition(meta.name, meta.ext) };
}

export async function loadShare(id: string): Promise<{ cfg: ShareConfig; meta: ShareMeta } | null> {
  const cfg = shareConfig();
  if (!cfg || !isValidId(id)) return null;
  const meta = await getJson<ShareMeta>(cfg, objectKey(id, "meta.json"));
  if (!meta || meta.version !== META_VERSION || isExpired(meta)) return null;
  return { cfg, meta };
}

export async function savePending(cfg: ShareConfig, pending: PendingUpload): Promise<void> {
  await putJson(cfg, objectKey(pending.id, "pending.json"), pending);
}

export async function loadPending(cfg: ShareConfig, id: string): Promise<PendingUpload | null> {
  return getJson<PendingUpload>(cfg, objectKey(id, "pending.json"));
}

export function buildMeta(
  pending: PendingUpload,
  input: { name: string; width: number; height: number; duration: number; poster: boolean; bytes: number },
): ShareMeta {
  return {
    version: META_VERSION,
    id: pending.id,
    name: input.name,
    bytes: input.bytes,
    contentType: pending.contentType,
    ext: pending.ext,
    width: input.width,
    height: input.height,
    duration: input.duration,
    createdAt: pending.createdAt,
    expiresAt: pending.expiresAt,
    poster: input.poster,
    ownerHash: pending.ownerHash,
  };
}

export type { PendingUpload };

const CORS_BASE = {
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
} as const;

/**
 * The origins a browser may call these routes from.
 *
 * The desktop app goes through the native HTTP client, which is not a browser
 * and never asks: it works with or without a header here. So the only thing an
 * open `Access-Control-Allow-Origin: *` ever enabled was any web page in the
 * world making its visitors start uploads on our bucket - free amplification
 * that spends the pending-upload ceiling and denies real people a link. The
 * webview's own origin and a dev server are the whole list.
 */
export function allowedOrigin(origin: string | null | undefined): string | null {
  if (!origin) return null;
  if (/^(https?:\/\/tauri\.localhost|tauri:\/\/localhost)$/.test(origin)) return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  if (siteUrl && origin === siteUrl) return origin;
  return null;
}

export function corsHeaders(origin: string | null): Record<string, string> {
  return origin ? { ...CORS_BASE, "Access-Control-Allow-Origin": origin } : { ...CORS_BASE };
}

export function json(data: unknown, status = 200, origin: string | null = null): NextResponse {
  return NextResponse.json(data, { status, headers: corsHeaders(origin) });
}

export function notConfigured(origin: string | null = null): NextResponse {
  return json(
    {
      error: "sharing_not_configured",
      message: "Sharing isn't switched on for this server yet.",
    },
    503,
    origin,
  );
}

/** New uploads are paused; what is already shared keeps playing. */
export function uploadsPaused(origin: string | null = null): NextResponse {
  return json(
    {
      error: "sharing_paused",
      message: "New share links are paused right now. Save the file and send it the usual way.",
    },
    503,
    origin,
  );
}

export function preflight(req?: { headers: Headers }): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(allowedOrigin(req?.headers.get("origin"))) });
}

/**
 * Trims and bounds a user-supplied title.
 *
 * Control characters go (they would travel into a `Content-Disposition`
 * header), and so do the invisible formatting ones: a right-to-left override
 * in a title is how a download is made to read `…fdp.exe` as `…exe.pdf`.
 */
export function cleanName(value: unknown): string {
  const s =
    typeof value === "string"
      ? value
          .replace(/\s+/g, " ")
          .replace(/[\p{Cc}\p{Cf}]/gu, "")
          .trim()
      : "";
  return (s || "Recording").slice(0, 120);
}

export function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
