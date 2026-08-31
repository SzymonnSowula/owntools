export const DEFAULT_SCROLL_SITES = [
  "x.com",
  "twitter.com",
  "tiktok.com",
  "instagram.com",
];

export function parseSiteList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const host = raw
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[/?#]/)[0]
      .toLowerCase();
    if (!host || !host.includes(".") || seen.has(host)) continue;
    seen.add(host);
    out.push(host);
  }
  return out;
}

export function siteListText(sites: string[]): string {
  return sites.join("\n");
}
