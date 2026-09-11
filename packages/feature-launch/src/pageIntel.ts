import { isTauri } from "@core/env";
import { trackedFetch } from "@core/net";

export interface PageIntel {
  url: string;
  name: string;
  tagline: string;
  accent: string | null;
  imageDataUrl: string | null;
  logoDataUrl: string | null;
  features: string[];
}

/** "launch: reading acme.com" — the line the Privacy card shows for a page or asset read. */
function readingPurpose(url: string): string {
  try {
    return `launch: reading ${new URL(url).hostname.replace(/^www\./, "")}`;
  } catch {
    return "launch: reading a page";
  }
}

/**
 * Reads the page through `@core/net` (the HTTP plugin in the app, plain fetch
 * in the browser) so the read is logged and Offline mode can refuse it. The
 * browser forbids setting User-Agent, so the header is only sent natively.
 */
async function fetchText(url: string): Promise<string> {
  const res = await trackedFetch(url, {
    method: "GET",
    headers: isTauri() ? { "User-Agent": "Mozilla/5.0 (owntools launch-maker)" } : undefined,
    purpose: readingPurpose(url),
  });
  if (!res.ok) throw new Error(`The site answered ${res.status}.`);
  return res.text();
}

async function fetchDataUrl(url: string): Promise<string | null> {
  try {
    const res = await trackedFetch(url, { method: "GET", purpose: readingPurpose(url) });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size === 0 || blob.size > 15_000_000) return null;
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function link(doc: Document, selectors: string[], base: string): string | null {
  for (const sel of selectors) {
    const href = doc.querySelector(sel)?.getAttribute("href")?.trim();
    if (!href) continue;
    try {
      return new URL(href, base).toString();
    } catch {
      /* skip malformed hrefs */
    }
  }
  return null;
}

function meta(doc: Document, selectors: string[]): string | null {
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    const content = el?.getAttribute("content")?.trim();
    if (content) return content;
  }
  return null;
}

function cleanText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Extracts launch-video material from a page's HTML. Exported for testing. */
export function analyzeHtml(
  html: string,
  url: string,
): Omit<PageIntel, "imageDataUrl" | "logoDataUrl"> & { imageUrl: string | null; logoUrl: string | null } {
  const doc = new DOMParser().parseFromString(html, "text/html");

  const siteName = meta(doc, ['meta[property="og:site_name"]']);
  const ogTitle = meta(doc, ['meta[property="og:title"]', 'meta[name="twitter:title"]']);
  const docTitle = doc.querySelector("title")?.textContent ?? "";
  const h1 = doc.querySelector("h1")?.textContent ?? "";

  // Name: prefer the short site name; fall back to the part of the title
  // before a separator ("Acme — the fastest X" → "Acme").
  let name = siteName ?? "";
  if (!name) {
    const source = ogTitle || docTitle;
    name = cleanText(source.split(/[|–—-]|·/)[0] ?? source);
  }
  if (!name) name = cleanText(new URL(url).hostname.replace(/^www\./, "").split(".")[0]);

  const description =
    meta(doc, [
      'meta[property="og:description"]',
      'meta[name="description"]',
      'meta[name="twitter:description"]',
    ]) ?? "";
  let tagline = cleanText(h1) || cleanText(description);
  if (tagline.length > 90) tagline = `${tagline.slice(0, 87).trimEnd()}…`;

  const accent = meta(doc, ['meta[name="theme-color"]']);

  let imageUrl = meta(doc, ['meta[property="og:image"]', 'meta[name="twitter:image"]']);
  if (imageUrl) {
    try {
      imageUrl = new URL(imageUrl, url).toString();
    } catch {
      imageUrl = null;
    }
  }

  // Feature candidates: short h2/h3 headings, then short list items.
  const features: string[] = [];
  const push = (text: string | null | undefined) => {
    const t = cleanText(text ?? "");
    if (t.length >= 8 && t.length <= 60 && !features.includes(t) && features.length < 4) {
      features.push(t);
    }
  };
  doc.querySelectorAll("h2, h3").forEach((el) => push(el.textContent));
  if (features.length < 3) doc.querySelectorAll("main li, section li").forEach((el) => push(el.textContent));

  const logoUrl = link(
    doc,
    ['link[rel="apple-touch-icon"]', 'link[rel="icon"]', 'link[rel="shortcut icon"]'],
    url,
  );

  return { url, name, tagline, accent, imageUrl, logoUrl, features };
}

export async function analyzeUrl(rawUrl: string): Promise<PageIntel> {
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const html = await fetchText(url);
  const base = analyzeHtml(html, url);
  const [imageDataUrl, logoDataUrl] = await Promise.all([
    base.imageUrl ? fetchDataUrl(base.imageUrl) : Promise.resolve(null),
    base.logoUrl ? fetchDataUrl(base.logoUrl) : Promise.resolve(null),
  ]);
  return {
    url: base.url,
    name: base.name,
    tagline: base.tagline,
    accent: base.accent,
    imageDataUrl,
    logoDataUrl,
    features: base.features,
  };
}
