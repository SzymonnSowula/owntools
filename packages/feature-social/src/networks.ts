import type { NetworkAvailability, NetworkId } from "./types";

/**
 * The catalogue. One entry per network the composer knows about, whether it
 * publishes today or not — the availability field is what the UI shows.
 *
 * Limits are per network, from the public docs (2026-09). `titleRequired`
 * marks article-style networks; `threads` marks the ones where follow-ups
 * become replies instead of being appended.
 */

export type AuthKind =
  | "app-password" // Bluesky
  | "oauth-oob" // Mastodon: register app, paste the code
  | "bot-token" // Telegram
  | "webhook" // Discord, Slack, Mattermost
  | "api-key" // Dev.to, Medium, Hashnode, Ghost…
  | "oauth-pkce" // X, LinkedIn, Threads… (bring your own app)
  | "none"; // coming soon

export interface NetworkLimits {
  /** Characters of the main text; Infinity when the network has none. */
  chars: number;
  /** Characters when media is attached (Telegram captions). */
  charsWithMedia?: number;
  /** Max images per post. */
  images: number;
  /** Max videos per post. */
  videos: number;
  /** Max bytes per image. */
  imageBytes?: number;
  /**
   * Max bytes per video. Only set where the platform fixes it (Bluesky 50 MB,
   * Telegram's bot API 50 MB, X 512 MB) — on Mastodon and Discord the ceiling
   * is instance or server configuration, and blocking a post on a guess is
   * worse than letting the network answer.
   */
  videoBytes?: number;
  /** Max length of a video, in seconds. */
  videoSeconds?: number;
  /** Title length for article networks. */
  title?: number;
  /** Max hashtags, when the network enforces one. */
  hashtags?: number;
}

export interface NetworkDef {
  id: NetworkId;
  name: string;
  /** simple-icons export name (`siX`); null = the app draws its own glyph. */
  icon: string | null;
  /** Brand hex, used for the small provider badge. */
  color: string;
  availability: NetworkAvailability;
  auth: AuthKind;
  limits: NetworkLimits;
  /** Replies-as-thread support. */
  threads: boolean;
  /** Bold / italic through Unicode styled letters makes sense here. */
  unicodeStyling: boolean;
  titleRequired: boolean;
  /** Short line under the name in the catalogue. */
  blurb: string;
  /** Where to create the developer app (bring-your-own-app networks). */
  devPortal?: string;
  /** Extra note shown on the connect form. */
  note?: string;
}

const UNLIMITED = Number.POSITIVE_INFINITY;

export const NETWORKS: NetworkDef[] = [
  {
    id: "x",
    name: "X",
    icon: "siX",
    color: "#000000",
    availability: "byo",
    auth: "oauth-pkce",
    limits: { chars: 280, images: 4, videos: 1, imageBytes: 5 * 1024 * 1024, videoBytes: 512 * 1024 * 1024, videoSeconds: 140 },
    threads: true,
    unicodeStyling: true,
    titleRequired: false,
    blurb: "Posts and threads, up to 4 images.",
    devPortal: "https://developer.x.com/en/portal/dashboard",
    note: "Create a free developer app, enable OAuth 2.0 (native app / public client) and add the redirect URL shown below.",
  },
  {
    id: "bluesky",
    name: "Bluesky",
    icon: "siBluesky",
    color: "#0085ff",
    availability: "live",
    auth: "app-password",
    limits: { chars: 300, images: 4, videos: 1, imageBytes: 1000 * 1000, videoBytes: 50 * 1024 * 1024, videoSeconds: 180 },
    threads: true,
    unicodeStyling: true,
    titleRequired: false,
    blurb: "Handle + app password. Links, mentions and tags become rich text.",
    note: "Use an app password (Settings → Privacy and security → App passwords), never your main password.",
  },
  {
    id: "mastodon",
    name: "Mastodon",
    icon: "siMastodon",
    color: "#6364ff",
    availability: "live",
    auth: "oauth-oob",
    limits: { chars: 500, images: 4, videos: 1 },
    threads: true,
    unicodeStyling: true,
    titleRequired: false,
    blurb: "Any instance. Authorise in the browser, paste the code.",
  },
  {
    id: "threads",
    name: "Threads",
    icon: "siThreads",
    color: "#000000",
    availability: "byo",
    auth: "oauth-pkce",
    limits: { chars: 500, images: 10, videos: 1, videoBytes: 1024 * 1024 * 1024, videoSeconds: 300 },
    threads: true,
    unicodeStyling: true,
    titleRequired: false,
    blurb: "Text and image posts through the Threads API.",
    devPortal: "https://developers.facebook.com/apps/",
  },
  {
    id: "instagram",
    name: "Instagram",
    icon: "siInstagram",
    color: "#e4405f",
    availability: "byo",
    auth: "oauth-pkce",
    limits: { chars: 2200, images: 10, videos: 1, hashtags: 30, videoBytes: 100 * 1024 * 1024, videoSeconds: 90 },
    threads: false,
    unicodeStyling: true,
    titleRequired: false,
    blurb: "Business or creator accounts via the Graph API; a photo is required.",
    devPortal: "https://developers.facebook.com/apps/",
  },
  {
    id: "facebook",
    name: "Facebook Page",
    icon: "siFacebook",
    color: "#0866ff",
    availability: "byo",
    auth: "oauth-pkce",
    limits: { chars: 63206, images: 10, videos: 1 },
    threads: false,
    unicodeStyling: true,
    titleRequired: false,
    blurb: "Page posts through the Graph API.",
    devPortal: "https://developers.facebook.com/apps/",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    icon: null,
    color: "#0a66c2",
    availability: "byo",
    auth: "oauth-pkce",
    limits: { chars: 3000, images: 1, videos: 1 },
    threads: false,
    unicodeStyling: true,
    titleRequired: false,
    blurb: "Personal profile posts with one image.",
    devPortal: "https://www.linkedin.com/developers/apps",
    note: "Your app needs the “Share on LinkedIn” and “Sign In with LinkedIn using OpenID Connect” products.",
  },
  {
    id: "linkedin-page",
    name: "LinkedIn Page",
    icon: null,
    color: "#0a66c2",
    availability: "soon",
    auth: "none",
    limits: { chars: 3000, images: 1, videos: 1 },
    threads: false,
    unicodeStyling: true,
    titleRequired: false,
    blurb: "Company pages need the Community Management API (partner review).",
  },
  {
    id: "tiktok",
    name: "TikTok",
    icon: "siTiktok",
    color: "#000000",
    availability: "soon",
    auth: "none",
    limits: { chars: 2200, images: 35, videos: 1 },
    threads: false,
    unicodeStyling: false,
    titleRequired: false,
    blurb: "Video posts via the Content Posting API (app audit required).",
  },
  {
    id: "youtube",
    name: "YouTube",
    icon: "siYoutube",
    color: "#ff0000",
    availability: "soon",
    auth: "none",
    limits: { chars: 5000, images: 0, videos: 1, title: 100 },
    threads: false,
    unicodeStyling: false,
    titleRequired: true,
    blurb: "Video uploads with title and description.",
  },
  {
    id: "pinterest",
    name: "Pinterest",
    icon: "siPinterest",
    color: "#bd081c",
    availability: "soon",
    auth: "none",
    limits: { chars: 500, images: 5, videos: 1, title: 100 },
    threads: false,
    unicodeStyling: false,
    titleRequired: true,
    blurb: "Pins with a title, a description and a link.",
  },
  {
    id: "reddit",
    name: "Reddit",
    icon: "siReddit",
    color: "#ff4500",
    availability: "byo",
    auth: "oauth-pkce",
    limits: { chars: 40000, images: 20, videos: 1, title: 300 },
    threads: false,
    unicodeStyling: false,
    titleRequired: true,
    blurb: "Text, link and image posts to a subreddit.",
    devPortal: "https://www.reddit.com/prefs/apps",
  },
  {
    id: "telegram",
    name: "Telegram",
    icon: "siTelegram",
    color: "#26a5e4",
    availability: "live",
    auth: "bot-token",
    limits: { chars: 4096, charsWithMedia: 1024, images: 10, videos: 10, videoBytes: 50 * 1024 * 1024 },
    threads: false,
    unicodeStyling: true,
    titleRequired: false,
    blurb: "A bot posts to a channel or group you admin.",
    note: "Create a bot with @BotFather, add it to the channel as an admin, then paste the token and the channel’s @username or numeric id.",
  },
  {
    id: "discord",
    name: "Discord",
    icon: "siDiscord",
    color: "#5865f2",
    availability: "live",
    auth: "webhook",
    limits: { chars: 2000, images: 10, videos: 10 },
    threads: false,
    unicodeStyling: false,
    titleRequired: false,
    blurb: "Messages through a channel webhook.",
    note: "Channel → Edit → Integrations → Webhooks → New webhook → Copy URL.",
  },
  {
    id: "slack",
    name: "Slack",
    icon: null,
    color: "#4a154b",
    availability: "live",
    auth: "webhook",
    limits: { chars: 4000, images: 0, videos: 0 },
    threads: false,
    unicodeStyling: false,
    titleRequired: false,
    blurb: "Text messages through an incoming webhook.",
    note: "Incoming webhooks post text only; images are dropped with a warning.",
  },
  {
    id: "medium",
    name: "Medium",
    icon: "siMedium",
    color: "#000000",
    availability: "live",
    auth: "api-key",
    limits: { chars: UNLIMITED, images: 0, videos: 0, title: 100 },
    threads: false,
    unicodeStyling: false,
    titleRequired: true,
    blurb: "Stories from Markdown with an integration token.",
    note: "Medium issues integration tokens under Settings → Security and apps; new tokens are not available to every account any more.",
  },
  {
    id: "devto",
    name: "Dev.to",
    icon: "siDevdotto",
    color: "#0a0a0a",
    availability: "live",
    auth: "api-key",
    limits: { chars: UNLIMITED, images: 1, videos: 0, title: 128, hashtags: 4 },
    threads: false,
    unicodeStyling: false,
    titleRequired: true,
    blurb: "Articles from Markdown with an API key.",
    note: "Settings → Extensions → DEV Community API Keys.",
  },
  {
    id: "hashnode",
    name: "Hashnode",
    icon: "siHashnode",
    color: "#2962ff",
    availability: "byo",
    auth: "api-key",
    limits: { chars: UNLIMITED, images: 1, videos: 0, title: 250 },
    threads: false,
    unicodeStyling: false,
    titleRequired: true,
    blurb: "Articles on your Hashnode publication.",
    devPortal: "https://hashnode.com/settings/developer",
  },
  {
    id: "lemmy",
    name: "Lemmy",
    icon: "siLemmy",
    color: "#000000",
    availability: "byo",
    auth: "api-key",
    limits: { chars: 10000, images: 1, videos: 0, title: 200 },
    threads: false,
    unicodeStyling: false,
    titleRequired: true,
    blurb: "Posts to a community on any instance.",
  },
  {
    id: "nostr",
    name: "Nostr",
    icon: null,
    color: "#8e30eb",
    availability: "byo",
    auth: "api-key",
    limits: { chars: UNLIMITED, images: 4, videos: 1 },
    threads: true,
    unicodeStyling: true,
    titleRequired: false,
    blurb: "Notes signed with your private key, sent to relays.",
  },
  {
    id: "farcaster",
    name: "Farcaster",
    icon: "siFarcaster",
    color: "#855dcd",
    availability: "byo",
    auth: "api-key",
    limits: { chars: 1024, images: 2, videos: 0 },
    threads: true,
    unicodeStyling: false,
    titleRequired: false,
    blurb: "Casts through a signer.",
  },
  {
    id: "vk",
    name: "VK",
    icon: "siVk",
    color: "#0077ff",
    availability: "byo",
    auth: "oauth-pkce",
    limits: { chars: 16000, images: 10, videos: 1 },
    threads: false,
    unicodeStyling: true,
    titleRequired: false,
    blurb: "Wall posts on a profile or community.",
    devPortal: "https://dev.vk.com/",
  },
  {
    id: "dribbble",
    name: "Dribbble",
    icon: "siDribbble",
    color: "#ea4c89",
    availability: "byo",
    auth: "oauth-pkce",
    limits: { chars: UNLIMITED, images: 1, videos: 1, title: 100 },
    threads: false,
    unicodeStyling: false,
    titleRequired: true,
    blurb: "Shots — for Pro accounts.",
    devPortal: "https://dribbble.com/account/applications",
  },
  {
    id: "tumblr",
    name: "Tumblr",
    icon: "siTumblr",
    color: "#36465d",
    availability: "byo",
    auth: "oauth-pkce",
    limits: { chars: 4096, images: 10, videos: 1 },
    threads: false,
    unicodeStyling: false,
    titleRequired: false,
    blurb: "Text and photo posts.",
    devPortal: "https://www.tumblr.com/oauth/apps",
  },
  {
    id: "wordpress",
    name: "WordPress",
    icon: "siWordpress",
    color: "#21759b",
    availability: "byo",
    auth: "api-key",
    limits: { chars: UNLIMITED, images: 1, videos: 0, title: 200 },
    threads: false,
    unicodeStyling: false,
    titleRequired: true,
    blurb: "Posts on a self-hosted site with an application password.",
  },
  {
    id: "ghost",
    name: "Ghost",
    icon: "siGhost",
    color: "#15171a",
    availability: "byo",
    auth: "api-key",
    limits: { chars: UNLIMITED, images: 1, videos: 0, title: 255 },
    threads: false,
    unicodeStyling: false,
    titleRequired: true,
    blurb: "Posts through the Admin API.",
  },
  {
    id: "substack",
    name: "Substack",
    icon: "siSubstack",
    color: "#ff6719",
    availability: "soon",
    auth: "none",
    limits: { chars: UNLIMITED, images: 1, videos: 0, title: 200 },
    threads: false,
    unicodeStyling: false,
    titleRequired: true,
    blurb: "No public API yet.",
  },
  {
    id: "google-business",
    name: "Google Business",
    icon: "siGoogle",
    color: "#4285f4",
    availability: "soon",
    auth: "none",
    limits: { chars: 1500, images: 1, videos: 0 },
    threads: false,
    unicodeStyling: false,
    titleRequired: false,
    blurb: "Local posts on a business profile.",
  },
  {
    id: "snapchat",
    name: "Snapchat",
    icon: "siSnapchat",
    color: "#fffc00",
    availability: "soon",
    auth: "none",
    limits: { chars: 250, images: 1, videos: 1 },
    threads: false,
    unicodeStyling: false,
    titleRequired: false,
    blurb: "Public stories for creators.",
  },
  {
    id: "whatsapp",
    name: "WhatsApp Channels",
    icon: "siWhatsapp",
    color: "#25d366",
    availability: "soon",
    auth: "none",
    limits: { chars: 65536, images: 1, videos: 1 },
    threads: false,
    unicodeStyling: true,
    titleRequired: false,
    blurb: "No public channel API yet.",
  },
  {
    id: "twitch",
    name: "Twitch",
    icon: "siTwitch",
    color: "#9146ff",
    availability: "soon",
    auth: "none",
    limits: { chars: 500, images: 0, videos: 0 },
    threads: false,
    unicodeStyling: false,
    titleRequired: false,
    blurb: "Chat announcements.",
  },
  {
    id: "kick",
    name: "Kick",
    icon: "siKick",
    color: "#53fc18",
    availability: "soon",
    auth: "none",
    limits: { chars: 500, images: 0, videos: 0 },
    threads: false,
    unicodeStyling: false,
    titleRequired: false,
    blurb: "Chat messages.",
  },
  {
    id: "mattermost",
    name: "Mattermost",
    icon: "siMattermost",
    color: "#0058cc",
    availability: "byo",
    auth: "webhook",
    limits: { chars: 16383, images: 0, videos: 0 },
    threads: false,
    unicodeStyling: false,
    titleRequired: false,
    blurb: "Messages through an incoming webhook.",
  },
  {
    id: "nextdoor",
    name: "Nextdoor",
    icon: "siNextdoor",
    color: "#8ed500",
    availability: "soon",
    auth: "none",
    limits: { chars: 5000, images: 10, videos: 1 },
    threads: false,
    unicodeStyling: false,
    titleRequired: false,
    blurb: "Business posts (partner API).",
  },
  {
    id: "vimeo",
    name: "Vimeo",
    icon: "siVimeo",
    color: "#1ab7ea",
    availability: "soon",
    auth: "none",
    limits: { chars: 5000, images: 0, videos: 1, title: 128 },
    threads: false,
    unicodeStyling: false,
    titleRequired: true,
    blurb: "Video uploads.",
  },
  {
    id: "bilibili",
    name: "Bilibili",
    icon: "siBilibili",
    color: "#00a1d6",
    availability: "soon",
    auth: "none",
    limits: { chars: 2000, images: 9, videos: 1 },
    threads: false,
    unicodeStyling: false,
    titleRequired: false,
    blurb: "Dynamics and videos.",
  },
  {
    id: "xiaohongshu",
    name: "Xiaohongshu",
    icon: "siXiaohongshu",
    color: "#ff2442",
    availability: "soon",
    auth: "none",
    limits: { chars: 1000, images: 18, videos: 1, title: 20 },
    threads: false,
    unicodeStyling: false,
    titleRequired: true,
    blurb: "Notes with images.",
  },
  {
    id: "weibo",
    name: "Weibo",
    icon: "siSinaweibo",
    color: "#e6162d",
    availability: "soon",
    auth: "none",
    limits: { chars: 2000, images: 9, videos: 1 },
    threads: false,
    unicodeStyling: false,
    titleRequired: false,
    blurb: "Posts with images.",
  },
];

const BY_ID = new Map(NETWORKS.map((n) => [n.id, n]));

export function networkById(id: string): NetworkDef {
  return BY_ID.get(id as NetworkId) ?? GENERIC;
}

/** Fallback for an unknown provider id in an old channels.json. */
const GENERIC: NetworkDef = {
  id: "x",
  name: "Unknown network",
  icon: null,
  color: "#6e6e73",
  availability: "soon",
  auth: "none",
  limits: { chars: 1000, images: 1, videos: 0 },
  threads: false,
  unicodeStyling: false,
  titleRequired: false,
  blurb: "",
};

export const AVAILABILITY_LABEL: Record<NetworkAvailability, string> = {
  live: "live",
  byo: "bring your own app",
  soon: "coming soon",
};

/**
 * The catalogue as the Rust agent server reads it. `networks.ts` stays the
 * one source of truth: the runtime mirrors this into
 * `<AppData>/social/networks.json` so `check_post` and `list_networks` answer
 * with the same limits the composer enforces, instead of a second table in
 * Rust that would drift the first time a network changes its mind.
 */
export function networksMirror(): { version: number; networks: Record<string, unknown>[] } {
  return {
    version: 1,
    networks: NETWORKS.map((n) => ({
      id: n.id,
      name: n.name,
      availability: n.availability,
      auth: n.auth,
      blurb: n.blurb,
      threads: n.threads,
      titleRequired: n.titleRequired,
      chars: Number.isFinite(n.limits.chars) ? n.limits.chars : 0,
      ...(n.limits.charsWithMedia ? { charsWithMedia: n.limits.charsWithMedia } : {}),
      images: n.limits.images,
      videos: n.limits.videos,
      ...(n.limits.imageBytes ? { imageBytes: n.limits.imageBytes } : {}),
      ...(n.limits.videoBytes ? { videoBytes: n.limits.videoBytes } : {}),
      ...(n.limits.videoSeconds ? { videoSeconds: n.limits.videoSeconds } : {}),
      ...(n.limits.title ? { title: n.limits.title } : {}),
      ...(n.limits.hashtags ? { hashtags: n.limits.hashtags } : {}),
    })),
  };
}

export function countByAvailability(): Record<NetworkAvailability, number> {
  const out: Record<NetworkAvailability, number> = { live: 0, byo: 0, soon: 0 };
  for (const n of NETWORKS) out[n.availability] += 1;
  return out;
}
