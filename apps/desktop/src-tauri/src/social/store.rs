//! The JSON files under `<AppData>/social/`, seen from Rust. Same layout the
//! frontend writes (see packages/feature-social/README.md): a post is one
//! file, every write is atomic (temp + rename), and every post carries a
//! `version` that a PATCH has to match.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Local, NaiveDateTime, SecondsFormat, Utc};
use rand::RngCore;
use serde_json::{json, Map, Value};

use super::DEFAULT_PORT;

pub struct AgentSettings {
    pub enabled: bool,
    pub port: u16,
    pub token: String,
}

/// 24 random bytes as hex, prefixed so it is recognisable in configs.
pub fn new_token() -> String {
    let mut bytes = [0u8; 24];
    rand::rng().fill_bytes(&mut bytes);
    format!("ss_{}", hex::encode(bytes))
}

pub fn new_id(prefix: &str) -> String {
    let mut bytes = [0u8; 8];
    rand::rng().fill_bytes(&mut bytes);
    format!("{prefix}_{}", hex::encode(bytes))
}

pub fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// Now, with this machine's offset — what a `scheduledAt` looks like when the
/// person (or an agent) means "right now" rather than a UTC instant.
pub fn local_now_iso() -> String {
    Local::now().to_rfc3339_opts(SecondsFormat::Secs, false)
}

pub fn read_json(path: &Path) -> Option<Value> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn write_json_atomic(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension(format!("{}.tmp", new_id("w")));
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

pub fn settings_path(root: &Path) -> PathBuf {
    root.join("settings.json")
}

pub fn agent_settings(root: &Path) -> AgentSettings {
    let settings = read_json(&settings_path(root)).unwrap_or(Value::Null);
    let agent = settings.get("agent").cloned().unwrap_or(Value::Null);
    AgentSettings {
        enabled: agent.get("enabled").and_then(Value::as_bool).unwrap_or(true),
        port: agent
            .get("port")
            .and_then(Value::as_u64)
            .filter(|p| (1024..=65535).contains(p))
            .map(|p| p as u16)
            .unwrap_or(DEFAULT_PORT),
        token: agent
            .get("token")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
    }
}

/// Merges the agent block into settings.json without touching the rest.
pub fn save_agent_settings(root: &Path, agent: &AgentSettings) -> Result<(), String> {
    let path = settings_path(root);
    let mut settings = read_json(&path).unwrap_or_else(|| json!({ "version": 1 }));
    if !settings.is_object() {
        settings = json!({ "version": 1 });
    }
    settings["agent"] = json!({
        "enabled": agent.enabled,
        "port": agent.port,
        "token": agent.token,
    });
    write_json_atomic(&path, &settings)
}

fn settings_timezone(root: &Path) -> String {
    read_json(&settings_path(root))
        .and_then(|s| s.get("timezone").and_then(Value::as_str).map(String::from))
        .unwrap_or_else(|| "UTC".to_string())
}

/* ------------------------------------------------------------------ */
/* Channels & tags                                                      */
/* ------------------------------------------------------------------ */

pub fn list_channels(root: &Path) -> Vec<Value> {
    read_json(&root.join("channels.json"))
        .and_then(|v| v.get("channels").and_then(Value::as_array).cloned())
        .unwrap_or_default()
}

pub fn channel_ids(root: &Path) -> Vec<String> {
    list_channels(root)
        .iter()
        .filter_map(|c| c.get("id").and_then(Value::as_str).map(String::from))
        .collect()
}

pub fn list_tags(root: &Path) -> Vec<Value> {
    read_json(&root.join("tags.json"))
        .and_then(|v| v.get("tags").and_then(Value::as_array).cloned())
        .unwrap_or_default()
}

/* ------------------------------------------------------------------ */
/* Posts                                                                */
/* ------------------------------------------------------------------ */

fn safe_id(id: &str) -> String {
    id.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .take(80)
        .collect()
}

pub fn post_path(root: &Path, id: &str) -> PathBuf {
    root.join("posts").join(format!("{}.json", safe_id(id)))
}

pub fn read_post(root: &Path, id: &str) -> Option<Value> {
    read_json(&post_path(root, id)).filter(|v| v.get("id").and_then(Value::as_str) == Some(id))
}

pub fn write_post(root: &Path, post: &Value) -> Result<(), String> {
    let id = post
        .get("id")
        .and_then(Value::as_str)
        .ok_or("post has no id")?
        .to_string();
    write_json_atomic(&post_path(root, &id), post)
}

pub fn delete_post(root: &Path, id: &str) -> Result<bool, String> {
    let path = post_path(root, id);
    if !path.exists() {
        return Ok(false);
    }
    fs::remove_file(&path).map_err(|e| e.to_string())?;
    Ok(true)
}

pub struct PostFilter {
    pub status: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub limit: Option<usize>,
}

pub fn list_posts(root: &Path, filter: &PostFilter) -> Vec<Value> {
    let dir = root.join("posts");
    let Ok(entries) = fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut posts: Vec<Value> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map(|x| x == "json").unwrap_or(false))
        .filter_map(|e| read_json(&e.path()))
        .filter(|p| p.get("id").and_then(Value::as_str).is_some())
        .collect();
    if let Some(status) = &filter.status {
        posts.retain(|p| p.get("status").and_then(Value::as_str) == Some(status.as_str()));
    }
    let key = |p: &Value| -> String {
        p.get("scheduledAt")
            .and_then(Value::as_str)
            .or_else(|| p.get("createdAt").and_then(Value::as_str))
            .unwrap_or("")
            .to_string()
    };
    if let Some(from) = filter.from.as_deref().and_then(parse_datetime) {
        posts.retain(|p| p.get("scheduledAt").and_then(Value::as_str).and_then(parse_datetime).map(|d| d >= from).unwrap_or(false));
    }
    if let Some(to) = filter.to.as_deref().and_then(parse_datetime) {
        posts.retain(|p| p.get("scheduledAt").and_then(Value::as_str).and_then(parse_datetime).map(|d| d <= to).unwrap_or(false));
    }
    posts.sort_by_key(key);
    if let Some(limit) = filter.limit {
        posts.truncate(limit);
    }
    posts
}

/// RFC 3339 with offset, or a local wall-clock "YYYY-MM-DDTHH:MM[:SS]".
pub fn parse_datetime(raw: &str) -> Option<DateTime<Utc>> {
    if let Ok(d) = DateTime::parse_from_rfc3339(raw) {
        return Some(d.with_timezone(&Utc));
    }
    for fmt in ["%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M"] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(raw, fmt) {
            if let Some(local) = naive.and_local_timezone(Local).single() {
                return Some(local.with_timezone(&Utc));
            }
        }
    }
    None
}

/// Normalises whatever the caller sent into the ISO form the app stores
/// (local offset, like the frontend's `toIso`).
fn normalize_datetime(raw: &str) -> Option<String> {
    parse_datetime(raw).map(|d| d.with_timezone(&Local).to_rfc3339_opts(SecondsFormat::Secs, false))
}

fn media_refs(value: &Value) -> Vec<Value> {
    match value.as_array() {
        Some(items) => items
            .iter()
            .filter_map(|m| match m {
                Value::String(id) => Some(json!({ "id": id })),
                Value::Object(o) if o.get("id").and_then(Value::as_str).is_some() => {
                    let mut out = json!({ "id": o["id"] });
                    if let Some(alt) = o.get("alt").and_then(Value::as_str) {
                        out["alt"] = json!(alt);
                    }
                    Some(out)
                }
                _ => None,
            })
            .collect(),
        None => Vec::new(),
    }
}

fn thread_parts(value: &Value) -> Vec<Value> {
    match value.as_array() {
        Some(items) => items
            .iter()
            .filter_map(|p| match p {
                Value::String(text) => Some(json!({ "text": text, "media": [] })),
                Value::Object(o) => Some(json!({
                    "text": o.get("text").and_then(Value::as_str).unwrap_or(""),
                    "media": media_refs(o.get("media").unwrap_or(&Value::Null)),
                })),
                _ => None,
            })
            .filter(|p| !p["text"].as_str().unwrap_or("").trim().is_empty() || !p["media"].as_array().map(|a| a.is_empty()).unwrap_or(true))
            .collect(),
        None => Vec::new(),
    }
}

/// Content block from the loose shapes agents send: `text` at the top level
/// or a full `content` object.
fn content_from(body: &Map<String, Value>, base: Option<&Value>) -> Value {
    let mut content = base.cloned().unwrap_or_else(|| json!({ "text": "", "media": [], "thread": [] }));
    if let Some(c) = body.get("content").and_then(Value::as_object) {
        if let Some(t) = c.get("text").and_then(Value::as_str) {
            content["text"] = json!(t);
        }
        if let Some(m) = c.get("media") {
            content["media"] = json!(media_refs(m));
        }
        if let Some(t) = c.get("thread") {
            content["thread"] = json!(thread_parts(t));
        }
        if let Some(t) = c.get("title").and_then(Value::as_str) {
            content["title"] = json!(t);
        }
    }
    if let Some(t) = body.get("text").and_then(Value::as_str) {
        content["text"] = json!(t);
    }
    if let Some(m) = body.get("media") {
        content["media"] = json!(media_refs(m));
    }
    if let Some(t) = body.get("thread") {
        content["thread"] = json!(thread_parts(t));
    }
    if let Some(t) = body.get("title").and_then(Value::as_str) {
        content["title"] = json!(t);
    }
    if content.get("media").is_none() {
        content["media"] = json!([]);
    }
    if content.get("thread").is_none() {
        content["thread"] = json!([]);
    }
    content
}

fn overrides_from(value: &Value) -> Value {
    let mut out = Map::new();
    if let Some(map) = value.as_object() {
        for (channel, o) in map {
            let Some(o) = o.as_object() else { continue };
            let mut entry = Map::new();
            if let Some(t) = o.get("text").and_then(Value::as_str) {
                entry.insert("text".into(), json!(t));
            }
            if let Some(m) = o.get("media") {
                entry.insert("media".into(), json!(media_refs(m)));
            }
            if let Some(t) = o.get("thread") {
                entry.insert("thread".into(), json!(thread_parts(t)));
            }
            if let Some(t) = o.get("title").and_then(Value::as_str) {
                entry.insert("title".into(), json!(t));
            }
            out.insert(channel.clone(), Value::Object(entry));
        }
    }
    Value::Object(out)
}

fn string_list(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect())
        .unwrap_or_default()
}

fn repeat_from(value: &Value) -> Value {
    let kind = value
        .get("kind")
        .and_then(Value::as_str)
        .or_else(|| value.as_str())
        .unwrap_or("none");
    match kind {
        "daily" | "weekly" | "monthly" => json!({ "kind": kind }),
        "every-n-days" => json!({ "kind": kind, "every": value.get("every").and_then(Value::as_u64).unwrap_or(2).max(1) }),
        _ => json!({ "kind": "none" }),
    }
}

#[derive(Debug)]
pub struct ApiError {
    pub status: u16,
    pub message: String,
}

impl ApiError {
    pub fn bad(message: impl Into<String>) -> Self {
        Self { status: 400, message: message.into() }
    }
    pub fn not_found(message: impl Into<String>) -> Self {
        Self { status: 404, message: message.into() }
    }
    pub fn conflict(message: impl Into<String>) -> Self {
        Self { status: 409, message: message.into() }
    }
    pub fn internal(message: impl Into<String>) -> Self {
        Self { status: 500, message: message.into() }
    }
}

fn check_channels(root: &Path, ids: &[String]) -> Result<(), ApiError> {
    let known = channel_ids(root);
    let unknown: Vec<&String> = ids.iter().filter(|id| !known.contains(id)).collect();
    if unknown.is_empty() {
        Ok(())
    } else {
        Err(ApiError::bad(format!(
            "unknown channel id(s): {} — GET /channels lists the valid ones",
            unknown.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")
        )))
    }
}

/// Builds a post from an agent's request and writes it.
pub fn create_post(root: &Path, body: &Value) -> Result<Value, ApiError> {
    let body = body.as_object().ok_or_else(|| ApiError::bad("expected a JSON object"))?;
    let content = content_from(body, None);
    let has_text = !content["text"].as_str().unwrap_or("").trim().is_empty();
    let has_media = !content["media"].as_array().map(|a| a.is_empty()).unwrap_or(true);
    if !has_text && !has_media {
        return Err(ApiError::bad("a post needs `text` or `media`"));
    }
    let channel_ids = string_list(body.get("channelIds"));
    check_channels(root, &channel_ids)?;
    let scheduled_at = match body.get("scheduledAt").and_then(Value::as_str) {
        Some(raw) if !raw.trim().is_empty() => Some(normalize_datetime(raw).ok_or_else(|| ApiError::bad(format!("cannot parse scheduledAt `{raw}` (use ISO 8601)")))?),
        _ => None,
    };
    let requested = body.get("status").and_then(Value::as_str);
    let status = match requested {
        Some("draft") => "draft",
        Some("scheduled") | None if scheduled_at.is_some() && !channel_ids.is_empty() => "scheduled",
        Some("scheduled") => {
            return Err(ApiError::bad("scheduling needs `scheduledAt` and at least one channel in `channelIds`"));
        }
        None => "draft",
        Some(other) => return Err(ApiError::bad(format!("status `{other}` is not allowed on create (draft or scheduled)"))),
    };
    let now = now_iso();
    let post = json!({
        "id": new_id("post"),
        "version": 1,
        "status": status,
        "scheduledAt": scheduled_at,
        "timezone": settings_timezone(root),
        "channelIds": channel_ids,
        "content": content,
        "overrides": overrides_from(body.get("overrides").unwrap_or(&Value::Null)),
        "tags": string_list(body.get("tags")),
        "repeat": repeat_from(body.get("repeat").unwrap_or(&Value::Null)),
        "results": {},
        "attempts": 0,
        "nextAttemptAt": Value::Null,
        "lastError": Value::Null,
        "createdAt": now,
        "updatedAt": now,
        "publishedAt": Value::Null,
        "source": "agent",
        "repeatOf": Value::Null,
    });
    write_post(root, &post).map_err(ApiError::internal)?;
    Ok(post)
}

/// Applies a partial update; refuses when the caller's `version` is stale.
pub fn patch_post(root: &Path, id: &str, body: &Value) -> Result<Value, ApiError> {
    let body = body.as_object().ok_or_else(|| ApiError::bad("expected a JSON object"))?;
    let mut post = read_post(root, id).ok_or_else(|| ApiError::not_found(format!("no post `{id}`")))?;
    let current_version = post.get("version").and_then(Value::as_u64).unwrap_or(1);
    if let Some(v) = body.get("version").and_then(Value::as_u64) {
        if v != current_version {
            return Err(ApiError::conflict(format!("post `{id}` is at version {current_version}, you sent {v} — read it again")));
        }
    }
    let status_now = post.get("status").and_then(Value::as_str).unwrap_or("draft").to_string();
    if status_now == "publishing" {
        return Err(ApiError::conflict("the post is being published right now"));
    }
    if body.contains_key("text") || body.contains_key("content") || body.contains_key("media") || body.contains_key("thread") || body.contains_key("title") {
        post["content"] = content_from(body, post.get("content"));
    }
    if let Some(ids) = body.get("channelIds") {
        let ids = string_list(Some(ids));
        check_channels(root, &ids)?;
        post["channelIds"] = json!(ids);
    }
    if let Some(o) = body.get("overrides") {
        post["overrides"] = overrides_from(o);
    }
    if let Some(t) = body.get("tags") {
        post["tags"] = json!(string_list(Some(t)));
    }
    if let Some(r) = body.get("repeat") {
        post["repeat"] = repeat_from(r);
    }
    let mut rescheduled = false;
    if let Some(raw) = body.get("scheduledAt") {
        match raw {
            Value::Null => post["scheduledAt"] = Value::Null,
            Value::String(s) => {
                let iso = normalize_datetime(s).ok_or_else(|| ApiError::bad(format!("cannot parse scheduledAt `{s}`")))?;
                post["scheduledAt"] = json!(iso);
                rescheduled = true;
            }
            _ => return Err(ApiError::bad("scheduledAt must be a string or null")),
        }
    }
    if let Some(status) = body.get("status").and_then(Value::as_str) {
        match status {
            "draft" | "cancelled" => post["status"] = json!(status),
            "scheduled" => {
                if post.get("scheduledAt").and_then(Value::as_str).is_none() {
                    return Err(ApiError::bad("scheduling needs a scheduledAt"));
                }
                if post.get("channelIds").and_then(Value::as_array).map(|a| a.is_empty()).unwrap_or(true) {
                    return Err(ApiError::bad("scheduling needs at least one channel"));
                }
                post["status"] = json!("scheduled");
                rescheduled = true;
            }
            other => return Err(ApiError::bad(format!("status `{other}` cannot be set through the API (draft, scheduled, cancelled)"))),
        }
    }
    if rescheduled {
        post["attempts"] = json!(0);
        post["nextAttemptAt"] = Value::Null;
        if status_now == "failed" {
            post["status"] = json!("scheduled");
            post["lastError"] = Value::Null;
        }
    }
    post["version"] = json!(current_version + 1);
    post["updatedAt"] = json!(now_iso());
    write_post(root, &post).map_err(ApiError::internal)?;
    Ok(post)
}

/// Marks the post due now; the app's runner publishes it.
pub fn publish_now(root: &Path, id: &str) -> Result<Value, ApiError> {
    let mut post = read_post(root, id).ok_or_else(|| ApiError::not_found(format!("no post `{id}`")))?;
    let status = post.get("status").and_then(Value::as_str).unwrap_or("draft");
    if status == "published" {
        return Err(ApiError::conflict("already published"));
    }
    if status == "publishing" {
        return Err(ApiError::conflict("already publishing"));
    }
    if post.get("channelIds").and_then(Value::as_array).map(|a| a.is_empty()).unwrap_or(true) {
        return Err(ApiError::bad("the post has no channels"));
    }
    let version = post.get("version").and_then(Value::as_u64).unwrap_or(1);
    post["status"] = json!("scheduled");
    post["scheduledAt"] = json!(Local::now().to_rfc3339_opts(SecondsFormat::Secs, false));
    post["attempts"] = json!(0);
    post["nextAttemptAt"] = Value::Null;
    post["lastError"] = Value::Null;
    if let Some(results) = post.get("results").and_then(Value::as_object).cloned() {
        let kept: Map<String, Value> = results.into_iter().filter(|(_, r)| r.get("status").and_then(Value::as_str) == Some("ok")).collect();
        post["results"] = Value::Object(kept);
    }
    post["version"] = json!(version + 1);
    post["updatedAt"] = json!(now_iso());
    write_post(root, &post).map_err(ApiError::internal)?;
    Ok(post)
}

/* ------------------------------------------------------------------ */
/* Media                                                                */
/* ------------------------------------------------------------------ */

pub fn list_media(root: &Path) -> Vec<Value> {
    read_json(&root.join("media.json"))
        .and_then(|v| v.get("items").and_then(Value::as_array).cloned())
        .unwrap_or_default()
}

fn extension_for(mime: &str, name: &str) -> String {
    let from_mime = match mime {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "video/mp4" => Some("mp4"),
        "video/webm" => Some("webm"),
        "video/quicktime" => Some("mov"),
        _ => None,
    };
    if let Some(ext) = from_mime {
        return ext.to_string();
    }
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .filter(|e| e.len() <= 5 && e.chars().all(|c| c.is_ascii_alphanumeric()))
        .unwrap_or_else(|| "bin".to_string())
}

pub fn mime_for_name(name: &str) -> &'static str {
    match Path::new(name).extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mov") => "video/quicktime",
        _ => "application/octet-stream",
    }
}

pub fn add_media(root: &Path, name: &str, mime: &str, bytes: &[u8], alt: Option<&str>) -> Result<Value, ApiError> {
    if bytes.is_empty() {
        return Err(ApiError::bad("empty file"));
    }
    let id = new_id("m");
    let ext = extension_for(mime, name);
    let rel = format!("media/{id}.{ext}");
    let path = root.join(&rel);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| ApiError::internal(e.to_string()))?;
    }
    fs::write(&path, bytes).map_err(|e| ApiError::internal(e.to_string()))?;
    let mut item = json!({
        "id": id,
        "file": rel,
        "name": if name.trim().is_empty() { format!("{id}.{ext}") } else { name.to_string() },
        "mime": mime,
        "bytes": bytes.len(),
        "createdAt": now_iso(),
    });
    if let Some(alt) = alt.filter(|a| !a.trim().is_empty()) {
        item["alt"] = json!(alt);
    }
    let index_path = root.join("media.json");
    let mut index = read_json(&index_path).unwrap_or_else(|| json!({ "version": 1, "items": [] }));
    if !index.get("items").map(Value::is_array).unwrap_or(false) {
        index = json!({ "version": 1, "items": [] });
    }
    index["items"].as_array_mut().expect("items is an array").push(item.clone());
    write_json_atomic(&index_path, &index).map_err(ApiError::internal)?;
    Ok(item)
}
