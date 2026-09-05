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
    { mcpServers: { "shipshape-social": { type: "http", url: mcp, headers: { Authorization: `Bearer ${tok}` } } } },
    null,
    2,
  );
  return [
    {
      id: "claude-code",
      name: "Claude Code",
      note: "One command; the server shows up as tools in every session.",
      lang: "shell",
      code: `claude mcp add --transport http shipshape-social ${mcp} --header "Authorization: Bearer ${tok}"`,
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
      code: `[mcp_servers.shipshape-social]\nurl = "${mcp}"\nbearer_token_env_var = "SHIPSHAPE_SOCIAL_TOKEN"\n\n# then: export SHIPSHAPE_SOCIAL_TOKEN=${tok}`,
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
  { method: "POST", path: "/mcp", what: "MCP over Streamable HTTP (JSON-RPC)." },
];

export const MCP_TOOLS: { name: string; what: string }[] = [
  { name: "list_channels", what: "Connected channels, their network and character limit." },
  { name: "list_posts", what: "Posts, optionally by status or date range." },
  { name: "get_post", what: "One post with results." },
  { name: "create_post", what: "Draft or schedule a post on one or more channels." },
  { name: "update_post", what: "Change text, time, channels, tags or per-channel overrides." },
  { name: "delete_post", what: "Remove a post." },
  { name: "publish_post", what: "Publish a post right away." },
  { name: "list_media", what: "Images and videos in the library." },
  { name: "upload_media", what: "Add an image (base64) to the library." },
  { name: "list_tags", what: "Tags for the calendar." },
];

export function isDesktop(): boolean {
  return isTauri();
}
