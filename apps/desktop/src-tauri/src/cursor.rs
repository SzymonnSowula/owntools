use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct CursorState {
    pub x: f64,
    pub y: f64,
    pub down: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScreenSize {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[cfg(windows)]
mod platform {
    use super::{CursorState, ScreenSize};

    #[repr(C)]
    struct Point {
        x: i32,
        y: i32,
    }

    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetCursorPos(lp_point: *mut Point) -> i32;
        fn GetAsyncKeyState(v_key: i32) -> i16;
        fn GetSystemMetrics(n_index: i32) -> i32;
    }

    const VK_LBUTTON: i32 = 0x01;
    const SM_XVIRTUALSCREEN: i32 = 76;
    const SM_YVIRTUALSCREEN: i32 = 77;
    const SM_CXVIRTUALSCREEN: i32 = 78;
    const SM_CYVIRTUALSCREEN: i32 = 79;

    pub fn cursor() -> Result<CursorState, String> {
        let mut point = Point { x: 0, y: 0 };
        unsafe {
            if GetCursorPos(&mut point) == 0 {
                return Err("GetCursorPos failed".into());
            }
            let down = (GetAsyncKeyState(VK_LBUTTON) as u16) & 0x8000 != 0;
            Ok(CursorState {
                x: point.x as f64,
                y: point.y as f64,
                down,
            })
        }
    }

    pub fn screen() -> ScreenSize {
        unsafe {
            ScreenSize {
                x: GetSystemMetrics(SM_XVIRTUALSCREEN) as f64,
                y: GetSystemMetrics(SM_YVIRTUALSCREEN) as f64,
                width: GetSystemMetrics(SM_CXVIRTUALSCREEN) as f64,
                height: GetSystemMetrics(SM_CYVIRTUALSCREEN) as f64,
            }
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    //! Quartz reports the pointer in *points*, which on a Retina display are
    //! half the size of a pixel. Tauri (and therefore `capture.rs`) reports
    //! monitors in physical pixels, because tao multiplies each screen's frame
    //! by its backing scale factor. Mixing the two put the drawn pointer at
    //! half its true offset on every Mac with a Retina screen — the macOS
    //! version of the two-monitor bug the editor already carries scars from.
    //!
    //! Since tao scales a screen's *origin* by that same screen's factor, the
    //! conversion collapses to one multiplication: a global point on a display
    //! whose backing scale is `s` sits at `point * s` in the pixel space the
    //! rest of the app speaks. `scale_at` finds `s` for the display the
    //! pointer is on.

    use super::{CursorState, ScreenSize};
    use std::ffi::c_void;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGPoint {
        x: f64,
        y: f64,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGSize {
        width: f64,
        height: f64,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGRect {
        origin: CGPoint,
        size: CGSize,
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGEventCreate(source: *const c_void) -> *mut c_void;
        fn CGEventGetLocation(event: *mut c_void) -> CGPoint;
        fn CGEventSourceButtonState(state_id: u32, button: u32) -> bool;
        fn CGGetActiveDisplayList(max: u32, displays: *mut u32, count: *mut u32) -> i32;
        fn CGDisplayBounds(display: u32) -> CGRect;
        fn CGDisplayCopyDisplayMode(display: u32) -> *mut c_void;
        fn CGDisplayModeGetWidth(mode: *mut c_void) -> usize;
        fn CGDisplayModeGetPixelWidth(mode: *mut c_void) -> usize;
        fn CGDisplayModeRelease(mode: *mut c_void);
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFRelease(cf: *mut c_void);
    }

    const HID_SYSTEM_STATE: u32 = 1;
    const LEFT_BUTTON: u32 = 0;
    const MAX_DISPLAYS: usize = 16;

    fn displays() -> Vec<u32> {
        let mut ids = [0u32; MAX_DISPLAYS];
        let mut count = 0u32;
        let ok = unsafe {
            CGGetActiveDisplayList(MAX_DISPLAYS as u32, ids.as_mut_ptr(), &mut count)
        };
        if ok != 0 {
            return Vec::new();
        }
        ids[..count as usize].to_vec()
    }

    /// Backing scale of one display: the current mode's pixel width over its
    /// width in points. 1.0 on a plain external screen, 2.0 on a Retina one,
    /// and the true fractional value in a scaled mode.
    fn scale_of(display: u32) -> f64 {
        unsafe {
            let mode = CGDisplayCopyDisplayMode(display);
            if mode.is_null() {
                return 1.0;
            }
            let points = CGDisplayModeGetWidth(mode) as f64;
            let pixels = CGDisplayModeGetPixelWidth(mode) as f64;
            CGDisplayModeRelease(mode);
            if points > 0.0 && pixels > 0.0 {
                pixels / points
            } else {
                1.0
            }
        }
    }

    fn contains(rect: CGRect, x: f64, y: f64) -> bool {
        x >= rect.origin.x
            && y >= rect.origin.y
            && x < rect.origin.x + rect.size.width
            && y < rect.origin.y + rect.size.height
    }

    /// The scale that applies at a global point. Falls back to the main
    /// display when the pointer is between screens (it briefly can be).
    fn scale_at(x: f64, y: f64) -> f64 {
        let ids = displays();
        for id in &ids {
            if contains(unsafe { CGDisplayBounds(*id) }, x, y) {
                return scale_of(*id);
            }
        }
        ids.first().map(|id| scale_of(*id)).unwrap_or(1.0)
    }

    pub fn cursor() -> Result<CursorState, String> {
        unsafe {
            let event = CGEventCreate(std::ptr::null());
            if event.is_null() {
                return Err("CGEventCreate failed".into());
            }
            let point = CGEventGetLocation(event);
            CFRelease(event);
            // CGEventGetLocation already reports global *display* coordinates,
            // which have a top-left origin — the same convention as a video
            // frame. Flipping it, as this used to, mirrored every recording
            // about the middle of the screen.
            let scale = scale_at(point.x, point.y);
            let down = CGEventSourceButtonState(HID_SYSTEM_STATE, LEFT_BUTTON);
            Ok(CursorState {
                x: point.x * scale,
                y: point.y * scale,
                down,
            })
        }
    }

    /// The whole desktop in physical pixels — the union of every display's
    /// bounds, each scaled by its own factor, which is exactly the rectangle
    /// Tauri's monitor list describes.
    pub fn screen() -> ScreenSize {
        let ids = displays();
        if ids.is_empty() {
            return ScreenSize { x: 0.0, y: 0.0, width: 1920.0, height: 1080.0 };
        }
        let (mut left, mut top) = (f64::MAX, f64::MAX);
        let (mut right, mut bottom) = (f64::MIN, f64::MIN);
        for id in ids {
            let bounds = unsafe { CGDisplayBounds(id) };
            let scale = scale_of(id);
            left = left.min(bounds.origin.x * scale);
            top = top.min(bounds.origin.y * scale);
            right = right.max((bounds.origin.x + bounds.size.width) * scale);
            bottom = bottom.max((bounds.origin.y + bounds.size.height) * scale);
        }
        ScreenSize {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
        }
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod platform {
    use super::{CursorState, ScreenSize};

    pub fn cursor() -> Result<CursorState, String> {
        Ok(CursorState {
            x: 0.0,
            y: 0.0,
            down: false,
        })
    }

    pub fn screen() -> ScreenSize {
        ScreenSize {
            x: 0.0,
            y: 0.0,
            width: 1920.0,
            height: 1080.0,
        }
    }
}

#[tauri::command]
pub fn get_cursor() -> Result<CursorState, String> {
    platform::cursor()
}

#[tauri::command]
pub fn get_screen_size() -> ScreenSize {
    platform::screen()
}
