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
    use super::{CursorState, ScreenSize};
    use std::ffi::c_void;

    #[repr(C)]
    struct CGPoint {
        x: f64,
        y: f64,
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGEventCreate(source: *const c_void) -> *mut c_void;
        fn CGEventGetLocation(event: *mut c_void) -> CGPoint;
        fn CGEventSourceButtonState(state_id: u32, button: u32) -> bool;
        fn CGMainDisplayID() -> u32;
        fn CGDisplayPixelsWide(display: u32) -> usize;
        fn CGDisplayPixelsHigh(display: u32) -> usize;
        fn CGDisplayBounds(display: u32) -> CGRect;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFRelease(cf: *mut c_void);
    }

    #[repr(C)]
    struct CGRect {
        origin: CGPoint,
        size: CGSize,
    }

    #[repr(C)]
    struct CGSize {
        width: f64,
        height: f64,
    }

    const HID_SYSTEM_STATE: u32 = 1;
    const LEFT_BUTTON: u32 = 0;

    pub fn cursor() -> Result<CursorState, String> {
        unsafe {
            let event = CGEventCreate(std::ptr::null());
            if event.is_null() {
                return Err("CGEventCreate failed".into());
            }
            let point = CGEventGetLocation(event);
            CFRelease(event);
            let display = CGMainDisplayID();
            let bounds = CGDisplayBounds(display);
            // Quartz origin is bottom-left; Screeni uses top-left like video frames.
            let y = bounds.origin.y + bounds.size.height - point.y;
            let down = CGEventSourceButtonState(HID_SYSTEM_STATE, LEFT_BUTTON);
            Ok(CursorState {
                x: point.x,
                y,
                down,
            })
        }
    }

    pub fn screen() -> ScreenSize {
        unsafe {
            let display = CGMainDisplayID();
            let bounds = CGDisplayBounds(display);
            ScreenSize {
                x: bounds.origin.x,
                y: 0.0,
                width: CGDisplayPixelsWide(display) as f64,
                height: CGDisplayPixelsHigh(display) as f64,
            }
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
