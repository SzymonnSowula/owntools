//! A hidden window tells its web view that it is hidden.
//!
//! Tauri hides a window by hiding the native window only: the WebView2
//! controller inside keeps `IsVisible = true`, so Chromium goes on treating the
//! page as on screen — raster tiles, caches and all — for as long as the window
//! sits in the tray. Microsoft's guidance for hosts is to mirror the window's
//! state into `IsVisible` ("there are CPU and memory benefits when the page is
//! hidden… WebView2 will purge some caches"), and `MemoryUsageTargetLevel::Low`
//! is the documented knob for an inactive app that must keep running scripts.
//!
//! That is exactly the main window's situation — the social runner, automations,
//! sync and the focus timer live there, and it spends hours in the tray — and
//! the dictation pill's, hidden between takes. So for those two (the on-demand
//! windows of overlays.rs only exist while they are needed): hidden or
//! minimised → `IsVisible = false` + target level Low; shown → the reverse.
//! Scripts keep
//! running. `additionalBrowserArgs` switches off `IntensiveWakeUpThrottling`,
//! so a hidden page still gets a timer wake-up every second rather than once a
//! minute after five minutes — a pomodoro must not end a minute late. Audible
//! pages (the ambient records) are never throttled by Chromium in the first
//! place.
//!
//! The state is followed from the window procedure (`WM_WINDOWPOSCHANGED` with
//! `SWP_SHOWWINDOW` / `SWP_HIDEWINDOW`, `WM_SIZE` for minimise and restore), so
//! every way a window is shown or hidden counts — Rust, JavaScript, the tray.
//!
//! `OWNTOOLS_WEBVIEW_IDLE=off` leaves the web views alone, `visible` mirrors the
//! visibility without touching the memory target; anything else (the default)
//! does both. A switch for measuring, and for ruling this out.

use tauri::WebviewWindow;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode {
    Off,
    Visible,
    VisibleAndLow,
}

fn mode_from(value: Option<&str>) -> Mode {
    match value.map(|v| v.trim().to_ascii_lowercase()).as_deref() {
        Some("off" | "0" | "false") => Mode::Off,
        Some("visible") => Mode::Visible,
        _ => Mode::VisibleAndLow,
    }
}

fn mode() -> Mode {
    static MODE: std::sync::OnceLock<Mode> = std::sync::OnceLock::new();
    *MODE.get_or_init(|| mode_from(std::env::var("OWNTOOLS_WEBVIEW_IDLE").ok().as_deref()))
}

/// Starts mirroring the window's visibility into its web view. Once per window.
#[cfg(windows)]
pub fn attach(window: &WebviewWindow) {
    let mode = mode();
    if mode == Mode::Off {
        return;
    }
    let label = window.label().to_string();
    let hwnd = match window.hwnd() {
        Ok(hwnd) => hwnd.0 as isize,
        Err(e) => {
            log::warn!("[{label}] web view idle: no window handle: {e}");
            return;
        }
    };
    let result = window.with_webview(move |webview| {
        // SAFETY: runs on the thread that owns the window, which is where the
        // subclass procedure will run too; `platform::install` hands the
        // controller's ownership to the subclass, which releases it on
        // WM_NCDESTROY.
        let installed = unsafe { platform::install(hwnd, webview.controller(), mode == Mode::VisibleAndLow) };
        if installed {
            log::info!("[{label}] web view follows the window's visibility");
        } else {
            log::warn!("[{label}] web view idle: subclass not installed");
        }
    });
    if let Err(e) = result {
        log::warn!("web view idle: with_webview failed: {e}");
    }
}

#[cfg(not(windows))]
pub fn attach(_window: &WebviewWindow) {
    let _ = mode;
}

#[cfg(windows)]
mod platform {
    use std::cell::Cell;

    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Controller, ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use windows::core::Interface;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{
        IsIconic, IsWindowVisible, SIZE_MINIMIZED, SWP_HIDEWINDOW, SWP_SHOWWINDOW, WINDOWPOS,
        WM_NCDESTROY, WM_SIZE, WM_WINDOWPOSCHANGED,
    };

    /// "owti" — distinct from wry's own subclass on the same window.
    const SUBCLASS_ID: usize = 0x6f77_7469;

    struct Hook {
        controller: ICoreWebView2Controller,
        lower_memory: bool,
        /// What the web view was last told, so a stream of WM_SIZE during a
        /// resize does not re-issue the same calls.
        visible: Cell<Option<bool>>,
    }

    /// # Safety
    /// Must run on the thread that owns `hwnd`.
    pub unsafe fn install(hwnd: isize, controller: ICoreWebView2Controller, lower_memory: bool) -> bool {
        let hwnd = HWND(hwnd as *mut _);
        let hook = Box::into_raw(Box::new(Hook { controller, lower_memory, visible: Cell::new(None) }));
        // SAFETY: plain Win32 calls on a window owned by this thread; `hook`
        // stays alive until the subclass procedure frees it on WM_NCDESTROY.
        unsafe {
            if !SetWindowSubclass(hwnd, Some(procedure), SUBCLASS_ID, hook as usize).as_bool() {
                drop(Box::from_raw(hook));
                return false;
            }
            apply(&*hook, IsWindowVisible(hwnd).as_bool() && !IsIconic(hwnd).as_bool());
        }
        true
    }

    fn apply(hook: &Hook, visible: bool) {
        if hook.visible.get() == Some(visible) {
            return;
        }
        hook.visible.set(Some(visible));
        // SAFETY: COM calls on the controller's own UI thread.
        unsafe {
            let _ = hook.controller.SetIsVisible(visible);
            if !hook.lower_memory {
                return;
            }
            // ICoreWebView2_19 needs runtime 1.0.2210+; an older one keeps the default.
            if let Ok(core) = hook.controller.CoreWebView2() {
                if let Ok(core) = core.cast::<ICoreWebView2_19>() {
                    let level = if visible {
                        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
                    } else {
                        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                    };
                    let _ = core.SetMemoryUsageTargetLevel(level);
                }
            }
        }
    }

    unsafe extern "system" fn procedure(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        data: usize,
    ) -> LRESULT {
        // SAFETY: `data` is the Box installed above, valid until WM_NCDESTROY
        // frees it (no reference to it is held past that point); `lparam` of
        // WM_WINDOWPOSCHANGED points at a WINDOWPOS.
        unsafe {
            match msg {
                WM_WINDOWPOSCHANGED => {
                    let hook = &*(data as *const Hook);
                    let pos = &*(lparam.0 as *const WINDOWPOS);
                    if pos.flags.contains(SWP_SHOWWINDOW) {
                        apply(hook, !IsIconic(hwnd).as_bool());
                    } else if pos.flags.contains(SWP_HIDEWINDOW) {
                        apply(hook, false);
                    }
                }
                WM_SIZE => {
                    let hook = &*(data as *const Hook);
                    if wparam.0 == SIZE_MINIMIZED as usize {
                        apply(hook, false);
                    } else if IsWindowVisible(hwnd).as_bool() {
                        apply(hook, true);
                    }
                }
                WM_NCDESTROY => {
                    let _ = RemoveWindowSubclass(hwnd, Some(procedure), SUBCLASS_ID);
                    drop(Box::from_raw(data as *mut Hook));
                }
                _ => {}
            }
            DefSubclassProc(hwnd, msg, wparam, lparam)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_switch_reads_like_it_says() {
        assert_eq!(mode_from(None), Mode::VisibleAndLow);
        assert_eq!(mode_from(Some("")), Mode::VisibleAndLow);
        assert_eq!(mode_from(Some("off")), Mode::Off);
        assert_eq!(mode_from(Some(" OFF ")), Mode::Off);
        assert_eq!(mode_from(Some("0")), Mode::Off);
        assert_eq!(mode_from(Some("visible")), Mode::Visible);
        assert_eq!(mode_from(Some("low")), Mode::VisibleAndLow);
    }
}
