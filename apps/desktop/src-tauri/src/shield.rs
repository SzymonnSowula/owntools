//! Keeps the recorder's own chrome out of the recording.
//!
//! Two things sit on the screen while a take runs and neither belongs in it:
//! our recorder bar — a normal top-level window, since the capture is made
//! from inside it — and WebView2's "… is sharing your screen" bar, which
//! Chromium parks at the bottom of the screen from its own process. For our
//! window, `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` removes it from
//! every capture path (Windows 10 2004+). Chromium's bar belongs to
//! msedgewebview2.exe: affinity is tried first and, when the OS refuses it on
//! another process's window, the bar is parked off every monitor instead —
//! it is redundant next to our own Stop, and the capture keeps running.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

static WATCH: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);

/// Excludes the recorder overlay itself from screen captures. Once, at start-up.
pub fn shield_overlay(app: &AppHandle) {
    #[cfg(windows)]
    {
        let Some(window) = app.get_webview_window("recorder") else {
            return;
        };
        match window.hwnd() {
            Ok(hwnd) => {
                if platform::exclude_from_capture(hwnd.0 as isize) {
                    log::info!("recorder overlay excluded from screen capture");
                } else {
                    log::warn!("recorder overlay could not be excluded from capture; it will show in full-screen takes");
                }
            }
            Err(err) => log::warn!("recorder overlay has no window handle: {err}"),
        }
    }
    #[cfg(target_os = "macos")]
    {
        crate::mac::shield_recorder(app);
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = app;
    }
}

/// Hides the browser's own sharing bar for the length of a take (`on`), or stops doing so.
#[tauri::command]
pub fn capture_shield(on: bool) {
    let mut slot = WATCH.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(stop) = slot.take() {
        stop.store(true, Ordering::Relaxed);
    }
    if !on {
        return;
    }
    let stop = Arc::new(AtomicBool::new(false));
    *slot = Some(stop.clone());
    let spawned = std::thread::Builder::new()
        .name("capture-shield".into())
        .spawn(move || {
            let mut handled = std::collections::HashSet::new();
            while !stop.load(Ordering::Relaxed) {
                platform::hide_share_bars(&mut handled);
                std::thread::sleep(std::time::Duration::from_millis(250));
            }
        });
    if let Err(err) = spawned {
        log::warn!("capture shield thread failed to start: {err}");
    }
}

#[cfg(windows)]
mod platform {
    use std::collections::HashSet;

    #[repr(C)]
    #[derive(Default)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    #[link(name = "user32")]
    unsafe extern "system" {
        fn EnumWindows(callback: extern "system" fn(isize, isize) -> i32, lparam: isize) -> i32;
        fn IsWindowVisible(hwnd: isize) -> i32;
        fn GetWindowTextLengthW(hwnd: isize) -> i32;
        fn GetWindowTextW(hwnd: isize, buf: *mut u16, max: i32) -> i32;
        fn GetClassNameW(hwnd: isize, buf: *mut u16, max: i32) -> i32;
        fn GetWindowRect(hwnd: isize, rect: *mut Rect) -> i32;
        fn GetWindowThreadProcessId(hwnd: isize, pid: *mut u32) -> u32;
        fn SetWindowDisplayAffinity(hwnd: isize, affinity: u32) -> i32;
        fn SetWindowPos(hwnd: isize, after: isize, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetCurrentProcessId() -> u32;
    }

    const WDA_EXCLUDEFROMCAPTURE: u32 = 0x0000_0011;
    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_NOACTIVATE: u32 = 0x0010;
    /// Off every monitor a desktop can have.
    const PARK: i32 = -32_000;

    pub fn exclude_from_capture(hwnd: isize) -> bool {
        unsafe { SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE) != 0 }
    }

    extern "system" fn collect(hwnd: isize, lparam: isize) -> i32 {
        // SAFETY: lparam is the &mut Vec passed to EnumWindows, alive for the call.
        let out = unsafe { &mut *(lparam as *mut Vec<isize>) };
        out.push(hwnd);
        1
    }

    fn wide(read: impl Fn(*mut u16, i32) -> i32, cap: usize) -> String {
        let mut buf = vec![0u16; cap.max(1)];
        let n = read(buf.as_mut_ptr(), buf.len() as i32);
        if n <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buf[..n as usize])
    }

    /// Chromium's sharing bar: a small, visible top-level window of another
    /// process (WebView2's) whose text names our origin. Every language puts
    /// the origin in that text, so "localhost" is the marker, not the wording.
    fn is_share_bar(hwnd: isize, own_pid: u32) -> bool {
        if unsafe { IsWindowVisible(hwnd) } == 0 {
            return false;
        }
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
        if pid == 0 || pid == own_pid {
            return false;
        }
        let class = wide(|b, n| unsafe { GetClassNameW(hwnd, b, n) }, 64);
        if !class.starts_with("Chrome_WidgetWin") {
            return false;
        }
        let len = unsafe { GetWindowTextLengthW(hwnd) };
        if len <= 0 || len > 512 {
            return false;
        }
        let title = wide(|b, n| unsafe { GetWindowTextW(hwnd, b, n) }, len as usize + 1).to_lowercase();
        if !title.contains("localhost") {
            return false;
        }
        let mut rect = Rect::default();
        if unsafe { GetWindowRect(hwnd, &mut rect) } == 0 || rect.left <= PARK / 2 {
            return false;
        }
        let (w, h) = (rect.right - rect.left, rect.bottom - rect.top);
        w > 200 && h > 0 && h < 160
    }

    pub fn hide_share_bars(handled: &mut HashSet<isize>) {
        let mut handles: Vec<isize> = Vec::new();
        unsafe { EnumWindows(collect, &mut handles as *mut Vec<isize> as isize) };
        let own = unsafe { GetCurrentProcessId() };
        for hwnd in handles {
            if handled.contains(&hwnd) || !is_share_bar(hwnd, own) {
                continue;
            }
            let excluded = exclude_from_capture(hwnd);
            let parked = !excluded
                && unsafe { SetWindowPos(hwnd, 0, PARK, PARK, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE) } != 0;
            log::info!(
                "sharing bar {hwnd:#x}: {}",
                if excluded {
                    "excluded from capture"
                } else if parked {
                    "parked off-screen"
                } else {
                    "could not be touched"
                }
            );
            if excluded || parked {
                handled.insert(hwnd);
            }
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use std::collections::HashSet;

    pub fn exclude_from_capture(_hwnd: isize) -> bool {
        false
    }

    pub fn hide_share_bars(_handled: &mut HashSet<isize>) {}
}
