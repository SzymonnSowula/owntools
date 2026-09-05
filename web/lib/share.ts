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
/** Presigned URLs stay valid this long — enough for a slow upload of a long take. */
const PRESIGN_SECONDS = 6 * 3600;
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

export function shareConfig(): ShareConfig | null {
  const endpoint = env(process.env.SHARE_S3_ENDPOINT);
  const bucket = env(process.env.SHARE_S3_BUCKET);
  const accessKeyId = env(process.env.SHARE_S3_ACCESS_KEY_ID);
  const secretAccessKey = env(process.env.SHARE_S3_SECRET_ACCESS_KEY);
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  const maxMb = Number(env(process.env.SHARE_MAX_MB) ?? "500");
  const ttl = Number(env(process.env.SHARE_TTL_DAYS) ?? "30");
  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    bucket,
    region: env(process.env.SHARE_S3_REGION) ?? "auto",
    accessKeyId,
    secretAccessKey,
    publicBase: env(process.env.SHARE_PUBLIC_BASE)?.replace(/\/+$/, ""),
    maxBytes: (Number.isFinite(maxMb) && maxMb > 0 ? maxMb : 500) * 1024 * 1024,
    ttlDays: Number.isFinite(ttl) && ttl >= 0 ? ttl : 30,
  };
}

function client(cfg: ShareConfig): AwsClient {
  return new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: "s3",
    region: cfg.region,
  });
}

export function objectKey(id: string, file: string): string {
  return `shares/${id}/${file}`;
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

/** A URL the uploader can PUT (or a viewer can GET) without credentials, for a limited time. */
export async function presign(
  cfg: ShareConfig,
  key: string,
  method: "PUT" | "GET",
  query?: Record<string, string>,
  expiresSeconds = PRESIGN_SECONDS,
): Promise<string> {
  const url = objectUrl(cfg, key, { ...(query ?? {}), "X-Amz-Expires": String(expiresSeconds) });
  const signed = await client(cfg).sign(url, { method, aws: { signQuery: true } });
  return signed.url;
}

function xmlValue(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  return m ? m[1] : null;
}

export async function createMultipart(cfg: ShareConfig, key: string, contentType: string): Promise<string> {
  const res = await s3(cfg, key, { method: "POST", query: { uploads: "" }, headers: { "content-type": contentType } });
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

export async function headObject(cfg: ShareConfig, key: string): Promise<{ exists: boolean; size: number }> {
  const res = await s3(cfg, key, { method: "HEAD" });
  if (!res.ok) return { exists: false, size: 0 };
  return { exists: true, size: Number(res.headers.get("content-length") ?? 0) };
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

export function newId(length = 10): string {
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

export function isExpired(meta: Pick<ShareMeta, "expiresAt">): boolean {
  return meta.expiresAt !== null && Date.now() > meta.expiresAt;
}

export async function publicUrl(cfg: ShareConfig, key: string): Promise<string> {
  if (cfg.publicBase) return `${cfg.publicBase}/${key}`;
  return presign(cfg, key, "GET", undefined, 3600);
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

/** The desktop app talks to these routes from its own origin, so every answer carries CORS headers. */
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Max-Age": "86400",
} as const;

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: CORS_HEADERS });
}

export function notConfigured(): NextResponse {
  return json(
    {
      error: "sharing_not_configured",
      message: "Sharing isn't switched on for this server yet.",
    },
    503,
  );
}

export function preflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/** Trims and bounds a user-supplied title. */
export function cleanName(value: unknown): string {
  const s = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return (s || "Recording").slice(0, 120);
}

export function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
