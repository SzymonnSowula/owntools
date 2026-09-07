//! Click and key timing for the editor's sound effects.
//!
//! The recorder polls the pointer over IPC every 33 ms, which is fine for a
//! position but coarse for a click: a press lands up to a frame late and a
//! quick double-click can collapse into one. This module polls the mouse
//! buttons and the keyboard from a thread of its own at 250 Hz for the length
//! of a take — no hooks (see `scroll_guard.rs` for why those are a last
//! resort), just `GetAsyncKeyState`, the call the cursor sampler already
//! makes for the left button — and stamps every edge in-process.
//!
//! Privacy: a key event records *when* a key went down and what sort of key
//! it was — a letter/digit/symbol, the space bar, enter, backspace or a
//! modifier — and never which one. That is exactly what a typing sound needs
//! (a space bar thocks lower than a letter) and nothing a keylogger wants.
//! Nothing is written to disk here; the events go back to the recorder
//! window when the take stops and end up in the project's own JSON.
//!
//! Windows reports the *physical* left and right buttons here regardless of
//! the "swap buttons" setting, so a left-handed setup hears its primary click
//! as a right click. Cosmetic, and the editor can turn right clicks off.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Instant;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum InputEvent {
    Button {
        /// Milliseconds since the sampler started.
        t: f64,
        button: &'static str,
        down: bool,
        x: f64,
        y: f64,
    },
    Key {
        t: f64,
        kind: &'static str,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputTrackResult {
    pub events: Vec<InputEvent>,
    /// Sampling rate, Hz.
    pub rate: u32,
    /// True when the take outgrew the event budget and the tail was dropped.
    pub dropped: bool,
}

struct Session {
    stop: Arc<AtomicBool>,
    handle: JoinHandle<Vec<InputEvent>>,
}

static SESSION: Mutex<Option<Session>> = Mutex::new(None);

const RATE_HZ: u32 = 250;
/// A few hours of frantic typing; anything past it is not a screencast.
const MAX_EVENTS: usize = 200_000;

/// Starts sampling. A session already running is stopped and thrown away first.
#[tauri::command]
pub fn input_track_start() -> Result<(), String> {
    let mut slot = SESSION.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(old) = slot.take() {
        old.stop.store(true, Ordering::Relaxed);
        let _ = old.handle.join();
    }
    let stop = Arc::new(AtomicBool::new(false));
    let flag = stop.clone();
    let started = Instant::now();
    let handle = std::thread::Builder::new()
        .name("input-track".into())
        .spawn(move || platform::run(started, flag))
        .map_err(|e| format!("input track thread: {e}"))?;
    *slot = Some(Session { stop, handle });
    log::info!("input track started");
    Ok(())
}

/// Stops sampling and hands back everything seen since `input_track_start`.
#[tauri::command]
pub fn input_track_stop() -> InputTrackResult {
    let session = SESSION.lock().unwrap_or_else(|e| e.into_inner()).take();
    let Some(session) = session else {
        return InputTrackResult {
            events: Vec::new(),
            rate: RATE_HZ,
            dropped: false,
        };
    };
    session.stop.store(true, Ordering::Relaxed);
    let events = session.handle.join().unwrap_or_default();
    let dropped = events.len() >= MAX_EVENTS;
    log::info!("input track stopped: {} events{}", events.len(), if dropped { " (budget hit)" } else { "" });
    InputTrackResult {
        events,
        rate: RATE_HZ,
        dropped,
    }
}

#[cfg(windows)]
mod platform {
    use super::{InputEvent, MAX_EVENTS, RATE_HZ};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    #[repr(C)]
    struct Point {
        x: i32,
        y: i32,
    }

    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetCursorPos(lp_point: *mut Point) -> i32;
        fn GetAsyncKeyState(v_key: i32) -> i16;
    }

    // A 4 ms sleep is a 15.6 ms sleep unless the timer resolution is raised;
    // raised for the take only, the way media players and games do it.
    #[link(name = "winmm")]
    unsafe extern "system" {
        fn timeBeginPeriod(u_period: u32) -> u32;
        fn timeEndPeriod(u_period: u32) -> u32;
    }

    const BUTTONS: [(i32, &str); 3] = [(0x01, "left"), (0x02, "right"), (0x04, "middle")];

    fn is_down(vk: i32) -> bool {
        (unsafe { GetAsyncKeyState(vk) } as u16) & 0x8000 != 0
    }

    /// The sort of key a virtual-key code is, or None for codes that are not
    /// keys someone types on: mouse buttons, IME states, media keys, unassigned
    /// and OEM-specific ranges. The generic VK_SHIFT/CONTROL/MENU codes are
    /// skipped in favour of their left/right variants, which report the same
    /// press once.
    fn key_kind(vk: i32) -> Option<&'static str> {
        match vk {
            0x20 => Some("space"),
            0x0D => Some("enter"),
            0x08 | 0x2E => Some("backspace"),
            0x5B | 0x5C | 0xA0..=0xA5 => Some("modifier"),
            0x09 | 0x13 | 0x14 | 0x1B => Some("key"),
            0x21..=0x2D | 0x2F => Some("key"),
            0x30..=0x39 | 0x41..=0x5A | 0x5D => Some("key"),
            0x60..=0x6F | 0x70..=0x87 | 0x90 | 0x91 => Some("key"),
            0xBA..=0xC0 | 0xDB..=0xDF | 0xE2 => Some("key"),
            _ => None,
        }
    }

    pub fn run(started: Instant, stop: Arc<AtomicBool>) -> Vec<InputEvent> {
        let raised = unsafe { timeBeginPeriod(1) } == 0;
        let mut events = Vec::new();
        let mut buttons = [false; 3];
        let mut keys = [false; 256];
        let mut point = Point { x: 0, y: 0 };
        // Whatever is held as the take starts did not go down in it.
        for (i, (vk, _)) in BUTTONS.iter().enumerate() {
            buttons[i] = is_down(*vk);
        }
        for vk in 0x08..=0xFE {
            if key_kind(vk).is_some() {
                keys[vk as usize] = is_down(vk);
            }
        }
        let period = Duration::from_micros(1_000_000 / u64::from(RATE_HZ));
        while !stop.load(Ordering::Relaxed) {
            let t = started.elapsed().as_secs_f64() * 1000.0;
            // On a secure desktop the read fails and the previous point stands.
            let _ = unsafe { GetCursorPos(&mut point) };
            for (i, (vk, name)) in BUTTONS.iter().enumerate() {
                let down = is_down(*vk);
                if down != buttons[i] {
                    buttons[i] = down;
                    if events.len() < MAX_EVENTS {
                        events.push(InputEvent::Button {
                            t,
                            button: name,
                            down,
                            x: f64::from(point.x),
                            y: f64::from(point.y),
                        });
                    }
                }
            }
            for vk in 0x08..=0xFE {
                let Some(kind) = key_kind(vk) else { continue };
                let down = is_down(vk);
                if down && !keys[vk as usize] && events.len() < MAX_EVENTS {
                    events.push(InputEvent::Key { t, kind });
                }
                keys[vk as usize] = down;
            }
            std::thread::sleep(period);
        }
        if raised {
            unsafe { timeEndPeriod(1) };
        }
        events
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{InputEvent, MAX_EVENTS, RATE_HZ};
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

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
        fn CGEventSourceKeyState(state_id: u32, key: u16) -> bool;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFRelease(cf: *mut c_void);
    }

    const HID_SYSTEM_STATE: u32 = 1;
    const BUTTONS: [(u32, &str); 3] = [(0, "left"), (1, "right"), (2, "middle")];

    // TODO(macOS port): `CGEventSourceKeyState` needs the Input Monitoring
    // permission on 10.15+; without it every key reads as up and the take
    // simply has no typing track. Buttons and the pointer need nothing.
    fn key_kind(code: u16) -> Option<&'static str> {
        match code {
            49 => Some("space"),
            36 | 76 => Some("enter"),
            51 | 117 => Some("backspace"),
            54..=63 => Some("modifier"),
            0..=53 | 64..=75 | 77..=116 | 118..=126 => Some("key"),
            _ => None,
        }
    }

    fn pointer() -> Option<(f64, f64)> {
        unsafe {
            let event = CGEventCreate(std::ptr::null());
            if event.is_null() {
                return None;
            }
            let p = CGEventGetLocation(event);
            CFRelease(event);
            Some((p.x, p.y))
        }
    }

    pub fn run(started: Instant, stop: Arc<AtomicBool>) -> Vec<InputEvent> {
        let mut events = Vec::new();
        let mut buttons = [false; 3];
        let mut keys = [false; 128];
        let mut point = (0.0, 0.0);
        for (i, (b, _)) in BUTTONS.iter().enumerate() {
            buttons[i] = unsafe { CGEventSourceButtonState(HID_SYSTEM_STATE, *b) };
        }
        for code in 0..128u16 {
            if key_kind(code).is_some() {
                keys[code as usize] = unsafe { CGEventSourceKeyState(HID_SYSTEM_STATE, code) };
            }
        }
        let period = Duration::from_micros(1_000_000 / u64::from(RATE_HZ));
        while !stop.load(Ordering::Relaxed) {
            let t = started.elapsed().as_secs_f64() * 1000.0;
            if let Some(p) = pointer() {
                point = p;
            }
            for (i, (b, name)) in BUTTONS.iter().enumerate() {
                let down = unsafe { CGEventSourceButtonState(HID_SYSTEM_STATE, *b) };
                if down != buttons[i] {
                    buttons[i] = down;
                    if events.len() < MAX_EVENTS {
                        events.push(InputEvent::Button {
                            t,
                            button: name,
                            down,
                            x: point.0,
                            y: point.1,
                        });
                    }
                }
            }
            for code in 0..128u16 {
                let Some(kind) = key_kind(code) else { continue };
                let down = unsafe { CGEventSourceKeyState(HID_SYSTEM_STATE, code) };
                if down && !keys[code as usize] && events.len() < MAX_EVENTS {
                    events.push(InputEvent::Key { t, kind });
                }
                keys[code as usize] = down;
            }
            std::thread::sleep(period);
        }
        events
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod platform {
    use super::InputEvent;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    pub fn run(_started: Instant, stop: Arc<AtomicBool>) -> Vec<InputEvent> {
        while !stop.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(50));
        }
        Vec::new()
    }
}
