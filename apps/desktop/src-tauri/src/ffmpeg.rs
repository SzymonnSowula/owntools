use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{AppHandle, Manager};

fn ffmpeg_names() -> &'static [&'static str] {
    if cfg!(windows) {
        &["ffmpeg.exe", "ffmpeg"]
    } else {
        &["ffmpeg", "ffmpeg.exe"]
    }
}

fn candidate_paths(app: &AppHandle) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(dir) = app.path().resource_dir() {
        for name in ffmpeg_names() {
            out.push(dir.join(name));
            out.push(dir.join("resources").join(name));
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for name in ffmpeg_names() {
                out.push(dir.join(name));
            }
        }
    }
    out
}

fn run_ffmpeg_version(bin: &Path) -> bool {
    let mut cmd = std::process::Command::new(bin);
    cmd.arg("-version").stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd.status().map(|s| s.success()).unwrap_or(false)
}

fn resolve_ffmpeg(app: &AppHandle) -> Option<PathBuf> {
    for path in candidate_paths(app) {
        if path.is_file() && run_ffmpeg_version(&path) {
            return Some(path);
        }
    }
    if run_ffmpeg_version(Path::new("ffmpeg")) {
        return Some(PathBuf::from("ffmpeg"));
    }
    None
}

#[tauri::command]
pub fn ffmpeg_available(app: AppHandle) -> bool {
    resolve_ffmpeg(&app).is_some()
}

#[tauri::command]
pub fn convert_to_mp4(app: AppHandle, input: String, output: String) -> Result<(), String> {
    let bin = resolve_ffmpeg(&app).ok_or_else(|| "ffmpeg not found".to_string())?;
    let mut cmd = std::process::Command::new(bin);
    cmd.args([
        "-y",
        "-i",
        &input,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        "-shortest",
        &output,
    ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let status = cmd.status().map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("ffmpeg conversion failed".into())
    }
}
