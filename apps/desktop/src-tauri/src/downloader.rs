//! Streams large files (the whisper engine and its models) straight to disk
//! with a pinned SHA-256, resume and cancel. This lives in Rust so a 1.6 GB
//! model never has to sit in the webview's memory: the old frontend path
//! buffered the whole file twice before writing it.

use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::netlog;

/// Emitted on every download while it runs.
pub const PROGRESS_EVENT: &str = "download-progress";
/// The error string a cancelled download resolves with; the frontend keys off it.
pub const CANCELLED: &str = "cancelled";

fn cancelled_set() -> &'static Mutex<HashSet<String>> {
    static SET: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    SET.get_or_init(|| Mutex::new(HashSet::new()))
}

fn is_cancelled(id: &str) -> bool {
    cancelled_set()
        .lock()
        .map(|s| s.contains(id))
        .unwrap_or(false)
}

fn clear_cancelled(id: &str) {
    if let Ok(mut s) = cancelled_set().lock() {
        s.remove(id);
    }
}

/// The `.part` files a download is writing right now. Settings → Storage
/// clears unfinished downloads and must never pull one out from under a
/// running stream: Rust opens files with `FILE_SHARE_DELETE`, so the delete
/// would succeed and the download would fail at the final rename.
fn active_set() -> &'static Mutex<HashSet<PathBuf>> {
    static SET: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    SET.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Registered for as long as it lives; dropped on every way out of `run_download`.
struct ActivePart(PathBuf);

impl ActivePart {
    fn new(part: &Path) -> Self {
        if let Ok(mut s) = active_set().lock() {
            s.insert(part.to_path_buf());
        }
        Self(part.to_path_buf())
    }
}

impl Drop for ActivePart {
    fn drop(&mut self) {
        if let Ok(mut s) = active_set().lock() {
            s.remove(&self.0);
        }
    }
}

/// Partial files of the downloads running now.
pub fn active_parts() -> Vec<PathBuf> {
    active_set().lock().map(|s| s.iter().cloned().collect()).unwrap_or_default()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    /// Caller-chosen id; progress events and `download_cancel` use it.
    pub id: String,
    pub url: String,
    /// Destination relative to the app data folder, e.g. `whisper/ggml-base.bin`.
    pub dest: String,
    /// Hex SHA-256 the finished file has to match. Strongly recommended for
    /// anything that gets executed or loaded as a model.
    pub sha256: Option<String>,
    /// Progress-bar total when the server sends no Content-Length.
    pub expected_size: Option<u64>,
    /// What the download is for, as the Privacy card should show it
    /// ("whisper model download"). Without it the id is labelled by prefix
    /// (`netlog::download_purpose`).
    #[serde(default)]
    pub purpose: Option<String>,
}

/// What one `download_file` call did on the wire, for the network log.
#[derive(Default)]
struct Tally {
    /// A connection was opened (false for "already complete" and Offline mode).
    sent: bool,
    started: i64,
    status: Option<u16>,
    /// Bytes received by *this* call — a resumed download counts only its own range.
    received: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub id: String,
    pub loaded: u64,
    pub total: u64,
}

/// Destinations come from the frontend, so keep them to plain relative paths
/// under the app data folder: never a drive letter, never `..`.
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
    if out.as_os_str().is_empty() {
        None
    } else {
        Some(out)
    }
}

fn part_path(dest: &Path) -> PathBuf {
    let mut name = dest
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "download".into());
    name.push_str(".part");
    dest.with_file_name(name)
}

/// Marks a running download as cancelled. The partial file is kept so the
/// next attempt can resume from where it stopped.
#[tauri::command]
pub fn download_cancel(id: String) {
    if let Ok(mut s) = cancelled_set().lock() {
        s.insert(id);
    }
}

#[tauri::command]
pub async fn download_file(app: AppHandle, request: DownloadRequest) -> Result<String, String> {
    let mut tally = Tally::default();
    let result = run_download(&app, &request, &mut tally).await;
    if tally.sent {
        let host = netlog::host_of(&request.url);
        netlog::record(
            &app,
            netlog::NetEntry {
                ts: tally.started,
                host: host.clone(),
                method: "GET".into(),
                bytes_out: Some(0),
                bytes_in: Some(tally.received),
                purpose: request
                    .purpose
                    .clone()
                    .filter(|p| !p.trim().is_empty())
                    .unwrap_or_else(|| netlog::download_purpose(&request.id)),
                ok: result.is_ok(),
                status: tally.status,
                kind: netlog::kind_of_host(&host),
            },
        );
    }
    result
}

async fn run_download(app: &AppHandle, request: &DownloadRequest, tally: &mut Tally) -> Result<String, String> {
    let rel = safe_relative(&request.dest)
        .ok_or("Destination must be a plain path inside the app data folder.")?;
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dest = root.join(&rel);
    let part = part_path(&dest);
    let _active = ActivePart::new(&part);
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Could not create {}: {e}", parent.display()))?;
    }
    clear_cancelled(&request.id);

    // Already there and intact: a multi-file model resumes file by file, and
    // the files that made it must not be fetched twice.
    if let Some(expected) = request.sha256.as_deref() {
        if let Ok(meta) = tokio::fs::metadata(&dest).await {
            let size_ok = request.expected_size.map(|n| n == meta.len()).unwrap_or(true);
            if meta.is_file() && meta.len() > 0 && size_ok {
                let path = dest.clone();
                let digest = tauri::async_runtime::spawn_blocking(move || -> std::io::Result<String> {
                    let mut file = std::fs::File::open(&path)?;
                    let mut hasher = Sha256::new();
                    std::io::copy(&mut file, &mut hasher)?;
                    Ok(hex::encode(hasher.finalize()))
                })
                .await
                .map_err(|e| e.to_string())?;
                if matches!(digest, Ok(ref d) if d.eq_ignore_ascii_case(expected)) {
                    let _ = app.emit(
                        PROGRESS_EVENT,
                        DownloadProgress {
                            id: request.id.clone(),
                            loaded: meta.len(),
                            total: meta.len(),
                        },
                    );
                    log::info!("download {}: already complete, skipped", request.id);
                    return Ok(dest.to_string_lossy().to_string());
                }
            }
        }
    }

    // Resume: hash what is already on disk so the final checksum still covers
    // the whole file.
    let mut hasher = Sha256::new();
    let mut have: u64 = 0;
    if let Ok(meta) = tokio::fs::metadata(&part).await {
        if meta.is_file() && meta.len() > 0 {
            let mut file = tokio::fs::File::open(&part).await.map_err(|e| e.to_string())?;
            let mut buf = vec![0u8; 1 << 20];
            loop {
                let n = file.read(&mut buf).await.map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                hasher.update(&buf[..n]);
                have += n as u64;
            }
        }
    }

    // Nothing leaves the machine in Offline mode — checked after the
    // "already complete" path above, which needs no network at all.
    if netlog::offline(app) {
        return Err("Offline mode is on — turn it off in Settings → Privacy to download.".into());
    }

    let client = reqwest::Client::builder()
        .user_agent(concat!("owntools/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.get(&request.url);
    if have > 0 {
        req = req.header(reqwest::header::RANGE, format!("bytes={have}-"));
    }
    tally.sent = true;
    tally.started = netlog::now_ms();
    let res = req
        .send()
        .await
        .map_err(|e| format!("Download could not start: {e}"))?;
    let status = res.status();
    tally.status = Some(status.as_u16());
    let resumed = status == reqwest::StatusCode::PARTIAL_CONTENT;
    if !(status.is_success() || resumed) {
        return Err(format!("Download failed ({status}): {}", request.url));
    }
    if have > 0 && !resumed {
        // The server ignored the range header: start over.
        hasher = Sha256::new();
        have = 0;
    }
    let content_len = res.content_length().unwrap_or(0);
    let total = if content_len > 0 {
        have + content_len
    } else {
        request.expected_size.unwrap_or(0)
    };

    let mut options = tokio::fs::OpenOptions::new();
    options.create(true).write(true);
    if resumed {
        options.append(true);
    } else {
        options.truncate(true);
    }
    let mut file = options
        .open(&part)
        .await
        .map_err(|e| format!("Could not open {} for writing: {e}", part.display()))?;

    let id = request.id.clone();
    let emit = |loaded: u64| {
        let _ = app.emit(
            PROGRESS_EVENT,
            DownloadProgress {
                id: id.clone(),
                loaded,
                total,
            },
        );
    };

    let mut loaded = have;
    let mut last_emit = Instant::now() - Duration::from_secs(1);
    emit(loaded);
    let mut stream = res.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if is_cancelled(&request.id) {
            let _ = file.flush().await;
            clear_cancelled(&request.id);
            log::info!("download {} cancelled at {loaded} bytes", request.id);
            return Err(CANCELLED.into());
        }
        let bytes = chunk.map_err(|e| format!("Download interrupted: {e}"))?;
        file.write_all(&bytes)
            .await
            .map_err(|e| format!("Could not write to disk: {e}"))?;
        hasher.update(&bytes);
        loaded += bytes.len() as u64;
        tally.received += bytes.len() as u64;
        if last_emit.elapsed() >= Duration::from_millis(150) {
            emit(loaded);
            last_emit = Instant::now();
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);
    emit(loaded);

    if let Some(expected) = request
        .sha256
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let actual = hex::encode(hasher.finalize());
        if !actual.eq_ignore_ascii_case(expected) {
            let _ = tokio::fs::remove_file(&part).await;
            log::error!(
                "checksum mismatch for {}: expected {expected}, got {actual}",
                request.url
            );
            return Err(
                "Checksum mismatch: the download was corrupted or the file changed upstream. Try again."
                    .into(),
            );
        }
    }

    if tokio::fs::metadata(&dest).await.is_ok() {
        let _ = tokio::fs::remove_file(&dest).await;
    }
    tokio::fs::rename(&part, &dest)
        .await
        .map_err(|e| format!("Could not move the finished file into place: {e}"))?;
    log::info!("downloaded {} ({loaded} bytes) to {}", request.url, dest.display());
    Ok(dest.to_string_lossy().to_string())
}
