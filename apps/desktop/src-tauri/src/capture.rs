//! What a recording actually shows.
//!
//! `getDisplayMedia` hands back pixels and nothing else: the browser never
//! says which monitor or window the user picked. The cursor, on the other
//! hand, is sampled in virtual-desktop coordinates. Without the recorded
//! surface's rectangle those two live in different spaces, and any pointer we
//! draw lands somewhere else entirely — on a two-monitor desk the error is the
//! width of the other screen.
//!
//! So we enumerate what *could* have been recorded — every monitor, every
//! visible top-level window — with rectangles in the same virtual-desktop
//! pixels the cursor uses, and let the frontend match the capture's size
//! against that list.
//!
//! Window rectangles come from `DWMWA_EXTENDED_FRAME_BOUNDS`, not
//! `GetWindowRect`: the latter includes the invisible resize border (a
//! maximized window reports 2568x1400 for a 2560x1392 work area), while the
//! DWM bounds are exactly the pixels a window capture contains.

use serde::Serialize;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub id: String,
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale: f64,
    pub primary: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    /// Native handle as a decimal string; `capture_window_rect` takes it back.
    pub id: String,
    pub title: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub foreground: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplaySources {
    pub monitors: Vec<MonitorInfo>,
    pub windows: Vec<WindowInfo>,
    /// The whole virtual desktop, for reference and as a last-resort denominator.
    pub virtual_screen: CaptureRect,
}

fn monitors(app: &AppHandle) -> Vec<MonitorInfo> {
    let primary = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| (m.position().x, m.position().y));
    let list = match app.available_monitors() {
        Ok(list) => list,
        Err(err) => {
            log::warn!("could not enumerate monitors: {err}");
            return Vec::new();
        }
    };
    list.into_iter()
        .enumerate()
        .map(|(i, m)| {
            let pos = *m.position();
            let size = *m.size();
            MonitorInfo {
                id: format!("monitor:{i}"),
                name: m.name().cloned().unwrap_or_else(|| format!("Display {}", i + 1)),
                x: pos.x as f64,
                y: pos.y as f64,
                width: size.width as f64,
                height: size.height as f64,
                scale: m.scale_factor(),
                primary: primary == Some((pos.x, pos.y)),
            }
        })
        .collect()
}

#[cfg(windows)]
mod platform {
    use super::{CaptureRect, WindowInfo};
    use std::ffi::c_void;

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
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
        fn IsIconic(hwnd: isize) -> i32;
        fn IsWindow(hwnd: isize) -> i32;
        fn GetWindowRect(hwnd: isize, rect: *mut Rect) -> i32;
        fn GetWindowTextW(hwnd: isize, buf: *mut u16, max: i32) -> i32;
        fn GetWindowTextLengthW(hwnd: isize) -> i32;
        fn GetForegroundWindow() -> isize;
        fn GetWindowLongW(hwnd: isize, index: i32) -> i32;
    }

    #[link(name = "dwmapi")]
    unsafe extern "system" {
        fn DwmGetWindowAttribute(hwnd: isize, attr: u32, out: *mut c_void, size: u32) -> i32;
    }

    const GWL_EXSTYLE: i32 = -20;
    const WS_EX_TOOLWINDOW: i32 = 0x0000_0080;
    const DWMWA_CLOAKED: u32 = 14;
    const DWMWA_EXTENDED_FRAME_BOUNDS: u32 = 9;
    /// Anything smaller is a tooltip, a splash or a stray helper — never a take.
    const MIN_SIDE: i32 = 160;

    extern "system" fn collect(hwnd: isize, lparam: isize) -> i32 {
        // SAFETY: lparam is the &mut Vec we passed to EnumWindows, alive for the call.
        let out = unsafe { &mut *(lparam as *mut Vec<isize>) };
        out.push(hwnd);
        1
    }

    fn title_of(hwnd: isize) -> String {
        unsafe {
            let len = GetWindowTextLengthW(hwnd);
            if len <= 0 {
                return String::new();
            }
            let mut buf = vec![0u16; len as usize + 1];
            let written = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
            if written <= 0 {
                return String::new();
            }
            String::from_utf16_lossy(&buf[..written as usize])
        }
    }

    fn is_cloaked(hwnd: isize) -> bool {
        let mut cloaked: u32 = 0;
        let ok = unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_CLOAKED,
                &mut cloaked as *mut u32 as *mut c_void,
                std::mem::size_of::<u32>() as u32,
            )
        };
        ok == 0 && cloaked != 0
    }

    /// The pixels a window capture of `hwnd` contains, or None if it has none.
    pub fn window_rect(hwnd: isize) -> Option<CaptureRect> {
        if unsafe { IsWindow(hwnd) } == 0 {
            return None;
        }
        let mut rect = Rect::default();
        let dwm = unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                &mut rect as *mut Rect as *mut c_void,
                std::mem::size_of::<Rect>() as u32,
            )
        };
        if dwm != 0 {
            // Pre-DWM or a window that refuses the query: the outer rect is all we have.
            if unsafe { GetWindowRect(hwnd, &mut rect) } == 0 {
                return None;
            }
        }
        let width = (rect.right - rect.left) as f64;
        let height = (rect.bottom - rect.top) as f64;
        if width <= 0.0 || height <= 0.0 {
            return None;
        }
        Some(CaptureRect {
            x: rect.left as f64,
            y: rect.top as f64,
            width,
            height,
        })
    }

    pub fn windows() -> Vec<WindowInfo> {
        let mut handles: Vec<isize> = Vec::new();
        unsafe {
            EnumWindows(collect, &mut handles as *mut Vec<isize> as isize);
        }
        let foreground = unsafe { GetForegroundWindow() };
        let mut out = Vec::new();
        for hwnd in handles {
            if unsafe { IsWindowVisible(hwnd) } == 0 || unsafe { IsIconic(hwnd) } != 0 {
                continue;
            }
            if unsafe { GetWindowLongW(hwnd, GWL_EXSTYLE) } & WS_EX_TOOLWINDOW != 0 {
                continue;
            }
            if is_cloaked(hwnd) {
                continue;
            }
            let title = title_of(hwnd);
            if title.is_empty() {
                continue;
            }
            let Some(rect) = window_rect(hwnd) else { continue };
            if rect.width < MIN_SIDE as f64 || rect.height < MIN_SIDE as f64 {
                continue;
            }
            out.push(WindowInfo {
                id: hwnd.to_string(),
                title,
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                foreground: hwnd == foreground,
            });
        }
        out
    }
}

#[cfg(not(windows))]
mod platform {
    use super::{CaptureRect, WindowInfo};

    /// Window geometry needs per-platform work; monitors alone still align a
    /// full-screen take, which is the case the editor asks for anyway.
    pub fn windows() -> Vec<WindowInfo> {
        Vec::new()
    }

    pub fn window_rect(_id: isize) -> Option<CaptureRect> {
        None
    }
}

#[tauri::command]
pub fn list_display_sources(app: AppHandle) -> DisplaySources {
    let screen = crate::cursor::get_screen_size();
    DisplaySources {
        monitors: monitors(&app),
        windows: platform::windows(),
        virtual_screen: CaptureRect {
            x: screen.x,
            y: screen.y,
            width: screen.width,
            height: screen.height,
        },
    }
}

/// Re-reads one window's rectangle, so a take can follow a window that is
/// moved or resized while it records.
#[tauri::command]
pub fn capture_window_rect(id: String) -> Option<CaptureRect> {
    let handle: isize = id.parse().ok()?;
    platform::window_rect(handle)
}
