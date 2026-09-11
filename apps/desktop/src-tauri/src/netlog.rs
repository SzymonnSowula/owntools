//! The network log behind Settings → Privacy, and the Offline mode flag.
//!
//! One JSONL line per request that left (or tried to leave) the machine:
//! host, method, payload size, answer size, status and the purpose the caller
//! wrote for the person. Never the request itself. Lines arrive from the
//! frontend through `net_log` (every `trackedFetch` in `@core/net`) and from
//! `downloader.rs` directly. The file rotates at 5 MB and one previous
//! generation is kept — on any realistic usage that is many months.
//!
//! Offline mode is a flag file, `<AppData>/privacy/offline`: the frontend
//! mirrors it in localStorage for its synchronous check before a request,
//! and `download_file` reads it here before opening a connection.

use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::{Datelike, Local, TimeZone};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// Rotate the log once it grows past this many bytes.
pub const ROTATE_AT: u64 = 5 * 1024 * 1024;
const LOG_FILE: &str = "netlog.jsonl";
const ROTATED_FILE: &str = "netlog.jsonl.1";
const OFFLINE_FLAG: &str = "offline";
/// Rows the "recent requests" list can ask for at most.
const RECENT_MAX: usize = 1000;

/// Appends come from several runtime threads at once; one writer at a time
/// keeps every line whole.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NetKind {
    /// Left this machine.
    Cloud,
    /// Loopback or the local network — never counts as "left".
    Local,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetEntry {
    /// Epoch milliseconds when the request was sent.
    pub ts: i64,
    pub host: String,
    pub method: String,
    /// Request payload bytes when known.
    #[serde(default)]
    pub bytes_out: Option<u64>,
    /// Answer bytes when known (Content-Length, or what a download received).
    #[serde(default)]
    pub bytes_in: Option<u64>,
    /// What it was for, in the person's words.
    pub purpose: String,
    pub ok: bool,
    /// HTTP status; None when no answer arrived or the layer did not report one.
    #[serde(default)]
    pub status: Option<u16>,
    pub kind: NetKind,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HostRow {
    pub host: String,
    pub purpose: String,
    pub kind: NetKind,
    pub requests: u64,
    pub failed: u64,
    pub bytes_out: u64,
    pub bytes_in: u64,
    /// Requests whose answer size the server did not state.
    pub unknown_in: u64,
    /// Epoch ms of the newest request in the row.
    pub last: i64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    /// "YYYY-MM", local time.
    pub month: String,
    /// Headline: requests that left this machine (cloud only).
    pub requests: u64,
    pub bytes_out: u64,
    pub bytes_in: u64,
    pub unknown_in: u64,
    pub cloud_requests: u64,
    pub local_requests: u64,
    pub failed: u64,
    /// Cloud rows, biggest first.
    pub by_host: Vec<HostRow>,
    /// Loopback / LAN rows — stayed on this machine.
    pub local: Vec<HostRow>,
}

/* ------------------------------------------------------------------------- */
/* Paths and time                                                            */
/* ------------------------------------------------------------------------- */

pub fn privacy_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("privacy"))
        .map_err(|e| e.to_string())
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// "YYYY-MM" of an epoch-ms timestamp in local time — the month on the
/// person's calendar, which is what the card's picker offers.
pub fn month_of(ts: i64) -> String {
    match Local.timestamp_millis_opt(ts).single() {
        Some(t) => format!("{:04}-{:02}", t.year(), t.month()),
        None => "0000-00".to_string(),
    }
}

pub fn current_month() -> String {
    month_of(now_ms())
}

/// The hostname of a URL as the log shows it; the whole string when it does not parse.
pub fn host_of(url: &str) -> String {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.trim_end_matches('.').to_ascii_lowercase()))
        .unwrap_or_else(|| url.to_string())
}

fn parse_v4(host: &str) -> Option<[u8; 4]> {
    let mut out = [0u8; 4];
    let mut n = 0;
    for part in host.split('.') {
        if n == 4 {
            return None;
        }
        out[n] = part.parse().ok()?;
        n += 1;
    }
    (n == 4).then_some(out)
}

/// Loopback, `*.localhost`, and the private ranges (10/8, 172.16/12,
/// 192.168/16, 169.254/16, fc00::/7, fe80::/10) stay on this machine or desk.
pub fn kind_of_host(host: &str) -> NetKind {
    let h = host.trim_matches(|c| c == '[' || c == ']').to_ascii_lowercase();
    if h == "localhost" || h.ends_with(".localhost") || h == "::1" || h == "::" || h == "0.0.0.0" {
        return NetKind::Local;
    }
    if let Some([a, b, ..]) = parse_v4(&h) {
        let private = a == 127
            || a == 10
            || (a == 172 && (16..=31).contains(&b))
            || (a == 192 && b == 168)
            || (a == 169 && b == 254);
        return if private { NetKind::Local } else { NetKind::Cloud };
    }
    let bytes = h.as_bytes();
    let v6_local = bytes.len() > 4
        && bytes[4] == b':'
        && ((bytes[0] == b'f' && matches!(bytes[1], b'c' | b'd'))
            || (h.starts_with("fe") && matches!(bytes[2], b'8' | b'9' | b'a' | b'b')));
    if v6_local {
        NetKind::Local
    } else {
        NetKind::Cloud
    }
}

/// A readable purpose for a `download_file` id the frontend did not label.
/// Prefix-based on purpose: the dictation installer's ids are `engine`,
/// `parakeet-runtime` and `model:<catalogue id>:<file>`; the YouTube tool's
/// are `yt-audio-<video id>`; the language-model installer's start with `llm`.
pub fn download_purpose(id: &str) -> String {
    let lower = id.to_ascii_lowercase();
    let label = if lower == "engine" || lower.starts_with("whisper") {
        "whisper engine download"
    } else if lower.starts_with("parakeet-runtime") || lower.starts_with("parakeet") {
        "Parakeet runtime download"
    } else if lower.starts_with("model:parakeet") {
        "Parakeet model download"
    } else if lower.starts_with("model:ggml") || lower.starts_with("model:whisper") {
        "whisper model download"
    } else if lower.starts_with("model:") {
        "speech model download"
    } else if lower.starts_with("llm") {
        "language model download"
    } else if lower.starts_with("youtube") || lower.starts_with("yt-") {
        "YouTube audio download"
    } else {
        return format!("download: {id}");
    };
    label.to_string()
}

/* ------------------------------------------------------------------------- */
/* The file                                                                  */
/* ------------------------------------------------------------------------- */

fn rotate_if_needed(dir: &Path) -> std::io::Result<()> {
    let current = dir.join(LOG_FILE);
    let len = match fs::metadata(&current) {
        Ok(m) => m.len(),
        Err(_) => return Ok(()),
    };
    if len < ROTATE_AT {
        return Ok(());
    }
    let rotated = dir.join(ROTATED_FILE);
    let _ = fs::remove_file(&rotated);
    fs::rename(&current, &rotated)
}

/// Appends one line, rotating first when the file is full. Callers treat a
/// failure as "log and carry on": the request it describes must not fail
/// because the log could not be written.
pub fn append(dir: &Path, entry: &NetEntry) -> std::io::Result<()> {
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    fs::create_dir_all(dir)?;
    rotate_if_needed(dir)?;
    let mut line = serde_json::to_string(entry).map_err(std::io::Error::other)?;
    line.push('\n');
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(LOG_FILE))?;
    file.write_all(line.as_bytes())
}

/// Every entry on disk, oldest first: the rotated generation, then the
/// current file. A line that does not parse is skipped, never fatal.
pub fn read_all(dir: &Path) -> Vec<NetEntry> {
    let mut out = Vec::new();
    for name in [ROTATED_FILE, LOG_FILE] {
        let Ok(file) = fs::File::open(dir.join(name)) else {
            continue;
        };
        for line in BufReader::new(file).lines().map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(entry) = serde_json::from_str::<NetEntry>(&line) {
                out.push(entry);
            }
        }
    }
    out
}

pub fn clear(dir: &Path) -> std::io::Result<()> {
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    for name in [LOG_FILE, ROTATED_FILE] {
        match fs::remove_file(dir.join(name)) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
    }
    Ok(())
}

/// Appends to the app's log; failures are logged, never returned — the
/// request this line describes has already happened.
pub fn record(app: &AppHandle, entry: NetEntry) {
    match privacy_dir(app) {
        Ok(dir) => {
            if let Err(e) = append(&dir, &entry) {
                log::warn!("network log not written: {e}");
            }
        }
        Err(e) => log::warn!("network log dir unavailable: {e}"),
    }
}

/* ------------------------------------------------------------------------- */
/* Summaries                                                                 */
/* ------------------------------------------------------------------------- */

fn row_order(a: &HostRow, b: &HostRow) -> std::cmp::Ordering {
    (b.bytes_out + b.bytes_in)
        .cmp(&(a.bytes_out + a.bytes_in))
        .then(b.requests.cmp(&a.requests))
        .then(a.host.cmp(&b.host))
}

pub fn summarize(entries: &[NetEntry], month: &str) -> Summary {
    let mut summary = Summary {
        month: month.to_string(),
        ..Summary::default()
    };
    let mut rows: Vec<HostRow> = Vec::new();
    for e in entries.iter().filter(|e| month_of(e.ts) == month) {
        let row = match rows
            .iter_mut()
            .find(|r| r.kind == e.kind && r.host == e.host && r.purpose == e.purpose)
        {
            Some(r) => r,
            None => {
                rows.push(HostRow {
                    host: e.host.clone(),
                    purpose: e.purpose.clone(),
                    kind: e.kind,
                    requests: 0,
                    failed: 0,
                    bytes_out: 0,
                    bytes_in: 0,
                    unknown_in: 0,
                    last: 0,
                });
                rows.last_mut().expect("just pushed")
            }
        };
        row.requests += 1;
        if !e.ok {
            row.failed += 1;
        }
        row.bytes_out += e.bytes_out.unwrap_or(0);
        match e.bytes_in {
            Some(n) => row.bytes_in += n,
            None => row.unknown_in += 1,
        }
        row.last = row.last.max(e.ts);
        match e.kind {
            NetKind::Local => summary.local_requests += 1,
            NetKind::Cloud => {
                summary.requests += 1;
                summary.cloud_requests += 1;
                summary.bytes_out += e.bytes_out.unwrap_or(0);
                match e.bytes_in {
                    Some(n) => summary.bytes_in += n,
                    None => summary.unknown_in += 1,
                }
                if !e.ok {
                    summary.failed += 1;
                }
            }
        }
    }
    for row in rows {
        match row.kind {
            NetKind::Cloud => summary.by_host.push(row),
            NetKind::Local => summary.local.push(row),
        }
    }
    summary.by_host.sort_by(row_order);
    summary.local.sort_by(row_order);
    summary
}

/// The newest `limit` entries, newest first.
pub fn recent(entries: &[NetEntry], limit: usize) -> Vec<NetEntry> {
    let limit = limit.clamp(1, RECENT_MAX);
    let mut out: Vec<NetEntry> = entries.iter().rev().take(limit).cloned().collect();
    out.sort_by(|a, b| b.ts.cmp(&a.ts));
    out
}

/* ------------------------------------------------------------------------- */
/* Offline mode                                                              */
/* ------------------------------------------------------------------------- */

pub fn offline_in(dir: &Path) -> bool {
    dir.join(OFFLINE_FLAG).is_file()
}

pub fn set_offline_in(dir: &Path, on: bool) -> std::io::Result<()> {
    let flag = dir.join(OFFLINE_FLAG);
    if on {
        fs::create_dir_all(dir)?;
        fs::write(&flag, b"on\n")
    } else {
        match fs::remove_file(&flag) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e),
        }
    }
}

/// True while the person has Offline mode on. Rust egress (`download_file`)
/// checks this before opening a connection; the frontend checks its mirror.
pub fn offline(app: &AppHandle) -> bool {
    privacy_dir(app).map(|d| offline_in(&d)).unwrap_or(false)
}

/* ------------------------------------------------------------------------- */
/* Commands                                                                  */
/* ------------------------------------------------------------------------- */

#[tauri::command(async)]
pub fn net_log(app: AppHandle, entry: NetEntry) -> Result<(), String> {
    let dir = privacy_dir(&app)?;
    append(&dir, &entry).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn net_log_summary(app: AppHandle, month: Option<String>) -> Result<Summary, String> {
    let dir = privacy_dir(&app)?;
    let month = month
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(current_month);
    Ok(summarize(&read_all(&dir), &month))
}

#[tauri::command(async)]
pub fn net_log_recent(app: AppHandle, limit: Option<usize>) -> Result<Vec<NetEntry>, String> {
    let dir = privacy_dir(&app)?;
    Ok(recent(&read_all(&dir), limit.unwrap_or(100)))
}

#[tauri::command(async)]
pub fn net_log_clear(app: AppHandle) -> Result<(), String> {
    let dir = privacy_dir(&app)?;
    clear(&dir).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn privacy_offline_get(app: AppHandle) -> Result<bool, String> {
    Ok(offline_in(&privacy_dir(&app)?))
}

#[tauri::command(async)]
pub fn privacy_offline_set(app: AppHandle, on: bool) -> Result<(), String> {
    let dir = privacy_dir(&app)?;
    set_offline_in(&dir, on).map_err(|e| e.to_string())?;
    log::info!("offline mode {}", if on { "on" } else { "off" });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!("owntools-netlog-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        base
    }

    fn entry(ts: i64, host: &str, purpose: &str, kind: NetKind) -> NetEntry {
        NetEntry {
            ts,
            host: host.into(),
            method: "POST".into(),
            bytes_out: Some(100),
            bytes_in: Some(50),
            purpose: purpose.into(),
            ok: true,
            status: Some(200),
            kind,
        }
    }

    #[test]
    fn append_then_read_round_trips_and_skips_garbage() {
        let dir = scratch("roundtrip");
        let now = now_ms();
        append(&dir, &entry(now, "bsky.social", "post to Bluesky", NetKind::Cloud)).unwrap();
        append(&dir, &entry(now + 1, "127.0.0.1", "meeting summary", NetKind::Local)).unwrap();
        {
            let mut f = OpenOptions::new().append(true).open(dir.join(LOG_FILE)).unwrap();
            f.write_all(b"not json at all\n\n").unwrap();
        }
        append(&dir, &entry(now + 2, "huggingface.co", "whisper model download", NetKind::Cloud)).unwrap();
        let all = read_all(&dir);
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].host, "bsky.social");
        assert_eq!(all[1].kind, NetKind::Local);
        assert_eq!(all[2].ts, now + 2);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rotates_at_five_megabytes_and_keeps_one_generation() {
        let dir = scratch("rotate");
        fs::write(dir.join(LOG_FILE), vec![b'x'; ROTATE_AT as usize]).unwrap();
        append(&dir, &entry(now_ms(), "a.example", "one", NetKind::Cloud)).unwrap();
        assert_eq!(fs::metadata(dir.join(ROTATED_FILE)).unwrap().len(), ROTATE_AT);
        assert!(fs::metadata(dir.join(LOG_FILE)).unwrap().len() < 1024);
        // A second rotation replaces the previous generation instead of piling up.
        fs::write(dir.join(LOG_FILE), vec![b'y'; ROTATE_AT as usize + 7]).unwrap();
        append(&dir, &entry(now_ms(), "b.example", "two", NetKind::Cloud)).unwrap();
        assert_eq!(fs::metadata(dir.join(ROTATED_FILE)).unwrap().len(), ROTATE_AT + 7);
        assert_eq!(read_all(&dir).len(), 1);
        assert!(!dir.join("netlog.jsonl.2").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn summary_keeps_the_headline_to_what_left_this_month() {
        let now = now_ms();
        let month = month_of(now);
        let year_ago = now - 366 * 24 * 3600 * 1000;
        let mut failed = entry(now + 10, "bsky.social", "post to Bluesky", NetKind::Cloud);
        failed.ok = false;
        failed.status = Some(500);
        failed.bytes_in = None;
        failed.bytes_out = Some(300);
        let mut model = entry(now + 20, "huggingface.co", "whisper model download", NetKind::Cloud);
        model.method = "GET".into();
        model.bytes_out = Some(0);
        model.bytes_in = Some(600_000_000);
        let entries = vec![
            entry(now, "bsky.social", "post to Bluesky", NetKind::Cloud),
            failed,
            model,
            entry(now + 30, "127.0.0.1", "meeting summary", NetKind::Local),
            entry(year_ago, "bsky.social", "post to Bluesky", NetKind::Cloud),
        ];
        let s = summarize(&entries, &month);
        assert_eq!(s.month, month);
        assert_eq!(s.requests, 3);
        assert_eq!(s.cloud_requests, 3);
        assert_eq!(s.local_requests, 1);
        assert_eq!(s.bytes_out, 400);
        assert_eq!(s.bytes_in, 600_000_050);
        assert_eq!(s.unknown_in, 1);
        assert_eq!(s.failed, 1);
        assert_eq!(s.by_host.len(), 2);
        assert_eq!(s.by_host[0].host, "huggingface.co");
        let bsky = &s.by_host[1];
        assert_eq!((bsky.requests, bsky.failed, bsky.bytes_out, bsky.bytes_in, bsky.unknown_in), (2, 1, 400, 50, 1));
        assert_eq!(bsky.last, now + 10);
        assert_eq!(s.local.len(), 1);
        assert_eq!(s.local[0].purpose, "meeting summary");
        // A quiet month is all zeros, not an error.
        let quiet = summarize(&entries, &month_of(year_ago - 40 * 24 * 3600 * 1000));
        assert_eq!(quiet.requests, 0);
        assert!(quiet.by_host.is_empty());
    }

    #[test]
    fn recent_is_newest_first_and_limited() {
        let now = now_ms();
        let entries: Vec<NetEntry> = (0..10).map(|i| entry(now + i, "h", "p", NetKind::Cloud)).collect();
        let r = recent(&entries, 3);
        assert_eq!(r.iter().map(|e| e.ts).collect::<Vec<_>>(), vec![now + 9, now + 8, now + 7]);
        assert_eq!(recent(&entries, 0).len(), 1);
    }

    #[test]
    fn download_ids_get_readable_purposes() {
        assert_eq!(download_purpose("engine"), "whisper engine download");
        assert_eq!(download_purpose("parakeet-runtime"), "Parakeet runtime download");
        assert_eq!(download_purpose("model:parakeet-tdt-0.6b-v3-int8:encoder.int8.onnx"), "Parakeet model download");
        assert_eq!(download_purpose("model:ggml-large-v3-turbo-q5_0.bin:ggml-large-v3-turbo-q5_0.bin"), "whisper model download");
        assert_eq!(download_purpose("model:something-else:file"), "speech model download");
        assert_eq!(download_purpose("llm:qwen2.5-3b"), "language model download");
        assert_eq!(download_purpose("youtube:abc123"), "YouTube audio download");
        assert_eq!(download_purpose("yt-audio-dQw4w9WgXcQ"), "YouTube audio download");
        assert_eq!(download_purpose("mystery"), "download: mystery");
    }

    #[test]
    fn hosts_are_classified_like_the_frontend() {
        assert_eq!(host_of("https://huggingface.co/x/y?z=1"), "huggingface.co");
        assert_eq!(host_of("http://[::1]:8080/"), "[::1]");
        assert_eq!(kind_of_host("localhost"), NetKind::Local);
        assert_eq!(kind_of_host("tauri.localhost"), NetKind::Local);
        assert_eq!(kind_of_host("127.0.0.1"), NetKind::Local);
        assert_eq!(kind_of_host("[::1]"), NetKind::Local);
        assert_eq!(kind_of_host("192.168.1.10"), NetKind::Local);
        assert_eq!(kind_of_host("172.31.0.1"), NetKind::Local);
        assert_eq!(kind_of_host("172.32.0.1"), NetKind::Cloud);
        assert_eq!(kind_of_host("fd12:3456::1"), NetKind::Local);
        assert_eq!(kind_of_host("huggingface.co"), NetKind::Cloud);
        assert_eq!(kind_of_host("8.8.8.8"), NetKind::Cloud);
    }

    #[test]
    fn offline_flag_round_trips_and_clear_removes_both_files() {
        let dir = scratch("offline");
        assert!(!offline_in(&dir));
        set_offline_in(&dir, true).unwrap();
        assert!(offline_in(&dir));
        set_offline_in(&dir, false).unwrap();
        set_offline_in(&dir, false).unwrap();
        assert!(!offline_in(&dir));
        fs::write(dir.join(LOG_FILE), b"{}\n").unwrap();
        fs::write(dir.join(ROTATED_FILE), b"{}\n").unwrap();
        clear(&dir).unwrap();
        clear(&dir).unwrap();
        assert!(read_all(&dir).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }
}
