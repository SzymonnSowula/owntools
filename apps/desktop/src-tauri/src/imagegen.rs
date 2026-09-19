//! Image generation on this machine: stable-diffusion.cpp's `sd-cli`, run once
//! per request, with the model files the frontend's catalogue pinned.
//!
//!   images/engine/bin/     `sd-cli(.exe)` + the libraries it loads, unpacked
//!                          from the pinned release archive by
//!                          `imagegen_install_runtime`;
//!   images/engine/build    which build that was ("vulkan", "cpu", "metal") —
//!                          the frontend asks before it offers a GPU option;
//!   images/engine/last-run.log  everything the last run printed, for the
//!                          log-folder button when a generation fails;
//!   images/models/<id>/…   model files, fetched by the pinned downloader
//!                          (`download_file`), so a half-fetched one is a
//!                          `.part` and never looks installed. A model may
//!                          also name a file that lives elsewhere under
//!                          AppData — FLUX.2 klein and Z-Image read their
//!                          prompt with Qwen3 4B, the very file Settings →
//!                          Intelligence already downloaded for the language
//!                          model, so it is shared instead of fetched twice;
//!   images/generated/      what came out, one PNG per image.
//!
//! ## Why a one-shot CLI and not a resident server (this time)
//!
//! The language model and Parakeet stay resident because a tool asks them
//! several things in a row and the load dominated every answer. A picture is
//! the other way round: sampling takes tens of seconds to minutes, the load is
//! a few seconds of that, and a resident diffusion model would hold 3–7 GB of
//! RAM or VRAM between two pictures a person makes an hour apart. One process
//! per picture also makes Cancel honest — the process is killed, the memory is
//! back.
//!
//! The command line is built here from a typed request. The webview never
//! passes arguments: it names files (relative to AppData, checked), numbers
//! (clamped) and a sampler from an allow-list.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

#[cfg(windows)]
const CLI_EXE: &str = "sd-cli.exe";
#[cfg(not(windows))]
const CLI_EXE: &str = "sd-cli";

/// A 6B model on a laptop CPU is slow, not stuck; an hour is "stuck".
const RUN_TIMEOUT: Duration = Duration::from_secs(60 * 60);
const PROGRESS_EVENT: &str = "imagegen-progress";

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("images"))
}

fn engine_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(root(app)?.join("engine"))
}

fn bin_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(engine_dir(app)?.join("bin"))
}

fn find_cli(app: &AppHandle) -> Option<PathBuf> {
    let exe = bin_dir(app).ok()?.join(CLI_EXE);
    exe.is_file().then_some(exe)
}

/// Ids come from the frontend: a bare name, never a path.
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

/// Paths come from the frontend: relative, inside AppData, no climbing out.
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

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImagegenStatus {
    /// `sd-cli` is unpacked and in place.
    pub runtime: bool,
    /// "vulkan" | "cpu" | "metal" — the build that was unpacked.
    pub build: Option<String>,
    /// A Vulkan loader is installed, i.e. some GPU driver on this machine
    /// speaks Vulkan and the GPU build has something to run on. Always false
    /// off Windows (macOS gets the Metal build, which needs no such check).
    pub vulkan: bool,
    /// Id of the generation in flight, if any.
    pub busy: Option<String>,
    pub dir: String,
    /// `std::env::consts::ARCH` — the macOS build is arm64-only.
    pub arch: &'static str,
}

fn vulkan_present() -> bool {
    #[cfg(windows)]
    {
        let system = std::env::var_os("SystemRoot")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
        system.join("System32").join("vulkan-1.dll").is_file()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

fn read_build(app: &AppHandle) -> Option<String> {
    let text = std::fs::read_to_string(engine_dir(app).ok()?.join("build")).ok()?;
    let build = text.trim();
    matches!(build, "vulkan" | "cpu" | "metal").then(|| build.to_string())
}

fn busy_id() -> Option<String> {
    RUNNING.lock().ok()?.as_ref().map(|job| job.id.clone())
}

/// Off the main thread: it touches the disk, and the main thread is the whole
/// app's event loop.
#[tauri::command(async)]
pub fn imagegen_status(app: AppHandle) -> ImagegenStatus {
    let runtime = find_cli(&app).is_some();
    ImagegenStatus {
        runtime,
        build: if runtime { read_build(&app) } else { None },
        vulkan: vulkan_present(),
        busy: busy_id(),
        dir: root(&app).map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
        arch: std::env::consts::ARCH,
    }
}

/// `name<TAB>description` lines from `sd-cli --list-devices` — which GPU the
/// engine would use, for the Settings card. Empty when the engine is missing.
#[tauri::command(async)]
pub fn imagegen_devices(app: AppHandle) -> Vec<(String, String)> {
    let Some(exe) = find_cli(&app) else {
        return Vec::new();
    };
    let mut cmd = Command::new(&exe);
    cmd.arg("--list-devices")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if let Some(parent) = exe.parent() {
        cmd.current_dir(parent);
    }
    hide_window(&mut cmd);
    let Ok(out) = cmd.output() else {
        return Vec::new();
    };
    parse_devices(&String::from_utf8_lossy(&out.stdout))
}

fn parse_devices(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|line| {
            let (name, description) = line.split_once('\t')?;
            let name = name.trim();
            (!name.is_empty()).then(|| (name.to_string(), description.trim().to_string()))
        })
        .collect()
}

fn hide_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

/// Model files, each a path relative to AppData. Which ones are set decides
/// the model family as far as `sd-cli` is concerned: `model` alone is a
/// classic checkpoint (SD 1.x / SDXL), `diffusion` + `vae` + `llm` is the
/// split layout FLUX.2 klein and Z-Image use.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelFiles {
    pub model: Option<String>,
    pub diffusion: Option<String>,
    pub vae: Option<String>,
    pub llm: Option<String>,
    pub clip_l: Option<String>,
    pub t5xxl: Option<String>,
    /// Folder holding LoRA files, for a `<lora:name:1>` tag in the prompt.
    pub lora_dir: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateRequest {
    /// Names the run: progress events and `imagegen_cancel` carry it, and it
    /// is the stem of the files written.
    pub id: String,
    pub files: ModelFiles,
    pub prompt: String,
    #[serde(default)]
    pub negative: Option<String>,
    pub width: u32,
    pub height: u32,
    pub steps: u32,
    pub cfg_scale: f32,
    /// Distilled guidance (FLUX-family); left to the engine's default when absent.
    #[serde(default)]
    pub guidance: Option<f32>,
    #[serde(default)]
    pub sampler: Option<String>,
    #[serde(default)]
    pub scheduler: Option<String>,
    pub seed: i64,
    pub count: u32,
    #[serde(default)]
    pub flash_attention: bool,
    #[serde(default)]
    pub offload_to_cpu: bool,
    #[serde(default)]
    pub clip_on_cpu: bool,
    #[serde(default)]
    pub vae_tiling: bool,
    /// Run on the processor even though the build could use the GPU.
    #[serde(default)]
    pub cpu_only: bool,
}

const SAMPLERS: &[&str] = &[
    "euler", "euler_a", "heun", "dpm2", "dpm++2s_a", "dpm++2m", "dpm++2mv2", "ipndm", "ipndm_v", "lcm", "ddim_trailing",
    "tcd",
];
const SCHEDULERS: &[&str] = &[
    "discrete", "karras", "exponential", "ays", "gits", "smoothstep", "sgm_uniform", "simple",
];

/// The numbers a request may carry, pulled into range rather than refused:
/// a slider that overshoots should not be an error dialog.
fn clamp_request(mut request: GenerateRequest) -> Result<GenerateRequest, String> {
    request.id = safe_id(&request.id).ok_or("Not a generation id.")?;
    let prompt = request.prompt.trim();
    if prompt.is_empty() {
        return Err("Write a prompt first.".into());
    }
    // Windows caps a command line at 32,767 characters; a prompt is one argument of it.
    request.prompt = prompt.chars().take(6000).collect();
    request.negative = request
        .negative
        .map(|n| n.trim().chars().take(3000).collect::<String>())
        .filter(|n| !n.is_empty());
    // Latents are 1/8 of the picture and FLUX-family models patch them 2×2.
    let snap = |v: u32| (v.clamp(256, 2048) / 16) * 16;
    request.width = snap(request.width);
    request.height = snap(request.height);
    request.steps = request.steps.clamp(1, 80);
    request.count = request.count.clamp(1, 4);
    request.cfg_scale = if request.cfg_scale.is_finite() { request.cfg_scale.clamp(0.0, 30.0) } else { 7.0 };
    request.guidance = request.guidance.filter(|g| g.is_finite()).map(|g| g.clamp(0.0, 30.0));
    if let Some(sampler) = &request.sampler {
        if !SAMPLERS.contains(&sampler.as_str()) {
            return Err(format!("Unknown sampler: {sampler}"));
        }
    }
    if let Some(scheduler) = &request.scheduler {
        if !SCHEDULERS.contains(&scheduler.as_str()) {
            return Err(format!("Unknown scheduler: {scheduler}"));
        }
    }
    Ok(request)
}

/// A model file named by the frontend → an absolute path that exists inside AppData.
fn model_file(data: &Path, rel: &Option<String>, what: &str, dir: bool) -> Result<Option<PathBuf>, String> {
    let Some(rel) = rel else {
        return Ok(None);
    };
    let safe = safe_relative(rel).ok_or_else(|| format!("Not a valid path for the {what}."))?;
    let path = data.join(safe);
    let there = if dir { path.is_dir() } else { path.is_file() };
    if !there {
        return Err(format!(
            "The {what} is missing ({}). Install the model again to fetch it.",
            path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
        ));
    }
    Ok(Some(path))
}

/// `sd-cli` builds differ in which flags they accept; probing `--help` once
/// lets a re-pinned binary lose a flag without every generation failing.
fn help_text(exe: &Path) -> String {
    static HELP: Mutex<Option<(PathBuf, String)>> = Mutex::new(None);
    let mut slot = HELP.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((path, text)) = slot.as_ref() {
        if path == exe {
            return text.clone();
        }
    }
    let mut cmd = Command::new(exe);
    cmd.arg("--help").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(parent) = exe.parent() {
        cmd.current_dir(parent);
    }
    hide_window(&mut cmd);
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

/// The arguments for one run, as (flag, value) pairs in order — a function of
/// its own so the mapping is tested without a binary.
fn build_args(
    request: &GenerateRequest,
    files: &ResolvedFiles,
    output_pattern: &Path,
    threads: u32,
    supports: &dyn Fn(&str) -> bool,
) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    let mut push = |flag: &str, value: Option<String>| {
        args.push(flag.to_string());
        if let Some(value) = value {
            args.push(value);
        }
    };
    let path = |p: &Path| Some(p.to_string_lossy().to_string());

    if let Some(p) = &files.model {
        push("-m", path(p));
    }
    if let Some(p) = &files.diffusion {
        push("--diffusion-model", path(p));
    }
    if let Some(p) = &files.vae {
        push("--vae", path(p));
    }
    if let Some(p) = &files.llm {
        push("--llm", path(p));
    }
    if let Some(p) = &files.clip_l {
        push("--clip_l", path(p));
    }
    if let Some(p) = &files.t5xxl {
        push("--t5xxl", path(p));
    }
    if let Some(p) = &files.lora_dir {
        push("--lora-model-dir", path(p));
    }

    push("-p", Some(request.prompt.clone()));
    if let Some(negative) = &request.negative {
        push("-n", Some(negative.clone()));
    }
    push("-W", Some(request.width.to_string()));
    push("-H", Some(request.height.to_string()));
    push("--steps", Some(request.steps.to_string()));
    push("--cfg-scale", Some(format!("{:.2}", request.cfg_scale)));
    if let Some(guidance) = request.guidance {
        push("--guidance", Some(format!("{guidance:.2}")));
    }
    if let Some(sampler) = &request.sampler {
        push("--sampling-method", Some(sampler.clone()));
    }
    if let Some(scheduler) = &request.scheduler {
        push("--scheduler", Some(scheduler.clone()));
    }
    push("-s", Some(request.seed.to_string()));
    push("-b", Some(request.count.to_string()));
    push("-t", Some(threads.to_string()));
    push("-o", path(output_pattern));

    if request.flash_attention && supports("--diffusion-fa") {
        push("--diffusion-fa", None);
    }
    if request.offload_to_cpu && supports("--offload-to-cpu") {
        push("--offload-to-cpu", None);
    }
    if request.clip_on_cpu && supports("--clip-on-cpu") {
        push("--clip-on-cpu", None);
    }
    if request.vae_tiling && supports("--vae-tiling") {
        push("--vae-tiling", None);
    }
    if request.cpu_only && supports("--backend") {
        push("--backend", Some("cpu".to_string()));
    }
    args
}

#[derive(Debug, Default)]
struct ResolvedFiles {
    model: Option<PathBuf>,
    diffusion: Option<PathBuf>,
    vae: Option<PathBuf>,
    llm: Option<PathBuf>,
    clip_l: Option<PathBuf>,
    t5xxl: Option<PathBuf>,
    lora_dir: Option<PathBuf>,
}

fn resolve_files(data: &Path, files: &ModelFiles) -> Result<ResolvedFiles, String> {
    let resolved = ResolvedFiles {
        model: model_file(data, &files.model, "model file", false)?,
        diffusion: model_file(data, &files.diffusion, "diffusion model", false)?,
        vae: model_file(data, &files.vae, "image decoder (VAE)", false)?,
        llm: model_file(data, &files.llm, "text encoder", false)?,
        clip_l: model_file(data, &files.clip_l, "CLIP text encoder", false)?,
        t5xxl: model_file(data, &files.t5xxl, "T5 text encoder", false)?,
        lora_dir: model_file(data, &files.lora_dir, "LoRA folder", true)?,
    };
    if resolved.model.is_none() && resolved.diffusion.is_none() {
        return Err("The request names no model file.".into());
    }
    Ok(resolved)
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub id: String,
    /// "loading" until the first sampling step, then "sampling", then "decoding".
    pub phase: &'static str,
    pub step: u32,
    pub steps: u32,
    /// Which picture of the batch, from 1.
    pub image: u32,
    pub images: u32,
    /// Seconds per step as the engine reports it; 0 before it knows.
    pub seconds_per_step: f32,
}

/// Finds `  12/20 - 1.53s/it` (or `it/s`) in a chunk of the engine's output.
/// The bar is redrawn with carriage returns, so a chunk may hold several; the
/// last one wins.
fn parse_step(chunk: &str) -> Option<(u32, u32, f32)> {
    let mut found = None;
    for piece in chunk.split(|c| c == '\r' || c == '\n') {
        let Some(slash) = piece.find('/') else { continue };
        let before = &piece[..slash];
        let digits_start = before
            .char_indices()
            .rev()
            .take_while(|(_, c)| c.is_ascii_digit())
            .last()
            .map(|(i, _)| i);
        let Some(start) = digits_start else { continue };
        let Ok(step) = before[start..].parse::<u32>() else { continue };
        let after = &piece[slash + 1..];
        let total_len = after.chars().take_while(|c| c.is_ascii_digit()).count();
        if total_len == 0 {
            continue;
        }
        let Ok(total) = after[..total_len].parse::<u32>() else { continue };
        let rest = after[total_len..].trim_start();
        let Some(rest) = rest.strip_prefix('-') else { continue };
        let rest = rest.trim_start();
        let number_len = rest.chars().take_while(|c| c.is_ascii_digit() || *c == '.').count();
        let Ok(value) = rest[..number_len].parse::<f32>() else { continue };
        let unit = rest[number_len..].trim_start();
        let seconds = if unit.starts_with("it/s") {
            if value > 0.0 { 1.0 / value } else { 0.0 }
        } else if unit.starts_with("s/it") {
            value
        } else {
            continue;
        };
        if total > 0 && step <= total {
            found = Some((step, total, seconds));
        }
    }
    found
}

/// The lines worth showing a person when a run fails: the engine's own
/// errors, else the tail of what it printed.
fn failure_summary(log: &str) -> String {
    let lines: Vec<&str> = log
        .split(|c| c == '\r' || c == '\n')
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    let errors: Vec<&str> = lines
        .iter()
        .copied()
        .filter(|l| l.contains("[ERROR]") || l.to_ascii_lowercase().contains("error:"))
        .collect();
    let picked = if errors.is_empty() {
        lines.iter().rev().take(3).rev().copied().collect::<Vec<_>>()
    } else {
        errors.into_iter().rev().take(3).rev().collect()
    };
    let text = picked.join(" · ");
    let lowered = text.to_ascii_lowercase();
    if lowered.contains("out of memory") || lowered.contains("failed to allocate") || lowered.contains("alloc") {
        return format!("The model did not fit in memory. Try a smaller size, or run on the processor. ({text})");
    }
    if text.is_empty() {
        "The image engine stopped without saying why.".to_string()
    } else {
        text.chars().take(400).collect()
    }
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

struct Job {
    id: String,
    child: Child,
    cancelled: bool,
}

/// One generation at a time: two diffusion models in memory at once is how a
/// laptop stops answering.
static RUNNING: Mutex<Option<Job>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateResult {
    /// Paths relative to AppData, one per picture, in order.
    pub files: Vec<String>,
    pub seed: i64,
    pub ms: u64,
    pub width: u32,
    pub height: u32,
}

fn pump(
    mut stream: impl Read + Send + 'static,
    log: Arc<Mutex<String>>,
    on_chunk: impl Fn(&str) + Send + 'static,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match stream.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                    on_chunk(&chunk);
                    if let Ok(mut all) = log.lock() {
                        // The progress bar alone can print megabytes; keep the tail.
                        if all.len() > 512 * 1024 {
                            let cut = all.len() - 256 * 1024;
                            let cut = (cut..all.len()).find(|i| all.is_char_boundary(*i)).unwrap_or(0);
                            all.drain(..cut);
                        }
                        all.push_str(&chunk);
                    }
                }
            }
        }
    })
}

fn run_blocking(app: AppHandle, request: GenerateRequest) -> Result<GenerateResult, String> {
    let exe = find_cli(&app).ok_or("The image engine is not installed yet.")?;
    let data = data_dir(&app)?;
    let files = resolve_files(&data, &request.files)?;
    let out_dir = root(&app)?.join("generated");
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    let pattern = out_dir.join(format!("{}_%02d.png", request.id));
    let threads = crate::parakeet::recognizer_threads(None);
    let help = help_text(&exe);
    let supports = |flag: &str| help.contains(flag);
    let args = build_args(&request, &files, &pattern, threads, &supports);

    let mut cmd = Command::new(&exe);
    cmd.args(&args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(parent) = exe.parent() {
        cmd.current_dir(parent);
    }
    hide_window(&mut cmd);

    let started = Instant::now();
    let (stdout, stderr) = {
        let mut slot = RUNNING.lock().map_err(|_| "The image engine's state is poisoned.".to_string())?;
        if slot.is_some() {
            return Err("Another image is still being generated.".into());
        }
        let mut child = cmd.spawn().map_err(|e| format!("The image engine would not start: {e}"))?;
        // Gigabytes that must go with owntools, however owntools goes (child_job.rs).
        crate::child_job::adopt(&child);
        let pipes = (child.stdout.take(), child.stderr.take());
        *slot = Some(Job { id: request.id.clone(), child, cancelled: false });
        pipes
    };
    log::info!(
        "imagegen {}: {}x{} · {} steps · {} image(s) · {} threads",
        request.id, request.width, request.height, request.steps, request.count, threads
    );

    let log = Arc::new(Mutex::new(String::new()));
    let state = Arc::new(Mutex::new((0u32, 1u32)));
    let emit = {
        let app = app.clone();
        let id = request.id.clone();
        let images = request.count;
        let state = state.clone();
        move |chunk: &str| {
            let Some((step, steps, seconds)) = parse_step(chunk) else { return };
            // The bar restarts for every picture of a batch.
            let image = {
                let mut s = state.lock().unwrap_or_else(|e| e.into_inner());
                if step < s.0 && s.1 < images {
                    s.1 += 1;
                }
                s.0 = step;
                s.1
            };
            let _ = app.emit(
                PROGRESS_EVENT,
                Progress {
                    id: id.clone(),
                    phase: if step >= steps && image >= images { "decoding" } else { "sampling" },
                    step,
                    steps,
                    image,
                    images,
                    seconds_per_step: seconds,
                },
            );
        }
    };
    let _ = app.emit(
        PROGRESS_EVENT,
        Progress { id: request.id.clone(), phase: "loading", step: 0, steps: request.steps, image: 1, images: request.count, seconds_per_step: 0.0 },
    );
    let pumps = [
        stdout.map(|s| pump(s, log.clone(), emit.clone())),
        stderr.map(|s| pump(s, log.clone(), emit)),
    ];

    // Poll rather than wait(): `imagegen_cancel` needs the child too.
    let outcome = loop {
        std::thread::sleep(Duration::from_millis(120));
        let mut slot = RUNNING.lock().map_err(|_| "The image engine's state is poisoned.".to_string())?;
        let Some(job) = slot.as_mut() else {
            break Err("The generation was cancelled.".to_string());
        };
        match job.child.try_wait() {
            Ok(Some(status)) => {
                let cancelled = job.cancelled;
                *slot = None;
                break if cancelled { Err("cancelled".to_string()) } else { Ok(status) };
            }
            Ok(None) if started.elapsed() > RUN_TIMEOUT => {
                let _ = job.child.kill();
                let _ = job.child.wait();
                *slot = None;
                break Err("The image engine ran for an hour without finishing and was stopped.".to_string());
            }
            Ok(None) => {}
            Err(e) => {
                *slot = None;
                break Err(e.to_string());
            }
        }
    };
    for handle in pumps.into_iter().flatten() {
        let _ = handle.join();
    }
    let text = log.lock().map(|l| l.clone()).unwrap_or_default();
    if let Ok(dir) = engine_dir(&app) {
        let _ = std::fs::write(dir.join("last-run.log"), &text);
    }

    let status = outcome?;
    let mut produced = Vec::new();
    for i in 0..request.count {
        let name = format!("{}_{:02}.png", request.id, i);
        if out_dir.join(&name).is_file() {
            produced.push(format!("images/generated/{name}"));
        }
    }
    if !status.success() || produced.is_empty() {
        log::warn!("imagegen {} failed: {}", request.id, status);
        return Err(failure_summary(&text));
    }
    let ms = started.elapsed().as_millis() as u64;
    log::info!("imagegen {}: {} image(s) in {} ms", request.id, produced.len(), ms);
    Ok(GenerateResult { files: produced, seed: request.seed, ms, width: request.width, height: request.height })
}

/// Runs one generation to the end. Rejects with `"cancelled"` after
/// `imagegen_cancel`, which is what the frontend matches on.
#[tauri::command]
pub async fn imagegen_generate(app: AppHandle, request: GenerateRequest) -> Result<GenerateResult, String> {
    let request = clamp_request(request)?;
    tauri::async_runtime::spawn_blocking(move || run_blocking(app, request))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
pub fn imagegen_cancel(id: String) -> Result<(), String> {
    let mut slot = RUNNING.lock().map_err(|_| "The image engine's state is poisoned.".to_string())?;
    if let Some(job) = slot.as_mut() {
        if job.id == id || id.is_empty() {
            job.cancelled = true;
            let _ = job.child.kill();
        }
    }
    Ok(())
}

/// For `RunEvent::Exit`: nothing of ours keeps sampling after the app is gone.
pub fn shutdown() {
    if let Ok(mut slot) = RUNNING.lock() {
        if let Some(mut job) = slot.take() {
            let _ = job.child.kill();
            let _ = job.child.wait();
        }
    }
}

// ---------------------------------------------------------------------------
// Installing and removing
// ---------------------------------------------------------------------------

/// Which archive entries land in `images/engine/bin/`: the CLI and every
/// shared library next to it. The release also ships a server and licences.
fn keep_entry(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    name.eq_ignore_ascii_case(CLI_EXE) || lower.ends_with(".dll") || lower.ends_with(".dylib") || lower.ends_with(".so")
}

#[cfg(unix)]
fn mark_exec(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755));
}
#[cfg(not(unix))]
fn mark_exec(_path: &Path) {}

fn unpack_zip(archive: &Path, into: &Path) -> Result<(usize, bool), String> {
    let file = std::fs::File::open(archive).map_err(|e| format!("Engine archive missing: {e}"))?;
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(file)).map_err(|e| format!("Engine archive unreadable: {e}"))?;
    let mut count = 0usize;
    let mut got_cli = false;
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
        got_cli |= name.eq_ignore_ascii_case(CLI_EXE);
        count += 1;
    }
    Ok((count, got_cli))
}

/// Unpacks the pinned stable-diffusion.cpp release zip into
/// `images/engine/bin/` and records which build it was. The archive is
/// deleted afterwards. A different build replaces the one in place.
#[tauri::command]
pub async fn imagegen_install_runtime(app: AppHandle, archive: String, build: String) -> Result<(), String> {
    if !matches!(build.as_str(), "vulkan" | "cpu" | "metal") {
        return Err("Unknown engine build.".into());
    }
    let rel = safe_relative(&archive).ok_or("Not a valid archive path.")?;
    let archive_path = data_dir(&app)?.join(rel);
    let engine = engine_dir(&app)?;
    let bin = bin_dir(&app)?;
    if busy_id().is_some() {
        return Err("An image is being generated - try again when it is done.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        // Libraries of the previous build must not linger next to the new CLI.
        if bin.is_dir() {
            std::fs::remove_dir_all(&bin).map_err(|e| e.to_string())?;
        }
        std::fs::create_dir_all(&bin).map_err(|e| e.to_string())?;
        let (count, got_cli) = unpack_zip(&archive_path, &bin)?;
        let _ = std::fs::remove_file(&archive_path);
        if !got_cli {
            return Err("The archive did not contain sd-cli.".to_string());
        }
        std::fs::write(engine.join("build"), &build).map_err(|e| e.to_string())?;
        log::info!("imagegen engine unpacked: {count} files ({build}) into {}", bin.display());
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Deletes one model folder under `images/models/`. Files a model shares with
/// another tool (the Qwen3 text encoder) live elsewhere and are not touched.
#[tauri::command(async)]
pub fn imagegen_remove_model(app: AppHandle, id: String) -> Result<(), String> {
    let safe = safe_id(&id).ok_or("Not a model id.")?;
    if busy_id().is_some() {
        return Err("An image is being generated - try again when it is done.".into());
    }
    let dir = root(&app)?.join("models").join(safe);
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Deletes generated pictures by name (the library's "Delete").
#[tauri::command(async)]
pub fn imagegen_remove_outputs(app: AppHandle, files: Vec<String>) -> Result<u32, String> {
    let dir = root(&app)?.join("generated");
    let mut removed = 0;
    for file in files {
        let Some(name) = Path::new(&file).file_name().map(|n| n.to_string_lossy().to_string()) else {
            continue;
        };
        if safe_id(&name).is_none() {
            continue;
        }
        if std::fs::remove_file(dir.join(&name)).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> GenerateRequest {
        GenerateRequest {
            id: "job-1".into(),
            files: ModelFiles { model: Some("images/models/sd15/model.gguf".into()), ..Default::default() },
            prompt: "  a lighthouse at dusk  ".into(),
            negative: Some("   ".into()),
            width: 1000,
            height: 5000,
            steps: 400,
            cfg_scale: f32::NAN,
            guidance: None,
            sampler: Some("euler_a".into()),
            scheduler: None,
            seed: 42,
            count: 9,
            flash_attention: true,
            offload_to_cpu: false,
            clip_on_cpu: false,
            vae_tiling: false,
            cpu_only: true,
        }
    }

    #[test]
    fn requests_are_pulled_into_range() {
        let r = clamp_request(request()).unwrap();
        assert_eq!(r.prompt, "a lighthouse at dusk");
        assert_eq!(r.negative, None);
        assert_eq!((r.width, r.height), (992, 2048));
        assert_eq!(r.steps, 80);
        assert_eq!(r.count, 4);
        assert_eq!(r.cfg_scale, 7.0);
    }

    #[test]
    fn a_request_cannot_name_its_own_flags() {
        let mut r = request();
        r.sampler = Some("euler --upscale-model x".into());
        assert!(clamp_request(r).is_err());
        let mut r = request();
        r.id = "../escape".into();
        assert!(clamp_request(r).is_err());
        let mut r = request();
        r.prompt = "   ".into();
        assert!(clamp_request(r).is_err());
    }

    #[test]
    fn model_paths_stay_inside_app_data() {
        assert!(safe_relative("images/models/x/model.gguf").is_some());
        assert!(safe_relative("llm/models/qwen3-4b-q4_k_m/Qwen3-4B-Q4_K_M.gguf").is_some());
        assert!(safe_relative("../../Windows/System32/cmd.exe").is_none());
        assert!(safe_relative("C:\\models\\x.gguf").is_none());
        assert!(safe_relative("/etc/passwd").is_none());
        let data = std::env::temp_dir();
        assert!(model_file(&data, &Some("no/such/file.gguf".into()), "model file", false).is_err());
        assert!(model_file(&data, &None, "model file", false).unwrap().is_none());
    }

    #[test]
    fn the_command_line_is_built_from_the_request() {
        let r = clamp_request(request()).unwrap();
        let files = ResolvedFiles { model: Some(PathBuf::from("m.gguf")), ..Default::default() };
        let all = |_: &str| true;
        let args = build_args(&r, &files, Path::new("out_%02d.png"), 4, &all);
        let joined = args.join(" ");
        assert!(joined.starts_with("-m m.gguf -p a lighthouse at dusk -W 992 -H 2048 --steps 80 --cfg-scale 7.00"));
        assert!(joined.contains("--sampling-method euler_a"));
        assert!(joined.contains("-s 42 -b 4 -t 4 -o out_%02d.png"));
        assert!(joined.contains("--diffusion-fa"));
        assert!(joined.ends_with("--backend cpu"));
        assert!(!joined.contains("-n "));

        // A binary that lost a flag does not get it.
        let none = |_: &str| false;
        let args = build_args(&r, &files, Path::new("o.png"), 4, &none).join(" ");
        assert!(!args.contains("--diffusion-fa"));
        assert!(!args.contains("--backend"));
    }

    #[test]
    fn the_split_layout_names_every_part() {
        let r = clamp_request(request()).unwrap();
        let files = ResolvedFiles {
            diffusion: Some(PathBuf::from("d.gguf")),
            vae: Some(PathBuf::from("v.safetensors")),
            llm: Some(PathBuf::from("q.gguf")),
            ..Default::default()
        };
        let all = |_: &str| true;
        let args = build_args(&r, &files, Path::new("o.png"), 4, &all).join(" ");
        assert!(args.starts_with("--diffusion-model d.gguf --vae v.safetensors --llm q.gguf -p "));
    }

    #[test]
    fn progress_is_read_off_the_bar() {
        assert_eq!(parse_step("  |=====>      | 5/20 - 1.50s/it"), Some((5, 20, 1.5)));
        assert_eq!(parse_step("\r  |==| 2/4 - 4.00it/s\r  |===| 3/4 - 4.00it/s"), Some((3, 4, 0.25)));
        assert_eq!(parse_step("[INFO ] loading tensors 1024/2048"), None);
        assert_eq!(parse_step("sampling completed, taking 12.30s"), None);
        assert_eq!(parse_step("9/4 - 1.0s/it"), None);
    }

    #[test]
    fn failures_are_said_in_words() {
        let log = "[INFO ] loading model\n[ERROR] ggml_vulkan: failed to allocate buffer\n";
        assert!(failure_summary(log).starts_with("The model did not fit in memory."));
        assert_eq!(failure_summary(""), "The image engine stopped without saying why.");
        assert!(failure_summary("[ERROR] stable-diffusion.cpp: unknown tensor").contains("unknown tensor"));
    }

    #[test]
    fn only_the_cli_and_its_libraries_are_unpacked() {
        assert!(keep_entry(CLI_EXE));
        assert!(keep_entry("stable-diffusion.dll"));
        assert!(keep_entry("ggml-vulkan.dll"));
        assert!(keep_entry("libstable-diffusion.dylib"));
        assert!(!keep_entry("sd-server.exe"));
        assert!(!keep_entry("LICENSE"));
    }

    #[test]
    fn devices_are_name_tab_description() {
        let text = "Vulkan0\tNVIDIA GeForce GTX 1650 Ti\nCPU\tIntel(R) Core(TM) i5-10300H\n\nnoise\n";
        assert_eq!(
            parse_devices(text),
            vec![
                ("Vulkan0".to_string(), "NVIDIA GeForce GTX 1650 Ti".to_string()),
                ("CPU".to_string(), "Intel(R) Core(TM) i5-10300H".to_string()),
            ]
        );
    }

    /// The real thing: needs the engine and a model under the app's data
    /// folder. `cargo test imagegen::tests::real_generation -- --ignored --nocapture`
    /// with OWNTOOLS_SD_CLI, OWNTOOLS_SD_MODEL (and optionally _VAE / _LLM /
    /// _DIFFUSION) pointing at files on this machine.
    #[test]
    #[ignore]
    fn real_generation() {
        let exe = PathBuf::from(std::env::var("OWNTOOLS_SD_CLI").expect("OWNTOOLS_SD_CLI"));
        let files = ResolvedFiles {
            model: std::env::var("OWNTOOLS_SD_MODEL").ok().map(PathBuf::from),
            diffusion: std::env::var("OWNTOOLS_SD_DIFFUSION").ok().map(PathBuf::from),
            vae: std::env::var("OWNTOOLS_SD_VAE").ok().map(PathBuf::from),
            llm: std::env::var("OWNTOOLS_SD_LLM").ok().map(PathBuf::from),
            ..Default::default()
        };
        let mut r = request();
        r.width = 512;
        r.height = 512;
        r.steps = std::env::var("OWNTOOLS_SD_STEPS").ok().and_then(|s| s.parse().ok()).unwrap_or(8);
        r.count = 1;
        r.cfg_scale = std::env::var("OWNTOOLS_SD_CFG").ok().and_then(|s| s.parse().ok()).unwrap_or(7.0);
        r.cpu_only = std::env::var("OWNTOOLS_SD_CPU").is_ok();
        r.sampler = None;
        let r = clamp_request(r).unwrap();
        let out = std::env::temp_dir().join("owntools-imagegen-test_%02d.png");
        let help = help_text(&exe);
        let supports = |flag: &str| help.contains(flag);
        let args = build_args(&r, &files, &out, crate::parakeet::recognizer_threads(None), &supports);
        println!("{} {}", exe.display(), args.join(" "));
        let started = Instant::now();
        let output = Command::new(&exe).args(&args).current_dir(exe.parent().unwrap()).output().unwrap();
        let text = format!("{}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
        let steps: Vec<_> = text.split('\r').filter_map(parse_step).collect();
        println!("{} ms · {} progress readings · last {:?}", started.elapsed().as_millis(), steps.len(), steps.last());
        assert!(output.status.success(), "{}", failure_summary(&text));
        assert!(std::env::temp_dir().join("owntools-imagegen-test_00.png").is_file());
        assert!(!steps.is_empty(), "the progress bar was not recognised");
    }
}
