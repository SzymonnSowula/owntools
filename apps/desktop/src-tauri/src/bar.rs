//! The bar's native half (the page is `apps/desktop/src/bar`).
//!
//! The bar lives in the `dictation` window, which is resident anyway: a web
//! view costs 55–95 MB (overlays.rs), so the bar does not get one of its own.
//! From here it gets what a page cannot do by itself:
//!
//! - `bar_set_bounds` — one `SetWindowPos` for place and size, so a resize
//!   never shows the new size in the old place for a frame.
//! - `bar_sync` — a watcher that tells the bar to step aside: a full-screen app
//!   in front of the bar's monitor, the recorder or a screenshot on screen, or
//!   the owntools window in front and covering the bar. Plus the tray tick.
//! - `bar_capture_exclusion` — out of screen recordings, screenshots and
//!   screen sharing (`WDA_EXCLUDEFROMCAPTURE`, Windows 10 2004+).
//! - `bar_note_foreground` / `bar_restore_foreground` — the window is
//!   non-activating (`focusable: false`), and if a click on it takes the
//!   foreground anyway, the app that had it gets it back before a dictated
//!   word is typed: that app is the whole point of dictating.
//! - `bar_drag` — the system's move loop, and a watch on the mouse button,
//!   because nothing tells the page when a drag has ended.
//!
//! Nothing about the window in front is kept or logged: its handle while the
//! pointer is over the bar, its rectangle for one comparison.

use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::menu::CheckMenuItem;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, Wry};

pub const LABEL: &str = "dictation";
/// How often the watcher looks. A full-screen video that appears waits at most this long.
const WATCH_EVERY: Duration = Duration::from_millis(700);
/// A drag that never ends (a lost button-up) stops being watched after this.
const DRAG_LIMIT: Duration = Duration::from_secs(120);

static WATCH: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);
static DRAG: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);
/// The window that was in front when the pointer reached the bar.
#[cfg_attr(not(windows), allow(dead_code))]
static NOTED: AtomicIsize = AtomicIsize::new(0);

/// The tray's "Show the bar" item, ticked to match the setting.
pub struct BarTray(pub CheckMenuItem<Wry>);

/// Why the bar steps aside; the page shows it again when this is `None`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(not(windows), allow(dead_code))]
pub enum Aside {
    Fullscreen,
    Main,
    Recorder,
    Capture,
}

impl Aside {
    fn as_str(self) -> &'static str {
        match self {
            Aside::Fullscreen => "fullscreen",
            Aside::Main => "main",
            Aside::Recorder => "recorder",
            Aside::Capture => "capture",
        }
    }
}

/// Start-up. Windows will not make a window with a caption style smaller than
/// its minimum tracking size (~136 × 39) unless the window says so, and the
/// resting bar is a capsule well under that.
pub fn setup(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        if let Err(e) = window.set_min_size(Some(tauri::LogicalSize::new(1.0, 1.0))) {
            log::warn!("bar: minimum size not lifted, the capsule may get a margin: {e}");
        }
    }
}

/// Whether an on-demand window is on screen. Most of the time it does not
/// exist at all (overlays.rs), and then nothing is asked of the main thread.
fn visible(app: &AppHandle, label: &str) -> bool {
    app.get_webview_window(label).and_then(|w| w.is_visible().ok()).unwrap_or(false)
}

#[cfg(windows)]
fn hwnd_of(window: &WebviewWindow) -> Option<isize> {
    window.hwnd().ok().map(|h| h.0 as isize)
}

/// The two resident windows the watcher compares against. Their handles never
/// change, and asking Tauri for one is a round trip through the main thread,
/// so the watcher asks once.
#[derive(Clone, Copy)]
struct Handles {
    #[cfg_attr(not(windows), allow(dead_code))]
    bar: isize,
    #[cfg_attr(not(windows), allow(dead_code))]
    main: Option<isize>,
}

fn handles(app: &AppHandle) -> Handles {
    #[cfg(windows)]
    {
        Handles {
            bar: app.get_webview_window(LABEL).as_ref().and_then(hwnd_of).unwrap_or(0),
            main: app.get_webview_window("main").as_ref().and_then(hwnd_of),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Handles { bar: 0, main: None }
    }
}

fn aside(app: &AppHandle, handles: Handles) -> Option<Aside> {
    if visible(app, "recorder") {
        return Some(Aside::Recorder);
    }
    if visible(app, "capture") {
        return Some(Aside::Capture);
    }
    #[cfg(windows)]
    {
        if handles.bar == 0 {
            return None;
        }
        platform::aside(handles.bar, handles.main)
    }
    #[cfg(not(windows))]
    {
        let _ = handles;
        None
    }
}

/// Moves and resizes the bar's window in one step. Physical pixels.
#[tauri::command]
pub fn bar_set_bounds(window: WebviewWindow, x: i32, y: i32, width: u32, height: u32) -> Result<(), String> {
    if window.label() != LABEL {
        return Err("only the bar places itself".into());
    }
    let (width, height) = (width.max(1), height.max(1));
    #[cfg(windows)]
    {
        if let Some(hwnd) = hwnd_of(&window) {
            if platform::set_bounds(hwnd, x, y, width as i32, height as i32) {
                return Ok(());
            }
        }
    }
    window.set_position(tauri::PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    window.set_size(tauri::PhysicalSize::new(width, height)).map_err(|e| e.to_string())
}

/// The bar was switched on or off: start or stop the watcher, tick the tray item.
#[tauri::command(async)]
pub fn bar_sync(app: AppHandle, enabled: bool) {
    if let Some(tray) = app.try_state::<BarTray>() {
        let _ = tray.0.set_checked(enabled);
    }
    let mut slot = WATCH.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(stop) = slot.take() {
        stop.store(true, Ordering::Relaxed);
    }
    if !enabled {
        return;
    }
    let stop = Arc::new(AtomicBool::new(false));
    *slot = Some(stop.clone());
    drop(slot);
    let spawned = std::thread::Builder::new().name("bar-watch".into()).spawn(move || {
        let handles = handles(&app);
        // `None` inside means "nothing in the way"; the outer one forces the first report.
        let mut last: Option<Option<Aside>> = None;
        while !stop.load(Ordering::Relaxed) {
            let now = aside(&app, handles);
            if last != Some(now) {
                last = Some(now);
                let _ = app.emit_to(LABEL, "bar-obscured", now.map(Aside::as_str));
            }
            std::thread::sleep(WATCH_EVERY);
        }
    });
    if let Err(e) = spawned {
        log::warn!("bar: the watcher did not start, the bar will not step aside for full screen: {e}");
    }
}

/// Keeps the bar out of every capture (`exclude`), or lets it be recorded.
#[tauri::command]
pub fn bar_capture_exclusion(window: WebviewWindow, exclude: bool) {
    #[cfg(windows)]
    {
        if let Some(hwnd) = hwnd_of(&window) {
            // Affinity belongs to the thread that owns the window: a sync
            // command runs on the main thread, which is that thread.
            if platform::exclude_from_capture(hwnd, exclude) {
                log::info!("bar: {} screen capture", if exclude { "excluded from" } else { "visible to" });
            } else {
                log::warn!("bar: capture affinity refused (Windows older than 10 2004?)");
            }
        }
    }
    #[cfg(not(windows))]
    let _ = (window, exclude);
}

/// The pointer reached the bar: remember the app in front, unless it is the bar.
#[tauri::command]
pub fn bar_note_foreground(window: WebviewWindow) {
    #[cfg(windows)]
    {
        if let Some(bar) = hwnd_of(&window) {
            let front = platform::foreground();
            if front != 0 && front != bar {
                NOTED.store(front, Ordering::Relaxed);
            }
        }
    }
    #[cfg(not(windows))]
    let _ = window;
}

/// A click on the bar took the foreground: give it back. True when it had to.
#[tauri::command]
pub fn bar_restore_foreground(window: WebviewWindow) -> bool {
    #[cfg(windows)]
    {
        let Some(bar) = hwnd_of(&window) else {
            return false;
        };
        let restored = platform::restore_foreground(bar, NOTED.load(Ordering::Relaxed));
        if restored {
            log::info!("bar: a click took the foreground; handed back to the app in front before it");
        }
        restored
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        false
    }
}

/// Starts a drag of the bar and sends `bar-drag-end` when the button is released.
#[tauri::command]
pub fn bar_drag(window: WebviewWindow) -> Result<(), String> {
    if window.label() != LABEL {
        return Err("only the bar drags itself".into());
    }
    window.start_dragging().map_err(|e| e.to_string())?;
    let mut slot = DRAG.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(stop) = slot.take() {
        stop.store(true, Ordering::Relaxed);
    }
    let stop = Arc::new(AtomicBool::new(false));
    *slot = Some(stop.clone());
    drop(slot);
    let app = window.app_handle().clone();
    let spawned = std::thread::Builder::new().name("bar-drag".into()).spawn(move || {
        let started = Instant::now();
        // The move loop starts a moment after the call.
        std::thread::sleep(Duration::from_millis(60));
        while !stop.load(Ordering::Relaxed) && started.elapsed() < DRAG_LIMIT {
            if !platform::primary_button_down() {
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        if stop.load(Ordering::Relaxed) {
            return; // a newer drag took over
        }
        // Let the last move land before the page reads the position.
        std::thread::sleep(Duration::from_millis(60));
        let _ = app.emit_to(LABEL, "bar-drag-end", ());
    });
    spawned.map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(windows)]
mod platform {
    use super::Aside;

    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    #[repr(C)]
    struct MonitorInfo {
        size: u32,
        monitor: Rect,
        work: Rect,
        flags: u32,
    }

    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetForegroundWindow() -> isize;
        fn SetForegroundWindow(hwnd: isize) -> i32;
        fn IsWindow(hwnd: isize) -> i32;
        fn IsIconic(hwnd: isize) -> i32;
        fn IsZoomed(hwnd: isize) -> i32;
        fn GetWindowRect(hwnd: isize, rect: *mut Rect) -> i32;
        fn GetClassNameW(hwnd: isize, buf: *mut u16, max: i32) -> i32;
        fn MonitorFromWindow(hwnd: isize, flags: u32) -> isize;
        fn GetMonitorInfoW(monitor: isize, info: *mut MonitorInfo) -> i32;
        fn SetWindowPos(hwnd: isize, after: isize, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
        fn SetWindowDisplayAffinity(hwnd: isize, affinity: u32) -> i32;
        fn GetAsyncKeyState(key: i32) -> i16;
        fn GetSystemMetrics(index: i32) -> i32;
    }

    const MONITOR_DEFAULTTONULL: u32 = 0;
    const MONITOR_DEFAULTTONEAREST: u32 = 2;
    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const SWP_NOOWNERZORDER: u32 = 0x0200;
    const WDA_NONE: u32 = 0;
    const WDA_EXCLUDEFROMCAPTURE: u32 = 0x0000_0011;
    const VK_LBUTTON: i32 = 0x01;
    const VK_RBUTTON: i32 = 0x02;
    const SM_SWAPBUTTON: i32 = 23;

    fn rect(hwnd: isize) -> Option<Rect> {
        let mut r = Rect::default();
        (unsafe { GetWindowRect(hwnd, &mut r) } != 0).then_some(r)
    }

    fn class_name(hwnd: isize) -> String {
        let mut buf = [0u16; 64];
        let n = unsafe { GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
        if n <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buf[..n as usize])
    }

    /// The desktop and the taskbars: in front after a click on them, never "full screen".
    fn is_shell(hwnd: isize) -> bool {
        matches!(class_name(hwnd).as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd")
    }

    pub(super) fn overlaps(a: (i32, i32, i32, i32), b: (i32, i32, i32, i32)) -> bool {
        a.0 < b.2 && b.0 < a.2 && a.1 < b.3 && b.1 < a.3
    }

    /// A window covers the whole monitor, the taskbar included.
    pub(super) fn covers(window: (i32, i32, i32, i32), monitor: (i32, i32, i32, i32)) -> bool {
        window.0 <= monitor.0 && window.1 <= monitor.1 && window.2 >= monitor.2 && window.3 >= monitor.3
    }

    fn tuple(r: Rect) -> (i32, i32, i32, i32) {
        (r.left, r.top, r.right, r.bottom)
    }

    pub fn aside(bar: isize, main: Option<isize>) -> Option<Aside> {
        let front = unsafe { GetForegroundWindow() };
        if front == 0 || front == bar {
            return None;
        }
        if Some(front) == main {
            if unsafe { IsIconic(front) } != 0 {
                return None;
            }
            return overlaps(tuple(rect(front)?), tuple(rect(bar)?)).then_some(Aside::Main);
        }
        // A maximised window stops at the taskbar; full screen covers it (a
        // video, a slideshow, a game — an exclusive-mode one too, whose display
        // mode is the monitor's rectangle while it runs). An auto-hidden
        // taskbar makes the two the same size, which is why the maximised
        // state is asked rather than measured.
        if unsafe { IsZoomed(front) } != 0 || is_shell(front) {
            return None;
        }
        let monitor = unsafe { MonitorFromWindow(front, MONITOR_DEFAULTTONULL) };
        if monitor == 0 || monitor != unsafe { MonitorFromWindow(bar, MONITOR_DEFAULTTONEAREST) } {
            return None;
        }
        let mut info = MonitorInfo {
            size: std::mem::size_of::<MonitorInfo>() as u32,
            monitor: Rect::default(),
            work: Rect::default(),
            flags: 0,
        };
        if unsafe { GetMonitorInfoW(monitor, &mut info) } == 0 {
            return None;
        }
        covers(tuple(rect(front)?), tuple(info.monitor)).then_some(Aside::Fullscreen)
    }

    pub fn foreground() -> isize {
        unsafe { GetForegroundWindow() }
    }

    pub fn restore_foreground(bar: isize, noted: isize) -> bool {
        let front = unsafe { GetForegroundWindow() };
        if front != bar || noted == 0 || noted == bar || unsafe { IsWindow(noted) } == 0 {
            return false;
        }
        unsafe { SetForegroundWindow(noted) != 0 }
    }

    pub fn set_bounds(hwnd: isize, x: i32, y: i32, width: i32, height: i32) -> bool {
        unsafe { SetWindowPos(hwnd, 0, x, y, width, height, SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER) != 0 }
    }

    pub fn exclude_from_capture(hwnd: isize, exclude: bool) -> bool {
        let affinity = if exclude { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE };
        unsafe { SetWindowDisplayAffinity(hwnd, affinity) != 0 }
    }

    /// The button that drags: the left one, or the right one when they are swapped.
    pub fn primary_button_down() -> bool {
        let key = if unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0 { VK_RBUTTON } else { VK_LBUTTON };
        (unsafe { GetAsyncKeyState(key) } as u16) & 0x8000 != 0
    }
}

#[cfg(not(windows))]
mod platform {
    /// Elsewhere the move loop returns only when the drag is over.
    pub fn primary_button_down() -> bool {
        false
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::platform::{covers, overlaps};

    #[test]
    fn full_screen_means_the_whole_monitor() {
        let monitor = (0, 0, 1920, 1080);
        assert!(covers((0, 0, 1920, 1080), monitor));
        // Games and players often overhang by a few pixels.
        assert!(covers((-8, -8, 1928, 1088), monitor));
        // A window that stops at the taskbar is not full screen.
        assert!(!covers((0, 0, 1920, 1032), monitor));
        // Full screen on the other monitor is not in front of this one.
        assert!(!covers((-2560, 0, 0, 1440), monitor));
    }

    #[test]
    fn the_owntools_window_only_counts_when_it_covers_the_bar() {
        let bar = (915, 994, 1005, 1022);
        assert!(overlaps((0, 0, 1920, 1032), bar));
        assert!(!overlaps((320, 140, 1600, 940), bar));
        // Touching edges do not overlap.
        assert!(!overlaps((0, 0, 1920, 994), bar));
    }
}
