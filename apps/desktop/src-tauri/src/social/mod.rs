//! social — the local agent server. A tiny axum service on 127.0.0.1 that
//! lets agents (Claude Code, Cursor, Codex, ChatGPT through a tunnel,
//! OpenClaw, Hermes, any script) read and write the same JSON files the
//! social tool keeps under `<AppData>/social/`, over REST and over MCP
//! (Streamable HTTP, JSON responses). It also serves the loopback OAuth
//! redirect (`/oauth/callback`) that "bring your own app" networks need.
//!
//! The frontend owns the network calls: `POST /posts/{id}/publish` only
//! marks the post due and emits `social-changed`, and the app's runner —
//! which lives in the tray — does the publishing.

pub mod mcp;
pub mod plan;
pub mod server;
pub mod setup;
pub mod store;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{Arc, Mutex, OnceLock, RwLock};

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Event the frontend listens to; payload `{ source, kind, id, action }`.
pub const CHANGED_EVENT: &str = "social-changed";
/// Event carrying an OAuth redirect back to the window that started it.
pub const OAUTH_EVENT: &str = "social-oauth-callback";
pub const DEFAULT_PORT: u16 = 7474;

pub struct SocialState {
    pub app: AppHandle,
    pub root: PathBuf,
    pub token: RwLock<String>,
    pub enabled: AtomicBool,
    pub port: AtomicU16,
    pub running: AtomicBool,
    /// Drop the sender to stop the current server.
    shutdown: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
}

static STATE: OnceLock<Arc<SocialState>> = OnceLock::new();

fn state() -> Option<Arc<SocialState>> {
    STATE.get().cloned()
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub running: bool,
    pub enabled: bool,
    pub port: u16,
    pub token: String,
    pub url: String,
}

impl SocialState {
    pub fn info(&self) -> AgentInfo {
        let port = self.port.load(Ordering::Relaxed);
        AgentInfo {
            running: self.running.load(Ordering::Relaxed),
            enabled: self.enabled.load(Ordering::Relaxed),
            port,
            token: self.token.read().map(|t| t.clone()).unwrap_or_default(),
            url: format!("http://127.0.0.1:{port}"),
        }
    }

    pub fn token_matches(&self, candidate: &str) -> bool {
        self.token
            .read()
            .map(|t| !t.is_empty() && constant_time_eq(t.as_bytes(), candidate.as_bytes()))
            .unwrap_or(false)
    }
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Reads the agent settings, mints a token when there is none, and starts
/// the server. Called once from `setup`.
pub fn start(app: &AppHandle) {
    let root = match app.path().app_data_dir() {
        Ok(dir) => dir.join("social"),
        Err(e) => {
            log::error!("social: no app data dir: {e}");
            return;
        }
    };
    let mut agent = store::agent_settings(&root);
    if agent.token.is_empty() {
        agent.token = store::new_token();
        if let Err(e) = store::save_agent_settings(&root, &agent) {
            log::error!("social: could not save the agent token: {e}");
        }
    }
    let state = Arc::new(SocialState {
        app: app.clone(),
        root,
        token: RwLock::new(agent.token),
        enabled: AtomicBool::new(agent.enabled),
        port: AtomicU16::new(agent.port),
        running: AtomicBool::new(false),
        shutdown: Mutex::new(None),
    });
    if STATE.set(state.clone()).is_err() {
        return;
    }
    spawn_server(state);
}

fn spawn_server(state: Arc<SocialState>) {
    let port = state.port.load(Ordering::Relaxed);
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    if let Ok(mut guard) = state.shutdown.lock() {
        // Dropping the previous sender stops the previous server.
        *guard = Some(tx);
    }
    tauri::async_runtime::spawn(async move {
        state.running.store(false, Ordering::Relaxed);
        let listener = match tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
            Ok(l) => l,
            Err(e) => {
                log::error!("social: cannot listen on 127.0.0.1:{port}: {e}");
                return;
            }
        };
        log::info!("social: agent server on http://127.0.0.1:{port}");
        state.running.store(true, Ordering::Relaxed);
        let app = server::router(state.clone());
        let served = axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = rx.await;
            })
            .await;
        state.running.store(false, Ordering::Relaxed);
        if let Err(e) = served {
            log::error!("social: server stopped: {e}");
        } else {
            log::info!("social: server on port {port} stopped");
        }
    });
}

/* ------------------------------------------------------------------ */
/* Commands                                                             */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub fn social_agent_info() -> Result<AgentInfo, String> {
    state()
        .map(|s| s.info())
        .ok_or_else(|| "agent server not started".to_string())
}

#[tauri::command]
pub fn social_agent_regenerate_token() -> Result<AgentInfo, String> {
    let s = state().ok_or_else(|| "agent server not started".to_string())?;
    let token = store::new_token();
    if let Ok(mut guard) = s.token.write() {
        *guard = token.clone();
    }
    let mut agent = store::agent_settings(&s.root);
    agent.token = token;
    store::save_agent_settings(&s.root, &agent)?;
    Ok(s.info())
}

/// Which agents are installed on this machine and whether our server is
/// already in their config.
#[tauri::command]
pub fn social_agent_targets() -> Vec<setup::TargetInfo> {
    setup::targets()
}

/// Writes the MCP entry into that agent's own config file. The UI confirms
/// first — this touches another program's settings.
#[tauri::command]
pub fn social_agent_install(target: String) -> Result<setup::InstallOutcome, String> {
    let s = state().ok_or_else(|| "agent server not started".to_string())?;
    let info = s.info();
    setup::install(&target, &format!("{}/mcp", info.url), &info.token)
}

#[tauri::command]
pub fn social_agent_configure(port: Option<u16>, enabled: Option<bool>) -> Result<AgentInfo, String> {
    let s = state().ok_or_else(|| "agent server not started".to_string())?;
    let mut agent = store::agent_settings(&s.root);
    agent.token = s.token.read().map(|t| t.clone()).unwrap_or(agent.token);
    if let Some(enabled) = enabled {
        agent.enabled = enabled;
        s.enabled.store(enabled, Ordering::Relaxed);
    }
    let mut restart = false;
    if let Some(port) = port {
        if !(1024..=65535).contains(&port) {
            return Err("port must be between 1024 and 65535".into());
        }
        if port != s.port.load(Ordering::Relaxed) {
            agent.port = port;
            s.port.store(port, Ordering::Relaxed);
            restart = true;
        }
    }
    store::save_agent_settings(&s.root, &agent)?;
    if restart {
        spawn_server(s.clone());
        // Give the new listener a moment so `running` reflects the truth.
        std::thread::sleep(std::time::Duration::from_millis(150));
    }
    Ok(s.info())
}
