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

/**
 * The address a request came from, as the hosting proxy reports it.
 *
 * Order matters, because a per-IP limit is only worth anything if the caller
 * cannot choose their own bucket. `x-vercel-forwarded-for` is written by the
 * edge and never carried over from the request, so it is the one value a
 * client cannot forge. `x-forwarded-for` is read **rightmost first**: a proxy
 * appends the address it saw, so the last entry is the one our own proxy
 * added and everything to its left may have been sent by the caller. Taking
 * the leftmost entry - the usual reading - lets anyone mint a fresh bucket per
 * request by rotating the header, which switches every limit here off.
 */
export function clientAddress(headers: Headers): string {
  const vercel = headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  if (vercel) return vercel;
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = headers.get("x-forwarded-for")?.split(",");
  return forwarded?.[forwarded.length - 1]?.trim() || "unknown";
}
