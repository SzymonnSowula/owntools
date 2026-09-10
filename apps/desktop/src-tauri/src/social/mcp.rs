//! The MCP half: JSON-RPC 2.0 over POST /mcp. `initialize`, `ping`,
//! `tools/list`, `tools/call` — the same operations as the REST routes,
//! described with JSON schemas so any MCP client can discover them.

use serde_json::{json, Value};

use super::plan;
use super::server::emit_changed;
use super::store::{self, ApiError, PostFilter};
use super::SocialState;

pub const PROTOCOL_VERSION: &str = "2025-06-18";
const SUPPORTED: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];

pub fn error_response(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn ok_response(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn tools() -> Value {
    let media_ref = json!({ "type": "array", "items": { "type": "string" }, "description": "Media library ids (see list_media / add_media_from_path)." });
    let thread = json!({ "type": "array", "items": { "type": "string" }, "description": "Follow-up parts. Networks with threads post them as replies; others get them appended." });
    let overrides = json!({
        "type": "object",
        "description": "Per-channel text/title overrides keyed by channel id: { \"<channelId>\": { \"text\": \"...\" } }.",
        "additionalProperties": { "type": "object", "properties": { "text": { "type": "string" }, "title": { "type": "string" } } }
    });
    let repeat = json!({
        "type": "object",
        "properties": { "kind": { "type": "string", "enum": ["none", "daily", "weekly", "monthly", "every-n-days"] }, "every": { "type": "integer", "minimum": 1 } }
    });
    json!([
        {
            "name": "list_channels",
            "description": "Connected social channels: id, provider (network), handle, displayName, disabled. Use the ids in create_post.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "list_posts",
            "description": "Posts on the calendar. Filter by status (draft, scheduled, publishing, published, failed, cancelled) and an ISO date range on scheduledAt.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "status": { "type": "string" },
                    "from": { "type": "string", "description": "ISO 8601 lower bound" },
                    "to": { "type": "string", "description": "ISO 8601 upper bound" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 500 }
                },
                "additionalProperties": false
            }
        },
        {
            "name": "get_post",
            "description": "One post with its per-channel results (status, url, error).",
            "inputSchema": { "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"], "additionalProperties": false }
        },
        {
            "name": "create_post",
            "description": "Create a post. With scheduledAt and channelIds it is scheduled; without scheduledAt it is a draft the person can finish in the calendar. Times: ISO 8601 (a missing offset means the machine's local time). Text limits per network apply at publish time — keep X under 280, Bluesky under 300, Mastodon under 500.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": { "type": "string" },
                    "channelIds": { "type": "array", "items": { "type": "string" } },
                    "scheduledAt": { "type": "string" },
                    "title": { "type": "string", "description": "Article networks (Dev.to, Medium, Reddit…)" },
                    "tags": { "type": "array", "items": { "type": "string" }, "description": "Tag ids from list_tags" },
                    "media": media_ref,
                    "thread": thread,
                    "overrides": overrides,
                    "repeat": repeat,
                    "status": { "type": "string", "enum": ["draft", "scheduled"] }
                },
                "required": ["text"],
                "additionalProperties": false
            }
        },
        {
            "name": "update_post",
            "description": "Change a post: text, scheduledAt, channelIds, tags, media, thread, overrides, repeat, title, or status (draft / scheduled / cancelled). Pass the version you read to avoid overwriting someone else's edit.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "version": { "type": "integer" },
                    "text": { "type": "string" },
                    "channelIds": { "type": "array", "items": { "type": "string" } },
                    "scheduledAt": { "type": ["string", "null"] },
                    "title": { "type": "string" },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "media": media_ref,
                    "thread": thread,
                    "overrides": overrides,
                    "repeat": repeat,
                    "status": { "type": "string", "enum": ["draft", "scheduled", "cancelled"] }
                },
                "required": ["id"],
                "additionalProperties": false
            }
        },
        {
            "name": "delete_post",
            "description": "Delete a post from the calendar (published copies stay on the networks).",
            "inputSchema": { "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"], "additionalProperties": false }
        },
        {
            "name": "publish_post",
            "description": "Publish a post now. The desktop app does the network calls within ~30 seconds; call get_post to read the results.",
            "inputSchema": { "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"], "additionalProperties": false }
        },
        {
            "name": "list_media",
            "description": "Images and videos in the media library (id, name, mime, bytes, width, height).",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "upload_media",
            "description": "Add an image or video to the library from base64 data; returns the media id to attach to posts.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": { "type": "string", "description": "File name with extension" },
                    "base64": { "type": "string" },
                    "mime": { "type": "string" },
                    "alt": { "type": "string" }
                },
                "required": ["name", "base64"],
                "additionalProperties": false
            }
        },
        {
            "name": "list_tags",
            "description": "Calendar tags (id, name, color).",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "list_networks",
            "description": "Every network the app knows: what it takes (characters, images, videos, video size and length), whether it is live, and how many channels are connected to it. Use it to answer \"can I post this there\" without guessing.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "check_post",
            "description": "Check a draft against every target network BEFORE creating it: character count in that network's own units, media limits, missing title, disabled or half-connected channels. Returns ok plus a list of issues per channel. Cheap — run it whenever you write or edit text.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": { "type": "string" },
                    "channelIds": { "type": "array", "items": { "type": "string" }, "description": "Defaults to every connected channel." },
                    "media": media_ref.clone(),
                    "title": { "type": "string" }
                },
                "additionalProperties": false
            }
        },
        {
            "name": "suggest_times",
            "description": "Free slots to schedule into, from the person's own preferred hour, skipping times already taken on the calendar. Use these instead of inventing timestamps.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "count": { "type": "integer", "minimum": 1, "maximum": 20, "description": "How many slots (default 3)." },
                    "from": { "type": "string", "description": "ISO 8601 earliest time; defaults to half an hour from now." },
                    "spacingMinutes": { "type": "integer", "minimum": 0, "description": "Keep this far away from other posts (default 60)." }
                },
                "additionalProperties": false
            }
        },
        {
            "name": "add_media_from_path",
            "description": "Add an image or video to the library from a file already on this machine. Always prefer this over upload_media for anything bigger than a small image — a video does not belong in a JSON-RPC argument. Returns the media id to pass in `media`.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Absolute path on this machine." },
                    "name": { "type": "string", "description": "Override the file name shown in the library." },
                    "alt": { "type": "string", "description": "Alt text — write one for images." }
                },
                "required": ["path"],
                "additionalProperties": false
            }
        },
        {
            "name": "post_now",
            "description": "Write a post and publish it immediately on the given channels — the one call for \"post this\". The desktop app does the network calls within ~30 seconds; call get_post afterwards for the per-channel result and URLs. For anything with a time on it use create_post instead.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": { "type": "string" },
                    "channelIds": { "type": "array", "items": { "type": "string" } },
                    "title": { "type": "string" },
                    "media": media_ref,
                    "thread": thread,
                    "overrides": overrides,
                    "tags": { "type": "array", "items": { "type": "string" } }
                },
                "required": ["text", "channelIds"],
                "additionalProperties": false
            }
        }
    ])
}

const GUIDE_URI: &str = "owntools://social/guide";

/// Ready-made jobs, so "what can this thing do" has an answer in the client's
/// own prompt menu instead of in a README.
fn prompts() -> Value {
    json!([
        {
            "name": "plan_a_week",
            "description": "Draft a week of posts from a topic and put them in free slots.",
            "arguments": [{ "name": "topic", "description": "What the week is about", "required": true }]
        },
        {
            "name": "post_this_video",
            "description": "Take a video file from disk, write the caption, schedule it.",
            "arguments": [{ "name": "path", "description": "Path to the video on this machine", "required": true }]
        },
        {
            "name": "whats_scheduled",
            "description": "Read back what is queued and flag anything that will not publish."
        }
    ])
}

fn prompt_text(name: &str, params: &Value) -> Option<String> {
    let arg = |key: &str| {
        params
            .get("arguments")
            .and_then(|a| a.get(key))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    match name {
        "plan_a_week" => Some(format!(
            "Plan a week of social posts about: {}.\n\nUse list_channels for the channels, write one post per free slot from suggest_times (count 5), run check_post on each before creating it, and create them as scheduled posts. Keep each one in the voice of the existing posts you can see through list_posts. Report back as a list of times and first lines.",
            arg("topic")
        )),
        "post_this_video" => Some(format!(
            "Post this video: {}.\n\nadd_media_from_path to put it in the library, list_channels to see where it can go (mind that not every network takes video — check with list_networks), write a caption of the right length for each, check_post, then schedule it at the first slot from suggest_times. Show me the caption before you schedule it.",
            arg("path")
        )),
        "whats_scheduled" => Some(
            "List what is scheduled from now on with list_posts (status scheduled). For each one run check_post with its text and channels, and tell me anything that would fail to publish — too long, missing media, a disabled channel. Then summarise the week in a sentence."
                .to_string(),
        ),
        _ => None,
    }
}

fn text_result(value: Value) -> Value {
    let text = serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string());
    json!({ "content": [{ "type": "text", "text": text }], "structuredContent": value, "isError": false })
}

fn error_result(err: &ApiError) -> Value {
    json!({ "content": [{ "type": "text", "text": format!("{} ({})", err.message, err.status) }], "isError": true })
}

fn call_tool(state: &SocialState, name: &str, args: &Value) -> Result<Value, ApiError> {
    let root = &state.root;
    let arg = |key: &str| args.get(key).cloned().unwrap_or(Value::Null);
    let id = || -> Result<String, ApiError> {
        args.get("id")
            .and_then(Value::as_str)
            .map(String::from)
            .ok_or_else(|| ApiError::bad("`id` is required"))
    };
    match name {
        "list_channels" => Ok(json!({ "channels": store::list_channels(root) })),
        "list_tags" => Ok(json!({ "tags": store::list_tags(root) })),
        "list_media" => Ok(json!({ "items": store::list_media(root) })),
        "list_posts" => {
            let filter = PostFilter {
                status: arg("status").as_str().map(String::from),
                from: arg("from").as_str().map(String::from),
                to: arg("to").as_str().map(String::from),
                limit: arg("limit").as_u64().map(|n| n as usize),
            };
            Ok(json!({ "posts": store::list_posts(root, &filter) }))
        }
        "get_post" => {
            let id = id()?;
            store::read_post(root, &id).ok_or_else(|| ApiError::not_found(format!("no post `{id}`")))
        }
        "create_post" => {
            let post = store::create_post(root, args)?;
            emit_changed(state, "post", post.get("id").and_then(Value::as_str), "create");
            Ok(post)
        }
        "update_post" => {
            let id = id()?;
            let post = store::patch_post(root, &id, args)?;
            emit_changed(state, "post", Some(&id), "update");
            Ok(post)
        }
        "delete_post" => {
            let id = id()?;
            let removed = store::delete_post(root, &id).map_err(ApiError::internal)?;
            if !removed {
                return Err(ApiError::not_found(format!("no post `{id}`")));
            }
            emit_changed(state, "post", Some(&id), "delete");
            Ok(json!({ "deleted": id }))
        }
        "publish_post" => {
            let id = id()?;
            let post = store::publish_now(root, &id)?;
            emit_changed(state, "post", Some(&id), "publish");
            Ok(json!({ "accepted": true, "post": post, "note": "the app publishes within ~30 s; call get_post for results" }))
        }
        "upload_media" => {
            let name = args.get("name").and_then(Value::as_str).unwrap_or("upload");
            let b64 = args.get("base64").and_then(Value::as_str).ok_or_else(|| ApiError::bad("`base64` is required"))?;
            let b64 = b64.split(',').next_back().unwrap_or(b64);
            use base64::Engine;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(b64.trim())
                .map_err(|e| ApiError::bad(format!("base64: {e}")))?;
            let mime = args
                .get("mime")
                .and_then(Value::as_str)
                .map(String::from)
                .unwrap_or_else(|| store::mime_for_name(name).to_string());
            let item = store::add_media(root, name, &mime, &bytes, args.get("alt").and_then(Value::as_str))?;
            emit_changed(state, "media", item.get("id").and_then(Value::as_str), "create");
            Ok(item)
        }
        "list_networks" => Ok(plan::networks_summary(root)),
        "check_post" => plan::check_post(root, args),
        "suggest_times" => plan::suggest_slots(
            root,
            args.get("count").and_then(Value::as_u64).unwrap_or(3) as usize,
            args.get("from").and_then(Value::as_str),
            args.get("spacingMinutes").and_then(Value::as_i64).unwrap_or(60),
        ),
        "add_media_from_path" => {
            let path = args.get("path").and_then(Value::as_str).ok_or_else(|| ApiError::bad("`path` is required"))?;
            let item = plan::add_media_from_path(root, path, args.get("alt").and_then(Value::as_str), args.get("name").and_then(Value::as_str))?;
            emit_changed(state, "media", item.get("id").and_then(Value::as_str), "create");
            Ok(item)
        }
        "post_now" => {
            let mut body = args.clone();
            if let Some(obj) = body.as_object_mut() {
                obj.insert("status".into(), json!("scheduled"));
                obj.insert("scheduledAt".into(), json!(store::local_now_iso()));
            }
            let post = store::create_post(root, &body)?;
            let id = post.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
            let post = store::publish_now(root, &id)?;
            emit_changed(state, "post", Some(&id), "publish");
            Ok(json!({ "accepted": true, "post": post, "note": "publishing now; call get_post in a few seconds for the results" }))
        }
        other => Err(ApiError::not_found(format!("unknown tool `{other}`"))),
    }
}

/// One JSON-RPC message in, one response out — or none for notifications.
pub fn handle(state: &SocialState, msg: &Value) -> Option<Value> {
    let id = msg.get("id").cloned().unwrap_or(Value::Null);
    let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
    let params = msg.get("params").cloned().unwrap_or(Value::Null);
    let is_notification = msg.get("id").is_none();

    if method.starts_with("notifications/") {
        return None;
    }
    if is_notification {
        return None;
    }

    let result = match method {
        "initialize" => {
            let requested = params.get("protocolVersion").and_then(Value::as_str).unwrap_or(PROTOCOL_VERSION);
            let version = if SUPPORTED.contains(&requested) { requested } else { PROTOCOL_VERSION };
            Ok(json!({
                "protocolVersion": version,
                "capabilities": { "tools": { "listChanged": false }, "resources": { "listChanged": false, "subscribe": false }, "prompts": { "listChanged": false } },
                "serverInfo": { "name": "owntools-social", "version": state.app.package_info().version.to_string() },
                "instructions": "Local scheduler for social posts, running on this person's own machine. The loop: list_channels for the ids, check_post to see whether the text fits every target network, suggest_times for a free slot, then create_post (or post_now when they asked for it to go out immediately). Attach media with add_media_from_path — never base64 a video. Everything you create appears in their calendar marked as coming from an agent, and nothing publishes without a time on it. Read the `owntools://social/guide` resource once for the details."
            }))
        }
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools() })),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            match call_tool(state, name, &args) {
                Ok(v) => Ok(text_result(v)),
                Err(e) => Ok(error_result(&e)),
            }
        }
        "resources/list" => Ok(json!({
            "resources": [{
                "uri": GUIDE_URI,
                "name": "How to drive owntools social",
                "description": "The order to call things in, what each network takes, and the mistakes worth not making.",
                "mimeType": "text/markdown"
            }]
        })),
        "resources/read" => {
            let uri = params.get("uri").and_then(Value::as_str).unwrap_or("");
            if uri == GUIDE_URI {
                Ok(json!({ "contents": [{ "uri": GUIDE_URI, "mimeType": "text/markdown", "text": plan::guide(&state.root) }] }))
            } else {
                Err((-32602, format!("unknown resource `{uri}`")))
            }
        }
        "prompts/list" => Ok(json!({ "prompts": prompts() })),
        "prompts/get" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            match prompt_text(name, &params) {
                Some(text) => Ok(json!({
                    "description": name,
                    "messages": [{ "role": "user", "content": { "type": "text", "text": text } }]
                })),
                None => Err((-32602, format!("unknown prompt `{name}`"))),
            }
        }
        "" => Err((-32600, "missing method".to_string())),
        other => Err((-32601, format!("method not found: {other}"))),
    };
    Some(match result {
        Ok(v) => ok_response(id, v),
        Err((code, message)) => error_response(id, code, &message),
    })
}
