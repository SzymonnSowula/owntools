//! REST + MCP + OAuth callback routes. Every write goes through `store` and
//! ends with a `social-changed` event so the open window reloads.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Multipart, Path, Query, Request, State};
use axum::http::{header, HeaderMap, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::Emitter;
use tower_http::cors::CorsLayer;

use super::plan;
use super::store::{self, ApiError, PostFilter};
use super::{SocialState, CHANGED_EVENT, OAUTH_EVENT};

type Shared = Arc<SocialState>;

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = StatusCode::from_u16(self.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        (status, Json(json!({ "error": self.message }))).into_response()
    }
}

pub fn emit_changed(state: &SocialState, kind: &str, id: Option<&str>, action: &str) {
    let _ = state.app.emit(
        CHANGED_EVENT,
        json!({ "source": "agent", "kind": kind, "id": id, "action": action }),
    );
}

pub fn router(state: Shared) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/oauth/callback", get(oauth_callback))
        .route("/channels", get(channels))
        .route("/posts", get(posts_list).post(posts_create))
        .route("/posts/{id}", get(post_get).patch(post_patch).delete(post_delete))
        .route("/posts/{id}/publish", post(post_publish))
        .route("/posts/now", post(posts_now))
        .route("/media", get(media_list).post(media_create))
        .route("/media/path", post(media_from_path))
        .route("/tags", get(tags))
        .route("/networks", get(networks))
        .route("/check", post(check))
        .route("/slots", get(slots))
        .route("/guide", get(guide))
        .route("/mcp", post(mcp_post).get(mcp_get).delete(mcp_delete))
        .layer(middleware::from_fn_with_state(state.clone(), auth))
        .layer(CorsLayer::permissive())
        .layer(DefaultBodyLimit::max(64 * 1024 * 1024))
        .with_state(state)
}

/// Bearer token on everything except the liveness check, the OAuth redirect
/// and CORS preflights. A paused API answers 403 so agents see why.
async fn auth(State(state): State<Shared>, req: Request, next: Next) -> Response {
    let path = req.uri().path();
    if req.method() == Method::OPTIONS || path == "/health" || path == "/oauth/callback" {
        return next.run(req).await;
    }
    if !state.enabled.load(Ordering::Relaxed) {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "the agent API is paused — turn it on in owntools → social → Agents" })),
        )
            .into_response();
    }
    let token = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer ").or_else(|| v.strip_prefix("bearer ")))
        .map(str::trim);
    match token {
        Some(t) if state.token_matches(t) => next.run(req).await,
        _ => (
            StatusCode::UNAUTHORIZED,
            [(header::WWW_AUTHENTICATE, "Bearer realm=\"owntools social\"")],
            Json(json!({ "error": "missing or wrong bearer token — copy it from owntools → social → Agents" })),
        )
            .into_response(),
    }
}

async fn health(State(state): State<Shared>) -> Json<Value> {
    Json(json!({
        "ok": true,
        "name": "owntools-social",
        "version": state.app.package_info().version.to_string(),
        "enabled": state.enabled.load(Ordering::Relaxed),
        "mcp": "/mcp",
    }))
}

#[derive(Deserialize)]
struct OAuthQuery {
    state: Option<String>,
    code: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

async fn oauth_callback(State(state): State<Shared>, Query(q): Query<OAuthQuery>) -> Html<String> {
    let ok = q.code.is_some() && q.error.is_none();
    let _ = state.app.emit(
        OAUTH_EVENT,
        json!({
            "state": q.state.unwrap_or_default(),
            "code": q.code,
            "error": q.error,
            "errorDescription": q.error_description,
        }),
    );
    let (title, body) = if ok {
        ("signed in", "You can close this tab and go back to owntools.")
    } else {
        ("sign-in was not completed", "Go back to owntools and try again.")
    };
    Html(format!(
        r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><title>owntools · {title}</title>
<style>body{{margin:0;min-height:100vh;display:grid;place-items:center;font-family:Inter,system-ui,sans-serif;background:#f5f5f7;color:#1d1d1f}}
.card{{background:#fff;border:1px solid rgba(29,29,31,.12);border-radius:16px;padding:32px 36px;box-shadow:0 18px 44px rgba(17,17,17,.12);text-align:center;max-width:420px}}
h1{{font-size:22px;margin:0 0 8px;letter-spacing:-.03em}} p{{margin:0;color:#6e6e73}}</style></head>
<body><div class="card"><h1>{title}</h1><p>{body}</p></div></body></html>"#
    ))
}

async fn channels(State(state): State<Shared>) -> Json<Value> {
    Json(json!({ "channels": store::list_channels(&state.root) }))
}

async fn tags(State(state): State<Shared>) -> Json<Value> {
    Json(json!({ "tags": store::list_tags(&state.root) }))
}

#[derive(Deserialize)]
struct ListQuery {
    status: Option<String>,
    from: Option<String>,
    to: Option<String>,
    limit: Option<usize>,
}

async fn posts_list(State(state): State<Shared>, Query(q): Query<ListQuery>) -> Json<Value> {
    let filter = PostFilter { status: q.status, from: q.from, to: q.to, limit: q.limit };
    Json(json!({ "posts": store::list_posts(&state.root, &filter) }))
}

async fn posts_create(State(state): State<Shared>, Json(body): Json<Value>) -> Result<(StatusCode, Json<Value>), ApiError> {
    let post = store::create_post(&state.root, &body)?;
    emit_changed(&state, "post", post.get("id").and_then(Value::as_str), "create");
    Ok((StatusCode::CREATED, Json(post)))
}

async fn post_get(State(state): State<Shared>, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    store::read_post(&state.root, &id)
        .map(Json)
        .ok_or_else(|| ApiError::not_found(format!("no post `{id}`")))
}

async fn post_patch(State(state): State<Shared>, Path(id): Path<String>, Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    let post = store::patch_post(&state.root, &id, &body)?;
    emit_changed(&state, "post", Some(&id), "update");
    Ok(Json(post))
}

async fn post_delete(State(state): State<Shared>, Path(id): Path<String>) -> Result<StatusCode, ApiError> {
    let removed = store::delete_post(&state.root, &id).map_err(ApiError::internal)?;
    if !removed {
        return Err(ApiError::not_found(format!("no post `{id}`")));
    }
    emit_changed(&state, "post", Some(&id), "delete");
    Ok(StatusCode::NO_CONTENT)
}

async fn post_publish(State(state): State<Shared>, Path(id): Path<String>) -> Result<(StatusCode, Json<Value>), ApiError> {
    let post = store::publish_now(&state.root, &id)?;
    emit_changed(&state, "post", Some(&id), "publish");
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({ "accepted": true, "post": post, "note": "the app publishes within ~30 s; poll GET /posts/{id} for results" })),
    ))
}

/// Write and publish in one call — what "post this" means over plain HTTP.
async fn posts_now(State(state): State<Shared>, Json(mut body): Json<Value>) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(obj) = body.as_object_mut() {
        obj.insert("status".into(), json!("scheduled"));
        obj.insert("scheduledAt".into(), json!(store::local_now_iso()));
    }
    let created = store::create_post(&state.root, &body)?;
    let id = created.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
    let post = store::publish_now(&state.root, &id)?;
    emit_changed(&state, "post", Some(&id), "publish");
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({ "accepted": true, "post": post, "note": "publishing now; poll GET /posts/{id} for results" })),
    ))
}

/// `{ path, name?, alt? }` — a file already on this machine, no base64.
async fn media_from_path(State(state): State<Shared>, Json(body): Json<Value>) -> Result<(StatusCode, Json<Value>), ApiError> {
    let path = body.get("path").and_then(Value::as_str).ok_or_else(|| ApiError::bad("`path` is required"))?;
    let item = plan::add_media_from_path(&state.root, path, body.get("alt").and_then(Value::as_str), body.get("name").and_then(Value::as_str))?;
    emit_changed(&state, "media", item.get("id").and_then(Value::as_str), "create");
    Ok((StatusCode::CREATED, Json(item)))
}

async fn networks(State(state): State<Shared>) -> Json<Value> {
    Json(plan::networks_summary(&state.root))
}

async fn check(State(state): State<Shared>, Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    plan::check_post(&state.root, &body).map(Json)
}

#[derive(Deserialize)]
struct SlotQuery {
    count: Option<usize>,
    from: Option<String>,
    #[serde(rename = "spacingMinutes", alias = "spacing_minutes")]
    spacing_minutes: Option<i64>,
}

async fn slots(State(state): State<Shared>, Query(q): Query<SlotQuery>) -> Result<Json<Value>, ApiError> {
    plan::suggest_slots(&state.root, q.count.unwrap_or(3), q.from.as_deref(), q.spacing_minutes.unwrap_or(60)).map(Json)
}

async fn guide(State(state): State<Shared>) -> impl IntoResponse {
    ([(header::CONTENT_TYPE, "text/markdown; charset=utf-8")], plan::guide(&state.root))
}

async fn media_list(State(state): State<Shared>) -> Json<Value> {
    Json(json!({ "items": store::list_media(&state.root) }))
}

/// JSON `{ name, base64, mime?, alt? }`, raw bytes with `Content-Type` +
/// `X-File-Name`, or a multipart `file` field.
async fn media_create(State(state): State<Shared>, headers: HeaderMap, body: Bytes) -> Result<(StatusCode, Json<Value>), ApiError> {
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let item = if content_type.starts_with("application/json") {
        let v: Value = serde_json::from_slice(&body).map_err(|e| ApiError::bad(format!("invalid JSON: {e}")))?;
        let name = v.get("name").and_then(Value::as_str).unwrap_or("upload").to_string();
        let b64 = v.get("base64").and_then(Value::as_str).ok_or_else(|| ApiError::bad("`base64` is required"))?;
        let b64 = b64.split(',').next_back().unwrap_or(b64);
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64.trim())
            .map_err(|e| ApiError::bad(format!("base64: {e}")))?;
        let mime = v.get("mime").and_then(Value::as_str).map(String::from).unwrap_or_else(|| store::mime_for_name(&name).to_string());
        store::add_media(&state.root, &name, &mime, &bytes, v.get("alt").and_then(Value::as_str))?
    } else if content_type.starts_with("multipart/form-data") {
        let req = Request::builder()
            .header(header::CONTENT_TYPE, content_type)
            .body(axum::body::Body::from(body))
            .map_err(|e| ApiError::bad(e.to_string()))?;
        let mut multipart = Multipart::from_request(req, &()).await.map_err(|e| ApiError::bad(e.to_string()))?;
        let mut found: Option<(String, String, Vec<u8>)> = None;
        let mut alt: Option<String> = None;
        while let Some(field) = multipart.next_field().await.map_err(|e| ApiError::bad(e.to_string()))? {
            let field_name = field.name().unwrap_or("").to_string();
            if field_name == "alt" {
                alt = field.text().await.ok();
                continue;
            }
            let name = field.file_name().unwrap_or("upload").to_string();
            let mime = field.content_type().map(String::from).unwrap_or_else(|| store::mime_for_name(&name).to_string());
            let data = field.bytes().await.map_err(|e| ApiError::bad(e.to_string()))?;
            found = Some((name, mime, data.to_vec()));
        }
        let (name, mime, data) = found.ok_or_else(|| ApiError::bad("no file field in the multipart body"))?;
        store::add_media(&state.root, &name, &mime, &data, alt.as_deref())?
    } else {
        let name = headers
            .get("x-file-name")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("upload")
            .to_string();
        let mime = if content_type.is_empty() { store::mime_for_name(&name).to_string() } else { content_type };
        store::add_media(&state.root, &name, &mime, &body, None)?
    };
    emit_changed(&state, "media", item.get("id").and_then(Value::as_str), "create");
    Ok((StatusCode::CREATED, Json(item)))
}

// Multipart extraction from a re-built request needs FromRequest in scope.
use axum::extract::FromRequest;

/* ------------------------------------------------------------------ */
/* MCP (Streamable HTTP, JSON responses)                                */
/* ------------------------------------------------------------------ */

async fn mcp_post(State(state): State<Shared>, body: Bytes) -> Response {
    let parsed: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(super::mcp::error_response(Value::Null, -32700, &format!("parse error: {e}"))),
            )
                .into_response();
        }
    };
    let messages: Vec<Value> = match parsed {
        Value::Array(items) => items,
        other => vec![other],
    };
    let mut responses = Vec::new();
    for msg in &messages {
        if let Some(res) = super::mcp::handle(&state, msg) {
            responses.push(res);
        }
    }
    if responses.is_empty() {
        // Notifications only — nothing to say back.
        return StatusCode::ACCEPTED.into_response();
    }
    let payload = if messages.len() == 1 { responses.remove(0) } else { Value::Array(responses) };
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        Json(payload),
    )
        .into_response()
}

/// No server-initiated stream: clients that ask for one get 405, as the
/// Streamable HTTP spec allows.
async fn mcp_get() -> Response {
    (StatusCode::METHOD_NOT_ALLOWED, [(header::ALLOW, "POST, DELETE")], "this MCP server does not open SSE streams").into_response()
}

async fn mcp_delete() -> StatusCode {
    StatusCode::OK
}
