mod cursor;
mod ffmpeg;
mod importer;
#[cfg(windows)]
mod scroll_guard;
#[cfg(windows)]
mod usage;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, WebviewWindow};

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

// The usage tracker and scroll guard are Windows-only. On other platforms the
// commands exist but are inert, so the frontend can call them unconditionally.
#[cfg(not(windows))]
mod usage {
    #[tauri::command]
    pub fn usage_set_enabled(_enabled: bool) {}

    #[tauri::command]
    pub fn usage_is_enabled() -> bool {
        false
    }
}

#[cfg(not(windows))]
mod scroll_guard {
    #[tauri::command]
    pub fn scroll_guard_sync(_armed: bool, _sites: Vec<String>) {}

    #[tauri::command]
    pub fn scroll_guard_note(_site: String) {}
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        reveal(&window);
    }
}

fn reveal(window: &WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_skip_taskbar(false);
    let _ = window.set_focus();
}

fn conceal(window: &tauri::Window) {
    let _ = window.hide();
    let _ = window.set_skip_taskbar(true);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init());

    builder
        .invoke_handler(tauri::generate_handler![
            quit_app,
            usage::usage_set_enabled,
            usage::usage_is_enabled,
            scroll_guard::scroll_guard_sync,
            scroll_guard::scroll_guard_note,
            cursor::get_cursor,
            cursor::get_screen_size,
            ffmpeg::ffmpeg_available,
            ffmpeg::convert_to_mp4,
            importer::import_legacy_data
        ])
        .setup(|app| {
            #[cfg(windows)]
            {
                usage::start(app.handle().clone());
                scroll_guard::start();
            }
            let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let toggle = MenuItem::with_id(
                app,
                "toggle-focus",
                "Start/pause focus timer",
                true,
                None::<&str>,
            )?;
            let record = MenuItem::with_id(app, "record", "Record screen", true, None::<&str>)?;
            let note = MenuItem::with_id(app, "quick-note", "Quick note", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &toggle, &record, &note, &quit])?;

            let icon = app
                .default_window_icon()
                .cloned()
                .expect("missing app icon");

            let _tray = TrayIconBuilder::with_id("tray")
                .icon(icon)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("suite")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main(app),
                    "toggle-focus" => {
                        let _ = app.emit("tray-toggle-focus", ());
                    }
                    "record" => {
                        if let Some(overlay) = app.get_webview_window("recorder") {
                            let _ = overlay.show();
                            let _ = overlay.set_focus();
                        }
                    }
                    "quick-note" => {
                        show_main(app);
                        let _ = app.emit("tray-quick-note", ());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                if window.label() == "recorder" {
                    let _ = window.hide();
                } else {
                    conceal(window);
                }
            }
            tauri::WindowEvent::Resized(_) => {
                if window.label() == "main" && window.is_minimized().unwrap_or(false) {
                    conceal(window);
                }
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running suite");
}
