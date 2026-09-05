import { isTauri } from "@core/env";

/**
 * One fetch for every provider. In the desktop app requests go through
 * `@tauri-apps/plugin-http` (no CORS, capability limited to https:// and
 * localhost); in the browser preview they would be blocked by CORS on most
 * APIs, so callers check `networkAvailable()` first and simulate instead.
 */

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function networkAvailable(): boolean {
  return isTauri();
}

export const DESKTOP_ONLY = "Connecting to networks needs the desktop app — the browser preview only simulates.";

export async function sfetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (isTauri()) {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return tauriFetch(url, init);
  }
  return fetch(url, init);
}

/** Error text for a failed response — the JSON `error`/`message` when there is one. */
export async function describeResponse(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const candidates = [
      j.error_description,
      j.message,
      j.error,
      j.detail,
      j.description,
      (j.errors as { message?: string }[] | undefined)?.[0]?.message,
      (j.error as { message?: string } | undefined)?.message,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) return `${res.status}: ${c.trim().slice(0, 300)}`;
    }
  } catch {
    /* not JSON */
  }
  const short = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return short ? `${res.status}: ${short}` : `HTTP ${res.status}`;
}

export async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) throw new HttpError(res.status, await describeResponse(res), "");
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Unexpected reply (not JSON): ${text.slice(0, 120)}`);
  }
}

export async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  return jsonOrThrow<T>(await sfetch(url, { method: "GET", headers }));
}

export async function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  return jsonOrThrow<T>(
    await sfetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

export async function postForm<T>(url: string, form: Record<string, string>, headers: Record<string, string> = {}): Promise<T> {
  return jsonOrThrow<T>(
    await sfetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
      body: new URLSearchParams(form).toString(),
    }),
  );
}

export async function postMultipart<T>(url: string, form: FormData, headers: Record<string, string> = {}): Promise<T> {
  return jsonOrThrow<T>(await sfetch(url, { method: "POST", headers, body: form }));
}

/** Downloads a small image (an avatar) — null on any failure. */
export async function fetchBytes(url: string, headers: Record<string, string> = {}): Promise<{ bytes: Uint8Array; mime: string } | null> {
  try {
    const res = await sfetch(url, { method: "GET", headers });
    if (!res.ok) return null;
    const mime = res.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
    return { bytes: new Uint8Array(await res.arrayBuffer()), mime };
  } catch {
    return null;
  }
}

export function fileFromBytes(bytes: Uint8Array, name: string, mime: string): File {
  return new File([bytes as BlobPart], name, { type: mime });
}

/** Bearer header helper. */
export const bearer = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });
