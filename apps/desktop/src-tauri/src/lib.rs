mod capture;
mod cursor;
mod diagnostics;
mod dictation;
mod downloader;
mod ffmpeg;
mod hotkeys;
mod importer;
mod launcher;
mod permissions;
mod prefs;
#[cfg(windows)]
mod scroll_guard;
mod shield;
mod social;
#[cfg(windows)]
mod usage;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, WebviewWindow};
use tauri_plugin_log::{Target, TargetKind};

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
    pub fn scroll_guard_note(_site: Option<String>) {}
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

/// Hide to the tray. Only used for an explicit close: minimising keeps the
/// window on the taskbar like every other app.
fn conceal(window: &tauri::Window) {
    let _ = window.hide();
    let _ = window.set_skip_taskbar(true);
}

fn log_targets() -> Vec<Target> {
    let mut targets = vec![Target::new(TargetKind::LogDir {
        file_name: Some(diagnostics::LOG_FILE_STEM.to_string()),
    })];
    if cfg!(debug_assertions) {
        targets.push(Target::new(TargetKind::Stdout));
    }
    targets
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main(app);
        }))
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .max_file_size(2 * 1024 * 1024)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .targets(log_targets())
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(
            // Remember the main window's size, position and monitor. The
            // overlay windows manage themselves and must never come back
            // visible on their own.
            tauri_plugin_window_state::Builder::new()
                .with_denylist(&["recorder", "dictation"])
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        );
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .invoke_handler(tauri::generate_handler![
            quit_app,
            usage::usage_set_enabled,
            usage::usage_is_enabled,
            scroll_guard::scroll_guard_sync,
            scroll_guard::scroll_guard_note,
            cursor::get_cursor,
            cursor::get_screen_size,
            capture::list_display_sources,
            capture::capture_window_rect,
            ffmpeg::ffmpeg_available,
            ffmpeg::convert_to_mp4,
            importer::import_legacy_data,
            launcher::launch_session,
            launcher::path_exists,
            dictation::dictation_status,
            dictation::dictation_remove_model,
            dictation::whisper_transcribe,
            dictation::type_text,
            dictation::dictation_target,
            downloader::download_file,
            downloader::download_cancel,
            diagnostics::read_log_tail,
            diagnostics::diagnostics_info,
            prefs::set_close_to_tray,
            hotkeys::dictation_hotkey,
            hotkeys::dictation_hotkey_registered,
            hotkeys::dictation_cancel_hotkey,
            social::social_agent_info,
            social::social_agent_regenerate_token,
            social::social_agent_configure,
            shield::capture_shield
        ])
        .setup(|app| {
            log::info!("shipshape {} starting", app.package_info().version);
            // The sampler thread idles until the frontend enables time tracking
            // or arms the scroll guard; nothing is read from other windows before
            // that, and the scroll guard's input hooks are installed only on arm.
            #[cfg(windows)]
            usage::start(app.handle().clone());
            hotkeys::register_dictation_hotkey(app.handle());
            // The social agent server (127.0.0.1, bearer token) + OAuth loopback.
            social::start(app.handle());
            // The pill can never show WebView2's own microphone prompt (see
            // permissions.rs), so our pages get the mic without one.
            for label in ["main", "recorder", "dictation"] {
                if let Some(window) = app.get_webview_window(label) {
                    permissions::grant_media(&window);
                }
            }
            // The recorder bar must never end up in the recording it controls.
            shield::shield_overlay(app.handle());

            let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let toggle = MenuItem::with_id(
                app,
                "toggle-focus",
                "Start/pause focus timer",
                true,
                None::<&str>,
            )?;
            let session = MenuItem::with_id(
                app,
                "start-session",
                "Start workspace session",
                true,
                None::<&str>,
            )?;
            let record = MenuItem::with_id(app, "record", "Record screen", true, None::<&str>)?;
            let note = MenuItem::with_id(app, "quick-note", "Quick note", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &session, &toggle, &record, &note, &quit])?;

            let Some(icon) = app.default_window_icon().cloned() else {
                log::error!("no default window icon in the bundle; tray icon not created");
                return Ok(());
            };

            let _tray = TrayIconBuilder::with_id("tray")
                .icon(icon)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("shipshape")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main(app),
                    "start-session" => {
                        show_main(app);
                        let _ = app.emit("tray-start-session", ());
                    }
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
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    if prefs::close_to_tray() {
                        api.prevent_close();
                        conceal(window);
                    } else {
                        // Every other window is a hidden helper: closing the
                        // main one with the tray option off means quit.
                        window.app_handle().exit(0);
                    }
                } else {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running shipshape");
}
