use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

static ARMED: AtomicBool = AtomicBool::new(false);
static LOCKED: AtomicBool = AtomicBool::new(false);
static SITES: Mutex<Vec<String>> = Mutex::new(Vec::new());
/// Set while a hook thread exists (spawned or still winding down).
static RUNNING: AtomicBool = AtomicBool::new(false);
/// A stop requested before the hook thread had published its id.
static STOP_PENDING: AtomicBool = AtomicBool::new(false);
/// Win32 thread id of the hook loop, once it is up.
static HOOK_THREAD: Mutex<Option<u32>> = Mutex::new(None);

#[tauri::command]
pub fn scroll_guard_sync(armed: bool, sites: Vec<String>) {
    ARMED.store(armed, Ordering::Relaxed);
    if let Ok(mut guard) = SITES.lock() {
        *guard = expand_all(&sites);
    }
    if armed {
        // The low-level input hooks exist only while the guard is armed: they
        // go in on arm and come out on disarm, never at startup for a feature
        // that is off.
        start();
        // The sampler parks while nothing needs it; this does.
        crate::usage::wake();
    } else {
        LOCKED.store(false, Ordering::Relaxed);
        stop();
    }
}

pub fn is_armed() -> bool {
    ARMED.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn scroll_guard_note(site: Option<String>) {
    note_host(site.as_deref());
}

pub fn is_locked() -> bool {
    LOCKED.load(Ordering::Relaxed)
}

pub fn start() {
    if RUNNING.swap(true, Ordering::AcqRel) {
        return;
    }
    STOP_PENDING.store(false, Ordering::Release);
    #[cfg(windows)]
    if let Err(e) = std::thread::Builder::new()
        .name("focus-scroll-guard".into())
        .spawn(hook_loop)
    {
        RUNNING.store(false, Ordering::Release);
        log::error!("could not start the scroll guard hook thread: {e}");
        return;
    }
    log::info!("scroll guard input hooks installed");
}

/// Tears the hooks down: asks the hook thread to leave its message loop, which
/// unhooks on the way out. No-op when nothing is running.
pub fn stop() {
    if !RUNNING.load(Ordering::Acquire) {
        return;
    }
    #[cfg(windows)]
    {
        let tid = HOOK_THREAD.lock().ok().and_then(|g| *g);
        match tid {
            Some(tid) => post_quit(tid),
            // The thread is starting up and has not published its id yet.
            None => STOP_PENDING.store(true, Ordering::Release),
        }
    }
    #[cfg(not(windows))]
    RUNNING.store(false, Ordering::Release);
}

#[cfg(windows)]
fn post_quit(tid: u32) {
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{PostThreadMessageW, WM_QUIT};
    if let Err(e) = unsafe { PostThreadMessageW(tid, WM_QUIT, WPARAM(0), LPARAM(0)) } {
        log::warn!("could not ask the scroll guard thread to stop: {e}");
    }
}

pub fn note_host(host: Option<&str>) {
    if !ARMED.load(Ordering::Relaxed) {
        LOCKED.store(false, Ordering::Relaxed);
        return;
    }
    let locked = host.map(is_blocked).unwrap_or(false);
    LOCKED.store(locked, Ordering::Relaxed);
}

fn normalize(raw: &str) -> String {
    raw.trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .trim_start_matches("www.")
        .trim_end_matches('.')
        .to_ascii_lowercase()
}

fn expand_all(sites: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for s in sites {
        for e in expand_one(&normalize(s)) {
            if !e.is_empty() && !out.contains(&e) {
                out.push(e);
            }
        }
    }
    out
}

fn expand_one(host: &str) -> Vec<String> {
    match host {
        "x.com" | "twitter.com" | "t.co" => vec![
            "x.com".into(),
            "twitter.com".into(),
            "mobile.twitter.com".into(),
            "t.co".into(),
        ],
        "tiktok.com" => vec![
            "tiktok.com".into(),
            "vm.tiktok.com".into(),
            "m.tiktok.com".into(),
        ],
        "instagram.com" => vec![
            "instagram.com".into(),
            "instagr.am".into(),
            "l.instagram.com".into(),
        ],
        other => {
            if other.is_empty() {
                vec![]
            } else {
                vec![other.to_string()]
            }
        }
    }
}

fn is_blocked(host: &str) -> bool {
    let h = normalize(host);
    if h.is_empty() {
        return false;
    }
    let Ok(sites) = SITES.lock() else {
        return false;
    };
    sites
        .iter()
        .any(|s| h == *s || h.ends_with(&format!(".{s}")))
}

#[cfg(windows)]
fn hook_loop() {
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx,
        MSG, WH_KEYBOARD_LL, WH_MOUSE_LL,
    };

    unsafe {
        let mouse = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), None, 0);
        let kbd = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), None, 0);
        if let Err(e) = &mouse {
            log::error!("scroll guard: mouse hook failed: {e}");
        }
        if let Err(e) = &kbd {
            log::error!("scroll guard: keyboard hook failed: {e}");
        }

        let tid = GetCurrentThreadId();
        if let Ok(mut slot) = HOOK_THREAD.lock() {
            *slot = Some(tid);
        }
        // A disarm that raced the spawn is honoured right away.
        let stop_now = STOP_PENDING.swap(false, Ordering::AcqRel);

        if !stop_now {
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }

        if let Ok(h) = mouse {
            let _ = UnhookWindowsHookEx(h);
        }
        if let Ok(h) = kbd {
            let _ = UnhookWindowsHookEx(h);
        }
        if let Ok(mut slot) = HOOK_THREAD.lock() {
            *slot = None;
        }
        RUNNING.store(false, Ordering::Release);
        log::info!("scroll guard input hooks removed");
    }
}

#[cfg(windows)]
unsafe extern "system" fn mouse_proc(
    code: i32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::LRESULT;
    use windows::Win32::UI::WindowsAndMessaging::{CallNextHookEx, WM_MOUSEHWHEEL, WM_MOUSEWHEEL};

    if code >= 0 && LOCKED.load(Ordering::Relaxed) {
        let msg = wparam.0 as u32;
        if msg == WM_MOUSEWHEEL || msg == WM_MOUSEHWHEEL {
            return LRESULT(1);
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

#[cfg(windows)]
unsafe extern "system" fn keyboard_proc(
    code: i32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::LRESULT;
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, KBDLLHOOKSTRUCT, WM_KEYDOWN, WM_SYSKEYDOWN,
    };

    if code >= 0 && LOCKED.load(Ordering::Relaxed) {
        let msg = wparam.0 as u32;
        if msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN {
            let info = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
            if is_scroll_key(info.vkCode) {
                return LRESULT(1);
            }
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

fn is_scroll_key(vk: u32) -> bool {
    matches!(
        vk,
        0x21 | // page up
        0x22 | // page down
        0x23 | // end
        0x24 | // home
        0x26 | // up
        0x28 // down
    )
}
