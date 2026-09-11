import { isTauri } from "@core/env";
import type { AgentInfo } from "./providers/oauth";

/**
 * The agent side of social: a local HTTP + MCP server the Rust side runs
 * (`src-tauri/src/social/`). This module only talks to it — status, token
 * rotation, port — and writes the setup snippets the Agents page shows.
 */

export { agentInfo } from "./providers/oauth";
export type { AgentInfo } from "./providers/oauth";

export async function regenerateAgentToken(): Promise<AgentInfo> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentInfo>("social_agent_regenerate_token");
}

export async function configureAgent(patch: { port?: number; enabled?: boolean }): Promise<AgentInfo> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentInfo>("social_agent_configure", { port: patch.port ?? null, enabled: patch.enabled ?? null });
}

/** An agent on this machine and whether our server is already in its config. */
export interface AgentTarget {
  id: string;
  detected: boolean;
  installed: boolean;
  path: string;
}

export interface InstallOutcome {
  target: string;
  path: string;
  action: "created" | "updated";
  note: string;
}

/** Names and one-liners for the agents we can configure without copy-paste. */
export const INSTALLABLE: { id: string; name: string; what: string }[] = [
  { id: "claude-code", name: "Claude Code", what: "~/.claude.json — every session, every project." },
  { id: "cursor", name: "Cursor", what: "~/.cursor/mcp.json — the global server list." },
  { id: "windsurf", name: "Windsurf", what: "~/.codeium/windsurf/mcp_config.json." },
  { id: "codex", name: "Codex CLI", what: "~/.codex/config.toml — under [mcp_servers]." },
];

export async function agentTargets(): Promise<AgentTarget[]> {
  if (!isTauri()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentTarget[]>("social_agent_targets");
}

/** Writes the MCP entry into that agent's config. Ask the person first. */
export async function installAgent(target: string): Promise<InstallOutcome> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<InstallOutcome>("social_agent_install", { target });
}

/**
 * What to say to the agent once it is connected. People stare at a working
 * MCP server without knowing what to ask it — this is the first sentence.
 */
export const STARTER_PROMPTS: { title: string; prompt: string }[] = [
  {
    title: "Post something now",
    prompt: "Using the owntools-social tools: read get_brand_voice, list my channels, write a short post about what I shipped today in that voice, run check_post on it, then post_now to the channels that fit. If it lands in review, tell me so I can approve it.",
  },
  {
    title: "Plan a week",
    prompt: "Using the owntools-social tools: read get_brand_voice, then write five posts about <topic> and put each one in the queue with add_to_queue (one client_ref per post, so a retry never doubles them). Run check_post first; use adapt_post where a channel's limit is tight. They will wait for my approval in Review — list them with times when you are done.",
  },
  {
    title: "Post a video",
    prompt: "Using the owntools-social tools: add_media_from_path for <path to the clip>, write a caption for each channel that takes video (list_networks says which), check_post, then add_to_queue with the media attached. Show me the caption before you queue it.",
  },
  {
    title: "Look after the queue",
    prompt: "Using the owntools-social tools: read the owntools://social/week resource and list_upcoming for 7 days, check each post against its networks with check_post, and tell me what would fail to publish and what is still waiting for my approval.",
  },
];

export function maskToken(token: string): string {
  if (!token) return "—";
  if (token.length <= 10) return "•".repeat(token.length);
  return `${token.slice(0, 5)}${"•".repeat(12)}${token.slice(-4)}`;
}

export interface AgentSnippet {
  id: string;
  name: string;
  /** One line under the name. */
  note: string;
  /** "shell" | "json" | "toml" | "text" — for the code block label. */
  lang: string;
  code: string;
  /** Needs a public URL (tunnel) rather than 127.0.0.1. */
  needsPublicUrl?: boolean;
}

export function agentSnippets(info: Pick<AgentInfo, "port" | "token">): AgentSnippet[] {
  const base = `http://127.0.0.1:${info.port}`;
  const mcp = `${base}/mcp`;
  const tok = info.token || "<token>";
  const json = JSON.stringify(
    { mcpServers: { "owntools-social": { type: "http", url: mcp, headers: { Authorization: `Bearer ${tok}` } } } },
    null,
    2,
  );
  return [
    {
      id: "claude-code",
      name: "Claude Code",
      note: "One command; the server shows up as tools in every session.",
      lang: "shell",
      code: `claude mcp add --transport http owntools-social ${mcp} --header "Authorization: Bearer ${tok}"`,
    },
    {
      id: "cursor",
      name: "Cursor",
      note: "Add to .cursor/mcp.json (project) or ~/.cursor/mcp.json (global).",
      lang: "json",
      code: json,
    },
    {
      id: "codex",
      name: "Codex CLI",
      note: "Append to ~/.codex/config.toml; the token comes from an environment variable.",
      lang: "toml",
      code: `[mcp_servers.owntools-social]\nurl = "${mcp}"\nbearer_token_env_var = "OWNTOOLS_SOCIAL_TOKEN"\n\n# then: export OWNTOOLS_SOCIAL_TOKEN=${tok}`,
    },
    {
      id: "openclaw",
      name: "OpenClaw",
      note: "Standard MCP server entry — paste into the agent's MCP config.",
      lang: "json",
      code: json,
    },
    {
      id: "hermes",
      name: "Hermes",
      note: "Same MCP entry; Hermes reads the mcpServers block.",
      lang: "json",
      code: json,
    },
    {
      id: "chatgpt",
      name: "ChatGPT",
      note: "Developer-mode connectors need a public HTTPS URL. Expose the port with a tunnel, then add the connector with the token as a bearer header.",
      lang: "shell",
      code: `# example with cloudflared (or ngrok, tailscale funnel…)\ncloudflared tunnel --url ${base}\n# connector URL: https://<your-tunnel-host>/mcp\n# Authorization: Bearer ${tok}`,
      needsPublicUrl: true,
    },
    {
      id: "rest",
      name: "Plain REST",
      note: "Any script or agent that can speak HTTP.",
      lang: "shell",
      code: [
        `curl -s ${base}/channels -H "Authorization: Bearer ${tok}"`,
        `curl -s ${base}/posts -X POST -H "Authorization: Bearer ${tok}" -H "Content-Type: application/json" \\`,
        `  -d '{"text":"Hello from an agent","channelIds":["<channel id>"],"scheduledAt":"2026-09-10T09:00:00+02:00"}'`,
      ].join("\n"),
    },
  ];
}

export const REST_ROUTES: { method: string; path: string; what: string }[] = [
  { method: "GET", path: "/health", what: "Liveness (no token needed)." },
  { method: "GET", path: "/channels", what: "Connected channels with their limits." },
  { method: "GET", path: "/posts", what: "Posts; filter with ?status=, ?from=, ?to= (ISO)." },
  { method: "GET", path: "/posts/{id}", what: "One post." },
  { method: "POST", path: "/posts", what: "Create: text, channelIds, scheduledAt (omit → draft), tags, media, thread, overrides." },
  { method: "PATCH", path: "/posts/{id}", what: "Update fields; send the version you read to avoid overwriting." },
  { method: "DELETE", path: "/posts/{id}", what: "Delete." },
  { method: "POST", path: "/posts/{id}/publish", what: "Publish now (the app does the network calls)." },
  { method: "GET", path: "/media", what: "Media library." },
  { method: "POST", path: "/media", what: "Upload: JSON {name, base64} or multipart file." },
  { method: "GET", path: "/tags", what: "Tags." },
  { method: "POST", path: "/posts/now", what: "Create and publish in one call." },
  { method: "GET", path: "/networks", what: "Networks with their limits and how many channels use them." },
  { method: "POST", path: "/check", what: "Check text + channelIds before creating anything." },
  { method: "GET", path: "/slots", what: "Free times: ?count=&from=&spacingMinutes=." },
  { method: "POST", path: "/media/path", what: "Add a file already on this machine: { path, alt? }." },
  { method: "POST", path: "/posts/queue", what: "Next free queue slot: { text, channelIds, mediaPaths?, client_ref? }." },
  { method: "GET", path: "/posts/upcoming", what: "What goes out in the next ?days= (default 7)." },
  { method: "GET", path: "/posts/search", what: "Find posts: ?q=&status=." },
  { method: "GET", path: "/review", what: "Posts waiting for your approval (read-only)." },
  { method: "POST", path: "/posts/{id}/reschedule", what: "Move a post: { at }." },
  { method: "POST", path: "/posts/{id}/duplicate", what: "Copy a post: { channelIds? }." },
  { method: "GET", path: "/voice", what: "The brand voice document (Markdown)." },
  { method: "PUT", path: "/voice", what: "Replace it: { markdown } or a text/markdown body." },
  { method: "POST", path: "/adapt", what: "Per-network variants of a text: { text, channelIds }." },
  { method: "GET", path: "/activity", what: "The activity log: ?limit=." },
  { method: "GET", path: "/week", what: "This week's calendar as Markdown." },
  { method: "GET", path: "/guide", what: "This whole workflow as Markdown." },
  { method: "POST", path: "/mcp", what: "MCP over Streamable HTTP (JSON-RPC)." },
];

export const MCP_TOOLS: { name: string; what: string }[] = [
  { name: "list_channels", what: "Connected channels, their network, character limit and queue slots." },
  { name: "list_networks", what: "Every network and what it takes — characters, images, video size and length." },
  { name: "get_brand_voice", what: "Your voice document (voice.md) — what every agent reads before writing a word." },
  { name: "set_brand_voice", what: "Rewrite the voice document (Markdown)." },
  { name: "check_post", what: "Would this text go out? Per-network count and blocking issues, before writing anything." },
  { name: "adapt_post", what: "One text → a version per network that fits its limit; model-backed when a model is set up, rules otherwise." },
  { name: "suggest_times", what: "Free times: the channels' queue slots first, then the preferred hour, skipping what is taken." },
  { name: "add_to_queue", what: "Text + channels (+ media paths) into the next free queue slot. Same client_ref twice = the same post." },
  { name: "create_post", what: "Draft or schedule a post; client_ref makes it idempotent, dry_run shows what would be created." },
  { name: "post_now", what: "Write and publish in one call — for “post this” (waits for approval when that is on)." },
  { name: "list_posts", what: "Posts, optionally by status or date range." },
  { name: "list_upcoming", what: "What goes out in the next N days, in order." },
  { name: "list_needs_review", what: "Posts waiting for the person's approval — read-only; approving is a human act." },
  { name: "search_posts", what: "Find posts by words in their text, optionally by status." },
  { name: "get_post", what: "One post with its per-channel results and URLs." },
  { name: "update_post", what: "Change text, time, channels, tags or per-channel overrides." },
  { name: "reschedule", what: "Move a post to another time." },
  { name: "duplicate_post", what: "Copy a post — same text and media, new channels if asked, no time yet." },
  { name: "delete_post", what: "Remove a post." },
  { name: "publish_post", what: "Publish a post that is already on the calendar." },
  { name: "add_media_from_path", what: "Take a file from disk into the library — how a video gets attached." },
  { name: "upload_media", what: "Add a small image from base64." },
  { name: "list_media", what: "Images and videos in the library." },
  { name: "list_tags", what: "Tags for the calendar." },
  { name: "get_activity", what: "The activity log — every agent write and every approval, rejection and undo." },
];

/** What `resources/list` offers next to the tools. */
export const MCP_RESOURCES: { uri: string; what: string }[] = [
  { uri: "owntools://social/guide", what: "How to drive this scheduler, in one page." },
  { uri: "owntools://social/week", what: "This week's calendar as Markdown: day → time · channel · status · first line." },
  { uri: "owntools://social/voice", what: "The brand voice document." },
];

export function isDesktop(): boolean {
  return isTauri();
}
