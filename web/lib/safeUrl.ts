import { promises as dns } from "node:dns";

/**
 * Server-side guard for fetching a user-supplied URL (launch-intel route).
 *
 * Our server must never be talked into requesting an address on its own
 * network: loopback, private and link-local ranges (incl. the cloud metadata
 * service at 169.254.169.254), `*.localhost` names, and the IPv6 spellings of
 * the same — including IPv4-mapped forms such as `[::ffff:127.0.0.1]`.
 * `fetchPublicUrl` applies the check to every redirect hop as well, because a
 * public URL is free to 302 inward.
 *
 * Node-only (uses dns) — import from route handlers, never from components.
 */

/** Thrown when a URL (or a redirect target) must not be fetched. */
export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

/** How many redirects we are willing to follow before giving up. */
export const MAX_REDIRECTS = 3;

/** Only the web's own schemes — no file:, ftp:, data:, javascript:. */
export function isAllowedScheme(protocol: string): boolean {
  return protocol === "http:" || protocol === "https:";
}

/* ------------------------------- IPv4 ---------------------------------- */

type Octets = [number, number, number, number];

/** One dotted part, the way the WHATWG URL parser reads it (dec / 0x hex / 0 octal). */
function parseIPv4Part(part: string): number | null {
  let p = part;
  let radix = 10;
  if (/^0x/i.test(p)) {
    radix = 16;
    p = p.slice(2);
    if (p === "") return 0;
  } else if (p.length > 1 && p[0] === "0") {
    radix = 8;
    p = p.slice(1);
  }
  const valid = radix === 16 ? /^[0-9a-f]+$/i : radix === 8 ? /^[0-7]+$/ : /^\d+$/;
  if (p === "" || !valid.test(p)) return null;
  return parseInt(p, radix);
}

/**
 * Parses any IPv4 spelling the URL parser accepts (`127.0.0.1`, `127.1`,
 * `0x7f000001`, `2130706433`, `0177.0.0.1`) into four octets; null when the
 * string is a host name rather than an address.
 */
function parseIPv4(host: string): Octets | null {
  const parts = host.split(".");
  if (parts.length === 0 || parts.length > 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    const n = parseIPv4Part(part);
    if (n === null) return null;
    nums.push(n);
  }
  const last = nums[nums.length - 1];
  for (let i = 0; i < nums.length - 1; i++) if (nums[i] > 255) return null;
  if (last >= 256 ** (5 - nums.length)) return null;
  let value = last;
  for (let i = 0; i < nums.length - 1; i++) value += nums[i] * 256 ** (3 - i);
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

function isBlockedIPv4([a, b, c]: Octets): boolean {
  if (a === 0) return true; // 0.0.0.0/8 — "this network"
  if (a === 10) return true; // 10/8 — private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 — carrier-grade NAT
  if (a === 127) return true; // 127/8 — loopback
  if (a === 169 && b === 254) return true; // 169.254/16 — link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 — private
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0/24 — IETF protocol assignments
  if (a === 192 && b === 168) return true; // 192.168/16 — private
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 — benchmarking
  if (a >= 224) return true; // 224/4 multicast, 240/4 reserved, broadcast
  return false;
}

/* ------------------------------- IPv6 ---------------------------------- */

/** Expands an IPv6 literal (no brackets) to eight 16-bit groups; null if malformed. */
function parseIPv6(host: string): number[] | null {
  let h = host;
  const zone = h.indexOf("%"); // fe80::1%eth0 — drop the zone id
  if (zone !== -1) h = h.slice(0, zone);
  if (!h.includes(":") || !/^[0-9a-f:.]+$/i.test(h)) return null;

  // Embedded dotted IPv4 in the last position (::ffff:127.0.0.1, 64:ff9b::1.2.3.4).
  let tail: number[] = [];
  if (h.includes(".")) {
    const lastColon = h.lastIndexOf(":");
    const dotted = h.slice(lastColon + 1);
    const v4 = /^\d+\.\d+\.\d+\.\d+$/.test(dotted) ? parseIPv4(dotted) : null;
    if (!v4) return null;
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    const before = h.slice(0, lastColon + 1);
    h = before.endsWith("::") ? before : before.slice(0, -1);
  }

  const halves = h.split("::");
  if (halves.length > 2) return null;
  const parseGroups = (s: string): number[] | null => {
    if (s === "") return [];
    const out: number[] = [];
    for (const g of s.split(":")) {
      if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = parseGroups(halves[0]);
  const rest = halves.length === 2 ? parseGroups(halves[1]) : [];
  if (!head || !rest) return null;
  const known = head.length + rest.length + tail.length;
  if (halves.length === 2) {
    if (known > 7) return null;
    return [...head, ...new Array<number>(8 - known).fill(0), ...rest, ...tail];
  }
  if (known !== 8) return null;
  return [...head, ...rest, ...tail];
}

function isBlockedIPv6(g: number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g;
  const v4 = (hi: number, lo: number): Octets => [hi >> 8, hi & 255, lo >> 8, lo & 255];
  const leadingZeros = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  if (g.every((x) => x === 0)) return true; // :: — unspecified
  if (leadingZeros && g5 === 0 && g6 === 0 && g7 === 1) return true; // ::1 — loopback
  // ::ffff:a.b.c.d (IPv4-mapped) and ::a.b.c.d (IPv4-compatible) — judge the IPv4 inside.
  if (leadingZeros && (g5 === 0xffff || g5 === 0)) return isBlockedIPv4(v4(g6, g7));
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isBlockedIPv4(v4(g6, g7)); // 64:ff9b::/96 — NAT64
  }
  if (g0 === 0x2002) return isBlockedIPv4(v4(g1, g2)); // 2002::/16 — 6to4 embeds the IPv4 next
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 — unique local (fd00::1 …)
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 — link-local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 — multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // 2001:db8::/32 — documentation
  return false;
}

/* ------------------------------- hosts --------------------------------- */

/**
 * True when `hostname` (as `new URL(...).hostname` gives it, brackets and
 * all) must never be fetched from our server: loopback, private, link-local,
 * carrier-NAT, multicast and reserved IPv4 ranges — in every spelling the
 * URL parser accepts — their IPv6 counterparts incl. IPv4-mapped / NAT64 /
 * 6to4 forms, `localhost` and `*.localhost`, mDNS and internal suffixes, and
 * single-label names (`metadata`, `router`), which are never public sites.
 */
export function isBlockedHost(hostname: string): boolean {
  let host = hostname.trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host === "") return true;

  if (host.includes(":")) {
    const v6 = parseIPv6(host);
    return v6 ? isBlockedIPv6(v6) : true; // looks like IPv6 but will not parse: refuse
  }
  const v4 = parseIPv4(host);
  if (v4) return isBlockedIPv4(v4);

  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) return true;
  if (!host.includes(".")) return true;
  return false;
}

/**
 * Rejects a URL whose scheme or host we must not touch. For host *names* it
 * also resolves them and refuses any that point at a blocked address, so a
 * public-looking name cannot front for 169.254.169.254. (A name that does not
 * resolve is let through — fetch will fail on it with a clear error.)
 */
export async function assertPublicHttpUrl(url: URL): Promise<void> {
  if (!isAllowedScheme(url.protocol)) throw new BlockedUrlError("Only http(s) sites are supported.");
  if (isBlockedHost(url.hostname)) throw new BlockedUrlError("Local addresses are not supported.");
  const host = url.hostname.toLowerCase();
  if (host.includes(":") || parseIPv4(host)) return; // literal address, already judged
  let records: { address: string }[];
  try {
    records = await dns.lookup(host, { all: true });
  } catch {
    return;
  }
  if (records.some((r) => isBlockedHost(r.address))) {
    throw new BlockedUrlError("Local addresses are not supported.");
  }
}

/**
 * `fetch` that follows redirects by hand: every hop — the first URL and each
 * `Location` after it — has to pass `assertPublicHttpUrl`, and after
 * MAX_REDIRECTS hops we stop. Resolves with the response and the URL it came
 * from, so callers can resolve relative links against the page they landed on.
 */
export async function fetchPublicUrl(
  start: URL,
  init: RequestInit = {},
): Promise<{ res: Response; url: URL }> {
  let url = start;
  for (let hop = 0; ; hop++) {
    try {
      await assertPublicHttpUrl(url);
    } catch (err) {
      if (hop > 0 && err instanceof BlockedUrlError) {
        throw new BlockedUrlError("That site redirects to an address we cannot fetch.");
      }
      throw err;
    }
    const res = await fetch(url, { ...init, redirect: "manual" });
    if (res.status < 300 || res.status >= 400) return { res, url };

    const location = res.headers.get("location");
    await res.body?.cancel().catch(() => undefined);
    if (!location) return { res, url }; // a 3xx without Location — hand it back as a non-ok response
    if (hop >= MAX_REDIRECTS) throw new BlockedUrlError("That site redirected too many times.");
    try {
      url = new URL(location, url);
    } catch {
      throw new BlockedUrlError("That site redirected to an invalid address.");
    }
  }
}
