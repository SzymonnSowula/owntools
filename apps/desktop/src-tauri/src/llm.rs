//! One language model for every tool, running on this machine: llama.cpp's
//! `llama-server` kept resident by this module, a pinned GGUF under
//! `<AppData>/llm/models/<id>/`, spoken to over loopback as an
//! OpenAI-compatible endpoint. Nothing leaves the machine.
//!
//!   llm/bin/     `llama-server(.exe)` + the libraries it loads, unpacked from
//!                the pinned release archive by `llm_install_runtime`. The
//!                server binary in current llama.cpp builds is a 9 KB launcher
//!                that loads `llama-server-impl.dll` and friends, so every
//!                library ships with it and the other twenty tools do not;
//!   llm/models/<id>/<file>.gguf  downloaded through the pinned downloader
//!                (`download_file`), so a half-fetched model is a `.part` and
//!                never looks installed;
//!   llm/server.log  what the last server start printed, for the log-folder
//!                button when "the model would not load".
//!
//! ## Why a resident server (again)
//!
//! Same story as `parakeet.rs`: loading a 2.5 GB model costs seconds, a tool
//! asks for three or four completions in a row, and paying the load on every
//! one is what makes "AI" feel broken. The server is started lazily by the
//! first request (or ahead of time by `llm_ensure_server`), keeps one model
//! in memory, is replaced when a different model is asked for, and is shut
//! down after `IDLE_SHUTDOWN` so 2–4 GB do not sit around all day. It is
//! killed on `RunEvent::Exit`.
//!
//! Measured here (i5-10300H, 4 physical cores, Qwen3 1.7B Q8_0, b10809):
//! model resident after ~2.0 s from a warm disk cache; a 50-token prompt +
//! 21-token answer in 2.4 s; 131 tokens generated at 11.7 tok/s with 4
//! threads, 11.4 tok/s with 8 — the hyperthreads buy nothing, which is why
//! the thread count is `parakeet::recognizer_threads` (physical cores).
//!
//! Qwen3 is a "thinking" model. Thinking is switched off twice — at the
//! template (`--reasoning off`) and per request
//! (`chat_template_kwargs.enable_thinking = false`) — and any `<think>` block
//! that still slips through is stripped, because a summary tool wants the
//! summary, not the model's diary.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[cfg(windows)]
const SERVER_EXE: &str = "llama-server.exe";
#[cfg(not(windows))]
const SERVER_EXE: &str = "llama-server";

/// How long the model may sit idle before we give the memory back.
const IDLE_SHUTDOWN: Duration = Duration::from_secs(10 * 60);
/// A 2.5 GB model from a cold disk on a laptop; be generous.
const START_TIMEOUT: Duration = Duration::from_secs(180);
/// One completion should never take this long, even a long summary on a slow CPU.
const CALL_TIMEOUT: Duration = Duration::from_secs(600);
/// Context the server is started with. Qwen3 goes to 32k natively, but the
/// KV cache for that is gigabytes; 8k covers `chunkForModel(text, 3000)`
/// plus a system prompt plus the answer, which is the contract every tool
/// codes against.
const CONTEXT_TOKENS: u32 = 8192;

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("llm"))
}

fn bin_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(root(app)?.join("bin"))
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(root(app)?.join("models"))
}

fn find_server_exe(app: &AppHandle) -> Option<PathBuf> {
    let exe = bin_dir(app).ok()?.join(SERVER_EXE);
    exe.is_file().then_some(exe)
}

/// Model ids come from the frontend: a bare folder name, never a path.
fn safe_id(id: &str) -> Option<String> {
    let id = id.trim();
    let ok = !id.is_empty()
        && id.len() <= 80
        && !id.contains("..")
        && id.chars().next().map(|c| c.is_ascii_alphanumeric()).unwrap_or(false)
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    ok.then(|| id.to_string())
}

/// The GGUF inside a model folder, if the download finished: the downloader
/// writes `<file>.part` and renames only after the checksum matched, so a
/// `.gguf` that exists is a model that is whole.
fn gguf_in(dir: &Path) -> Option<(PathBuf, u64)> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut files: Vec<(PathBuf, u64)> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.extension()
                .map(|x| x.eq_ignore_ascii_case("gguf"))
                .unwrap_or(false)
        })
        .filter_map(|p| {
            let len = p.metadata().ok()?.len();
            (len > 0).then_some((p, len))
        })
        .collect();
    files.sort();
    files.into_iter().next()
}

struct InstalledModel {
    id: String,
    bytes: u64,
}

fn installed_models(app: &AppHandle) -> Vec<InstalledModel> {
    let Ok(dir) = models_dir(app) else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut models: Vec<InstalledModel> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .filter_map(|p| {
            let (_, bytes) = gguf_in(&p)?;
            let id = p.file_name()?.to_string_lossy().to_string();
            Some(InstalledModel { id, bytes })
        })
        .collect();
    models.sort_by(|a, b| a.id.cmp(&b.id));
    models
}

fn model_path(app: &AppHandle, id: &str) -> Option<PathBuf> {
    let dir = models_dir(app).ok()?.join(id);
    gguf_in(&dir).map(|(path, _)| path)
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub id: String,
    pub installed: bool,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmBackendStatus {
    /// `llama-server` is unpacked and in place.
    pub runtime: bool,
    /// Complete model folders, one entry each.
    pub models: Vec<ModelStatus>,
    /// `off` (nothing loaded), `loading` (a start is in flight — the next
    /// request waits for it rather than starting a second one), `ready`.
    pub server: &'static str,
    /// Which model is loaded or loading.
    pub server_model: Option<String>,
    pub dir: String,
    /// `std::env::consts::ARCH` — the macOS runtime is arm64-only and the
    /// frontend needs to know before it offers the download.
    pub arch: &'static str,
}

pub fn status(app: &AppHandle) -> LlmBackendStatus {
    let (server, server_model) = server_snapshot();
    LlmBackendStatus {
        runtime: find_server_exe(app).is_some(),
        models: installed_models(app)
            .into_iter()
            .map(|m| ModelStatus {
                id: m.id,
                installed: true,
                bytes: m.bytes,
            })
            .collect(),
        server,
        server_model,
        dir: root(app).map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
        arch: std::env::consts::ARCH,
    }
}

/// Off the main thread on purpose: it reads two folders, and the main thread
/// is the whole app's event loop (see the disk analyzer's cleanup freeze).
#[tauri::command(async)]
pub fn llm_status(app: AppHandle) -> LlmBackendStatus {
    status(&app)
}

// ---------------------------------------------------------------------------
// The resident server
// ---------------------------------------------------------------------------

struct Server {
    child: Child,
    port: u16,
    model: String,
    threads: u32,
    /// When the last completion finished, for the idle watchdog.
    last_used: Instant,
}

/// The lock is never held while a model loads: `ensure_server` parks the
/// state on `Loading`, releases the mutex, starts the child, and takes the
/// lock again to store the result. `llm_status` therefore answers in
/// microseconds during a 30-second load instead of hanging the Settings card.
enum ServerState {
    Off,
    Loading { model: String },
    Ready(Server),
}

static SERVER: Mutex<ServerState> = Mutex::new(ServerState::Off);

fn server_snapshot() -> (&'static str, Option<String>) {
    let Ok(mut guard) = SERVER.lock() else {
        return ("off", None);
    };
    match &mut *guard {
        ServerState::Off => ("off", None),
        ServerState::Loading { model } => ("loading", Some(model.clone())),
        ServerState::Ready(server) => {
            if matches!(server.child.try_wait(), Ok(None)) {
                ("ready", Some(server.model.clone()))
            } else {
                // Died behind our back (OOM killer, a crash); say so.
                *guard = ServerState::Off;
                ("off", None)
            }
        }
    }
}

/// Is this exact model already resident? Decided before `ensure_server` so
/// the number reported to the user is the one they experienced.
fn is_warm(model: &str, threads: u32) -> bool {
    SERVER
        .lock()
        .map(|mut guard| match &mut *guard {
            ServerState::Ready(s) => {
                s.model == model && s.threads == threads && matches!(s.child.try_wait(), Ok(None))
            }
            _ => false,
        })
        .unwrap_or(false)
}

/// Asks the OS for a port nobody is using, then hands it to the child. There
/// is a small race between closing the listener and the server binding, which
/// is why a failed start is reported rather than retried forever.
fn free_port() -> Result<u16, String> {
    let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
        .map_err(|e| format!("no free loopback port: {e}"))?;
    listener.local_addr().map(|a| a.port()).map_err(|e| e.to_string())
}

fn address(port: u16) -> SocketAddr {
    SocketAddr::from(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port))
}

/// llama.cpp builds differ in which flags they accept; probing `--help` once
/// lets us pass the good ones without a hard failure on a re-pinned binary.
fn help_text(exe: &Path) -> String {
    static HELP: Mutex<Option<(PathBuf, String)>> = Mutex::new(None);
    let mut slot = HELP.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((path, text)) = slot.as_ref() {
        if path == exe {
            return text.clone();
        }
    }
    let mut cmd = Command::new(exe);
    cmd.arg("--help").stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(parent) = exe.parent() {
        cmd.current_dir(parent);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let text = cmd
        .output()
        .map(|out| {
            let mut s = String::from_utf8_lossy(&out.stdout).to_string();
            s.push_str(&String::from_utf8_lossy(&out.stderr));
            s
        })
        .unwrap_or_default();
    *slot = Some((exe.to_path_buf(), text.clone()));
    text
}

fn spawn_server(exe: &Path, model: &Path, port: u16, threads: u32, log: &Path) -> Result<Child, String> {
    let help = help_text(exe);
    let supports = |flag: &str| help.contains(flag);
    let mut cmd = Command::new(exe);
    cmd.arg("-m")
        .arg(model)
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .arg("-c")
        .arg(CONTEXT_TOKENS.to_string())
        .arg("-t")
        .arg(threads.to_string())
        // One slot with the whole context: requests come one at a time from a
        // person's tools, and a second slot would only split the KV cache.
        .arg("-np")
        .arg("1");
    if supports("--no-webui") {
        cmd.arg("--no-webui");
    }
    // Qwen3 thinks by default; a summary tool wants the summary.
    if supports("--reasoning [on|off|auto]") || supports("--reasoning ") {
        cmd.arg("--reasoning").arg("off");
    }
    // What the server prints (model metadata, "model loaded", any error) goes
    // to a file next to the models, not into the void.
    let stderr = std::fs::File::create(log)
        .map(Stdio::from)
        .unwrap_or_else(|_| Stdio::null());
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(stderr);
    if let Some(parent) = exe.parent() {
        cmd.current_dir(parent);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd.spawn()
        .map_err(|e| format!("the language model server would not start: {e}"))
}

/// One plain HTTP/1.1 GET over loopback — for `/health` while the child is
/// still loading, where pulling the async client into a blocking wait loop
/// would be more code than the request. Returns the status code.
fn http_status(port: u16, path: &str) -> Option<u16> {
    let mut stream = TcpStream::connect_timeout(&address(port), Duration::from_millis(250)).ok()?;
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    stream
        .write_all(format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n").as_bytes())
        .ok()?;
    let mut buf = Vec::with_capacity(512);
    let _ = stream.read_to_end(&mut buf);
    parse_status_line(&String::from_utf8_lossy(&buf))
}

fn parse_status_line(response: &str) -> Option<u16> {
    let line = response.lines().next()?;
    let mut parts = line.split_whitespace();
    let proto = parts.next()?;
    if !proto.starts_with("HTTP/") {
        return None;
    }
    parts.next()?.parse().ok()
}

/// Blocks until `/health` answers 200 (the model is loaded and the slots are
/// ready), or the child dies, or the deadline passes. `/health` is 503 with
/// "Loading model" until then.
fn wait_until_healthy(child: &mut Child, port: u16, log: &Path) -> Result<(), String> {
    let deadline = Instant::now() + START_TIMEOUT;
    while Instant::now() < deadline {
        if let Ok(Some(exit)) = child.try_wait() {
            let tail = std::fs::read_to_string(log)
                .map(|s| s.lines().rev().take(6).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join(" | "))
                .unwrap_or_default();
            return Err(format!(
                "the language model server exited during start-up ({exit}){}",
                if tail.is_empty() { String::new() } else { format!(": {tail}") }
            ));
        }
        if http_status(port, "/health") == Some(200) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err("the language model did not finish loading in time".into())
}

fn kill(mut server: Server) {
    let _ = server.child.kill();
    let _ = server.child.wait();
}

/// Returns the port of a running server for this model, starting one when
/// there is none (or when the model or thread count changed). Never holds
/// the state lock while the model loads.
fn ensure_server(app: &AppHandle, model: &str, threads: u32) -> Result<u16, String> {
    let exe = find_server_exe(app)
        .ok_or("The language model runtime is not installed — install a model in Settings → Intelligence.")?;
    let path = model_path(app, model)
        .ok_or("That model is not installed — install it in Settings → Intelligence.")?;
    let log = root(app)?.join("server.log");

    let deadline = Instant::now() + START_TIMEOUT;
    loop {
        let mut guard = SERVER.lock().map_err(|_| "language model lock poisoned")?;
        let previous = match std::mem::replace(&mut *guard, ServerState::Off) {
            ServerState::Ready(server) => {
                let alive = matches!(&server.child, c if {
                    let mut c = c;
                    let _ = &mut c;
                    true
                });
                let _ = alive;
                let mut server = server;
                let alive = matches!(server.child.try_wait(), Ok(None));
                if alive && server.model == model && server.threads == threads {
                    server.last_used = Instant::now();
                    let port = server.port;
                    *guard = ServerState::Ready(server);
                    return Ok(port);
                }
                log::info!(
                    "llm: replacing the resident model (alive={alive}, {} -> {model})",
                    server.model
                );
                Some(server)
            }
            ServerState::Loading { model: loading } => {
                // Someone else is starting one. Wait for them rather than
                // racing a second 2.5 GB load; then re-check what they got.
                *guard = ServerState::Loading { model: loading };
                drop(guard);
                if Instant::now() > deadline {
                    return Err("the language model is still loading; try again in a moment".into());
                }
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }
            ServerState::Off => None,
        };
        *guard = ServerState::Loading {
            model: model.to_string(),
        };
        drop(guard);
        if let Some(old) = previous {
            kill(old);
        }

        let started = Instant::now();
        let result = free_port().and_then(|port| {
            let mut child = spawn_server(&exe, &path, port, threads, &log)?;
            if let Err(e) = wait_until_healthy(&mut child, port, &log) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(e);
            }
            Ok((port, child))
        });

        let mut guard = SERVER.lock().map_err(|_| "language model lock poisoned")?;
        return match result {
            Ok((port, child)) => {
                log::info!(
                    "llm: model resident on 127.0.0.1:{port} ({model}, {threads} threads, loaded in {} ms)",
                    started.elapsed().as_millis()
                );
                *guard = ServerState::Ready(Server {
                    child,
                    port,
                    model: model.to_string(),
                    threads,
                    last_used: Instant::now(),
                });
                start_idle_watchdog();
                Ok(port)
            }
            Err(e) => {
                *guard = ServerState::Off;
                log::error!("llm: {e}");
                Err(e)
            }
        };
    }
}

/// One watchdog for the lifetime of the process: every half minute it checks
/// whether the model has been idle long enough to give the memory back.
fn start_idle_watchdog() {
    static STARTED: Mutex<bool> = Mutex::new(false);
    let mut started = STARTED.lock().unwrap_or_else(|e| e.into_inner());
    if *started {
        return;
    }
    *started = true;
    std::thread::spawn(|| loop {
        std::thread::sleep(Duration::from_secs(30));
        let Ok(mut guard) = SERVER.lock() else { continue };
        let idle = matches!(&*guard, ServerState::Ready(s) if s.last_used.elapsed() >= IDLE_SHUTDOWN);
        if idle {
            if let ServerState::Ready(server) = std::mem::replace(&mut *guard, ServerState::Off) {
                kill(server);
                log::info!("llm: model idle for {} min, memory released", IDLE_SHUTDOWN.as_secs() / 60);
            }
        }
    });
}

/// Marks the model as just used, so the idle watchdog does not free it in
/// the middle of a long summary that started nine minutes ago.
fn touch_server() {
    if let Ok(mut guard) = SERVER.lock() {
        if let ServerState::Ready(server) = &mut *guard {
            server.last_used = Instant::now();
        }
    }
}

/// Kills the resident server. Called when the app exits, by `llm_shutdown`,
/// and before the runtime is replaced or a model removed.
pub fn shutdown() {
    let Ok(mut guard) = SERVER.lock() else { return };
    if let ServerState::Ready(server) = std::mem::replace(&mut *guard, ServerState::Off) {
        kill(server);
        log::info!("llm: model server stopped");
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureResult {
    pub port: u16,
    /// Milliseconds the call took: ~0 when the model was already resident.
    pub ms: u64,
    pub warm: bool,
}

/// Loads the model ahead of a request (a tool that is about to need it, or
/// the Settings card's "Try it"), so the first answer does not pay the load.
#[tauri::command]
pub async fn llm_ensure_server(
    app: AppHandle,
    model: String,
    threads: Option<u32>,
) -> Result<EnsureResult, String> {
    let id = safe_id(&model).ok_or("Not a model id.")?;
    let threads = crate::parakeet::recognizer_threads(threads);
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        let warm = is_warm(&id, threads);
        let port = ensure_server(&app, &id, threads)?;
        Ok(EnsureResult {
            port,
            ms: started.elapsed().as_millis() as u64,
            warm,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Frees the model. The idle watchdog does this on its own after ten minutes.
#[tauri::command]
pub fn llm_shutdown() {
    shutdown();
}

// ---------------------------------------------------------------------------
// Completions
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteRequest {
    /// Catalogue id = model folder.
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub max_tokens: Option<u32>,
    /// 0–2; the frontend defaults to 0.3 for editing jobs.
    pub temperature: Option<f32>,
    /// Ask for one JSON value (`response_format: json_object`).
    pub json: Option<bool>,
    pub threads: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteResult {
    pub text: String,
    /// Milliseconds from the command starting to the answer arriving,
    /// including a model load when there was one.
    pub ms: u64,
    /// Of `ms`, how much was loading the model (0 when it was resident).
    pub load_ms: u64,
    pub prompt_tokens: Option<u64>,
    pub completion_tokens: Option<u64>,
    /// True when the model was already loaded, i.e. `ms` is the number a
    /// user actually waits once things are warm.
    pub warm: bool,
}

/// The request body llama-server's OpenAI-compatible endpoint gets.
fn chat_body(request: &CompleteRequest) -> serde_json::Value {
    let mut body = serde_json::json!({
        "model": request.model,
        "messages": request.messages,
        "max_tokens": request.max_tokens.unwrap_or(1024).clamp(1, 8192),
        "temperature": request.temperature.unwrap_or(0.3).clamp(0.0, 2.0),
        "stream": false,
        // Qwen3: no thinking block. Ignored by templates without the switch.
        "chat_template_kwargs": { "enable_thinking": false },
    });
    if request.json.unwrap_or(false) {
        body["response_format"] = serde_json::json!({ "type": "json_object" });
    }
    body
}

/// Qwen3 without thinking still opens with an empty `<think>\n\n</think>`
/// in some templates, and a model asked for JSON may narrate first. Drop
/// every complete block, and an unterminated one from its start.
fn strip_think(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    loop {
        match rest.find("<think>") {
            None => {
                out.push_str(rest);
                break;
            }
            Some(start) => {
                out.push_str(&rest[..start]);
                let after = &rest[start + "<think>".len()..];
                match after.find("</think>") {
                    Some(end) => rest = &after[end + "</think>".len()..],
                    None => break,
                }
            }
        }
    }
    out.trim().to_string()
}

/// llama-server's error bodies are `{"error":{"code":…,"message":"…"}}`.
fn describe_error(status: u16, body: &str) -> String {
    let message = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| {
            v.get("error")
                .and_then(|e| e.get("message").or(Some(e)))
                .and_then(|m| m.as_str().map(str::to_string))
        })
        .unwrap_or_else(|| body.chars().take(200).collect());
    format!("the language model answered {status}: {message}")
}

struct Answer {
    text: String,
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
}

fn parse_answer(body: &str) -> Result<Answer, String> {
    let v: serde_json::Value =
        serde_json::from_str(body).map_err(|e| format!("the language model sent something other than JSON: {e}"))?;
    let content = v
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .ok_or("the language model sent no message")?;
    let usage = v.get("usage");
    let tokens = |key: &str| usage.and_then(|u| u.get(key)).and_then(|n| n.as_u64());
    Ok(Answer {
        text: strip_think(content),
        prompt_tokens: tokens("prompt_tokens"),
        completion_tokens: tokens("completion_tokens"),
    })
}

/// POSTs one chat completion to the resident server. Async reqwest because
/// it is already in the tree and handles chunked bodies; `no_proxy` because
/// a system proxy must never see loopback.
async fn post_chat(port: u16, body: &serde_json::Value) -> Result<Answer, String> {
    let client = reqwest::Client::builder()
        .timeout(CALL_TIMEOUT)
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .post(format!("http://127.0.0.1:{port}/v1/chat/completions"))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| format!("could not reach the language model server: {e}"))?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !(200..300).contains(&status) {
        return Err(describe_error(status, &text));
    }
    parse_answer(&text)
}

/// One completion against the on-device model, loading it first when needed.
#[tauri::command]
pub async fn llm_complete(app: AppHandle, request: CompleteRequest) -> Result<CompleteResult, String> {
    let id = safe_id(&request.model).ok_or("Not a model id.")?;
    if request.messages.is_empty() {
        return Err("Nothing to ask.".into());
    }
    let threads = crate::parakeet::recognizer_threads(request.threads);
    let started = Instant::now();
    let warm = is_warm(&id, threads);

    let app_for_load = app.clone();
    let id_for_load = id.clone();
    let port = tauri::async_runtime::spawn_blocking(move || ensure_server(&app_for_load, &id_for_load, threads))
        .await
        .map_err(|e| e.to_string())??;
    let load_ms = if warm { 0 } else { started.elapsed().as_millis() as u64 };

    let mut request = request;
    request.model = id.clone();
    let body = chat_body(&request);
    let answer = post_chat(port, &body).await;
    touch_server();
    let answer = answer?;
    let ms = started.elapsed().as_millis() as u64;
    log::info!(
        "llm: {} -> {} tokens in {ms} ms ({}, {threads} threads{})",
        answer.prompt_tokens.unwrap_or(0),
        answer.completion_tokens.unwrap_or(0),
        if warm { "warm" } else { "cold" },
        if load_ms > 0 { format!(", {load_ms} ms of it loading") } else { String::new() }
    );
    Ok(CompleteResult {
        text: answer.text,
        ms,
        load_ms,
        prompt_tokens: answer.prompt_tokens,
        completion_tokens: answer.completion_tokens,
        warm,
    })
}

// ---------------------------------------------------------------------------
// Installing the runtime
// ---------------------------------------------------------------------------

/// Archive paths come from the frontend: keep them relative and inside AppData.
fn safe_relative(rel: &str) -> Option<PathBuf> {
    let path = Path::new(rel);
    if path.is_absolute() || rel.contains(':') {
        return None;
    }
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => out.push(part),
            _ => return None,
        }
    }
    (!out.as_os_str().is_empty()).then_some(out)
}

/// Which archive entries land in `llm/bin/`: the server launcher and every
/// shared library (the launcher is a shim over `llama-server-impl`, and the
/// CPU backend is a dozen `ggml-cpu-<arch>` libraries picked at run time),
/// nothing else — the release also ships ~20 other executables.
fn keep_entry(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    name.eq_ignore_ascii_case(SERVER_EXE)
        || lower.ends_with(".dll")
        || lower.ends_with(".dylib")
        || lower.ends_with(".so")
}

#[cfg(unix)]
fn mark_exec(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755));
}
#[cfg(not(unix))]
fn mark_exec(_path: &Path) {}

fn unpack_zip(archive: &Path, into: &Path) -> Result<(usize, bool), String> {
    let file = std::fs::File::open(archive).map_err(|e| format!("Runtime archive missing: {e}"))?;
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(file))
        .map_err(|e| format!("Runtime archive unreadable: {e}"))?;
    let mut count = 0usize;
    let mut got_server = false;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        let Some(name) = entry
            .enclosed_name()
            .and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string()))
        else {
            continue;
        };
        if !keep_entry(&name) {
            continue;
        }
        let dest = into.join(&name);
        let mut out = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        drop(out);
        mark_exec(&dest);
        got_server |= name.eq_ignore_ascii_case(SERVER_EXE);
        count += 1;
    }
    Ok((count, got_server))
}

fn unpack_tar_gz(archive: &Path, into: &Path) -> Result<(usize, bool), String> {
    let file = std::fs::File::open(archive).map_err(|e| format!("Runtime archive missing: {e}"))?;
    let decoder = flate2::read::MultiGzDecoder::new(std::io::BufReader::new(file));
    let mut tar = tar::Archive::new(decoder);
    let mut count = 0usize;
    let mut got_server = false;
    // Symlinks (`libllama.dylib -> libllama.0.dylib -> libllama.0.4.0.dylib`)
    // are recreated after every real file is on disk, so a link never points
    // at something that is not there yet.
    let mut links: Vec<(String, String)> = Vec::new();
    for entry in tar.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?.into_owned();
        let Some(name) = path.file_name().map(|n| n.to_string_lossy().to_string()) else {
            continue;
        };
        if !keep_entry(&name) {
            continue;
        }
        let kind = entry.header().entry_type();
        if kind.is_symlink() {
            if let Ok(Some(target)) = entry.link_name() {
                if let Some(target) = target.file_name().map(|n| n.to_string_lossy().to_string()) {
                    links.push((name, target));
                }
            }
            continue;
        }
        if !kind.is_file() {
            continue;
        }
        let dest = into.join(&name);
        let mut out = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        drop(out);
        mark_exec(&dest);
        got_server |= name.eq_ignore_ascii_case(SERVER_EXE);
        count += 1;
    }
    for (name, target) in links {
        let dest = into.join(&name);
        let _ = std::fs::remove_file(&dest);
        #[cfg(unix)]
        let linked = std::os::unix::fs::symlink(&target, &dest).is_ok();
        #[cfg(not(unix))]
        let linked = false;
        if !linked {
            // No symlinks here: a copy under the alias name works just as well.
            let _ = std::fs::copy(into.join(&target), &dest);
        }
        count += 1;
    }
    Ok((count, got_server))
}

/// Unpacks the pinned llama.cpp release archive (a `.zip` on Windows, a
/// `.tar.gz` on macOS) into `llm/bin/`: the server and the libraries it
/// loads, nothing else. The archive is deleted afterwards.
#[tauri::command]
pub async fn llm_install_runtime(app: AppHandle, archive: String) -> Result<(), String> {
    let rel = safe_relative(&archive).ok_or("Not a valid archive path.")?;
    let archive_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(rel);
    let bin = bin_dir(&app)?;

    // A running server holds its executable open on Windows.
    shutdown();

    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&bin).map_err(|e| e.to_string())?;
        let lower = archive_path.to_string_lossy().to_ascii_lowercase();
        let (count, got_server) = if lower.ends_with(".zip") {
            unpack_zip(&archive_path, &bin)?
        } else if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
            unpack_tar_gz(&archive_path, &bin)?
        } else {
            return Err("Unknown runtime archive format.".to_string());
        };
        let _ = std::fs::remove_file(&archive_path);
        if !got_server {
            return Err("The archive did not contain llama-server.".to_string());
        }
        log::info!("llm runtime unpacked: {count} files into {}", bin.display());
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Deletes one model folder (the card's "Remove").
#[tauri::command(async)]
pub fn llm_remove_model(app: AppHandle, id: String) -> Result<(), String> {
    let safe = safe_id(&id).ok_or("Not a model id.")?;
    // The server may have this very file mapped.
    let loaded = SERVER
        .lock()
        .map(|guard| match &*guard {
            ServerState::Ready(s) => s.model == safe,
            ServerState::Loading { model } => *model == safe,
            ServerState::Off => false,
        })
        .unwrap_or(false);
    if loaded {
        shutdown();
    }
    let dir = models_dir(&app)?.join(safe);
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_ids_stay_inside_the_models_folder() {
        assert_eq!(safe_id(" qwen3-4b-q4_k_m ").as_deref(), Some("qwen3-4b-q4_k_m"));
        assert_eq!(safe_id("qwen3-1.7b-q8_0").as_deref(), Some("qwen3-1.7b-q8_0"));
        assert!(safe_id("../whisper").is_none());
        assert!(safe_id("/etc/passwd").is_none());
        assert!(safe_id("C:\\models").is_none());
        assert!(safe_id("").is_none());
    }

    #[test]
    fn only_the_server_and_its_libraries_are_unpacked() {
        assert!(keep_entry(SERVER_EXE));
        assert!(keep_entry("ggml-cpu-haswell.dll"));
        assert!(keep_entry("libllama.0.4.0.dylib"));
        assert!(keep_entry("libggml-metal.dylib"));
        assert!(!keep_entry("llama-cli.exe"));
        assert!(!keep_entry("llama-bench"));
        assert!(!keep_entry("LICENSE"));
        assert!(!keep_entry("LICENSE-LLVM-OpenMP"));
    }

    #[test]
    fn think_blocks_are_removed_wherever_they_sit() {
        assert_eq!(strip_think("<think>\n\n</think>\n\nHello."), "Hello.");
        assert_eq!(strip_think("Hello.<think>later</think> Bye."), "Hello. Bye.");
        assert_eq!(strip_think("<think>never closed"), "");
        assert_eq!(strip_think("plain"), "plain");
    }

    #[test]
    fn answers_are_read_from_the_openai_shape() {
        let body = r#"{"choices":[{"finish_reason":"stop","index":0,"message":{"role":"assistant","content":"<think></think>Sure."}}],"usage":{"completion_tokens":21,"prompt_tokens":50,"total_tokens":71}}"#;
        let a = parse_answer(body).unwrap();
        assert_eq!(a.text, "Sure.");
        assert_eq!(a.prompt_tokens, Some(50));
        assert_eq!(a.completion_tokens, Some(21));
        assert!(parse_answer("{\"choices\":[]}").is_err());
        assert!(parse_answer("not json").is_err());
    }

    #[test]
    fn errors_quote_the_server_message() {
        let e = describe_error(400, r#"{"error":{"code":400,"message":"context too long","type":"invalid_request_error"}}"#);
        assert_eq!(e, "the language model answered 400: context too long");
        assert_eq!(describe_error(500, "boom"), "the language model answered 500: boom");
    }

    #[test]
    fn request_bodies_switch_thinking_off_and_ask_for_json_when_told() {
        let req = CompleteRequest {
            model: "qwen3-4b-q4_k_m".into(),
            messages: vec![ChatMessage {
                role: "user".into(),
                content: "hi".into(),
            }],
            max_tokens: Some(50_000),
            temperature: None,
            json: Some(true),
            threads: None,
        };
        let body = chat_body(&req);
        assert_eq!(body["chat_template_kwargs"]["enable_thinking"], false);
        assert_eq!(body["response_format"]["type"], "json_object");
        assert_eq!(body["max_tokens"], 8192);
        assert_eq!(body["messages"][0]["role"], "user");
        let plain = chat_body(&CompleteRequest { json: None, ..req });
        assert!(plain.get("response_format").is_none());
    }

    #[test]
    fn status_lines_parse() {
        assert_eq!(parse_status_line("HTTP/1.1 200 OK\r\nContent-Type: x\r\n\r\n"), Some(200));
        assert_eq!(parse_status_line("HTTP/1.1 503 Service Unavailable\r\n"), Some(503));
        assert_eq!(parse_status_line("garbage"), None);
        assert_eq!(parse_status_line(""), None);
    }

    /// Unpacks the real pinned archive (the one `models.ts` points at, downloaded
    /// by hand) into a temp folder and checks that exactly the right files come
    /// out: the launcher, its `-impl` library, the CPU backends — and none of
    /// the twenty other tools. Ignored because it needs the 18 MB archive:
    ///
    /// ```text
    /// OWNTOOLS_LLM_ARCHIVE=C:/path/llama-b10809-bin-win-cpu-x64.zip \
    ///   cargo test -- --ignored --nocapture live_runtime_unpack
    /// ```
    #[test]
    #[ignore = "needs the pinned llama.cpp archive on disk; see the doc comment"]
    fn live_runtime_unpack() {
        let archive = PathBuf::from(std::env::var("OWNTOOLS_LLM_ARCHIVE").expect("set OWNTOOLS_LLM_ARCHIVE"));
        let into = std::env::temp_dir().join(format!("owntools-llm-unpack-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&into);
        std::fs::create_dir_all(&into).unwrap();
        let lower = archive.to_string_lossy().to_ascii_lowercase();
        let (count, got_server) = if lower.ends_with(".zip") {
            unpack_zip(&archive, &into).expect("zip unpacks")
        } else {
            unpack_tar_gz(&archive, &into).expect("tar.gz unpacks")
        };
        let names: Vec<String> = std::fs::read_dir(&into)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        println!("{count} files unpacked: {names:?}");
        assert!(got_server, "llama-server missing");
        assert!(names.iter().any(|n| n.starts_with("llama-server")), "launcher missing");
        assert!(
            names.iter().any(|n| n.contains("llama-server-impl")),
            "the launcher's implementation library is missing"
        );
        assert!(names.iter().any(|n| n.contains("ggml-cpu")), "no CPU backend library");
        assert!(!names.iter().any(|n| n.starts_with("llama-cli")), "llama-cli should not be unpacked");
        assert!(!names.iter().any(|n| n.starts_with("LICENSE")), "licences should not be unpacked");
        let _ = std::fs::remove_dir_all(&into);
    }

    /// End-to-end against a real `llama-server` with a real GGUF: starts the
    /// server the way the app does, waits for `/health`, and asks for a
    /// ~200-token answer twice (the second proves the model stayed loaded).
    ///
    /// Ignored by default because it needs the pinned runtime and a model:
    ///
    /// ```text
    /// OWNTOOLS_LLM_SERVER=C:/path/llama-server.exe \
    /// OWNTOOLS_LLM_MODEL=C:/path/Qwen3-1.7B-Q8_0.gguf \
    ///   cargo test -- --ignored --nocapture live_llm
    /// ```
    #[test]
    #[ignore = "needs llama-server and a GGUF model; see the doc comment"]
    fn live_llm_round_trip() {
        let exe = PathBuf::from(std::env::var("OWNTOOLS_LLM_SERVER").expect("set OWNTOOLS_LLM_SERVER"));
        let model = PathBuf::from(std::env::var("OWNTOOLS_LLM_MODEL").expect("set OWNTOOLS_LLM_MODEL"));
        let threads = crate::parakeet::recognizer_threads(None);
        let log = std::env::temp_dir().join("owntools-llm-test.log");
        let port = free_port().expect("a free port");

        let started = Instant::now();
        let mut child = spawn_server(&exe, &model, port, threads, &log).expect("server starts");
        wait_until_healthy(&mut child, port, &log).expect("server becomes healthy");
        println!("model loaded in {} ms ({threads} threads)", started.elapsed().as_millis());

        let request = CompleteRequest {
            model: "test".into(),
            messages: vec![
                ChatMessage {
                    role: "system".into(),
                    content: "You write concise meeting summaries.".into(),
                },
                ChatMessage {
                    role: "user".into(),
                    content: "Write a 200-word summary of a fictional product planning meeting where a team decided to ship a screen recorder with automatic zoom, discussed pricing at 49 dollars, and assigned three follow-ups.".into(),
                },
            ],
            max_tokens: Some(220),
            temperature: Some(0.3),
            json: None,
            threads: None,
        };
        let body = chat_body(&request);
        for run in 1..=2 {
            let started = Instant::now();
            let answer = tauri::async_runtime::block_on(post_chat(port, &body)).expect("the model answers");
            let ms = started.elapsed().as_millis();
            let tokens = answer.completion_tokens.unwrap_or(0);
            println!(
                "run {run}: {tokens} tokens in {ms} ms ({:.1} tok/s), prompt {} tokens",
                tokens as f64 / (ms.max(1) as f64 / 1000.0),
                answer.prompt_tokens.unwrap_or(0)
            );
            println!("run {run}: {}", answer.text.chars().take(200).collect::<String>());
            assert!(!answer.text.is_empty());
            assert!(!answer.text.contains("<think>"));
        }

        let json_request = CompleteRequest {
            json: Some(true),
            max_tokens: Some(120),
            messages: vec![ChatMessage {
                role: "user".into(),
                content: "Give me a JSON object with keys title (a short meeting title) and tags (three lowercase tags).".into(),
            }],
            ..request
        };
        let answer = tauri::async_runtime::block_on(post_chat(port, &chat_body(&json_request))).expect("json answer");
        println!("json: {}", answer.text);
        let parsed: serde_json::Value = serde_json::from_str(&answer.text).expect("the answer is JSON");
        assert!(parsed.get("title").is_some());

        let _ = child.kill();
        let _ = child.wait();
    }
}
