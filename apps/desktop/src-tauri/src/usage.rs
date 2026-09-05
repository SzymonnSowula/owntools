use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const SAMPLE_MS: u64 = 2000;
const DEFAULT_IDLE_MS: u64 = 60_000;

/// Off until the frontend pushes the persisted setting (first run: after the
/// onboarding consent step). Nothing is read from other windows before that.
static ENABLED: AtomicBool = AtomicBool::new(false);
static STARTED: OnceLock<()> = OnceLock::new();

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageTick {
    pub date: String,
    pub seconds: u32,
    pub idle: bool,
    pub session_start: bool,
    pub app_id: String,
    pub app_name: String,
    pub title: String,
    pub site: Option<String>,
    pub scroll_locked: bool,
}

#[tauri::command]
pub fn usage_set_enabled(enabled: bool) {
    ENABLED.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
pub fn usage_is_enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

pub fn start(app: AppHandle) {
    if STARTED.set(()).is_err() {
        return;
    }
    if let Err(e) = thread::Builder::new()
        .name("focus-usage".into())
        .spawn(move || run_loop(app))
    {
        log::error!("could not start the usage sampler thread: {e}");
    }
}

fn run_loop(app: AppHandle) {
    let mut was_idle = true;
    let mut last_hwnd: isize = 0;
    let mut last_site: Option<String> = None;
    loop {
        thread::sleep(Duration::from_millis(SAMPLE_MS));
        let idle_ms = idle_milliseconds();
        let idle = idle_ms >= DEFAULT_IDLE_MS;
        let tracking = ENABLED.load(Ordering::Relaxed);
        let guarding = crate::scroll_guard::is_armed();
        // Only look at the foreground window when something needs it: time
        // tracking, or the scroll guard deciding whether this is a blocked site.
        // With both off this loop touches nothing but the idle timer.
        let mut sample = if tracking || guarding {
            foreground_sample(last_hwnd, last_site.as_deref())
        } else {
            empty_sample()
        };
        last_hwnd = sample.hwnd;
        last_site = sample.site.clone();
        crate::scroll_guard::note_host(sample.site.as_deref());
        if !tracking {
            // The guard only needs the host; keep window titles out of the
            // frontend when the user has tracking off.
            sample.title.clear();
            sample.app_id.clear();
            sample.app_name.clear();
        }

        let session_start = tracking && !idle && was_idle;
        if tracking {
            was_idle = idle;
        }

        let tick = UsageTick {
            date: local_date(),
            seconds: if !tracking || idle {
                0
            } else {
                (SAMPLE_MS / 1000) as u32
            },
            idle,
            session_start,
            app_id: sample.app_id,
            app_name: sample.app_name,
            title: sample.title,
            site: sample.site,
            scroll_locked: crate::scroll_guard::is_locked(),
        };
        let _ = app.emit("usage-tick", tick);
    }
}

fn local_date() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

struct Sample {
    hwnd: isize,
    app_id: String,
    app_name: String,
    title: String,
    site: Option<String>,
}

fn empty_sample() -> Sample {
    Sample {
        hwnd: 0,
        app_id: String::new(),
        app_name: "Desktop".into(),
        title: String::new(),
        site: None,
    }
}

#[cfg(not(windows))]
fn idle_milliseconds() -> u64 {
    0
}

#[cfg(not(windows))]
fn foreground_sample(_last_hwnd: isize, _last_site: Option<&str>) -> Sample {
    empty_sample()
}

#[cfg(windows)]
fn idle_milliseconds() -> u64 {
    use windows::Win32::System::SystemInformation::GetTickCount64;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    let mut info = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    let ok = unsafe { GetLastInputInfo(&mut info) };
    if !ok.as_bool() {
        return 0;
    }
    let now = unsafe { GetTickCount64() };
    now.saturating_sub(u64::from(info.dwTime))
}

#[cfg(windows)]
fn foreground_sample(last_hwnd: isize, last_site: Option<&str>) -> Sample {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId,
    };

    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        return empty_sample();
    }
    let hwnd_id = hwnd.0 as isize;

    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if pid == 0 {
        return empty_sample();
    }

    let title = window_title(hwnd);
    let path = process_path(pid);
    let exe = exe_name(&path);
    if is_ignored(&exe) {
        return empty_sample();
    }

    let app_name = friendly_name(&exe, &path);
    let site = if is_browser(&exe) {
        if hwnd_id == last_hwnd {
            last_site
                .map(|s| s.to_string())
                .or_else(|| browser_site(hwnd, &title))
        } else {
            browser_site(hwnd, &title)
        }
    } else {
        url_from_text(&title)
    };

    Sample {
        hwnd: hwnd_id,
        app_id: exe,
        app_name,
        title,
        site,
    }
}

#[cfg(windows)]
fn window_title(hwnd: windows::Win32::Foundation::HWND) -> String {
    use windows::Win32::UI::WindowsAndMessaging::GetWindowTextW;
    let mut buf = [0u16; 512];
    let n = unsafe { GetWindowTextW(hwnd, &mut buf) };
    if n <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..n as usize])
}

#[cfg(windows)]
fn process_path(pid: u32) -> String {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) };
    let Ok(handle) = handle else {
        return String::new();
    };
    let mut buf = [0u16; 512];
    let mut size = buf.len() as u32;
    let result = unsafe {
        QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut size)
    };
    let _ = unsafe { CloseHandle(handle) };
    if result.is_err() || size == 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..size as usize])
}

fn exe_name(path: &str) -> String {
    path.rsplit(['\\', '/'])
        .next()
        .unwrap_or(path)
        .to_string()
}

fn is_ignored(exe: &str) -> bool {
    let e = exe.to_ascii_lowercase();
    matches!(
        e.as_str(),
        "lockapp.exe"
            | "logonui.exe"
            | "scrnsave.scr"
            | "dwm.exe"
            | "searchhost.exe"
            | "textinputhost.exe"
            | "shellexperiencehost.exe"
            | "startmenuexperiencehost.exe"
    )
}

fn is_browser(exe: &str) -> bool {
    let e = exe.to_ascii_lowercase();
    matches!(
        e.as_str(),
        "chrome.exe"
            | "msedge.exe"
            | "msedgewebview2.exe"
            | "firefox.exe"
            | "brave.exe"
            | "opera.exe"
            | "opera_browser.exe"
            | "vivaldi.exe"
            | "chromium.exe"
            | "waterfox.exe"
            | "librewolf.exe"
            | "iexplore.exe"
            | "arc.exe"
            | "browser.exe"
            | "zen.exe"
    )
}

fn friendly_name(exe: &str, path: &str) -> String {
    let e = exe.to_ascii_lowercase();
    let p = path.to_ascii_lowercase();
    if p.contains("\\cursor") || e == "cursor.exe" {
        return "Cursor".into();
    }
    match e.as_str() {
        "code.exe" => "VS Code".into(),
        "chrome.exe" => "Google Chrome".into(),
        "msedge.exe" => "Microsoft Edge".into(),
        "firefox.exe" => "Firefox".into(),
        "brave.exe" => "Brave".into(),
        "opera.exe" | "opera_browser.exe" => "Opera".into(),
        "vivaldi.exe" => "Vivaldi".into(),
        "slack.exe" => "Slack".into(),
        "discord.exe" => "Discord".into(),
        "spotify.exe" => "Spotify".into(),
        "notion.exe" => "Notion".into(),
        "figma.exe" => "Figma".into(),
        "explorer.exe" => "File Explorer".into(),
        "winword.exe" => "Word".into(),
        "excel.exe" => "Excel".into(),
        "powerpnt.exe" => "PowerPoint".into(),
        "outlook.exe" => "Outlook".into(),
        "teams.exe" | "ms-teams.exe" => "Teams".into(),
        "windowsterminal.exe" | "wt.exe" => "Terminal".into(),
        "powershell.exe" | "pwsh.exe" => "PowerShell".into(),
        "cmd.exe" => "Command Prompt".into(),
        "notepad.exe" => "Notepad".into(),
        "focus.exe" | "shipshape.exe" => "shipshape".into(),
        _ => exe
            .trim_end_matches(".exe")
            .trim_end_matches(".EXE")
            .to_string(),
    }
}

fn url_from_text(text: &str) -> Option<String> {
    for token in text.split_whitespace() {
        let t = token.trim_matches(|c: char| "()[]<>,;\"'".contains(c));
        if let Some(host) = host_from_candidate(t) {
            return Some(host);
        }
    }
    None
}

fn host_from_candidate(raw: &str) -> Option<String> {
    let s = raw.trim();
    let lower = s.to_ascii_lowercase();
    if lower.starts_with("chrome:")
        || lower.starts_with("edge:")
        || lower.starts_with("about:")
        || lower.starts_with("file:")
        || lower.starts_with("devtools:")
    {
        return None;
    }
    let s = if lower.starts_with("http://") || lower.starts_with("https://") {
        s
    } else if lower.starts_with("www.") {
        s
    } else {
        return None;
    };
    let without_scheme = s
        .split("://")
        .nth(1)
        .unwrap_or(s)
        .trim_start_matches("www.");
    let host = without_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .split('@')
        .last()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if host.is_empty() || !host.contains('.') {
        None
    } else {
        Some(host)
    }
}

#[cfg(windows)]
fn browser_site(hwnd: windows::Win32::Foundation::HWND, title: &str) -> Option<String> {
    if let Some(host) = url_from_text(title) {
        return Some(host);
    }
    uia_address_host(hwnd).or_else(|| url_from_text(title))
}

#[cfg(windows)]
fn uia_address_host(hwnd: windows::Win32::Foundation::HWND) -> Option<String> {
    use uiautomation::controls::ControlType;
    use uiautomation::types::{Handle, UIProperty};
    use uiautomation::UIAutomation;

    let automation = UIAutomation::new().ok()?;
    let handle = Handle::from(hwnd.0 as isize);
    let root = automation.element_from_handle(handle).ok()?;
    let matcher = automation
        .create_matcher()
        .from(root)
        .control_type(ControlType::Edit)
        .timeout(180);
    if let Ok(edit) = matcher.find_first() {
        if let Ok(variant) = edit.get_property_value(UIProperty::ValueValue) {
            if let Ok(val) = variant.get_string() {
                if let Some(host) = host_from_candidate(&val) {
                    return Some(host);
                }
            }
        }
        if let Ok(name) = edit.get_name() {
            if let Some(host) = host_from_candidate(&name) {
                return Some(host);
            }
        }
    }
    None
}
