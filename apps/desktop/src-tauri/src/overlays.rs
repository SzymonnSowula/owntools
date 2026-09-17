//! The helper windows are built when they are needed and destroyed when they
//! are put away.
//!
//! Every WebView2 window is a renderer process of its own, and a renderer costs
//! its 55–95 MB whether anyone can see the window or not. owntools used to build
//! all five windows at start-up and only ever hide four of them: measured on
//! 2026-09-15 on the installed build, the hidden recorder, captions and capture
//! windows held 94 + 93 + 85 MB of private memory and the pill 56 MB — a third
//! of the whole app, in windows nobody could see.
//!
//! `tauri.conf.json` now marks the recorder, captions and capture windows
//! `"create": false`, and this module builds them from that same entry the first
//! time they are asked for:
//!
//! - **recorder**, **captions** — destroyed as soon as they are put away. Both
//!   open from a click, where the few hundred milliseconds of a new window go
//!   unnoticed.
//! - **capture** — kept, hidden, for [`CAPTURE_WARM`] after a screenshot,
//!   because screenshots come in runs; destroyed when nobody asked for another.
//! - The dictation pill stays resident (Tauri builds it at start-up): it has to
//!   be listening the moment the hotkey is pressed.
//!
//! Two rules keep this from breaking anything:
//! - **A window is never built on the main thread.** `build()` waits for the
//!   event loop, which *is* the main thread — a deadlock on Windows (wry#583).
//!   `ensure` refuses there; main-thread callers (the tray) use `open_with`.
//! - **A new page cannot hear an event sent before its listeners exist**, so the
//!   page calls `overlay_ready` once it is mounted (`@ui/OverlayReady`) and
//!   `ensure` waits for that before anyone shows the window or talks to it.
//!
//! `OWNTOOLS_EAGER_WINDOWS=1` builds the three at start-up and never destroys
//! them — the old behaviour, for measuring and for ruling this module out.

use std::sync::{Condvar, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, WebviewWindow, WebviewWindowBuilder};

/// Screenshots come in runs: the overlay waits this long, hidden, for the next.
pub const CAPTURE_WARM: Duration = Duration::from_secs(10 * 60);
/// A window destroyed from its own `overlay_release` call still answers it first.
const RELEASE_GRACE: Duration = Duration::from_millis(150);
/// How long a new page gets to say it is listening before it is used anyway.
const READY_TIMEOUT: Duration = Duration::from_secs(5);
/// `destroy()` only asks the event loop; the label is free again within this.
const GONE_TIMEOUT: Duration = Duration::from_secs(2);

/// The windows this module owns, in `tauri.conf.json` order.
pub const ON_DEMAND: [&str; 3] = ["recorder", "captions", "capture"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Keep {
    /// Destroyed right after it is put away.
    Close,
    /// Hidden for this long after it is put away, then destroyed.
    Warm(Duration),
}

fn keep(label: &str) -> Option<Keep> {
    match label {
        "recorder" | "captions" => Some(Keep::Close),
        "capture" => Some(Keep::Warm(CAPTURE_WARM)),
        _ => None,
    }
}

/// What the module remembers per label. A handful of entries, so plain vectors.
struct Book {
    /// Labels whose page has called `overlay_ready` since its window was built.
    ready: Vec<String>,
    /// Bumped whenever a window is asked for or put away, so a delayed destroy
    /// can tell it has been overtaken by a newer request.
    generations: Vec<(String, u64)>,
}

static BOOK: Mutex<Book> = Mutex::new(Book { ready: Vec::new(), generations: Vec::new() });
static READY: Condvar = Condvar::new();
/// Held while a window is looked up and built, or checked and destroyed: two
/// callers must not both build `capture`, and a delayed destroy must not race a
/// new request. Only ever taken off the main thread, which has to stay free to
/// run the builds this lock waits on.
static LIFECYCLE: Mutex<()> = Mutex::new(());

fn book() -> MutexGuard<'static, Book> {
    BOOK.lock().unwrap_or_else(|e| e.into_inner())
}

fn bump(label: &str) -> u64 {
    let mut book = book();
    if let Some((_, generation)) = book.generations.iter_mut().find(|(l, _)| l == label) {
        *generation += 1;
        return *generation;
    }
    book.generations.push((label.to_string(), 1));
    1
}

fn generation(label: &str) -> u64 {
    book().generations.iter().find(|(l, _)| l == label).map_or(0, |(_, g)| *g)
}

fn set_ready(label: &str, ready: bool) {
    let mut book = book();
    book.ready.retain(|l| l != label);
    if ready {
        book.ready.push(label.to_string());
    }
    drop(book);
    if ready {
        READY.notify_all();
    }
}

fn wait_ready(label: &str, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    let mut book = book();
    loop {
        if book.ready.iter().any(|l| l == label) {
            return true;
        }
        let now = Instant::now();
        if now >= deadline {
            return false;
        }
        book = match READY.wait_timeout(book, deadline - now) {
            Ok((guard, _)) => guard,
            Err(poisoned) => poisoned.into_inner().0,
        };
    }
}

fn lifecycle() -> MutexGuard<'static, ()> {
    LIFECYCLE.lock().unwrap_or_else(|e| e.into_inner())
}

fn on_main_thread() -> bool {
    std::thread::current().name() == Some("main")
}

fn eager() -> bool {
    static EAGER: OnceLock<bool> = OnceLock::new();
    *EAGER.get_or_init(|| std::env::var("OWNTOOLS_EAGER_WINDOWS").is_ok_and(|v| v.trim() == "1"))
}

/// Start-up. Nothing to build unless `OWNTOOLS_EAGER_WINDOWS` asks for it.
pub fn setup(app: &AppHandle) {
    if !eager() {
        return;
    }
    log::info!("OWNTOOLS_EAGER_WINDOWS: building the helper windows at start-up");
    let app = app.clone();
    let _ = std::thread::Builder::new().name("overlays-eager".into()).spawn(move || {
        for label in ON_DEMAND {
            if let Err(e) = ensure(&app, label) {
                log::warn!("{e}");
            }
        }
    });
}

/// The window, built from its `tauri.conf.json` entry when it does not exist,
/// once its page has said it is listening. Hidden, as the config says; showing
/// it is the caller's business. Blocks — never call it on the main thread.
pub fn ensure(app: &AppHandle, label: &str) -> Result<WebviewWindow, String> {
    if keep(label).is_none() {
        return app
            .get_webview_window(label)
            .ok_or_else(|| format!("there is no '{label}' window"));
    }
    if on_main_thread() {
        return Err(format!("the '{label}' window cannot be built from the main thread"));
    }
    let guard = lifecycle();
    // Whatever was scheduled for the old window, it is wanted again.
    bump(label);
    if let Some(window) = app.get_webview_window(label) {
        drop(guard);
        // Built a moment ago by another caller, its page may still be loading.
        if !wait_ready(label, READY_TIMEOUT) {
            log::warn!("'{label}' window: its page has not said it is ready; using it anyway");
        }
        return Ok(window);
    }
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == label)
        .cloned()
        .ok_or_else(|| format!("tauri.conf.json has no '{label}' window"))?;
    set_ready(label, false);
    let started = Instant::now();
    let window = WebviewWindowBuilder::from_config(app, &config)
        .and_then(|builder| builder.build())
        .map_err(|e| format!("the '{label}' window could not be built: {e}"))?;
    prepare(app, &window);
    drop(guard);
    let built_ms = started.elapsed().as_millis();
    let ready = wait_ready(label, READY_TIMEOUT);
    log::info!(
        "'{label}' window built in {built_ms} ms, page ready after {} ms{}",
        started.elapsed().as_millis(),
        if ready { "" } else { " (it never said so; used anyway)" }
    );
    Ok(window)
}

/// What a freshly built window needs before its page can do its job.
fn prepare(app: &AppHandle, window: &WebviewWindow) {
    if window.label() == "recorder" {
        // Camera and microphone without WebView2's own prompt (permissions.rs).
        crate::permissions::grant_media(window);
        // The bar must never end up in the recording it controls (shield.rs).
        // Window affinity belongs to the thread that owns the window.
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || crate::shield::shield_overlay(&handle));
    }
}

/// `ensure` on a thread of its own, then `then` with the window — for callers on
/// the main thread (the tray menu), which must not build a window themselves.
pub fn open_with(
    app: &AppHandle,
    label: &str,
    then: impl FnOnce(&AppHandle, &WebviewWindow) + Send + 'static,
) {
    let app = app.clone();
    let label = label.to_string();
    let spawned = std::thread::Builder::new()
        .name(format!("{label}-open"))
        .spawn(move || match ensure(&app, &label) {
            Ok(window) => then(&app, &window),
            Err(e) => log::error!("{e}"),
        });
    if let Err(e) = spawned {
        log::error!("could not start opening the window: {e}");
    }
}

/// Puts a window away: hidden at once, destroyed after its grace or warm period
/// unless somebody asks for it again first. Any thread.
pub fn release(app: &AppHandle, label: &str) {
    let Some(window) = app.get_webview_window(label) else {
        return;
    };
    let _ = window.hide();
    let Some(keep) = keep(label) else {
        return;
    };
    if eager() {
        return;
    }
    let after = match keep {
        Keep::Close => RELEASE_GRACE,
        Keep::Warm(period) => period,
    };
    let requested = bump(label);
    let handle = app.clone();
    let owned = label.to_string();
    let spawned = std::thread::Builder::new()
        .name(format!("{label}-release"))
        .spawn(move || {
            std::thread::sleep(after);
            let _guard = lifecycle();
            if generation(&owned) != requested {
                return; // asked for again in the meantime
            }
            destroy(&handle, &owned);
        });
    if let Err(e) = spawned {
        log::warn!("'{label}' window stays hidden instead of closing: {e}");
    }
}

/// Destroys a hidden window and waits until its label is free. Called with the
/// lifecycle lock held, off the main thread.
fn destroy(app: &AppHandle, label: &str) {
    let Some(window) = app.get_webview_window(label) else {
        return;
    };
    // Shown again by a path that did not go through `ensure`: leave it be.
    if window.is_visible().unwrap_or(false) {
        return;
    }
    set_ready(label, false);
    if let Err(e) = window.destroy() {
        log::warn!("'{label}' window could not be destroyed: {e}");
        return;
    }
    let deadline = Instant::now() + GONE_TIMEOUT;
    while app.get_webview_window(label).is_some() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    log::info!("'{label}' window closed");
}

/// An overlay page is mounted and listening (`@ui/OverlayReady`).
#[tauri::command]
pub async fn overlay_ready(window: WebviewWindow) {
    set_ready(window.label(), true);
}

/// Builds an on-demand window when it does not exist and waits for its page.
/// Does not show it: callers position it first.
#[tauri::command]
pub async fn overlay_ensure(app: AppHandle, label: String) -> Result<(), String> {
    if keep(&label).is_none() {
        return Err(format!("'{label}' is not an on-demand window"));
    }
    tauri::async_runtime::spawn_blocking(move || ensure(&app, &label).map(|_| ()))
        .await
        .map_err(|e| e.to_string())?
}

/// Hides an on-demand window; it closes a moment later, or after its warm period.
#[tauri::command]
pub fn overlay_release(app: AppHandle, label: String) -> Result<(), String> {
    if keep(&label).is_none() {
        return Err(format!("'{label}' is not an on-demand window"));
    }
    release(&app, &label);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_helper_windows_come_and_go() {
        assert_eq!(keep("recorder"), Some(Keep::Close));
        assert_eq!(keep("captions"), Some(Keep::Close));
        assert_eq!(keep("capture"), Some(Keep::Warm(CAPTURE_WARM)));
        // The main window and the pill live for the whole session.
        assert_eq!(keep("main"), None);
        assert_eq!(keep("dictation"), None);
        for label in ON_DEMAND {
            assert!(keep(label).is_some(), "{label}");
        }
    }

    #[test]
    fn a_new_request_overtakes_a_pending_destroy() {
        let label = "test-generation";
        let scheduled = bump(label);
        assert_eq!(generation(label), scheduled);
        // `ensure` in the meantime: the destroy that `scheduled` stood for is off.
        bump(label);
        assert_ne!(generation(label), scheduled);
    }

    #[test]
    fn waiting_ends_when_the_page_says_ready() {
        let label = "test-ready";
        set_ready(label, false);
        assert!(!wait_ready(label, Duration::from_millis(20)));
        let signal = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(30));
            set_ready(label, true);
        });
        let started = Instant::now();
        assert!(wait_ready(label, Duration::from_secs(5)));
        assert!(started.elapsed() < Duration::from_secs(2));
        signal.join().unwrap();
        // A destroyed window's page is not ready any more.
        set_ready(label, false);
        assert!(!wait_ready(label, Duration::from_millis(10)));
    }
}
