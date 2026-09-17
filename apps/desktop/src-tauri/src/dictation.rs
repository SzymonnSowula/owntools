//! On-device dictation: runs a downloaded whisper.cpp binary on WAV files and
//! types the result into the focused application. The engine + model live in
//! <AppData>/whisper and are downloaded from the frontend (see feature-dictation).

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const EXE_CANDIDATES: &[&str] = &[
    "whisper-cli.exe",
    "main.exe",
    "whisper-cli",
    "main",
];

/// Best to worst. `find_model` prefers whatever sits highest in this list, so a
/// user who adds large-v3-turbo next to the old base model gets the good one.
const MODEL_RANK: &[&str] = &[
    "large-v3-turbo",
    "large-v3",
    "large-v2",
    "large",
    "medium",
    "small",
    "base",
    "tiny",
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

fn is_model_file(path: &Path) -> bool {
    path.extension().map(|x| x == "bin" || x == "gguf").unwrap_or(false)
        && path
            .file_name()
            .map(|n| n.to_string_lossy().starts_with("ggml"))
            .unwrap_or(false)
}

fn model_score(name: &str) -> usize {
    let lower = name.to_ascii_lowercase();
    MODEL_RANK
        .iter()
        .position(|tag| lower.contains(tag))
        .unwrap_or(MODEL_RANK.len())
}

fn list_models(app: &AppHandle) -> Vec<String> {
    let Ok(dir) = whisper_dir(app) else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut models: Vec<String> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| is_model_file(p))
        .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().to_string()))
        .collect();
    // Best model first; alphabetical inside a tier so the order stays stable.
    models.sort_by(|a, b| model_score(a).cmp(&model_score(b)).then_with(|| a.cmp(b)));
    models
}

/// Resolves the model to run: the requested file when it exists, otherwise the
/// highest-quality one installed.
fn find_model(app: &AppHandle, requested: Option<&str>) -> Option<PathBuf> {
    let dir = whisper_dir(app).ok()?;
    if let Some(name) = requested.map(str::trim).filter(|n| !n.is_empty()) {
        if let Some(safe) = safe_model_name(name) {
            let candidate = dir.join(safe);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    list_models(app).into_iter().next().map(|name| dir.join(name))
}

/// Model names come from the frontend, so keep them to a bare `ggml*.bin`
/// filename, never a path that could escape the whisper folder.
fn safe_model_name(name: &str) -> Option<String> {
    let name = name.trim();
    if name.is_empty()
        || name.contains(['/', '\\', ':'])
        || name.contains("..")
        || !name.starts_with("ggml")
        || !(name.ends_with(".bin") || name.ends_with(".gguf"))
    {
        return None;
    }
    Some(name.to_string())
}

#[derive(Debug, Clone, Serialize)]
pub struct DictationStatus {
    /// whisper.cpp is unpacked.
    pub engine: bool,
    /// At least one whisper model is installed.
    pub model: bool,
    pub dir: String,
    /// Installed whisper models, best first.
    pub models: Vec<String>,
    /// The second engine (sherpa-onnx + NVIDIA Parakeet), see parakeet.rs.
    pub parakeet: crate::parakeet::ParakeetStatus,
}

#[tauri::command]
pub fn dictation_status(app: AppHandle) -> Result<DictationStatus, String> {
    let dir = whisper_dir(&app)?;
    let models = list_models(&app);
    Ok(DictationStatus {
        engine: find_exe(&app).is_some(),
        model: !models.is_empty(),
        dir: dir.to_string_lossy().to_string(),
        models,
        parakeet: crate::parakeet::status(&app),
    })
}

/// Removes an installed model (the model manager's "free up space" button).
#[tauri::command]
pub fn dictation_remove_model(app: AppHandle, name: String) -> Result<(), String> {
    let safe = safe_model_name(&name).ok_or("Not a whisper model file.")?;
    let path = whisper_dir(&app)?.join(safe);
    if path.is_file() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Whisper builds differ in which flags they accept; probing `--help` once lets
/// us pass the good ones without risking a hard failure on an older binary.
fn help_text(exe: &Path) -> String {
    static HELP: OnceLock<Mutex<Option<(PathBuf, String)>>> = OnceLock::new();
    let cache = HELP.get_or_init(|| Mutex::new(None));
    let mut slot = cache.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((path, text)) = slot.as_ref() {
        if path == exe {
            return text.clone();
        }
    }
    let mut cmd = std::process::Command::new(exe);
    cmd.arg("--help").stdout(Stdio::piped()).stderr(Stdio::piped());
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

fn default_threads() -> u32 {
    let cores = std::thread::available_parallelism()
        .map(|n| n.get() as u32)
        .unwrap_or(4);
    // whisper.cpp stops scaling well past ~8 threads, and leaving a core free
    // keeps the UI responsive while a long file transcribes.
    cores.saturating_sub(1).clamp(2, 8)
}

/// Decoder knobs the frontend can set. Everything is optional: `None` means
/// "use whisper's own default".
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeOptions {
    /// Initial prompt: vocabulary, names and recent context (max ~224 tokens).
    pub prompt: Option<String>,
    /// Model filename inside <AppData>/whisper.
    pub model: Option<String>,
    pub beam_size: Option<u32>,
    pub best_of: Option<u32>,
    pub threads: Option<u32>,
    /// Drop `[BLANK_AUDIO]`, `(music)` and friends at the decoder instead of
    /// cleaning them out of the text afterwards.
    pub suppress_non_speech: Option<bool>,
    /// Max characters per segment (subtitles).
    pub max_len: Option<u32>,
    pub entropy_thold: Option<f32>,
    pub no_speech_thold: Option<f32>,
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
    options: Option<TranscribeOptions>,
) -> Result<String, String> {
    let opts = options.unwrap_or_default();
    let exe = find_exe(&app).ok_or("Whisper engine not installed.")?;
    let model = find_model(&app, opts.model.as_deref()).ok_or("Whisper model not installed.")?;

    // Unique per call: two transcriptions in flight must not share an output file.
    static CALLS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let call = CALLS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let out_base = std::env::temp_dir().join(format!(
        "owntools-whisper-{}-{call}",
        std::process::id()
    ));
    let out_base_str = out_base.to_string_lossy().to_string();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let help = help_text(&exe);
        let supports = |flag: &str| help.contains(flag);

        let mut cmd = std::process::Command::new(&exe);
        cmd.arg("-m")
            .arg(&model)
            .arg("-f")
            .arg(&wav)
            .arg("-l")
            .arg(if lang.is_empty() { "auto" } else { &lang })
            .arg("-t")
            .arg(opts.threads.unwrap_or_else(default_threads).clamp(1, 32).to_string())
            .arg("-np"); // no runtime prints

        // Beam search + best-of: the biggest accuracy lever after the model
        // itself. Greedy (1/1) is the fast preset.
        if let Some(bs) = opts.beam_size {
            cmd.arg("-bs").arg(bs.clamp(1, 12).to_string());
        }
        if let Some(bo) = opts.best_of {
            cmd.arg("-bo").arg(bo.clamp(1, 12).to_string());
        }
        if let Some(et) = opts.entropy_thold {
            cmd.arg("-et").arg(format!("{et}"));
        }
        if let Some(nth) = opts.no_speech_thold {
            if supports("--no-speech-thold") {
                cmd.arg("-nth").arg(format!("{nth}"));
            }
        }
        if opts.suppress_non_speech.unwrap_or(true) {
            if supports("--suppress-nst") {
                cmd.arg("--suppress-nst");
            } else if supports("--suppress-non-speech-tokens") {
                cmd.arg("--suppress-non-speech-tokens");
            }
        }
        if let Some(prompt) = opts
            .prompt
            .as_deref()
            .map(str::trim)
            .filter(|p| !p.is_empty())
        {
            if supports("--prompt") {
                // whisper truncates past ~224 tokens anyway; keep the head,
                // which is where the vocabulary lives.
                let capped: String = prompt.chars().take(900).collect();
                cmd.arg("--prompt").arg(capped);
            }
        }
        if let Some(ml) = opts.max_len {
            cmd.arg("-ml").arg(ml.to_string());
        }
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

/// Types text into the currently focused application: `SendInput` with
/// `KEYEVENTF_UNICODE` on Windows, a `CGEvent` carrying a unicode string on
/// macOS (which needs the Accessibility permission — see `mac.rs`).
#[tauri::command(async)]
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
    #[cfg(target_os = "macos")]
    {
        crate::mac::type_text(&text)
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = text;
        Err("Typing into other apps is not implemented on this platform yet.".into())
    }
}

/// Marks a file inside AppData executable.
///
/// The whisper archive is unpacked in the webview (it is a small zip and
/// fflate is already there), and `writeFile` creates 0644 — which on macOS
/// and Linux means the recognizer we just installed cannot be run. Windows
/// has no such bit, so this is a no-op there.
#[tauri::command]
pub fn mark_executable(app: AppHandle, path: String) -> Result<(), String> {
    // Paths come from the frontend: relative, inside AppData, no climbing out.
    let relative = std::path::Path::new(&path);
    if relative.is_absolute() || path.contains("..") || path.contains(':') {
        return Err("Not a path inside the app's data folder.".into());
    }
    let full = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(relative);
    if !full.is_file() {
        return Err(format!("{} is not a file", full.display()));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&full, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Where the next transcript goes, and to whom.
///
/// `main` is true when the app's own main window is the foreground window:
/// the pill hands the text to it as an event, so in-app fields and the board
/// take it directly instead of receiving raw keystrokes (on the board those
/// would be tool shortcuts). For any other application — which gets the text
/// typed through `type_text` — `app` is its process image name ("slack.exe";
/// the application's name on macOS) and `title` its window title, so the
/// per-app profiles can tell a chat from an e-mail. Both `None` when the
/// platform cannot say; the frontend treats that as "no profile".
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationTargetInfo {
    pub main: bool,
    pub app: Option<String>,
    pub title: Option<String>,
}

#[tauri::command]
pub fn dictation_target(app: AppHandle) -> DictationTargetInfo {
    let main = app
        .get_webview_window("main")
        .map(|w| main_is_foreground(&w))
        .unwrap_or(false);
    let (name, title) = if main { (None, None) } else { foreground_app() };
    DictationTargetInfo {
        main,
        app: name,
        title,
    }
}

/// The process behind the foreground window and that window's title.
fn foreground_app() -> (Option<String>, Option<String>) {
    #[cfg(windows)]
    {
        use windows::core::PWSTR;
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
            PROCESS_QUERY_LIMITED_INFORMATION,
        };
        use windows::Win32::UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
        };

        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.0.is_null() {
            return (None, None);
        }
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        // QUERY_LIMITED_INFORMATION is granted for elevated processes too,
        // where PROCESS_QUERY_INFORMATION would be refused.
        let app = (pid != 0)
            .then(|| unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok())
            .flatten()
            .and_then(|handle| {
                let mut buf = [0u16; 1024];
                let mut len = buf.len() as u32;
                let ok = unsafe {
                    QueryFullProcessImageNameW(
                        handle,
                        PROCESS_NAME_WIN32,
                        PWSTR(buf.as_mut_ptr()),
                        &mut len,
                    )
                }
                .is_ok();
                unsafe {
                    let _ = CloseHandle(handle);
                }
                ok.then(|| image_basename(&String::from_utf16_lossy(&buf[..len as usize])))
            })
            .filter(|name| !name.is_empty());
        let title = {
            let len = unsafe { GetWindowTextLengthW(hwnd) };
            if len > 0 {
                let mut buf = vec![0u16; len as usize + 1];
                let n = unsafe { GetWindowTextW(hwnd, &mut buf) };
                (n > 0).then(|| String::from_utf16_lossy(&buf[..n as usize]))
            } else {
                None
            }
        };
        (app, title)
    }
    #[cfg(target_os = "macos")]
    {
        (crate::mac::frontmost_app(), None)
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        (None, None)
    }
}

/// `C:\Program Files\Slack\slack.exe` → `slack.exe`.
fn image_basename(path: &str) -> String {
    path.rsplit(['\\', '/'])
        .next()
        .unwrap_or(path)
        .trim()
        .to_string()
}

/// Presses Enter in the focused application — what "send it" and a profile's
/// auto-send do once the text is typed. The frontend never calls this when our
/// own window is the target: there the words land in a field, and Enter would
/// submit whatever form the field belongs to.
#[tauri::command]
pub fn press_enter() -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
            KEYEVENTF_KEYUP, VK_RETURN,
        };
        let inputs: Vec<INPUT> = [KEYBD_EVENT_FLAGS(0), KEYEVENTF_KEYUP]
            .into_iter()
            .map(|flags| INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VK_RETURN,
                        wScan: 0,
                        dwFlags: flags,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            })
            .collect();
        let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
        if sent as usize != inputs.len() {
            return Err("SendInput was blocked by the target application.".into());
        }
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        crate::mac::press_enter()
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        Err("Pressing keys in other apps is not implemented on this platform yet.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_basename_keeps_only_the_file_name() {
        assert_eq!(image_basename(r"C:\Program Files\Slack\slack.exe"), "slack.exe");
        assert_eq!(image_basename("/Applications/Slack.app/Contents/MacOS/Slack"), "Slack");
        assert_eq!(image_basename("Code.exe"), "Code.exe");
        assert_eq!(image_basename(""), "");
    }

    #[test]
    fn model_names_stay_inside_the_whisper_folder() {
        assert_eq!(safe_model_name(" ggml-base.bin ").as_deref(), Some("ggml-base.bin"));
        assert!(safe_model_name("../ggml-base.bin").is_none());
        assert!(safe_model_name("notes.txt").is_none());
    }
}

fn main_is_foreground(main: &tauri::WebviewWindow) -> bool {
    #[cfg(windows)]
    {
        use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
        if let Ok(hwnd) = main.hwnd() {
            let fg = unsafe { GetForegroundWindow() };
            return !fg.0.is_null() && fg.0 as usize == hwnd.0 as usize;
        }
    }
    main.is_focused().unwrap_or(false)
}

/// The global hotkey: shows the pill (a non-focusable window, so the app the
/// user is dictating into keeps the keyboard) and lets it start or stop a take.
pub fn toggle(app: &AppHandle) {
    use tauri::Emitter;
    let Some(win) = app.get_webview_window("dictation") else {
        log::error!("dictation hotkey pressed, but there is no dictation window");
        return;
    };
    if let Err(e) = win.show() {
        log::warn!("dictation pill could not be shown: {e}");
    }
    match app.emit_to("dictation", "dictation-toggle", ()) {
        Ok(()) => log::info!("dictation hotkey: toggle sent to the pill"),
        Err(e) => log::warn!("dictation toggle not delivered to the pill: {e}"),
    }
}
