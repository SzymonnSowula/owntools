//! On-device dictation: runs a downloaded whisper.cpp binary on WAV files and
//! types the result into the focused application. The engine + model live in
//! <AppData>/whisper and are downloaded from the frontend (see feature-dictation).

use std::path::PathBuf;
use std::process::Stdio;
use serde::Serialize;
use tauri::{AppHandle, Manager};

const EXE_CANDIDATES: &[&str] = &[
    "whisper-cli.exe",
    "main.exe",
    "whisper-cli",
    "main",
];

fn whisper_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("whisper"))
}

fn find_exe(app: &AppHandle) -> Option<PathBuf> {
    let dir = whisper_dir(app).ok()?;
    for name in EXE_CANDIDATES {
        let path = dir.join(name);
        if path.is_file() {
            return Some(path);
        }
    }
    None
}

fn find_model(app: &AppHandle) -> Option<PathBuf> {
    let dir = whisper_dir(app).ok()?;
    let entries = std::fs::read_dir(&dir).ok()?;
    let mut models: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.extension().map(|x| x == "bin" || x == "gguf").unwrap_or(false)
                && p.file_name()
                    .map(|n| n.to_string_lossy().starts_with("ggml"))
                    .unwrap_or(false)
        })
        .collect();
    models.sort();
    models.into_iter().next()
}

#[derive(Debug, Clone, Serialize)]
pub struct DictationStatus {
    pub engine: bool,
    pub model: bool,
    pub dir: String,
}

#[tauri::command]
pub fn dictation_status(app: AppHandle) -> Result<DictationStatus, String> {
    let dir = whisper_dir(&app)?;
    Ok(DictationStatus {
        engine: find_exe(&app).is_some(),
        model: find_model(&app).is_some(),
        dir: dir.to_string_lossy().to_string(),
    })
}

/// Transcribes a 16 kHz mono WAV. When `json` is true, returns whisper's JSON
/// (with segment timestamps); otherwise plain text. When `translate` is true,
/// whisper translates the speech to English (`-tr`).
#[tauri::command]
pub async fn whisper_transcribe(
    app: AppHandle,
    wav: String,
    lang: String,
    json: bool,
    translate: bool,
) -> Result<String, String> {
    let exe = find_exe(&app).ok_or("Whisper engine not installed.")?;
    let model = find_model(&app).ok_or("Whisper model not installed.")?;

    let out_base = std::env::temp_dir().join(format!("suite-whisper-{}", std::process::id()));
    let out_base_str = out_base.to_string_lossy().to_string();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = std::process::Command::new(&exe);
        cmd.arg("-m")
            .arg(&model)
            .arg("-f")
            .arg(&wav)
            .arg("-l")
            .arg(if lang.is_empty() { "auto" } else { &lang })
            .arg("-np"); // no runtime prints
        if translate {
            cmd.arg("-tr"); // translate to English
        }
        if json {
            cmd.arg("-oj").arg("-of").arg(&out_base_str);
        } else {
            cmd.arg("-nt"); // no timestamps in stdout
        }
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        let output = cmd.output().map_err(|e| format!("Whisper failed to start: {e}"))?;
        if !output.status.success() {
            return Err(format!(
                "Whisper exited with an error: {}",
                String::from_utf8_lossy(&output.stderr)
                    .chars()
                    .take(400)
                    .collect::<String>()
            ));
        }
        if json {
            let json_path = format!("{out_base_str}.json");
            let data = std::fs::read_to_string(&json_path)
                .map_err(|e| format!("Whisper produced no JSON: {e}"))?;
            let _ = std::fs::remove_file(&json_path);
            Ok(data)
        } else {
            Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    result
}

/// Types text into the currently focused application (Windows: SendInput with
/// KEYEVENTF_UNICODE). No-op elsewhere for now.
#[tauri::command]
pub fn type_text(text: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
            KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, VIRTUAL_KEY,
        };

        let units: Vec<u16> = text.encode_utf16().collect();
        let mut inputs: Vec<INPUT> = Vec::with_capacity(units.len() * 2);
        for unit in units {
            for flags in [KEYEVENTF_UNICODE, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP] {
                inputs.push(INPUT {
                    r#type: INPUT_KEYBOARD,
                    Anonymous: INPUT_0 {
                        ki: KEYBDINPUT {
                            wVk: VIRTUAL_KEY(0),
                            wScan: unit,
                            dwFlags: KEYBD_EVENT_FLAGS(flags.0),
                            time: 0,
                            dwExtraInfo: 0,
                        },
                    },
                });
            }
        }
        // Send in modest chunks so target apps keep up.
        for chunk in inputs.chunks(64) {
            let sent = unsafe { SendInput(chunk, std::mem::size_of::<INPUT>() as i32) };
            if sent as usize != chunk.len() {
                return Err("SendInput was blocked by the target application.".into());
            }
            std::thread::sleep(std::time::Duration::from_millis(4));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = text;
        Err("Typing into other apps is not implemented on this platform yet.".into())
    }
}

pub fn toggle(app: &AppHandle) {
    use tauri::Emitter;
    if let Some(win) = app.get_webview_window("dictation") {
        let _ = win.show();
        let _ = app.emit_to("dictation", "dictation-toggle", ());
    }
}
