//! capture — the screenshot tool's native half.
//!
//! The overlay window (`capture`, transparent, always on top) is a page; the
//! things a page cannot do live here: taking the screenshot itself (`xcap`),
//! sizing that window to the monitor under the pointer, handing the pixels
//! over as one binary IPC response, writing the finished PNG into the library
//! and Pictures, reading its text with the OS's own OCR, and the clipboard.
//!
//! Two transfers are binary on purpose (see `packages/feature-capture/src/api/tauri.ts`):
//! `capture_pixels` answers with raw RGBA so the overlay paints before any PNG
//! is encoded, and `capture_put` receives the composed PNG as the request
//! body with its metadata in an `x-capture-meta` header. `capture_put` is the
//! only synchronous command and it only copies bytes — `capture_finish` does
//! the file work on a blocking thread, because a sync command runs on the
//! main thread and would freeze every window (as disk_trash once did).

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

/* ------------------------------------------------------------------ */
/* Data                                                                 */
/* ------------------------------------------------------------------ */

/// What `capture_grab` answers with and what `capture-shown` carries.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureFrame {
    pub id: String,
    /// Where the full screenshot is written (`<AppData>/capture/tmp/<id>.png`).
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub scale: f32,
    pub x: i32,
    pub y: i32,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveChoice {
    #[serde(default)]
    pub library: bool,
    #[serde(default)]
    pub pictures: bool,
}

/// The `x-capture-meta` header of `capture_put`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishMeta {
    pub id: String,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub rect: Rect,
    pub save: SaveChoice,
    #[serde(default)]
    pub ocr: bool,
    #[serde(default = "default_true")]
    pub hide: bool,
    #[serde(default)]
    pub title: Option<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishResult {
    pub id: String,
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub pictures_path: Option<String>,
    pub ocr_text: Option<String>,
    pub ocr_error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureItem {
    pub id: String,
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub created_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ocr_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct CaptureIndex {
    pub version: u32,
    pub items: Vec<CaptureItem>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OcrLine {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct OcrResult {
    pub text: String,
    pub lines: Vec<OcrLine>,
}

struct Frame {
    meta: CaptureFrame,
    rgba: Vec<u8>,
}

#[derive(Default)]
pub struct CaptureState {
    /// The screenshot the overlay is showing right now.
    current: Mutex<Option<Frame>>,
    /// The composed PNG handed in by `capture_put`, waiting for `capture_finish`.
    pending: Mutex<Option<(FinishMeta, Vec<u8>)>>,
}

/* ------------------------------------------------------------------ */
/* Paths + index                                                        */
/* ------------------------------------------------------------------ */

fn capture_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("capture");
    fs::create_dir_all(dir.join("tmp")).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    Ok(dir)
}

fn index_path(dir: &Path) -> PathBuf {
    dir.join("index.json")
}

pub fn read_index(dir: &Path) -> CaptureIndex {
    fs::read_to_string(index_path(dir))
        .ok()
        .and_then(|s| serde_json::from_str::<CaptureIndex>(&s).ok())
        .map(|mut idx| {
            idx.version = 1;
            idx
        })
        .unwrap_or(CaptureIndex { version: 1, items: Vec::new() })
}

pub fn write_index(dir: &Path, index: &CaptureIndex) -> Result<(), String> {
    let text = serde_json::to_string_pretty(index).map_err(|e| e.to_string())?;
    let tmp = index_path(dir).with_extension("json.part");
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, index_path(dir)).map_err(|e| e.to_string())
}

/// Held around every read-modify-write of `index.json`. A capture finishing
/// while Settings → Storage deletes a hundred others would otherwise write
/// back one of the two lists and lose the other change.
fn index_lock() -> MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(())).lock().unwrap_or_else(|e| e.into_inner())
}

/// What `remove_from_library` did.
#[derive(Debug, Default)]
pub struct LibraryRemoval {
    pub removed: Vec<String>,
    pub freed: u64,
    /// Asked for, but the file would not go (in use, no permission).
    pub failed: Vec<String>,
}

/// Deletes library captures by id: the PNG, its row in the index, and a PNG
/// in the folder that the index lost track of (named `<id>.png`). Rows whose
/// file is already gone are dropped on the way. Only ever deletes inside
/// `dir` — a row pointing anywhere else loses the row, never the file.
pub fn remove_from_library(dir: &Path, ids: &HashSet<String>) -> Result<LibraryRemoval, String> {
    let _guard = index_lock();
    let mut out = LibraryRemoval::default();
    let mut seen: HashSet<String> = HashSet::new();
    let mut index = read_index(dir);
    let before = index.items.len();
    let mut keep = Vec::with_capacity(index.items.len());
    for item in index.items.drain(..) {
        let path = PathBuf::from(&item.path);
        if !ids.contains(&item.id) {
            if path.exists() {
                keep.push(item);
            }
            continue;
        }
        seen.insert(item.id.clone());
        if !path.starts_with(dir) || !path.exists() {
            out.removed.push(item.id);
            continue;
        }
        let bytes = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        match fs::remove_file(&path) {
            Ok(()) => {
                out.freed += bytes;
                out.removed.push(item.id);
            }
            Err(e) => {
                log::warn!("capture: could not delete {}: {e}", path.display());
                out.failed.push(item.id.clone());
                keep.push(item);
            }
        }
    }
    index.items = keep;
    // The library's own PNGs that no row points at any more.
    for id in ids {
        if seen.contains(id) || !is_plain_name(id) {
            continue;
        }
        let path = dir.join(format!("{id}.png"));
        let Ok(meta) = fs::metadata(&path) else { continue };
        match fs::remove_file(&path) {
            Ok(()) => {
                out.freed += meta.len();
                out.removed.push(id.clone());
            }
            Err(e) => {
                log::warn!("capture: could not delete {}: {e}", path.display());
                out.failed.push(id.clone());
            }
        }
    }
    if index.items.len() != before {
        write_index(dir, &index)?;
    }
    Ok(out)
}

/// The full-screen PNG of the capture the overlay is showing, if one is open.
pub fn open_frame_path(app: &AppHandle) -> Option<PathBuf> {
    let state = app.try_state::<CaptureState>()?;
    let current = state.current.lock().ok()?;
    current.as_ref().map(|f| PathBuf::from(&f.meta.path))
}

fn new_id() -> String {
    format!("{:x}{:04x}", chrono::Utc::now().timestamp_millis(), rand::random::<u16>())
}

/// An id that is one plain file name — what a request may turn into a path.
pub(crate) fn is_plain_name(id: &str) -> bool {
    !id.is_empty() && id != "." && id != ".." && !id.contains(['/', '\\', ':'])
}

/// `<Pictures>/owntools/2026-09-11 14-32-05.png`
fn pictures_target() -> Option<PathBuf> {
    let dir = dirs::picture_dir()?.join("owntools");
    fs::create_dir_all(&dir).ok()?;
    let stamp = chrono::Local::now().format("%Y-%m-%d %H-%M-%S").to_string();
    let mut path = dir.join(format!("{stamp}.png"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{stamp} ({n}).png"));
        n += 1;
    }
    Some(path)
}

/* ------------------------------------------------------------------ */
/* Grab + overlay                                                       */
/* ------------------------------------------------------------------ */

#[cfg(windows)]
fn cursor_point() -> Option<(i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut pt = POINT::default();
    // SAFETY: plain Win32 call writing into a stack POINT.
    unsafe { GetCursorPos(&mut pt) }.ok()?;
    Some((pt.x, pt.y))
}

#[cfg(not(windows))]
fn cursor_point() -> Option<(i32, i32)> {
    None
}

fn pick_monitor(target: &str) -> Result<xcap::Monitor, String> {
    let all = xcap::Monitor::all().map_err(|e| format!("no monitors: {e}"))?;
    if let Some(index) = target.strip_prefix("monitor:").and_then(|s| s.parse::<usize>().ok()) {
        if let Some(m) = all.get(index) {
            return Ok(m.clone());
        }
    }
    if let Some((x, y)) = cursor_point() {
        if let Ok(m) = xcap::Monitor::from_point(x, y) {
            return Ok(m);
        }
    }
    all.iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or(all.first())
        .cloned()
        .ok_or_else(|| "no monitor to capture".to_string())
}

fn show_overlay(app: &AppHandle, meta: &CaptureFrame) -> Result<(), String> {
    // Built on the first screenshot and kept a while between them (overlays.rs);
    // the page pulls the frame with `capture_current` if it missed the event.
    let win = crate::overlays::ensure(app, "capture")?;
    let _ = win.set_position(PhysicalPosition::new(meta.x, meta.y));
    let _ = win.set_size(PhysicalSize::new(meta.width, meta.height));
    let _ = win.set_always_on_top(true);
    win.show().map_err(|e| e.to_string())?;
    let _ = win.set_focus();
    Ok(())
}

fn hide_overlay(app: &AppHandle) {
    // Hidden now, closed after a quiet spell with no new screenshot.
    crate::overlays::release(app, "capture");
}

/// Takes the screenshot, remembers it, shows the overlay over that monitor
/// and tells the page. Called from the hotkey (own thread) and `capture_grab`.
pub fn grab_and_show(app: &AppHandle, target: &str) -> Result<CaptureFrame, String> {
    let t0 = Instant::now();
    let monitor = pick_monitor(target)?;
    let image = monitor.capture_image().map_err(|e| format!("screenshot failed: {e}"))?;
    let (width, height) = image.dimensions();
    let dir = capture_dir(app)?;
    let id = new_id();
    let path = dir.join("tmp").join(format!("{id}.png"));
    let meta = CaptureFrame {
        id,
        path: path.to_string_lossy().into_owned(),
        width,
        height,
        scale: monitor.scale_factor().unwrap_or(1.0),
        x: monitor.x().unwrap_or(0),
        y: monitor.y().unwrap_or(0),
    };
    let rgba = image.into_raw();
    // The PNG on disk is the record the contract describes; the overlay never
    // waits for it.
    {
        let bytes = rgba.clone();
        let path = path.clone();
        std::thread::spawn(move || {
            if let Some(img) = image::RgbaImage::from_raw(width, height, bytes) {
                if let Err(e) = img.save(&path) {
                    log::warn!("capture: could not write {}: {e}", path.display());
                }
            }
        });
    }
    let state = app.state::<CaptureState>();
    *state.current.lock().map_err(|_| "capture state poisoned")? = Some(Frame { meta: meta.clone(), rgba });
    show_overlay(app, &meta)?;
    let _ = app.emit_to("capture", "capture-shown", &meta);
    log::info!(
        "capture: {}×{} at ({}, {}) grabbed and shown in {} ms",
        width,
        height,
        meta.x,
        meta.y,
        t0.elapsed().as_millis()
    );
    Ok(meta)
}

/// The global shortcut's handler: never on the shortcut thread itself.
pub fn on_hotkey(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = grab_and_show(&app, "cursor") {
            log::error!("capture hotkey: {e}");
        }
    });
}

/* ------------------------------------------------------------------ */
/* OCR                                                                  */
/* ------------------------------------------------------------------ */

#[cfg(windows)]
fn ocr_file(path: &Path) -> Result<OcrResult, String> {
    use windows::core::HSTRING;
    use windows::Graphics::Imaging::BitmapDecoder;
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::FileAccessMode;
    use windows::Storage::Streams::FileRandomAccessStream;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    // SAFETY: apartment init on this worker; a "changed mode" answer is fine.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
    let engine = OcrEngine::TryCreateFromUserProfileLanguages().map_err(|e| {
        format!("Text recognition needs a Windows language pack with OCR (Settings → Time & language → Language). {e}")
    })?;
    let max = OcrEngine::MaxImageDimension().unwrap_or(2600);

    // The engine refuses images over `max` per side: read the size first and
    // recognise a downscaled copy when needed, scaling the boxes back after.
    let (w, h) = image::image_dimensions(path).map_err(|e| format!("could not read {}: {e}", path.display()))?;
    let longest = w.max(h);
    let (source, factor) = if longest > max {
        let f = max as f64 / longest as f64;
        let img = image::open(path).map_err(|e| e.to_string())?.to_rgba8();
        let small = image::imageops::resize(
            &img,
            ((w as f64 * f) as u32).max(1),
            ((h as f64 * f) as u32).max(1),
            image::imageops::FilterType::Triangle,
        );
        let tmp = path.with_extension("ocr.png");
        small.save(&tmp).map_err(|e| e.to_string())?;
        (tmp, 1.0 / f)
    } else {
        (path.to_path_buf(), 1.0)
    };

    let run = || -> windows::core::Result<OcrResult> {
        let stream = FileRandomAccessStream::OpenAsync(&HSTRING::from(source.as_os_str()), FileAccessMode::Read)?.get()?;
        let decoder = BitmapDecoder::CreateAsync(&stream)?.get()?;
        let bitmap = decoder.GetSoftwareBitmapAsync()?.get()?;
        let result = engine.RecognizeAsync(&bitmap)?.get()?;
        let lines = result.Lines()?;
        let mut out = OcrResult::default();
        for i in 0..lines.Size()? {
            let line = lines.GetAt(i)?;
            let text = line.Text()?.to_string();
            let words = line.Words()?;
            let mut rect: Option<(f64, f64, f64, f64)> = None;
            for j in 0..words.Size()? {
                let r = words.GetAt(j)?.BoundingRect()?;
                let (x0, y0, x1, y1) = (r.X as f64, r.Y as f64, (r.X + r.Width) as f64, (r.Y + r.Height) as f64);
                rect = Some(match rect {
                    None => (x0, y0, x1, y1),
                    Some((a, b, c, d)) => (a.min(x0), b.min(y0), c.max(x1), d.max(y1)),
                });
            }
            let (x0, y0, x1, y1) = rect.unwrap_or_default();
            out.lines.push(OcrLine {
                text,
                x: x0 * factor,
                y: y0 * factor,
                w: (x1 - x0) * factor,
                h: (y1 - y0) * factor,
            });
        }
        out.text = out.lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>().join("\n");
        Ok(out)
    };
    let result = run().map_err(|e| format!("text recognition failed: {e}"));
    if factor != 1.0 {
        let _ = fs::remove_file(&source);
    }
    result
}

#[cfg(not(windows))]
fn ocr_file(_path: &Path) -> Result<OcrResult, String> {
    Err("Text recognition is not available on macOS yet.".to_string())
}

/* ------------------------------------------------------------------ */
/* Clipboard + shell                                                    */
/* ------------------------------------------------------------------ */

fn copy_png_to_clipboard(path: &Path) -> Result<(), String> {
    let img = image::open(path).map_err(|e| format!("could not read {}: {e}", path.display()))?.to_rgba8();
    let (w, h) = img.dimensions();
    let mut board = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    board
        .set_image(arboard::ImageData {
            width: w as usize,
            height: h as usize,
            bytes: std::borrow::Cow::Owned(img.into_raw()),
        })
        .map_err(|e| e.to_string())
}

fn copy_text_to_clipboard(text: &str) -> Result<(), String> {
    let mut board = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    board.set_text(text.to_string()).map_err(|e| e.to_string())
}

pub(crate) fn open_in_shell(path: &Path, select: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        let mut cmd = std::process::Command::new("explorer.exe");
        if select {
            cmd.arg(format!("/select,{}", path.display()));
        } else {
            cmd.arg(path);
        }
        cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
    }
    #[cfg(target_os = "macos")]
    {
        let mut cmd = std::process::Command::new("open");
        if select {
            cmd.arg("-R");
        }
        cmd.arg(path).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = select;
        std::process::Command::new("xdg-open").arg(path).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
}

/* ------------------------------------------------------------------ */
/* Commands                                                             */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub async fn capture_grab(app: AppHandle, target: Option<serde_json::Value>) -> Result<CaptureFrame, String> {
    let target = match target {
        Some(serde_json::Value::String(s)) => s,
        Some(serde_json::Value::Object(o)) => o
            .get("monitor")
            .and_then(|v| v.as_u64())
            .map(|n| format!("monitor:{n}"))
            .unwrap_or_else(|| "cursor".into()),
        _ => "cursor".to_string(),
    };
    tauri::async_runtime::spawn_blocking(move || grab_and_show(&app, &target))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn capture_current(state: State<'_, CaptureState>) -> Option<CaptureFrame> {
    state.current.lock().ok()?.as_ref().map(|f| f.meta.clone())
}

/// Raw RGBA of the current frame — one binary response, no JSON.
#[tauri::command]
pub fn capture_pixels(state: State<'_, CaptureState>, id: String) -> Result<tauri::ipc::Response, String> {
    let guard = state.current.lock().map_err(|_| "capture state poisoned")?;
    match guard.as_ref() {
        Some(f) if f.meta.id == id => Ok(tauri::ipc::Response::new(f.rgba.clone())),
        Some(_) => Err("that frame is gone; a newer capture replaced it".into()),
        None => Err("no capture is open".into()),
    }
}

/// Step one of finishing: the composed PNG as the raw body, metadata in the
/// `x-capture-meta` header. Only copies; `capture_finish` does the work.
#[tauri::command]
pub fn capture_put(state: State<'_, CaptureState>, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let meta_raw = request
        .headers()
        .get("x-capture-meta")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| "missing x-capture-meta header".to_string())?;
    let meta: FinishMeta = serde_json::from_str(meta_raw).map_err(|e| format!("bad x-capture-meta: {e}"))?;
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        tauri::ipc::InvokeBody::Json(_) => return Err("expected the PNG as the raw request body".into()),
    };
    if bytes.is_empty() {
        return Err("empty PNG".into());
    }
    let id = meta.id.clone();
    *state.pending.lock().map_err(|_| "capture state poisoned")? = Some((meta, bytes));
    Ok(id)
}

/// Step two: write the PNG where asked, OCR it when asked, update the index,
/// hide the overlay, tell the main window. Off the main thread.
#[tauri::command]
pub async fn capture_finish(app: AppHandle, id: String) -> Result<FinishResult, String> {
    let (meta, png) = {
        let state = app.state::<CaptureState>();
        let mut guard = state.pending.lock().map_err(|_| "capture state poisoned")?;
        match guard.take() {
            Some((m, b)) if m.id == id => (m, b),
            Some(other) => {
                *guard = Some(other);
                return Err("no PNG was put for this capture".into());
            }
            None => return Err("no PNG was put for this capture".into()),
        }
    };
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || finish_blocking(&app2, meta, png))
        .await
        .map_err(|e| e.to_string())?
}

fn finish_blocking(app: &AppHandle, meta: FinishMeta, png: Vec<u8>) -> Result<FinishResult, String> {
    let t0 = Instant::now();
    let dir = capture_dir(app)?;
    let (width, height) = image::load_from_memory(&png)
        .map(|img| (img.width(), img.height()))
        .unwrap_or((meta.width, meta.height));

    let path = if meta.save.library {
        dir.join(format!("{}.png", meta.id))
    } else {
        dir.join("tmp").join(format!("{}-final.png", meta.id))
    };
    fs::write(&path, &png).map_err(|e| format!("could not write {}: {e}", path.display()))?;

    let pictures_path = if meta.save.pictures {
        match pictures_target() {
            Some(target) => match fs::write(&target, &png) {
                Ok(()) => Some(target.to_string_lossy().into_owned()),
                Err(e) => {
                    log::warn!("capture: Pictures copy failed: {e}");
                    None
                }
            },
            None => None,
        }
    } else {
        None
    };

    let (ocr_text, ocr_error) = if meta.ocr {
        match ocr_file(&path) {
            Ok(r) => (Some(r.text), None),
            Err(e) => (None, Some(e)),
        }
    } else {
        (None, None)
    };

    if meta.save.library {
        let _guard = index_lock();
        let mut index = read_index(&dir);
        index.items.retain(|i| i.id != meta.id);
        index.items.insert(
            0,
            CaptureItem {
                id: meta.id.clone(),
                path: path.to_string_lossy().into_owned(),
                width,
                height,
                created_at: chrono::Utc::now().timestamp_millis(),
                ocr_text: ocr_text.clone().filter(|t| !t.trim().is_empty()),
                title: meta.title.clone().filter(|t| !t.trim().is_empty()),
            },
        );
        write_index(&dir, &index)?;
    }

    // The full screenshot is no longer needed once a crop exists.
    let _ = fs::remove_file(dir.join("tmp").join(format!("{}.png", meta.id)));
    if meta.hide {
        hide_overlay(app);
        if let Ok(mut cur) = app.state::<CaptureState>().current.lock() {
            if cur.as_ref().map(|f| f.meta.id == meta.id).unwrap_or(false) {
                *cur = None;
            }
        }
    }
    let _ = app.emit_to(
        "main",
        "capture-saved",
        json!({ "id": meta.id, "path": path.to_string_lossy(), "width": width, "height": height, "ocrText": ocr_text }),
    );
    log::info!(
        "capture: {} {}×{} saved{}{} in {} ms",
        meta.id,
        width,
        height,
        if meta.save.pictures { " (+Pictures)" } else { "" },
        if meta.ocr { " with OCR" } else { "" },
        t0.elapsed().as_millis()
    );
    Ok(FinishResult {
        id: meta.id,
        path: path.to_string_lossy().into_owned(),
        width,
        height,
        pictures_path,
        ocr_text,
        ocr_error,
    })
}

#[tauri::command]
pub async fn capture_ocr(app: AppHandle, path: String, id: Option<String>) -> Result<OcrResult, String> {
    let dir = capture_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let result = ocr_file(Path::new(&path))?;
        if let Some(id) = id {
            let _guard = index_lock();
            let mut index = read_index(&dir);
            if let Some(item) = index.items.iter_mut().find(|i| i.id == id) {
                item.ocr_text = Some(result.text.clone()).filter(|t| !t.trim().is_empty());
                write_index(&dir, &index)?;
            }
        }
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn capture_copy_image(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || copy_png_to_clipboard(Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn capture_copy_text(text: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || copy_text_to_clipboard(&text))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
pub fn capture_list(app: AppHandle) -> Result<CaptureIndex, String> {
    let dir = capture_dir(&app)?;
    let mut index = read_index(&dir);
    // Files removed by hand disappear from the library too.
    index.items.retain(|i| Path::new(&i.path).exists());
    Ok(index)
}

#[tauri::command(async)]
pub fn capture_delete(app: AppHandle, id: String) -> Result<(), String> {
    let dir = capture_dir(&app)?;
    {
        let _guard = index_lock();
        let mut index = read_index(&dir);
        if let Some(pos) = index.items.iter().position(|i| i.id == id) {
            let item = index.items.remove(pos);
            let _ = fs::remove_file(&item.path);
            write_index(&dir, &index)?;
        }
    }
    let _ = app.emit_to("main", "capture-saved", json!({ "id": id, "removed": true }));
    Ok(())
}

#[tauri::command(async)]
pub fn capture_set_title(app: AppHandle, id: String, title: String) -> Result<(), String> {
    let dir = capture_dir(&app)?;
    let _guard = index_lock();
    let mut index = read_index(&dir);
    if let Some(item) = index.items.iter_mut().find(|i| i.id == id) {
        item.title = Some(title).filter(|t| !t.trim().is_empty());
        write_index(&dir, &index)?;
    }
    Ok(())
}

#[tauri::command(async)]
pub fn capture_open_folder(app: AppHandle) -> Result<(), String> {
    let dir = capture_dir(&app)?;
    open_in_shell(&dir, false)
}

#[tauri::command(async)]
pub fn capture_reveal(path: String) -> Result<(), String> {
    open_in_shell(Path::new(&path), true)
}

#[tauri::command]
pub fn capture_cancel(app: AppHandle, state: State<'_, CaptureState>, id: Option<String>) -> Result<(), String> {
    if let Ok(mut cur) = state.current.lock() {
        let matches = match (&id, cur.as_ref()) {
            (Some(id), Some(f)) => &f.meta.id == id,
            (None, Some(_)) => true,
            _ => false,
        };
        if matches {
            if let Some(f) = cur.take() {
                let _ = fs::remove_file(&f.meta.path);
            }
        }
    }
    hide_overlay(&app);
    Ok(())
}

#[tauri::command]
pub fn capture_hide(app: AppHandle, state: State<'_, CaptureState>) {
    // Nothing reads the frame once the overlay is away — a crop is composed from
    // the page's own bitmap — so let go of its pixels (15 MB at 1440p, 33 MB at
    // 4K) now rather than at the next screenshot. "Copy text" closes this way.
    if let Ok(mut current) = state.current.lock() {
        *current = None;
    }
    hide_overlay(&app);
}

/// Brings the main window back after "send to board / social" from the overlay.
#[tauri::command]
pub fn capture_show_main(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        crate::reveal(&win);
    }
}

#[tauri::command]
pub fn capture_hotkey_registered(app: AppHandle) -> bool {
    app.global_shortcut().is_registered(crate::hotkeys::CAPTURE_HOTKEY)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("owntools-capture-{name}-{}", rand::random::<u32>()));
        fs::create_dir_all(dir.join("tmp")).unwrap();
        dir
    }

    #[test]
    fn index_round_trips_and_tolerates_a_missing_file() {
        let dir = temp_dir("index");
        assert_eq!(read_index(&dir).items.len(), 0);
        let index = CaptureIndex {
            version: 1,
            items: vec![CaptureItem {
                id: "a".into(),
                path: dir.join("a.png").to_string_lossy().into_owned(),
                width: 10,
                height: 5,
                created_at: 1,
                ocr_text: Some("hello".into()),
                title: None,
            }],
        };
        write_index(&dir, &index).unwrap();
        let back = read_index(&dir);
        assert_eq!(back.items[0].id, "a");
        assert_eq!(back.items[0].ocr_text.as_deref(), Some("hello"));
        // camelCase on disk, like the frontend expects.
        let raw = fs::read_to_string(index_path(&dir)).unwrap();
        assert!(raw.contains("\"createdAt\""), "{raw}");
        assert!(raw.contains("\"ocrText\""), "{raw}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn finish_meta_defaults_hide_to_true() {
        let meta: FinishMeta =
            serde_json::from_str(r#"{"id":"x","width":1,"height":1,"save":{"library":true}}"#).unwrap();
        assert!(meta.hide);
        assert!(!meta.ocr);
        assert!(meta.save.library && !meta.save.pictures);
    }

    #[test]
    fn ids_are_unique_and_sortable_by_time() {
        let a = new_id();
        let b = new_id();
        assert_ne!(a, b);
        assert!(a.len() >= 12);
    }

    fn item(dir: &Path, id: &str) -> CaptureItem {
        CaptureItem {
            id: id.into(),
            path: dir.join(format!("{id}.png")).to_string_lossy().into_owned(),
            width: 4,
            height: 4,
            created_at: 1,
            ocr_text: None,
            title: None,
        }
    }

    #[test]
    fn removing_from_the_library_takes_files_rows_and_lost_pngs_but_nothing_else() {
        let dir = temp_dir("remove");
        for id in ["keep", "gone", "lost"] {
            fs::write(dir.join(format!("{id}.png")), [0u8; 100]).unwrap();
        }
        // An exported copy elsewhere that a row points at must survive.
        let outside = temp_dir("outside").join("elsewhere.png");
        fs::write(&outside, [0u8; 10]).unwrap();
        let mut far = item(&dir, "far");
        far.path = outside.to_string_lossy().into_owned();
        let index = CaptureIndex {
            version: 1,
            // "dead" has no file any more: pruned on the way.
            items: vec![item(&dir, "keep"), item(&dir, "gone"), item(&dir, "dead"), far],
        };
        write_index(&dir, &index).unwrap();

        let ids: HashSet<String> = ["gone", "lost", "far", "../escape"].iter().map(|s| s.to_string()).collect();
        let out = remove_from_library(&dir, &ids).unwrap();

        let mut removed = out.removed.clone();
        removed.sort();
        assert_eq!(removed, vec!["far", "gone", "lost"]);
        assert_eq!(out.freed, 200, "only the two PNGs inside the library count");
        assert!(out.failed.is_empty());
        assert!(dir.join("keep.png").exists());
        assert!(!dir.join("gone.png").exists());
        assert!(!dir.join("lost.png").exists());
        assert!(outside.exists(), "a file outside the library is never deleted");
        let back: Vec<String> = read_index(&dir).items.into_iter().map(|i| i.id).collect();
        assert_eq!(back, vec!["keep"]);
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(outside.parent().unwrap());
    }
}
