//! The MCP half: JSON-RPC 2.0 over POST /mcp. `initialize`, `ping`,
//! `tools/list`, `tools/call` — the same operations as the REST routes,
//! described with JSON schemas so any MCP client can discover them.

use serde_json::{json, Value};

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
    let media_ref = json!({ "type": "array", "items": { "type": "string" }, "description": "Media library ids (see list_media / upload_media)." });
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
        }
    ])
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
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": "shipshape-social", "version": state.app.package_info().version.to_string() },
                "instructions": "Local scheduler for social media posts. Read list_channels first, then create_post with the channel ids and an ISO scheduledAt; the person reviews everything in the shipshape calendar. Keep X posts under 280 characters, Bluesky under 300, Mastodon under 500."
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
        "resources/list" => Ok(json!({ "resources": [] })),
        "prompts/list" => Ok(json!({ "prompts": [] })),
        "" => Err((-32600, "missing method".to_string())),
        other => Err((-32601, format!("method not found: {other}"))),
    };
    Some(match result {
        Ok(v) => ok_response(id, v),
        Err((code, message)) => error_response(id, code, &message),
    })
}
