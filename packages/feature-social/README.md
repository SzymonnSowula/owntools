# social — local-first scheduler that agents can drive

`packages/feature-social` is the sixth owntools tool: a calendar that
schedules posts to social networks **from the user's machine**, a composer
with per-network tabs and previews, a runner that publishes from the tray,
and a local HTTP + MCP server so AI agents (Claude Code, Cursor, Codex,
OpenClaw, Hermes, ChatGPT through a tunnel) can plan and queue posts that
the person reviews in the calendar. There is no owntools cloud anywhere in
the path: every post goes straight from the desktop app to the network.

Inspired by Postiz (AGPL) for the UX shape; nothing was copied.

## Layout

```
src/
  types.ts          data model (the on-disk contract; Rust reads the same JSON)
  networks.ts       catalogue: 38 networks, limits, auth kind, availability;
                    `networksMirror()` is what the runtime writes to networks.json
  connect.ts        paste-to-connect: text in → which network + prefilled fields
  guides.ts         numbered setup steps per network (links, redirect URL, effort)
  model.ts          ids, defaults, tolerant parsers, tag palette
  storage.ts        <AppData>/social (Tauri fs) ⇄ IndexedDB (pnpm dev) adapter
  store.ts          zustand store; every mutation is read-modify-write on disk
  limits.ts         per-network counting (X weights, Bluesky graphemes, URL=23) + validation
  facets.ts         links / mentions / hashtags with UTF-16 + UTF-8 offsets
  unicode.ts        bold / italic through Mathematical Alphanumeric Symbols
  recurrence.ts     repeat rules → next occurrence
  time.ts           week / month grids, ISO with offset, relative times
  scheduler.ts      the runner: due posts, publish, retries, repeats, catch-up
  channelHealth.ts  saving rotated tokens at once, `channel.health`, "Test connection"
  accounts.ts       which account a channel is (a reconnect lands on the same channel)
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
| `networks.json` | mirror of `networks.ts` (id, name, limits) written by the runtime so the Rust agent server answers with the same numbers the composer enforces |

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

## Connecting an account

Connecting is where people give up, so there are two ways in and neither
asks "which network is this token from?" first.

**Paste anything** (`connect.ts`, pure + tested). The box at the top of the
Add-channel dialog takes whatever is on the clipboard and works out both the
network and the fields: a Discord/Slack/Mattermost webhook URL, a Telegram
bot token (plus the `@channel` or `-100…` id sitting next to it), a Bluesky
app password with the handle, `@you@instance`, a profile link on a host we
know, a Mastodon-shaped `https://instance/@user`. `exact` means the
credential itself was in the paste; `hint` means it only opens the right
form with a head start.

**Guided setup** (`guides.ts`). Each network's connect form shows numbered
steps instead of one dense note: how long it takes ("about a minute" vs
"about 10 minutes, most of it on their website"), what you end up pasting, a
button that opens the exact page, and copy chips for the values their form
wants — the loopback redirect URL and the scopes. Adding a network = one
`GUIDES` entry.

**Telegram** no longer asks anyone to hunt for a numeric chat id:
`discoverChats(token)` reads the bot's recent updates (adding a bot to a
channel produces a `my_chat_member` update) and "Find my chats" lists them
to pick from.

## Providers

| network | status | connect | publish |
| --- | --- | --- | --- |
| Bluesky | live | handle + app password (createSession) | uploadBlob + createRecord with facets (links, `@handle.tld` mentions resolved to DIDs, #tags); threads as replies; **video** through the video service (`getServiceAuth` → `app.bsky.video.uploadVideo` → job polling → `app.bsky.embed.video`), 50 MB / 3 min |
| Mastodon (any instance) | live | register app (`/api/v1/apps`, oob redirect) → browser → paste code → token | `/api/v2/media` + `/api/v1/statuses` (visibility pref, Idempotency-Key); an upload is **polled until the instance finishes processing it** (206 → 200), which is what makes video work; threads as replies; instance char limit read from `/api/v2/instance` |
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

## Video

An AT Protocol post carries images *or* a video, never both, and every
network has its own ceiling — so `networks.ts` carries `videoBytes` and
`videoSeconds` next to the image limits and `limits.ts` checks the attached
file against them before anything is scheduled (`limits.test.ts`). Bluesky
was silently dropping video before this: the embed only ever looked at
`image/*`.

A recording does not have to travel through the desktop to become a post.
screeni's export dialog has **Post it → Send to social**: it renders the
cut, hands the bytes over through `@core/handoff` (a module-level slot plus
a DOM event — same window, no file written), the shell switches tools, and
`SocialView` puts the clip in the media library and opens the composer with
it attached. `packages/core/src/handoff.test.ts` covers the contract.

## Runner

`runtime.ts` starts with the app (App.tsx effect), so posts go out while
owntools sits in the tray. Every 30 s (and after every `social-changed`)
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

**Tokens and channel health.** X and Bluesky retire a refresh token when it
is used, so a provider hands rotated credentials to `saveCreds` the moment a
refresh succeeds — returning them only at the end of a successful publish
lost them whenever the next call failed, and every retry then presented a
dead token. X also never refreshes one token twice (`x.ts`: `inflight` +
`rotated`), because "Publish all now" starts every missed post at once. A
`ProviderError` with `kind: "auth" | "billing"` is written onto the channel as
`channel.health` (the next success or a reconnect clears it); the calendar
shows it above the week with the scheduled posts it takes down, the Channels
page swaps the "live" pill for "signed out" / "out of credits", and `Reconnect`
signs the *same* channel in again (`reconnectChannel`, refused for a different
account) so its posts keep their channel id. X is pay-per-use: an empty credit
balance answers 402 on everything but the token endpoint.

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
(marks due now; the app publishes; 202) · `POST /posts/now` (create +
publish in one call) · `GET /media` · `POST /media`
(JSON `{name, base64, mime?, alt?}`, multipart `file`, or raw bytes +
`X-File-Name`) · `POST /media/path` (`{ path, name?, alt? }` — a file
already on this machine) · `GET /tags` · `GET /networks` · `POST /check`
· `GET /slots?count&from&spacingMinutes` · `GET /guide` (Markdown).

MCP: `POST /mcp` (Streamable HTTP, JSON responses, no SSE; `GET` → 405).
Methods: `initialize` (2025-06-18 / 2025-03-26 / 2024-11-05), `ping`,
`tools/list`, `tools/call`, `resources/list`, `resources/read`,
`prompts/list`, `prompts/get`. Tools: `list_channels`, `list_networks`,
`check_post`, `suggest_times`, `create_post`, `post_now`, `list_posts`,
`get_post`, `update_post`, `delete_post`, `publish_post`,
`add_media_from_path`, `upload_media`, `list_media`, `list_tags`.

The five newer ones are what turn "an API exists" into something an agent
gets right first time (`plan.rs`, unit-tested):

- `check_post` — the composer's own validation, before anything is written:
  per-network character count (X weights and URL-as-23 included), media
  limits, missing title, disabled or stub channels.
- `suggest_times` — free slots from the person's preferred hour, spaced,
  skipping what the calendar already holds. Agents otherwise invent times.
- `list_networks` — what each network takes, read from `networks.json`.
- `add_media_from_path` — a path instead of base64, so a video can be
  attached at all.
- `post_now` — create + publish in one call.

`resources/read` serves `owntools://social/guide`: the workflow, the traps
and the connected channels as Markdown (also `GET /guide`). `prompts/list`
offers three ready jobs (plan a week, post this video, look after the
queue).

**One-click setup** (`setup.rs`, `social_agent_install`): the Agents page
writes the MCP entry straight into Claude Code (`~/.claude.json`), Cursor
(`~/.cursor/mcp.json`), Windsurf (`~/.codeium/windsurf/mcp_config.json`) or
Codex (`~/.codex/config.toml`). Each merge keeps everything else in the file,
writes atomically, refuses a file it cannot parse, and is confirmed in a
dialog first — it is another program's configuration.

Setup snippets (Agents page): Claude Code
`claude mcp add --transport http owntools-social http://127.0.0.1:7474/mcp --header "Authorization: Bearer <token>"`,
Cursor / OpenClaw / Hermes `mcpServers` JSON, Codex `config.toml`, ChatGPT
(needs a public HTTPS URL — tunnel note), plain curl.

OAuth loopback: `GET /oauth/callback?code&state` → HTML "you can close this
tab" + Tauri event `social-oauth-callback { state, code, error, errorDescription }`;
`providers/oauth.ts` opens the consent page with `plugin-opener` and waits
for the matching state (5 min timeout).

## Tests

`pnpm vitest run packages/feature-social` — limits (including video size and
length), facets, unicode, recurrence, time, model parsers, scheduler
(due/missed/settle/backoff/repeat) and the paste detector. `cargo test
social::` covers the Rust half: character measuring against the same rules as
`limits.ts`, `check_post`, slot suggestion, media from a path, and the config
merges behind one-click agent setup.
