//! NVIDIA Parakeet through sherpa-onnx: the second dictation engine, next to
//! whisper.cpp. Everything lives under `<AppData>/parakeet`:
//!
//!   parakeet/bin/  the recognizer executables, unpacked from the pinned
//!       release archive by `parakeet_install_runtime` — the one-shot
//!       `sherpa-onnx-offline` and the resident
//!       `sherpa-onnx-offline-websocket-server`;
//!   parakeet/lib/  the shared libraries on macOS (`@loader_path/../lib` is
//!       what the executables look for); on Windows the DLLs sit next to the
//!       exe in `bin/`, which is where Windows looks;
//!   parakeet/models/<id>/{encoder,decoder,joiner}.int8.onnx + tokens.txt,
//!       downloaded file by file through the pinned downloader.
//!
//! ## Why a resident server
//!
//! Loading the 0.6B model costs ~4.5 s on a laptop CPU, and the one-shot CLI
//! paid that on **every** take: a 3.9 s dictation measured 6.1–6.5 s end to
//! end. `sherpa-onnx-offline-websocket-server` keeps the recognizer in memory,
//! so the same take is decode-only. Two numbers from this machine (i5-10300H,
//! 4 physical cores), 3.9 s of speech:
//!
//!   one-shot CLI, 7 threads        6100–6500 ms
//!   resident server, 7 threads      1100–1300 ms
//!   resident server, 4 threads       660–770 ms
//!
//! The thread count matters as much as residency: onnxruntime scales with
//! *physical* cores and loses badly when the pool spills onto hyperthreads,
//! which is why `recognizer_threads` counts cores rather than
//! `available_parallelism`.
//!
//! The server is started lazily (or ahead of time by `parakeet_warmup`, which
//! the pill calls the moment it starts listening, so the load overlaps with
//! the user speaking), shut down after `IDLE_SHUTDOWN` without a take so the
//! model does not sit on ~600 MB forever, and killed when the app exits.

use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::ws::{Message, WebSocket};

#[cfg(windows)]
const RUNTIME_EXE: &str = "sherpa-onnx-offline.exe";
#[cfg(not(windows))]
const RUNTIME_EXE: &str = "sherpa-onnx-offline";

#[cfg(windows)]
const SERVER_EXE: &str = "sherpa-onnx-offline-websocket-server.exe";
#[cfg(not(windows))]
const SERVER_EXE: &str = "sherpa-onnx-offline-websocket-server";

/// Every file a model folder needs before it counts as installed.
pub const MODEL_FILES: &[&str] = &[
    "encoder.int8.onnx",
    "decoder.int8.onnx",
    "joiner.int8.onnx",
    "tokens.txt",
];

/// How long the recognizer may sit idle before we give the memory back.
const IDLE_SHUTDOWN: Duration = Duration::from_secs(15 * 60);
/// Loading the model is disk-bound the first time; be generous.
const START_TIMEOUT: Duration = Duration::from_secs(120);
/// One take should never take this long, even for a very long file.
const CALL_TIMEOUT: Duration = Duration::from_secs(600);
/// The server rejects an utterance longer than this (its default is 300 s).
const MAX_UTTERANCE_SECONDS: u32 = 900;

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("parakeet"))
}

fn bin_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(root(app)?.join("bin"))
}

fn lib_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(root(app)?.join("lib"))
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(root(app)?.join("models"))
}

fn find_in_bin(app: &AppHandle, name: &str) -> Option<PathBuf> {
    let exe = bin_dir(app).ok()?.join(name);
    exe.is_file().then_some(exe)
}

fn find_exe(app: &AppHandle) -> Option<PathBuf> {
    find_in_bin(app, RUNTIME_EXE)
}

fn find_server_exe(app: &AppHandle) -> Option<PathBuf> {
    find_in_bin(app, SERVER_EXE)
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

fn model_complete(dir: &Path) -> bool {
    MODEL_FILES.iter().all(|name| {
        dir.join(name)
            .metadata()
            .map(|m| m.is_file() && m.len() > 0)
            .unwrap_or(false)
    })
}

fn list_models(app: &AppHandle) -> Vec<String> {
    let Ok(dir) = models_dir(app) else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut models: Vec<String> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir() && model_complete(p))
        .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().to_string()))
        .collect();
    models.sort();
    models
}

#[derive(Debug, Clone, Serialize)]
pub struct ParakeetStatus {
    /// The one-shot recognizer is unpacked and in place.
    pub runtime: bool,
    /// The resident recognizer is unpacked too. An install from before the
    /// resident server existed has `runtime` without `server`, and every take
    /// pays the model load again — `dictationStatus` surfaces it so the UI can
    /// offer the (small) engine update.
    pub server: bool,
    /// The resident recognizer is loaded *right now*, so the next take is
    /// decode-only.
    pub resident: bool,
    pub dir: String,
    /// Ids of the complete model folders.
    pub models: Vec<String>,
}

pub fn status(app: &AppHandle) -> ParakeetStatus {
    ParakeetStatus {
        runtime: find_exe(app).is_some(),
        server: find_server_exe(app).is_some(),
        resident: server_is_live(),
        dir: root(app).map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
        models: list_models(app),
    }
}

// ---------------------------------------------------------------------------
// How many threads onnxruntime should use
// ---------------------------------------------------------------------------

/// Physical cores, because that is what an int8 ONNX graph scales with.
/// Measured on this machine: 4 threads = 660 ms for a take that takes 1300 ms
/// at 8. On Apple Silicon the number that matters is the *performance* cores —
/// scheduling matrix multiplies onto efficiency cores drags the whole batch.
fn physical_cores() -> u32 {
    #[cfg(windows)]
    {
        use windows::Win32::System::SystemInformation::{
            GetLogicalProcessorInformationEx, RelationProcessorCore,
            SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX,
        };
        unsafe {
            let mut len: u32 = 0;
            // First call sizes the buffer; it always "fails" with
            // ERROR_INSUFFICIENT_BUFFER, which is why the result is ignored.
            let _ = GetLogicalProcessorInformationEx(RelationProcessorCore, None, &mut len);
            if len > 0 {
                let mut buffer = vec![0u8; len as usize];
                let ptr = buffer.as_mut_ptr() as *mut SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX;
                if GetLogicalProcessorInformationEx(RelationProcessorCore, Some(ptr), &mut len)
                    .is_ok()
                {
                    let mut offset = 0usize;
                    let mut cores = 0u32;
                    while offset + std::mem::size_of::<u32>() * 2 <= len as usize {
                        let entry = buffer.as_ptr().add(offset)
                            as *const SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX;
                        let size = (*entry).Size as usize;
                        if size == 0 {
                            break;
                        }
                        cores += 1;
                        offset += size;
                    }
                    if cores > 0 {
                        return cores;
                    }
                }
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        // libSystem is always linked; no libc crate needed for two sysctls.
        unsafe extern "C" {
            fn sysctlbyname(
                name: *const std::ffi::c_char,
                oldp: *mut std::ffi::c_void,
                oldlenp: *mut usize,
                newp: *mut std::ffi::c_void,
                newlen: usize,
            ) -> i32;
        }
        fn read(name: &str) -> Option<u32> {
            let key = std::ffi::CString::new(name).ok()?;
            let mut value: i32 = 0;
            let mut size = std::mem::size_of::<i32>();
            let ok = unsafe {
                sysctlbyname(
                    key.as_ptr(),
                    &mut value as *mut i32 as *mut std::ffi::c_void,
                    &mut size,
                    std::ptr::null_mut(),
                    0,
                )
            };
            (ok == 0 && value > 0).then_some(value as u32)
        }
        // Apple Silicon reports performance cores under perflevel0; an Intel
        // Mac has no perflevel keys and falls through to hw.physicalcpu.
        if let Some(n) = read("hw.perflevel0.physicalcpu").or_else(|| read("hw.physicalcpu")) {
            return n;
        }
    }
    // Anywhere else: logical processors, halved when the count suggests SMT.
    let logical = std::thread::available_parallelism()
        .map(|n| n.get() as u32)
        .unwrap_or(4);
    if logical >= 8 {
        logical / 2
    } else {
        logical
    }
}

/// Threads for one recognizer, clamped to something sane on both a 2-core
/// laptop and a 32-core workstation (onnxruntime stops scaling well before
/// that and we still want the UI to breathe).
pub fn recognizer_threads(requested: Option<u32>) -> u32 {
    requested
        .filter(|n| *n > 0)
        .unwrap_or_else(physical_cores)
        .clamp(1, 12)
}

// ---------------------------------------------------------------------------
// Reading the take
// ---------------------------------------------------------------------------

/// Mono 16-bit PCM samples, normalised to [-1, 1], plus the rate they were
/// recorded at. The frontend always writes exactly this (`blobToWhisperWav`),
/// so the parser refuses anything else rather than guessing.
pub struct Pcm {
    pub samples: Vec<f32>,
    pub rate: u32,
}

pub fn read_wav(path: &Path) -> Result<Pcm, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("could not read the take: {e}"))?;
    parse_wav(&bytes)
}

fn u16_at(bytes: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([bytes[at], bytes[at + 1]])
}

fn u32_at(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

pub fn parse_wav(bytes: &[u8]) -> Result<Pcm, String> {
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("not a WAV file".into());
    }
    let mut offset = 12usize;
    let mut rate = 0u32;
    let mut channels = 0u16;
    let mut bits = 0u16;
    let mut data: Option<&[u8]> = None;
    while offset + 8 <= bytes.len() {
        let id = &bytes[offset..offset + 4];
        let size = u32_at(bytes, offset + 4) as usize;
        let body = offset + 8;
        // A truncated final chunk (a stream that stopped mid-write) still has
        // usable samples; take what is there rather than failing the take.
        let end = body.saturating_add(size).min(bytes.len());
        if id == b"fmt " && end - body >= 16 {
            channels = u16_at(bytes, body + 2);
            rate = u32_at(bytes, body + 4);
            bits = u16_at(bytes, body + 14);
        } else if id == b"data" {
            data = Some(&bytes[body..end]);
            break;
        }
        // Chunks are word-aligned: an odd size is followed by a pad byte.
        offset = body + size + (size & 1);
    }
    let data = data.ok_or("the WAV has no data chunk")?;
    if channels != 1 || bits != 16 {
        return Err(format!(
            "expected mono 16-bit PCM, got {channels} channel(s) at {bits} bits"
        ));
    }
    if rate == 0 {
        return Err("the WAV has no sample rate".into());
    }
    let samples = data
        .chunks_exact(2)
        .map(|pair| i16::from_le_bytes([pair[0], pair[1]]) as f32 / 32768.0)
        .collect();
    Ok(Pcm { samples, rate })
}

// ---------------------------------------------------------------------------
// The resident recognizer
// ---------------------------------------------------------------------------

struct Server {
    child: Child,
    port: u16,
    model: String,
    threads: u32,
    /// When the last take finished, for the idle watchdog.
    last_used: Instant,
}

static SERVER: Mutex<Option<Server>> = Mutex::new(None);

fn server_is_live() -> bool {
    SERVER
        .lock()
        .map(|guard| guard.is_some())
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

fn spawn_server(
    exe: &Path,
    lib: &Path,
    model_dir: &Path,
    port: u16,
    threads: u32,
) -> Result<Child, String> {
    let mut cmd = Command::new(exe);
    cmd.arg(format!("--port={port}"))
        .arg("--num-io-threads=1")
        // One decode at a time: a take is latency-bound, not throughput-bound,
        // and a second work thread would only fight the first for cores.
        .arg("--num-work-threads=1")
        .arg("--max-batch-size=1")
        .arg(format!("--max-utterance-length={MAX_UTTERANCE_SECONDS}"))
        // The server logs to ./log.txt in its working directory unless told
        // otherwise; keep it out of wherever the process happened to start.
        .arg(format!(
            "--log-file={}",
            exe.parent().unwrap_or(Path::new(".")).join("recognizer.log").display()
        ))
        .arg(format!("--encoder={}", model_dir.join("encoder.int8.onnx").display()))
        .arg(format!("--decoder={}", model_dir.join("decoder.int8.onnx").display()))
        .arg(format!("--joiner={}", model_dir.join("joiner.int8.onnx").display()))
        .arg(format!("--tokens={}", model_dir.join("tokens.txt").display()))
        .arg("--model-type=nemo_transducer")
        .arg("--decoding-method=greedy_search")
        .arg(format!("--num-threads={threads}"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(parent) = exe.parent() {
        cmd.current_dir(parent);
    }
    // macOS: the executables carry `@loader_path/../lib`, which the unpacked
    // layout satisfies; this is the belt to that pair of braces.
    #[cfg(target_os = "macos")]
    cmd.env("DYLD_LIBRARY_PATH", lib);
    #[cfg(not(target_os = "macos"))]
    let _ = lib;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let child = cmd
        .spawn()
        .map_err(|e| format!("the resident recognizer would not start: {e}"))?;
    // ~700 MB that must go with owntools, however owntools goes (child_job.rs).
    crate::child_job::adopt(&child);
    Ok(child)
}

/// Blocks until the child is accepting connections, or the child dies.
fn wait_until_listening(child: &mut Child, port: u16) -> Result<(), String> {
    let deadline = Instant::now() + START_TIMEOUT;
    while Instant::now() < deadline {
        if let Ok(Some(exit)) = child.try_wait() {
            return Err(format!("the resident recognizer exited during start-up ({exit})"));
        }
        if TcpStream::connect_timeout(&address(port), Duration::from_millis(250)).is_ok() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err("the resident recognizer did not come up in time".into())
}

/// Returns the port of a running recognizer for this model, starting one when
/// there is none (or when the model or thread count changed).
fn ensure_server(app: &AppHandle, model: &str, threads: u32) -> Result<u16, String> {
    let exe = find_server_exe(app)
        .ok_or("The resident recognizer is not installed; reinstall the Parakeet engine.")?;
    let lib = lib_dir(app)?;
    let model_dir = models_dir(app)?.join(model);

    let mut guard = SERVER.lock().map_err(|_| "recognizer lock poisoned")?;
    if let Some(server) = guard.as_mut() {
        let alive = matches!(server.child.try_wait(), Ok(None));
        if alive && server.model == model && server.threads == threads {
            server.last_used = Instant::now();
            return Ok(server.port);
        }
        log::info!(
            "parakeet: replacing the resident recognizer (alive={alive}, model {} -> {model})",
            server.model
        );
        let _ = server.child.kill();
        let _ = server.child.wait();
        *guard = None;
    }

    let port = free_port()?;
    let started = Instant::now();
    let mut child = spawn_server(&exe, &lib, &model_dir, port, threads)?;
    if let Err(e) = wait_until_listening(&mut child, port) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(e);
    }
    log::info!(
        "parakeet: recognizer resident on 127.0.0.1:{port} ({model}, {threads} threads, loaded in {} ms)",
        started.elapsed().as_millis()
    );
    *guard = Some(Server {
        child,
        port,
        model: model.to_string(),
        threads,
        last_used: Instant::now(),
    });
    start_idle_watchdog();
    Ok(port)
}

/// One watchdog for the lifetime of the process: every half minute it checks
/// whether the recognizer has been idle long enough to give the memory back.
fn start_idle_watchdog() {
    static STARTED: Mutex<bool> = Mutex::new(false);
    let mut started = match STARTED.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    if *started {
        return;
    }
    *started = true;
    std::thread::spawn(|| loop {
        std::thread::sleep(Duration::from_secs(30));
        let Ok(mut guard) = SERVER.lock() else { continue };
        let idle = guard
            .as_ref()
            .map(|s| s.last_used.elapsed() >= IDLE_SHUTDOWN)
            .unwrap_or(false);
        if idle {
            if let Some(mut server) = guard.take() {
                let _ = server.child.kill();
                let _ = server.child.wait();
                log::info!("parakeet: recognizer idle, memory released");
            }
        }
    });
}

/// Marks the recognizer as just used, so the idle watchdog does not decide to
/// free a model in the middle of a long decode. `ensure_server` stamps this
/// at the *start* of a take; a fifteen-minute recording spends minutes
/// decoding after that, which is long enough to matter.
fn touch_server() {
    if let Ok(mut guard) = SERVER.lock() {
        if let Some(server) = guard.as_mut() {
            server.last_used = Instant::now();
        }
    }
}

/// Kills the resident recognizer. Called when the app exits, and by the
/// `parakeet_shutdown` command.
pub fn shutdown() {
    let Ok(mut guard) = SERVER.lock() else { return };
    if let Some(mut server) = guard.take() {
        let _ = server.child.kill();
        let _ = server.child.wait();
        log::info!("parakeet: recognizer stopped");
    }
}

/// One take over the wire: `u32` sample rate, `u32` payload bytes, then the
/// f32 samples; the answer is the same JSON line the CLI prints.
fn decode_on_server(port: u16, pcm: &Pcm) -> Result<String, String> {
    let mut socket = WebSocket::connect(address(port), CALL_TIMEOUT)?;
    let byte_len = pcm.samples.len() * 4;
    let mut payload = Vec::with_capacity(8 + byte_len);
    payload.extend_from_slice(&pcm.rate.to_le_bytes());
    payload.extend_from_slice(&(byte_len as u32).to_le_bytes());
    for sample in &pcm.samples {
        payload.extend_from_slice(&sample.to_le_bytes());
    }
    // websocketpp caps a single message; the reference client chunks and so do
    // we, generously, because a long file is megabytes of f32.
    for chunk in payload.chunks(64 * 1024) {
        socket.send_binary(chunk)?;
    }
    let answer = match socket.read_message()? {
        Message::Text(text) => Ok(text),
        Message::Close => Err("the recognizer closed the connection".to_string()),
        Message::Binary(bytes) => Err(format!(
            "the recognizer sent {} bytes of binary where JSON was expected",
            bytes.len()
        )),
    };
    // "Done" is how the server's own client says goodbye; it closes the
    // connection itself, so the close frame is only a fallback.
    let _ = socket.send_text("Done");
    socket.close();
    answer
}

/// Loads the model ahead of a take. The pill calls this when it starts
/// listening, so the ~4.5 s load happens while the user is still speaking
/// instead of after. Returns how long it took, in milliseconds.
#[tauri::command]
pub async fn parakeet_warmup(
    app: AppHandle,
    model: String,
    threads: Option<u32>,
) -> Result<u64, String> {
    let id = safe_id(&model).ok_or("Not a Parakeet model id.")?;
    let dir = models_dir(&app)?.join(&id);
    if !model_complete(&dir) {
        return Err("Parakeet model not installed.".to_string());
    }
    let threads = recognizer_threads(threads);
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        ensure_server(&app, &id, threads)?;
        Ok(started.elapsed().as_millis() as u64)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Frees the model. The user can also just close the app.
#[tauri::command(async)]
pub fn parakeet_shutdown() {
    shutdown();
}

/// What a take cost, so the UI can show it and a regression is visible in the
/// log rather than only in someone's patience.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParakeetResult {
    /// sherpa's JSON line: `{"text": "...", "timestamps": [...], ...}`.
    pub json: String,
    /// Milliseconds from the command starting to the JSON arriving.
    pub ms: u64,
    /// True when the model was already loaded, i.e. this is the number a user
    /// actually waits. False means the take also paid for the model load.
    pub warm: bool,
    /// Length of the audio, for the real-time factor in the log.
    pub audio_ms: u64,
}

/// Transcribes a 16 kHz mono WAV with the given model.
#[tauri::command]
pub async fn parakeet_transcribe(
    app: AppHandle,
    wav: String,
    model: String,
    threads: Option<u32>,
) -> Result<ParakeetResult, String> {
    let id = safe_id(&model).ok_or("Not a Parakeet model id.")?;
    let dir = models_dir(&app)?.join(&id);
    if !model_complete(&dir) {
        return Err("Parakeet model not installed.".to_string());
    }
    let threads = recognizer_threads(threads);

    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        let pcm = read_wav(Path::new(&wav))?;
        let audio_ms = (pcm.samples.len() as f64 / pcm.rate.max(1) as f64 * 1000.0) as u64;

        // Was the model already loaded? Decided before `ensure_server` so the
        // number reported is the one the user experienced.
        let warm = SERVER
            .lock()
            .ok()
            .and_then(|guard| {
                guard
                    .as_ref()
                    .map(|s| s.model == id && s.threads == threads)
            })
            .unwrap_or(false);

        let json = match ensure_server(&app, &id, threads) {
            Ok(port) => {
                let answer = decode_on_server(port, &pcm);
                touch_server();
                answer
            }
            Err(e) => {
                log::warn!("parakeet: falling back to the one-shot recognizer ({e})");
                Err(e)
            }
        };
        let json = match json {
            Ok(json) => json,
            Err(_) => transcribe_one_shot(&app, &wav, &dir, threads)?,
        };
        let ms = started.elapsed().as_millis() as u64;
        log::info!(
            "parakeet: {audio_ms} ms of audio in {ms} ms ({}, RTF {:.2}, {threads} threads)",
            if warm { "warm" } else { "cold" },
            ms as f64 / audio_ms.max(1) as f64
        );
        Ok(ParakeetResult {
            json,
            ms,
            warm,
            audio_ms,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The pre-resident path, still here because an engine installed before the
/// resident server existed has only this executable — and because a recognizer
/// that will not start must never mean "no dictation".
fn transcribe_one_shot(
    app: &AppHandle,
    wav: &str,
    model_dir: &Path,
    threads: u32,
) -> Result<String, String> {
    let exe = find_exe(app).ok_or("Parakeet runtime not installed.")?;
    let mut cmd = Command::new(&exe);
    cmd.arg(format!("--encoder={}", model_dir.join("encoder.int8.onnx").display()))
        .arg(format!("--decoder={}", model_dir.join("decoder.int8.onnx").display()))
        .arg(format!("--joiner={}", model_dir.join("joiner.int8.onnx").display()))
        .arg(format!("--tokens={}", model_dir.join("tokens.txt").display()))
        .arg("--model-type=nemo_transducer")
        .arg("--decoding-method=greedy_search")
        .arg(format!("--num-threads={threads}"))
        .arg(wav)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(parent) = exe.parent() {
        cmd.current_dir(parent);
    }
    #[cfg(target_os = "macos")]
    if let Ok(lib) = lib_dir(app) {
        cmd.env("DYLD_LIBRARY_PATH", lib);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let output = cmd
        .output()
        .map_err(|e| format!("Parakeet failed to start: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "Parakeet exited with an error: {}",
            String::from_utf8_lossy(&output.stderr)
                .chars()
                .take(400)
                .collect::<String>()
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with('{'))
        .map(|line| line.to_string())
        .ok_or_else(|| {
            format!(
                "Parakeet produced no result: {}",
                String::from_utf8_lossy(&output.stderr)
                    .chars()
                    .take(300)
                    .collect::<String>()
            )
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

/// Where one archive entry belongs, or `None` for the dozen other tools,
/// headers and import libraries the release ships.
///
/// Windows wants the DLLs next to the exe (that is where the loader looks);
/// macOS wants them in a sibling `lib/`, because the executables are linked
/// with `@loader_path/../lib`. Flattening on macOS breaks every binary in the
/// archive, so the two platforms get different destinations on purpose.
fn destination_for(folder: &str, name: &str) -> Option<&'static str> {
    let lower = name.to_ascii_lowercase();
    let is_exe = name.eq_ignore_ascii_case(RUNTIME_EXE) || name.eq_ignore_ascii_case(SERVER_EXE);
    let is_lib = folder == "lib"
        && (lower.ends_with(".dll") || lower.ends_with(".so") || lower.ends_with(".dylib"));
    if is_exe {
        return Some("bin");
    }
    if !is_lib {
        return None;
    }
    if cfg!(windows) {
        Some("bin")
    } else {
        Some("lib")
    }
}

/// Unpacks the pinned sherpa-onnx release archive (`.tar.bz2`) into
/// `parakeet/`: the two recognizers and the libraries they load, nothing else.
/// The archive is deleted afterwards.
#[tauri::command]
pub async fn parakeet_install_runtime(app: AppHandle, archive: String) -> Result<(), String> {
    let rel = safe_relative(&archive).ok_or("Not a valid archive path.")?;
    let archive_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(rel);
    let root = root(&app)?;

    // A running recognizer holds its executable open on Windows.
    shutdown();

    tauri::async_runtime::spawn_blocking(move || {
        let file = std::fs::File::open(&archive_path)
            .map_err(|e| format!("Runtime archive missing: {e}"))?;
        let decoder = bzip2::read::MultiBzDecoder::new(std::io::BufReader::new(file));
        let mut tar = tar::Archive::new(decoder);
        let mut got_exe = false;
        let mut got_server = false;
        let mut count = 0usize;
        for entry in tar.entries().map_err(|e| e.to_string())? {
            let mut entry = entry.map_err(|e| e.to_string())?;
            if !entry.header().entry_type().is_file() {
                continue;
            }
            let path = entry.path().map_err(|e| e.to_string())?.into_owned();
            let Some(name) = path.file_name().map(|n| n.to_string_lossy().to_string()) else {
                continue;
            };
            let folder = path
                .parent()
                .and_then(|p| p.file_name())
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let Some(sub) = destination_for(&folder, &name) else {
                continue;
            };
            let dir = root.join(sub);
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let dest = dir.join(&name);
            let mut out = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            drop(out);
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755));
            }
            if name.eq_ignore_ascii_case(RUNTIME_EXE) {
                got_exe = true;
            }
            if name.eq_ignore_ascii_case(SERVER_EXE) {
                got_server = true;
            }
            count += 1;
        }
        let _ = std::fs::remove_file(&archive_path);
        if !got_exe || !got_server {
            return Err("The archive did not contain the sherpa-onnx recognizers.".to_string());
        }
        log::info!("parakeet runtime unpacked: {count} files into {}", root.display());
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Deletes one model folder (the model manager's "Remove").
#[tauri::command(async)]
pub fn parakeet_remove_model(app: AppHandle, id: String) -> Result<(), String> {
    let safe = safe_id(&id).ok_or("Not a Parakeet model id.")?;
    // The recognizer may have the model mapped.
    shutdown();
    let dir = models_dir(&app)?.join(safe);
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav(rate: u32, channels: u16, bits: u16, samples: &[i16]) -> Vec<u8> {
        let data: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
        let mut out = Vec::new();
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
        out.extend_from_slice(b"WAVEfmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes()); // PCM
        out.extend_from_slice(&channels.to_le_bytes());
        out.extend_from_slice(&rate.to_le_bytes());
        out.extend_from_slice(&(rate * channels as u32 * bits as u32 / 8).to_le_bytes());
        out.extend_from_slice(&(channels * bits / 8).to_le_bytes());
        out.extend_from_slice(&bits.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(&data);
        out
    }

    #[test]
    fn reads_mono_16_bit_pcm() {
        let pcm = parse_wav(&wav(16000, 1, 16, &[0, 16384, -16384, 32767])).unwrap();
        assert_eq!(pcm.rate, 16000);
        assert_eq!(pcm.samples.len(), 4);
        assert!((pcm.samples[1] - 0.5).abs() < 1e-6);
        assert!((pcm.samples[2] + 0.5).abs() < 1e-6);
    }

    #[test]
    fn skips_chunks_between_fmt_and_data() {
        let mut bytes = wav(16000, 1, 16, &[1, 2, 3]);
        // Splice a LIST chunk of odd length (plus its pad byte) after fmt.
        let mut spliced = bytes[..36].to_vec();
        spliced.extend_from_slice(b"LIST");
        spliced.extend_from_slice(&3u32.to_le_bytes());
        spliced.extend_from_slice(&[b'I', b'N', b'F', 0]);
        spliced.extend_from_slice(&bytes[36..]);
        bytes = spliced;
        let pcm = parse_wav(&bytes).unwrap();
        assert_eq!(pcm.samples.len(), 3);
    }

    #[test]
    fn refuses_stereo_and_non_pcm_widths() {
        assert!(parse_wav(&wav(16000, 2, 16, &[0, 0])).is_err());
        assert!(parse_wav(&wav(16000, 1, 8, &[0, 0])).is_err());
        assert!(parse_wav(b"not a wav at all, really not").is_err());
    }

    #[test]
    fn a_truncated_data_chunk_still_decodes() {
        let mut bytes = wav(16000, 1, 16, &[1, 2, 3, 4]);
        bytes.truncate(bytes.len() - 4); // lose the last two samples
        let pcm = parse_wav(&bytes).unwrap();
        assert_eq!(pcm.samples.len(), 2);
    }

    #[test]
    fn threads_prefer_physical_cores_and_stay_sane() {
        let auto = recognizer_threads(None);
        // Printed because it is the single biggest lever on dictation latency
        // on a given machine: `cargo test -- --nocapture threads_prefer`.
        println!(
            "recognizer threads: {auto} (physical {}, logical {})",
            physical_cores(),
            std::thread::available_parallelism().map(|n| n.get()).unwrap_or(0)
        );
        assert!((1..=12).contains(&auto), "auto threads out of range: {auto}");
        assert_eq!(recognizer_threads(Some(3)), 3);
        assert_eq!(recognizer_threads(Some(0)), auto, "0 means 'decide for me'");
        assert_eq!(recognizer_threads(Some(999)), 12);
    }

    #[test]
    fn only_the_recognizers_and_their_libraries_are_unpacked() {
        assert_eq!(destination_for("bin", RUNTIME_EXE), Some("bin"));
        assert_eq!(destination_for("bin", SERVER_EXE), Some("bin"));
        assert_eq!(destination_for("bin", "sherpa-onnx-microphone"), None);
        assert_eq!(destination_for("include", "sherpa-onnx.h"), None);
        let libs = if cfg!(windows) { "bin" } else { "lib" };
        assert_eq!(destination_for("lib", "onnxruntime.dll"), Some(libs));
        assert_eq!(destination_for("lib", "libonnxruntime.dylib"), Some(libs));
        // A stray library outside lib/ is not ours to install.
        assert_eq!(destination_for("bin", "onnxruntime.dll"), None);
    }

    /// End-to-end against a real `sherpa-onnx-offline-websocket-server`.
    ///
    /// Ignored by default because it needs a loaded recognizer, which is a
    /// 670 MB model and five seconds of start-up. It is the only test that
    /// exercises the wire format — the handshake, client-side masking, the
    /// `u32 rate | u32 bytes | f32 samples` header and the chunking — against
    /// the actual server rather than against my reading of its source, so run
    /// it whenever any of that changes:
    ///
    /// ```text
    /// sherpa-onnx-offline-websocket-server --port=6060 --num-work-threads=1 \
    ///   --encoder=... --decoder=... --joiner=... --tokens=... \
    ///   --model-type=nemo_transducer --num-threads=4
    ///
    /// OWNTOOLS_PARAKEET_PORT=6060 OWNTOOLS_PARAKEET_WAV=C:/path/short.wav \
    ///   cargo test -- --ignored --nocapture live_recognizer
    /// ```
    #[test]
    #[ignore = "needs a running sherpa-onnx recognizer; see the doc comment"]
    fn live_recognizer_round_trip() {
        let port: u16 = std::env::var("OWNTOOLS_PARAKEET_PORT")
            .expect("set OWNTOOLS_PARAKEET_PORT")
            .parse()
            .expect("port must be a number");
        let wav = std::env::var("OWNTOOLS_PARAKEET_WAV").expect("set OWNTOOLS_PARAKEET_WAV");
        let pcm = read_wav(Path::new(&wav)).expect("the WAV should parse");
        let seconds = pcm.samples.len() as f64 / pcm.rate as f64;
        println!("{seconds:.2} s of audio at {} Hz", pcm.rate);

        // Twice on purpose: the second call proves the model stayed loaded,
        // which is the whole reason this server exists.
        for run in 1..=2 {
            let started = Instant::now();
            let json = decode_on_server(port, &pcm).expect("the recognizer should answer");
            let ms = started.elapsed().as_millis();
            println!("run {run}: {ms} ms (RTF {:.3})", ms as f64 / 1000.0 / seconds);
            println!("run {run}: {}", json.chars().take(160).collect::<String>());
            assert!(json.starts_with('{'), "expected a JSON line, got: {json}");
            assert!(json.contains("\"text\""), "no text field in: {json}");
        }
    }

    #[test]
    fn model_ids_stay_inside_the_models_folder() {
        assert_eq!(safe_id(" parakeet-tdt-0.6b-v3-int8 ").as_deref(), Some("parakeet-tdt-0.6b-v3-int8"));
        assert!(safe_id("../whisper").is_none());
        assert!(safe_id("/etc/passwd").is_none());
        assert!(safe_id("").is_none());
    }
}
