# social — local-first scheduler that agents can drive

`packages/feature-social` is the sixth shipshape tool: a calendar that
schedules posts to social networks **from the user's machine**, a composer
with per-network tabs and previews, a runner that publishes from the tray,
and a local HTTP + MCP server so AI agents (Claude Code, Cursor, Codex,
OpenClaw, Hermes, ChatGPT through a tunnel) can plan and queue posts that
the person reviews in the calendar. There is no shipshape cloud anywhere in
the path: every post goes straight from the desktop app to the network.

Inspired by Postiz (AGPL) for the UX shape; nothing was copied.

## Layout

```
src/
  types.ts          data model (the on-disk contract; Rust reads the same JSON)
  networks.ts       catalogue: 38 networks, limits, auth kind, availability
  model.ts          ids, defaults, tolerant parsers, tag palette
  storage.ts        <AppData>/social (Tauri fs) ⇄ IndexedDB (pnpm dev) adapter
  store.ts          zustand store; every mutation is read-modify-write on disk
  limits.ts         per-network counting (X weights, Bluesky graphemes, URL=23) + validation
  facets.ts         links / mentions / hashtags with UTF-16 + UTF-8 offsets
  unicode.ts        bold / italic through Mathematical Alphanumeric Symbols
  recurrence.ts     repeat rules → next occurrence
  time.ts           week / month grids, ISO with offset, relative times
  scheduler.ts      the runner: due posts, publish, retries, repeats, catch-up
  runtime.ts        startSocialRuntime(): store + runner + `social-changed` listener
  ai.ts             in-app AI (Anthropic / OpenAI-compatible) with the user's key
  agent.ts          agent server info, token masking, setup snippets
  sample.ts         browser-preview demo data
  providers/        one adapter per live network + OAuth PKCE helper + registry
  components/       SocialView (rail + pages), calendar/, composer/, channels/,
                    AgentsPage, SettingsPage, MediaPage (+DesignMedia),
                    AnalyticsPage, CatchUpSheet, Toasts, primitives (Radix)
  social.css        `.mod-social` reset (@layer base) + un-layered `sc-*` classes
```

Aliases: `@feature-social` in `apps/desktop/vite.config.ts`,
`apps/desktop/tsconfig.json` and `vitest.config.ts`. The tool is registered
in `shell/shellStore.ts` (`Tool = … | "social"`), `App.tsx` (lazy
`SocialModule` + the runtime effect), `shell/Hub.tsx` (card),
`shell/SuiteTitleBar.tsx` (crumb), `packages/ui/src/WinDots.tsx`
(`ToolIcons.social`) and `shell/Onboarding.tsx` (copy: six tools).

## Files on disk — `<AppData>/social/`

| file | content |
| --- | --- |
| `channels.json` | `{ version, channels: Channel[], collections: string[] }` — no secrets |
| `credentials.json` | `{ version, channels: { [channelId]: { …secrets } } }` |
| `posts/<id>.json` | one `Post` per file (see below) |
| `tags.json` | `{ version, tags: [{ id, name, color }] }` |
| `media.json` + `media/<id>.<ext>` | library index (`id, file, name, mime, bytes, width, height, duration, alt, createdAt`) + the bytes |
| `avatars/<channelId>.<ext>` | channel avatars downloaded at connect time |
| `settings.json` | calendar prefs, `agent: { enabled, port, token }`, `ai: { provider, baseUrl, model, apiKey }`, `unsplashKey` |

`Post` (camelCase, ISO-8601 strings with offset):

```
id, version, status: draft|scheduled|publishing|published|failed|cancelled,
scheduledAt|null, timezone, channelIds[], content: { text, media: [{id, alt?}],
thread: [{text, media}], title? }, overrides: { [channelId]: Partial<content> },
tags: string[] (tag ids), repeat: { kind: none|daily|weekly|monthly|every-n-days, every?, until? },
results: { [channelId]: { status: pending|ok|error|skipped, url?, remoteId?, error?, at, simulated? } },
attempts, nextAttemptAt|null, lastError|null, createdAt, updatedAt, publishedAt|null,
source: app|agent|repeat, repeatOf|null
```

**Concurrency.** Every write is atomic (temp file + rename) on both sides.
The frontend never overwrites from memory: `updatePost(id, fn)` re-reads the
file, applies `fn`, bumps `version`, writes. The Rust server does the same
and refuses a PATCH whose `version` is stale (409). After any server write
it emits the Tauri event `social-changed` and the UI reloads. Settings:
the frontend never touches the `agent` block (Rust owns the token/port);
`saveSettings` re-reads the file and keeps that block.

In the browser preview (`pnpm dev`) the same paths key an IndexedDB store,
network calls are simulated (`settings.simulate` is forced on), and a
“demo” button in the rail loads sample data.

## Providers

| network | status | connect | publish |
| --- | --- | --- | --- |
| Bluesky | live | handle + app password (createSession) | uploadBlob + createRecord with facets (links, `@handle.tld` mentions resolved to DIDs, #tags); threads as replies |
| Mastodon (any instance) | live | register app (`/api/v1/apps`, oob redirect) → browser → paste code → token | `/api/v2/media` + `/api/v1/statuses` (visibility pref, Idempotency-Key); threads as replies; instance char limit read from `/api/v2/instance` |
| Telegram | live | bot token + chat id/@username (getMe, getChat) | sendMessage / sendPhoto / sendVideo / sendMediaGroup; parse mode pref |
| Discord | live | channel webhook URL (GET webhook for name/avatar) | webhook `?wait=true`, files as attachments |
| Slack / Mattermost | live | incoming webhook URL | text only (images dropped with a warning) |
| Dev.to | live | API key (`/api/users/me`) | `/api/articles` markdown, title from the title field or first line, draft pref, default tags |
| Medium | live | integration token (`/v1/me`) | `/v1/users/{id}/posts` markdown |
| X | bring your own app | OAuth 2.0 + PKCE (`x.com/i/oauth2/authorize`, `api.x.com/2/oauth2/token`, refresh) with the loopback redirect | `POST /2/tweets`, v2 chunked media upload (`/2/media/upload/initialize` → `/{id}/append` → `/{id}/finalize`, STATUS polling), alt text, threads as replies |
| LinkedIn (member) | bring your own app | OAuth 2.0 auth code (secret required, `openid profile w_member_social`) | `rest/posts` (LinkedIn-Version `202606`, little-format escaping), one image via `rest/images?action=initializeUpload` + PUT |
| Threads, Instagram, Facebook, Reddit, Hashnode, Lemmy, Nostr, Farcaster, VK, Dribbble, Tumblr, WordPress, Ghost | bring your own app — **stub** | key form (keys saved in credentials.json) | channel is marked `stub`; validation blocks scheduling with a clear message |
| LinkedIn Page, TikTok, YouTube, Pinterest, Substack, Google Business, Snapchat, WhatsApp Channels, Twitch, Kick, Nextdoor, Vimeo, Bilibili, Xiaohongshu, Weibo | coming soon | listed, not connectable | — |

HTTP goes through `@tauri-apps/plugin-http` (`providers/http.ts`). Outside
Tauri the providers are replaced by a simulator. None of the live adapters
has been exercised against a real account in this build — see the report.

Character limits (`networks.ts`): X 280 (twitter-text weights, URLs 23),
Bluesky 300 graphemes, Mastodon 500 (URLs 23; instance override), Threads
500, LinkedIn 3000, Instagram 2200 (30 hashtags), Facebook 63206, Pinterest
500, TikTok 2200, YouTube 5000, Reddit 40000 body / 300 title, Telegram
4096 (1024 with media), Discord 2000, Slack 4000, Dev.to / Medium unlimited.
Per-channel override in preferences.

## Runner

`runtime.ts` starts with the app (App.tsx effect), so posts go out while
shipshape sits in the tray. Every 30 s (and after every `social-changed`)
`scheduler.tick()`:

1. hands stale `publishing` posts (> 5 min) back to the queue;
2. publishes posts due within the last `lateToleranceMinutes` (default 10):
   status → `publishing`, each channel → provider, results stored;
   all ok → `published` (+ the next occurrence for a repeat rule);
   retryable errors (429/5xx/network) → attempts 1 → 2 with 1 min / 5 min
   backoff, then `failed`; permanent errors fail at once, successes are kept
   and never re-sent;
3. posts due earlier than the tolerance (the app was closed) go to the
   **catch-up sheet**: publish now / tomorrow same time / skip, all or each.

Notifications: in-app toast always; native notification (plugin
`notification`) when `settings.notifications` is on.

## Agent API (Rust: `src-tauri/src/social/`)

An axum server on `127.0.0.1:<port>` (default 7474, settings → agent).
`mod.rs` starts it in `setup`, mints the bearer token on first run
(`ss_<48 hex>`), and exposes the commands `social_agent_info`,
`social_agent_regenerate_token`, `social_agent_configure { port, enabled }`.
`store.rs` = the JSON files, `server.rs` = routes + auth middleware + CORS,
`mcp.rs` = JSON-RPC.

Auth: `Authorization: Bearer <token>` on everything except `GET /health`,
`GET /oauth/callback` and preflights. `enabled=false` → 403 on REST/MCP
(the OAuth callback keeps working).

REST: `GET /channels` · `GET /posts?status&from&to&limit` · `GET /posts/{id}`
· `POST /posts` (`text`, `channelIds`, `scheduledAt`, `title`, `tags`,
`media`, `thread`, `overrides`, `repeat`, `status`) · `PATCH /posts/{id}`
(same fields + `version`) · `DELETE /posts/{id}` · `POST /posts/{id}/publish`
(marks due now; the app publishes; 202) · `GET /media` · `POST /media`
(JSON `{name, base64, mime?, alt?}`, multipart `file`, or raw bytes +
`X-File-Name`) · `GET /tags`.

MCP: `POST /mcp` (Streamable HTTP, JSON responses, no SSE; `GET` → 405).
Methods: `initialize` (2025-06-18 / 2025-03-26 / 2024-11-05), `ping`,
`tools/list`, `tools/call`, `resources/list`, `prompts/list`. Tools:
`list_channels`, `list_posts`, `get_post`, `create_post`, `update_post`,
`delete_post`, `publish_post`, `list_media`, `upload_media`, `list_tags`.

Setup snippets (Agents page): Claude Code
`claude mcp add --transport http shipshape-social http://127.0.0.1:7474/mcp --header "Authorization: Bearer <token>"`,
Cursor / OpenClaw / Hermes `mcpServers` JSON, Codex `config.toml`, ChatGPT
(needs a public HTTPS URL — tunnel note), plain curl.

OAuth loopback: `GET /oauth/callback?code&state` → HTML "you can close this
tab" + Tauri event `social-oauth-callback { state, code, error, errorDescription }`;
`providers/oauth.ts` opens the consent page with `plugin-opener` and waits
for the matching state (5 min timeout).

## Tests

`pnpm vitest run packages/feature-social` — limits, facets, unicode,
recurrence, time, model parsers, scheduler (due/missed/settle/backoff/repeat).
