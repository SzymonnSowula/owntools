export const DEFAULT_SCROLL_SITES = [
  "x.com",
  "twitter.com",
  "tiktok.com",
  "instagram.com",
];

/**
 * A starting list so blocking a site is one click, not a typing exercise.
 * Grouped the way people actually lose an hour, and it includes the Polish
 * feeds — a generic English-only list is useless here.
 */
export interface SiteSuggestion {
  host: string;
  label: string;
  group: string;
}

export const SITE_SUGGESTIONS: SiteSuggestion[] = [
  { host: "x.com", label: "X", group: "Social" },
  { host: "twitter.com", label: "Twitter", group: "Social" },
  { host: "instagram.com", label: "Instagram", group: "Social" },
  { host: "facebook.com", label: "Facebook", group: "Social" },
  { host: "threads.net", label: "Threads", group: "Social" },
  { host: "linkedin.com", label: "LinkedIn", group: "Social" },
  { host: "bsky.app", label: "Bluesky", group: "Social" },
  { host: "mastodon.social", label: "Mastodon", group: "Social" },

  { host: "tiktok.com", label: "TikTok", group: "Video" },
  { host: "youtube.com", label: "YouTube", group: "Video" },
  { host: "twitch.tv", label: "Twitch", group: "Video" },
  { host: "netflix.com", label: "Netflix", group: "Video" },
  { host: "9gag.com", label: "9GAG", group: "Video" },

  { host: "reddit.com", label: "Reddit", group: "Forums" },
  { host: "news.ycombinator.com", label: "Hacker News", group: "Forums" },
  { host: "quora.com", label: "Quora", group: "Forums" },
  { host: "wykop.pl", label: "Wykop", group: "Forums" },
  { host: "discord.com", label: "Discord", group: "Forums" },

  { host: "onet.pl", label: "Onet", group: "News" },
  { host: "wp.pl", label: "Wirtualna Polska", group: "News" },
  { host: "interia.pl", label: "Interia", group: "News" },
  { host: "tvn24.pl", label: "TVN24", group: "News" },
  { host: "bbc.com", label: "BBC", group: "News" },
  { host: "cnn.com", label: "CNN", group: "News" },

  { host: "amazon.com", label: "Amazon", group: "Shopping" },
  { host: "allegro.pl", label: "Allegro", group: "Shopping" },
  { host: "olx.pl", label: "OLX", group: "Shopping" },
  { host: "aliexpress.com", label: "AliExpress", group: "Shopping" },
];

/** One raw entry → a bare host, or null if it isn't one. */
export function normalizeSite(raw: string): string | null {
  const host = raw
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]
    .toLowerCase();
  if (!host || !host.includes(".") || host.startsWith(".") || host.endsWith(".")) return null;
  return host;
}

export function parseSiteList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const host = normalizeSite(raw);
    if (!host || seen.has(host)) continue;
    seen.add(host);
    out.push(host);
  }
  return out;
}

export function siteListText(sites: string[]): string {
  return sites.join("\n");
}

/** The label we know for a host, or the host itself. */
export function siteLabel(host: string): string {
  return SITE_SUGGESTIONS.find((s) => s.host === host)?.label ?? host;
}

/**
 * Search over the catalogue: matches host or label, hides what is already
 * blocked, and keeps the list short enough to scan.
 */
export function searchSites(query: string, blocked: string[], limit = 8): SiteSuggestion[] {
  const q = query.trim().toLowerCase();
  const taken = new Set(blocked);
  const pool = SITE_SUGGESTIONS.filter((s) => !taken.has(s.host));
  if (!q) return pool.slice(0, limit);
  const scored = pool
    .map((s) => {
      const host = s.host.toLowerCase();
      const label = s.label.toLowerCase();
      if (host.startsWith(q) || label.startsWith(q)) return { s, rank: 0 };
      if (host.includes(q) || label.includes(q)) return { s, rank: 1 };
      return null;
    })
    .filter((x): x is { s: SiteSuggestion; rank: number } => x !== null)
    .sort((a, b) => a.rank - b.rank);
  return scored.slice(0, limit).map((x) => x.s);
}
