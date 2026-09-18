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

/// `agentPostsNeedApproval` from settings.json — on unless the person turned
/// it off. The same key the frontend's `parseSettings` reads.
pub fn approval_required(root: &Path) -> bool {
    read_json(&settings_path(root))
        .and_then(|s| s.get("agentPostsNeedApproval").and_then(Value::as_bool))
        .unwrap_or(true)
}

/// What an agent is told when its post went to the review queue.
pub const REVIEW_MESSAGE: &str = "waiting for approval in owntools → social → Review";

/* ------------------------------------------------------------------ */
/* Brand voice & activity log                                           */
/* ------------------------------------------------------------------ */

pub fn write_text_atomic(path: &Path, text: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension(format!("{}.tmp", new_id("w")));
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

pub fn voice_path(root: &Path) -> PathBuf {
    root.join("voice.md")
}

/// `voice.md` — empty string when the person has not written one yet.
pub fn read_voice(root: &Path) -> String {
    fs::read_to_string(voice_path(root)).unwrap_or_default()
}

pub fn write_voice(root: &Path, markdown: &str) -> Result<(), String> {
    write_text_atomic(&voice_path(root), markdown)
}

pub fn activity_path(root: &Path) -> PathBuf {
    root.join("activity.jsonl")
}

const ACTIVITY_MAX_BYTES: u64 = 2 * 1024 * 1024;
const ACTIVITY_KEEP_LINES: usize = 1000;

/// One line of `activity.jsonl` — the same shape the frontend's `activity.ts`
/// writes and reads: `{ ts, actor, action, postId, before?, after?, note? }`.
pub fn log_activity(root: &Path, actor: &str, action: &str, post_id: &str, before: Option<&Value>, after: Option<&Value>, note: Option<&str>) {
    let mut entry = json!({ "ts": now_iso(), "actor": actor, "action": action, "postId": post_id });
    if let Some(b) = before {
        entry["before"] = b.clone();
    }
    if let Some(a) = after {
        entry["after"] = a.clone();
    }
    if let Some(n) = note.filter(|n| !n.trim().is_empty()) {
        entry["note"] = json!(n);
    }
    let path = activity_path(root);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let line = format!("{}\n", entry);
    let appended = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut f| {
            use std::io::Write;
            f.write_all(line.as_bytes())
        });
    if let Err(e) = appended {
        log::warn!("social: could not append to activity.jsonl: {e}");
        return;
    }
    // Keep it bounded: past the cap, rewrite the newest lines only.
    if fs::metadata(&path).map(|m| m.len() > ACTIVITY_MAX_BYTES).unwrap_or(false) {
        if let Ok(text) = fs::read_to_string(&path) {
            let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
            if lines.len() > ACTIVITY_KEEP_LINES {
                let kept = lines[lines.len() - ACTIVITY_KEEP_LINES..].join("\n");
                let _ = write_text_atomic(&path, &format!("{kept}\n"));
            }
        }
    }
}

/// The newest `limit` entries, newest first. Bad lines are skipped.
pub fn read_activity(root: &Path, limit: usize) -> Vec<Value> {
    let Ok(text) = fs::read_to_string(activity_path(root)) else {
        return Vec::new();
    };
    text.lines()
        .rev()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|v| v.get("postId").and_then(Value::as_str).is_some() && v.get("action").and_then(Value::as_str).is_some())
        .take(limit.clamp(1, 1000))
        .collect()
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
    let before = read_json(&path);
    fs::remove_file(&path).map_err(|e| e.to_string())?;
    log_activity(root, "agent", "delete", id, before.as_ref(), None, None);
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
    /// social is part of Pro and this install has no key.
    pub fn pro_required() -> Self {
        Self { status: 402, message: super::server::PRO_REQUIRED.to_string() }
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

/// `client_ref` (or `clientRef`) from a create body — the agent's idempotency key.
pub fn client_ref_of(body: &Map<String, Value>) -> Option<String> {
    body.get("client_ref")
        .or_else(|| body.get("clientRef"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(200).collect())
}

/// The post already created with this `client_ref`, if any.
pub fn find_by_client_ref(root: &Path, client_ref: &str) -> Option<Value> {
    list_posts(root, &PostFilter { status: None, from: None, to: None, limit: None })
        .into_iter()
        .find(|p| p.get("clientRef").and_then(Value::as_str) == Some(client_ref))
}

/// The post an agent's request describes — validated and complete, but not
/// written. `create_post` writes it; `dry_run` shows it.
///
/// Status: `needs_review` for every agent post while approval is on (that is
/// what the setting means — the person sees it before it can publish);
/// otherwise scheduled when there is a time and a channel, else a draft.
pub fn build_post(root: &Path, body: &Value) -> Result<Value, ApiError> {
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
    let status = if approval_required(root) { "needs_review" } else { status };
    let now = now_iso();
    let mut post = json!({
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
        "clientRef": Value::Null,
    });
    if let Some(client_ref) = client_ref_of(body) {
        post["clientRef"] = json!(client_ref);
    }
    Ok(post)
}

/// What `create_post` hands back: the post, whether it already existed
/// (same `client_ref`), and whether it waits for a person.
pub struct Created {
    pub post: Value,
    pub duplicate: bool,
    pub needs_review: bool,
}

impl Created {
    /// The post's fields plus `duplicate`, `needs_review` and — when it
    /// waits — the `message` an agent should pass on. One object, so a client
    /// that only knows the old shape still finds `id` and `status` at the top.
    pub fn response(&self) -> Value {
        let mut out = self.post.clone();
        out["duplicate"] = json!(self.duplicate);
        out["needs_review"] = json!(self.needs_review);
        if self.needs_review {
            out["message"] = json!(format!("created and {REVIEW_MESSAGE}; the person approves, edits or rejects it — nothing publishes until then"));
        } else if self.duplicate {
            out["message"] = json!("a post with this client_ref already exists — returned instead of creating a second one");
        }
        out
    }
}

/// Builds a post from an agent's request and writes it. A second call with
/// the same `client_ref` returns the first post instead of a second file.
pub fn create_post(root: &Path, body: &Value) -> Result<Created, ApiError> {
    if let Some(client_ref) = body.as_object().and_then(client_ref_of) {
        if let Some(existing) = find_by_client_ref(root, &client_ref) {
            let needs_review = existing.get("status").and_then(Value::as_str) == Some("needs_review");
            return Ok(Created { post: existing, duplicate: true, needs_review });
        }
    }
    let post = build_post(root, body)?;
    write_post(root, &post).map_err(ApiError::internal)?;
    let needs_review = post.get("status").and_then(Value::as_str) == Some("needs_review");
    log_activity(root, "agent", "create", post["id"].as_str().unwrap_or(""), None, Some(&post), None);
    Ok(Created { post, duplicate: false, needs_review })
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
    let before = post.clone();
    let approval = approval_required(root);
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
                // Approval is a human act. While the setting is on, an agent can
                // move a post as far as the review queue and no further; a post
                // the person already put on the calendar keeps its place.
                let already_live = matches!(status_now.as_str(), "scheduled" | "publishing" | "failed");
                post["status"] = json!(if approval && !already_live { "needs_review" } else { "scheduled" });
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
    log_activity(root, "agent", "update", id, Some(&before), Some(&post), None);
    Ok(post)
}

/// `duplicate` / `needs_review` / `message` on a post an agent just wrote, so
/// the agent can tell the person where it went.
pub fn with_review_flags(post: &Value) -> Value {
    let mut out = post.clone();
    let waiting = post.get("status").and_then(Value::as_str) == Some("needs_review");
    out["needs_review"] = json!(waiting);
    if waiting {
        out["message"] = json!(format!("the post is {REVIEW_MESSAGE}; nothing publishes until the person approves it"));
    }
    out
}

/// What `publish_now` hands back: `accepted` when the runner will publish,
/// otherwise the post went to (or stays in) the review queue.
pub struct Published {
    pub post: Value,
    pub accepted: bool,
    pub needs_review: bool,
}

impl Published {
    pub fn response(&self, note: &str) -> Value {
        let mut out = json!({ "accepted": self.accepted, "needs_review": self.needs_review, "post": self.post });
        out["note"] = json!(if self.needs_review {
            format!("not published: the post is {REVIEW_MESSAGE}. Tell the person; they approve it in the app.")
        } else {
            note.to_string()
        });
        out
    }
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
