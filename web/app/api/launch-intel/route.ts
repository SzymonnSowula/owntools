import { NextRequest, NextResponse } from "next/server";
import { BlockedUrlError, fetchPublicUrl, isAllowedScheme, isBlockedHost } from "@/lib/safeUrl";

export const runtime = "nodejs";

/**
 * Server-side page reader for the launch video maker. The browser can't fetch
 * arbitrary sites (CORS), so this route pulls the HTML, extracts launch
 * material with regexes (no DOM on the server) and inlines images as data
 * URLs so client canvases stay untainted. Nothing is stored.
 */

const HTML_LIMIT = 2_000_000; // 2 MB of HTML is plenty
const IMAGE_LIMIT = 10_000_000;
const ICON_LIMIT = 1_500_000;
const UA = "Mozilla/5.0 (compatible; shipshape-launch/1.0; +https://shipshape.app)";

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function clean(s: string): string {
  return decodeEntities(s).replace(/\s+/g, " ").trim();
}

/**
 * Animated headlines often duplicate their copy in hidden spans; stripping
 * tags then yields "the fastest X the fastest X". Collapse repeated phrases.
 */
function dedupeRepeat(s: string): string {
  let words = s.split(" ");
  let changed = true;
  while (changed) {
    changed = false;
    for (let n = Math.floor(words.length / 2); n >= 3; n--) {
      const a = words.slice(0, n).join(" ").toLowerCase();
      const b = words.slice(n, 2 * n).join(" ").toLowerCase();
      if (a === b) {
        words = [...words.slice(0, n), ...words.slice(2 * n)];
        changed = true;
        break;
      }
    }
  }
  return words.join(" ");
}

/** <meta property="og:title" content="..."> in either attribute order. */
function metaContent(html: string, keys: string[]): string | null {
  for (const key of keys) {
    const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`<meta[^>]+(?:name|property)=["']${k}["'][^>]*?content=["']([^"']+)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*?(?:name|property)=["']${k}["']`, "i"),
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m?.[1]) {
        const v = clean(m[1]);
        if (v) return v;
      }
    }
  }
  return null;
}

function tagText(html: string, tag: string, max: number): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < max) {
    const text = clean(m[1].replace(/<[^>]+>/g, " "));
    if (text) out.push(text);
  }
  return out;
}

function linkHref(html: string, rels: string[]): string | null {
  for (const rel of rels) {
    const patterns = [
      new RegExp(`<link[^>]+rel=["'][^"']*${rel}[^"']*["'][^>]*?href=["']([^"']+)["']`, "i"),
      new RegExp(`<link[^>]+href=["']([^"']+)["'][^>]*?rel=["'][^"']*${rel}[^"']*["']`, "i"),
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m?.[1]) return decodeEntities(m[1]);
    }
  }
  return null;
}

function absolute(href: string | null, base: string): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

async function fetchDataUrl(url: string, limit: number): Promise<string | null> {
  try {
    // Same guard as the page itself: a hostile page could point its og:image
    // at an internal address and read it back through us.
    const { res } = await fetchPublicUrl(new URL(url), {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!type.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > limit) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url")?.trim();
  if (!raw) return NextResponse.json({ error: "Missing url." }, { status: 400 });

  let target: URL;
  try {
    target = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return NextResponse.json({ error: "That doesn't look like a URL." }, { status: 400 });
  }
  if (!isAllowedScheme(target.protocol)) {
    return NextResponse.json({ error: "Only http(s) sites are supported." }, { status: 400 });
  }
  const hostname = target.hostname;
  if (isBlockedHost(hostname)) {
    return NextResponse.json({ error: "Local addresses are not supported." }, { status: 400 });
  }

  // Redirects are followed by hand (lib/safeUrl.ts) so every hop gets the same
  // scheme + host check — a public URL must not be able to 302 us inward.
  let html: string;
  let landed = target;
  try {
    const { res, url } = await fetchPublicUrl(target, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(15_000),
    });
    landed = url;
    if (!res.ok) {
      return NextResponse.json({ error: `The site answered ${res.status}.` }, { status: 502 });
    }
    html = (await res.text()).slice(0, HTML_LIMIT);
  } catch (err) {
    if (err instanceof BlockedUrlError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Couldn't reach that site." }, { status: 502 });
  }

  const siteName = metaContent(html, ["og:site_name"]);
  const ogTitle = metaContent(html, ["og:title", "twitter:title"]);
  const docTitle = tagText(html, "title", 1)[0] ?? "";
  const h1 = tagText(html, "h1", 1)[0] ?? "";

  let name = siteName ?? "";
  if (!name) {
    const source = ogTitle || docTitle;
    name = clean((source.split(/[|–—·]|\s-\s/)[0] ?? source) || "");
  }
  if (!name) name = hostname.replace(/^www\./, "").split(".")[0];
  if (name.length > 40) name = `${name.slice(0, 38).trimEnd()}…`;

  const description =
    metaContent(html, ["og:description", "description", "twitter:description"]) ?? "";
  let tagline = dedupeRepeat(h1) || description;
  if (tagline.length > 90) tagline = `${tagline.slice(0, 87).trimEnd()}…`;

  // Feature candidates: short h2/h3 headings, then short list items.
  const features: string[] = [];
  const push = (raw: string) => {
    const t = dedupeRepeat(raw);
    if (t.length >= 8 && t.length <= 60 && !/cookie|privacy|sign in|log in/i.test(t) && !features.includes(t) && features.length < 4) {
      features.push(t);
    }
  };
  tagText(html, "h2", 24).forEach(push);
  if (features.length < 3) tagText(html, "h3", 24).forEach(push);
  if (features.length < 3) tagText(html, "li", 40).forEach(push);

  const accentRaw = metaContent(html, ["theme-color", "msapplication-TileColor"]);
  const accent = accentRaw && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(accentRaw) ? accentRaw : null;

  // Relative asset links resolve against the page we actually landed on.
  const imageUrl = absolute(
    metaContent(html, ["og:image", "og:image:url", "twitter:image"]),
    landed.toString(),
  );
  const logoUrl = absolute(
    linkHref(html, ["apple-touch-icon", "icon"]),
    landed.toString(),
  );

  const [imageDataUrl, logoDataUrl] = await Promise.all([
    imageUrl ? fetchDataUrl(imageUrl, IMAGE_LIMIT) : Promise.resolve(null),
    logoUrl && !logoUrl.endsWith(".ico") ? fetchDataUrl(logoUrl, ICON_LIMIT) : Promise.resolve(null),
  ]);

  return NextResponse.json({
    url: target.toString(),
    host: hostname.replace(/^www\./, ""),
    name,
    tagline,
    description,
    features,
    accent,
    imageDataUrl,
    logoDataUrl,
  });
}
