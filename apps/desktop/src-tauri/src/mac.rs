//! The macOS half of the things Windows does through `user32`: typing a
//! transcript into whatever application is in front, asking for the
//! permission that requires, and keeping the recorder bar out of the
//! recording.
//!
//! Everything here talks to the system frameworks directly rather than
//! through an Objective-C crate: it is three selectors and four C functions,
//! and a binding crate would be a much larger surface than the code it saves.
//!
//! Two TCC permissions matter, and both are silent failures if you do not
//! check for them, which is why each has a command of its own:
//!
//!   **Accessibility** — required to post keyboard events into another app.
//!       Without it `CGEventPost` succeeds and nothing is typed.
//!   **Input Monitoring** — required to *read* the keyboard, which only the
//!       editor's optional key-timing track wants (`input_track.rs`).
//!
//! Screen recording is asked for by WebKit itself the first time
//! `getDisplayMedia` runs, so it needs nothing here beyond the usage strings
//! in `Info.plist`.

#![cfg(target_os = "macos")]

use std::ffi::{c_void, CString};

use tauri::{Manager, WebviewWindow};

// ---------------------------------------------------------------------------
// Core Graphics / Application Services
// ---------------------------------------------------------------------------

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventCreateKeyboardEvent(source: *const c_void, keycode: u16, key_down: bool)
        -> *mut c_void;
    fn CGEventKeyboardSetUnicodeString(event: *mut c_void, length: usize, string: *const u16);
    fn CGEventPost(tap: u32, event: *mut c_void);
}

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
}

// The CoreFoundation globals keep their C names, which are not Rust's.
#[allow(non_upper_case_globals)]
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(cf: *mut c_void);
    fn CFDictionaryCreate(
        allocator: *const c_void,
        keys: *const *const c_void,
        values: *const *const c_void,
        count: isize,
        key_callbacks: *const c_void,
        value_callbacks: *const c_void,
    ) -> *mut c_void;
    static kCFTypeDictionaryKeyCallBacks: c_void;
    static kCFTypeDictionaryValueCallBacks: c_void;
    static kCFBooleanTrue: *const c_void;
    fn CFStringCreateWithCString(
        allocator: *const c_void,
        c_str: *const std::ffi::c_char,
        encoding: u32,
    ) -> *mut c_void;
}

/// Posting at the HID level is what a real keyboard does, so applications that
/// filter on the event tap still see the keystrokes.
const K_CG_HID_EVENT_TAP: u32 = 0;
const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

/// `CGEventKeyboardSetUnicodeString` does not promise to carry an arbitrarily
/// long string; Apple's own sample code keeps it short, and long strings are
/// known to be truncated. 16 UTF-16 units per event is well inside that.
const UNITS_PER_EVENT: usize = 16;

/// Types text into the frontmost application. Requires Accessibility.
pub fn type_text(text: &str) -> Result<(), String> {
    if !is_trusted() {
        return Err(
            "macOS has not given owntools permission to type into other apps. \
             Open System Settings → Privacy & Security → Accessibility and switch owntools on."
                .into(),
        );
    }
    let units: Vec<u16> = text.encode_utf16().collect();
    if units.is_empty() {
        return Ok(());
    }
    for chunk in units.chunks(UNITS_PER_EVENT) {
        unsafe {
            // Keycode 0 with a unicode string attached: the character is
            // carried by the string, not by the (meaningless) key code.
            for down in [true, false] {
                let event = CGEventCreateKeyboardEvent(std::ptr::null(), 0, down);
                if event.is_null() {
                    return Err("macOS refused to create a keyboard event.".into());
                }
                CGEventKeyboardSetUnicodeString(event, chunk.len(), chunk.as_ptr());
                CGEventPost(K_CG_HID_EVENT_TAP, event);
                CFRelease(event);
            }
        }
        // The same pacing as the Windows path: applications with their own
        // input queues drop characters that arrive faster than this.
        std::thread::sleep(std::time::Duration::from_millis(4));
    }
    Ok(())
}

/// Whether this process may post events into other applications.
pub fn is_trusted() -> bool {
    unsafe { AXIsProcessTrusted() }
}

/// Same question, but macOS shows its "open System Settings?" sheet when the
/// answer is no. Only ever called from an explicit user action, because the
/// prompt appears once per app and is easy to waste.
pub fn request_trust() -> bool {
    unsafe {
        let key = CString::new("AXTrustedCheckOptionPrompt").unwrap();
        let key_string = CFStringCreateWithCString(
            std::ptr::null(),
            key.as_ptr(),
            K_CF_STRING_ENCODING_UTF8,
        );
        if key_string.is_null() {
            return AXIsProcessTrusted();
        }
        let keys = [key_string as *const c_void];
        let values = [kCFBooleanTrue];
        let options = CFDictionaryCreate(
            std::ptr::null(),
            keys.as_ptr(),
            values.as_ptr(),
            1,
            &kCFTypeDictionaryKeyCallBacks,
            &kCFTypeDictionaryValueCallBacks,
        );
        let trusted = AXIsProcessTrustedWithOptions(options);
        if !options.is_null() {
            CFRelease(options);
        }
        CFRelease(key_string);
        trusted
    }
}

// ---------------------------------------------------------------------------
// Keeping a window out of screen captures
// ---------------------------------------------------------------------------

#[link(name = "objc", kind = "dylib")]
unsafe extern "C" {
    fn sel_registerName(name: *const std::ffi::c_char) -> *const c_void;
    fn objc_msgSend();
}

/// `NSWindowSharingNone` — the window is not shared with screen capture.
/// `NSWindowSharingType` is an `NSUInteger`.
const NS_WINDOW_SHARING_NONE: u64 = 0;

/// The macOS answer to `WDA_EXCLUDEFROMCAPTURE`: a window whose sharing type
/// is "none" is skipped by the capture APIs, so the recorder's own bar never
/// lands in the take it is controlling.
///
/// `sharingType` is soft-deprecated in favour of ScreenCaptureKit's content
/// filters, which only the *capturer* can set — and here the capturer is
/// WebKit's `getDisplayMedia`, not us. This is the lever we have.
pub fn exclude_from_capture(window: &WebviewWindow) -> bool {
    let Ok(ns_window) = window.ns_window() else {
        return false;
    };
    if ns_window.is_null() {
        return false;
    }
    unsafe {
        let selector = CString::new("setSharingType:").unwrap();
        let sel = sel_registerName(selector.as_ptr());
        if sel.is_null() {
            return false;
        }
        // objc_msgSend is variadic in its declaration and must be called
        // through a signature that matches the selector exactly.
        let send: extern "C" fn(*mut c_void, *const c_void, u64) =
            std::mem::transmute(objc_msgSend as *const ());
        send(ns_window, sel, NS_WINDOW_SHARING_NONE);
    }
    true
}

/// Applies it to the recorder overlay, once, at start-up.
pub fn shield_recorder(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("recorder") else {
        return;
    };
    if exclude_from_capture(&window) {
        log::info!("recorder overlay excluded from screen capture (NSWindowSharingNone)");
    } else {
        log::warn!("recorder overlay could not be excluded from capture; it may show in full-screen takes");
    }
}
