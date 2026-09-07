//! NVIDIA Parakeet through sherpa-onnx: the second dictation engine, next to
//! whisper.cpp. Everything lives under `<AppData>/parakeet`:
//!
//!   parakeet/bin/sherpa-onnx-offline.exe + the onnxruntime / sherpa DLLs,
//!       unpacked from the pinned release archive by `parakeet_install_runtime`;
//!   parakeet/models/<id>/{encoder.int8.onnx, decoder.int8.onnx,
//!       joiner.int8.onnx, tokens.txt}, downloaded file by file through the
//!       pinned downloader (`download_file`).
//!
//! Recognition runs the CLI on a WAV and returns the JSON line it prints
//! (text + token timestamps). The model is loaded per call, which costs about
//! three seconds on a laptop CPU; the decode itself is far faster than
//! whisper's. A resident recognizer (sherpa's websocket server) would remove
//! the load time and is the obvious next step.

use std::path::{Component, Path, PathBuf};
use std::process::Stdio;

use serde::Serialize;
use tauri::{AppHandle, Manager};

#[cfg(windows)]
const RUNTIME_EXE: &str = "sherpa-onnx-offline.exe";
#[cfg(not(windows))]
const RUNTIME_EXE: &str = "sherpa-onnx-offline";

/// Every file a model folder needs before it counts as installed.
pub const MODEL_FILES: &[&str] = &[
    "encoder.int8.onnx",
    "decoder.int8.onnx",
    "joiner.int8.onnx",
    "tokens.txt",
];

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

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(root(app)?.join("models"))
}

fn find_exe(app: &AppHandle) -> Option<PathBuf> {
    let exe = bin_dir(app).ok()?.join(RUNTIME_EXE);
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
    /// sherpa-onnx-offline is unpacked and in place.
    pub runtime: bool,
    pub dir: String,
    /// Ids of the complete model folders.
    pub models: Vec<String>,
}

pub fn status(app: &AppHandle) -> ParakeetStatus {
    ParakeetStatus {
        runtime: find_exe(app).is_some(),
        dir: root(app).map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
        models: list_models(app),
    }
}

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

/// Unpacks the pinned sherpa-onnx release archive (`.tar.bz2`) into
/// `parakeet/bin`: only the offline recognizer and the DLLs it loads — the
/// archive also ships a dozen other tools, headers and import libraries we
/// have no use for. The archive is deleted afterwards.
#[tauri::command]
pub async fn parakeet_install_runtime(app: AppHandle, archive: String) -> Result<(), String> {
    let rel = safe_relative(&archive).ok_or("Not a valid archive path.")?;
    let archive_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(rel);
    let bin = bin_dir(&app)?;

    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&bin).map_err(|e| e.to_string())?;
        let file = std::fs::File::open(&archive_path)
            .map_err(|e| format!("Runtime archive missing: {e}"))?;
        let decoder = bzip2::read::MultiBzDecoder::new(std::io::BufReader::new(file));
        let mut tar = tar::Archive::new(decoder);
        let mut got_exe = false;
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
            let wanted = name.eq_ignore_ascii_case(RUNTIME_EXE)
                || (folder == "lib" && name.to_ascii_lowercase().ends_with(".dll"))
                || (folder == "lib" && name.to_ascii_lowercase().ends_with(".so"))
                || (folder == "lib" && name.to_ascii_lowercase().ends_with(".dylib"));
            if !wanted {
                continue;
            }
            let dest = bin.join(&name);
            let mut out = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755));
            }
            if name.eq_ignore_ascii_case(RUNTIME_EXE) {
                got_exe = true;
            }
            count += 1;
        }
        let _ = std::fs::remove_file(&archive_path);
        if !got_exe {
            return Err("The archive did not contain sherpa-onnx-offline.".to_string());
        }
        log::info!("parakeet runtime unpacked: {count} files into {}", bin.display());
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn default_threads() -> u32 {
    let cores = std::thread::available_parallelism()
        .map(|n| n.get() as u32)
        .unwrap_or(4);
    cores.saturating_sub(1).clamp(2, 8)
}

/// Transcribes a 16 kHz mono WAV with the given model. Returns sherpa's JSON
/// result line: `{"text": "...", "timestamps": [...], "tokens": [...], ...}`.
#[tauri::command]
pub async fn parakeet_transcribe(
    app: AppHandle,
    wav: String,
    model: String,
    threads: Option<u32>,
) -> Result<String, String> {
    let exe = find_exe(&app).ok_or("Parakeet runtime not installed.")?;
    let id = safe_id(&model).ok_or("Not a Parakeet model id.")?;
    let dir = models_dir(&app)?.join(&id);
    if !model_complete(&dir) {
        return Err("Parakeet model not installed.".to_string());
    }
    let threads = threads.unwrap_or_else(default_threads).clamp(1, 32);

    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = std::process::Command::new(&exe);
        cmd.arg(format!("--encoder={}", dir.join("encoder.int8.onnx").display()))
            .arg(format!("--decoder={}", dir.join("decoder.int8.onnx").display()))
            .arg(format!("--joiner={}", dir.join("joiner.int8.onnx").display()))
            .arg(format!("--tokens={}", dir.join("tokens.txt").display()))
            .arg("--model-type=nemo_transducer")
            .arg("--decoding-method=greedy_search")
            .arg(format!("--num-threads={threads}"))
            .arg(&wav)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(parent) = exe.parent() {
            cmd.current_dir(parent);
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
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Deletes one model folder (the model manager's "Remove").
#[tauri::command]
pub fn parakeet_remove_model(app: AppHandle, id: String) -> Result<(), String> {
    let safe = safe_id(&id).ok_or("Not a Parakeet model id.")?;
    let dir = models_dir(&app)?.join(safe);
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}
