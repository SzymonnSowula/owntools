/**
 * A fixed-window counter per key, kept in this server instance's memory.
 *
 * Not a security boundary - a serverless deployment runs several instances and
 * each keeps its own count. It exists so one noisy client cannot spend the
 * Polar rate limit (500 requests a minute for the whole organization) that the
 * next real buyer's checkout needs.
 */

const windows = new Map<string, { count: number; resetAt: number }>();

export function allowRequest(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const current = windows.get(key);
  if (!current || now >= current.resetAt) {
    if (windows.size > 10_000) {
      for (const [k, w] of windows) if (now >= w.resetAt) windows.delete(k);
    }
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

/** The address a request came from, as the hosting proxy reports it. */
export function clientAddress(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || "unknown";
}
