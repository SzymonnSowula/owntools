mod audio_capture;
mod automations;
mod bar;
mod capture;
mod capture_tool;
mod child_job;
mod cursor;
mod diagnostics;
mod dictation;
mod disk;
mod downloader;
mod ffmpeg;
mod hotkeys;
mod importer;
mod input_track;
mod launcher;
mod llm;
#[cfg(target_os = "macos")]
mod mac;
mod migrate;
mod netlog;
mod overlays;
mod parakeet;
mod permissions;
mod prefs;
#[cfg(windows)]
mod scroll_guard;
mod shield;
mod social;
mod storage;
mod sync;
#[cfg(windows)]
mod usage;
mod webview_idle;
mod ws;

use tauri::menu::{CheckMenuItem, Menu, MenuItem};
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
    rescue_offscreen(window);
    let _ = window.set_focus();
}

/// Brings a window back when it is parked outside every monitor.
///
/// Windows keeps a minimised window at (-32000, -32000) sized to its caption.
/// Hide it while it sits there and it can come back "visible and not iconic" at
/// those coordinates — `show()` and `unminimize()` are then both no-ops (tao
/// returns early when the state already matches), so the tray item, the
/// shortcut and the single-instance handler all "do nothing", permanently. A
/// second monitor that gets unplugged strands a window the same way. Seen for
/// real after a long cleanup froze the app (2026-09-08).
fn rescue_offscreen(window: &WebviewWindow) {
    let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) else {
        return;
    };
    let monitors = window.available_monitors().unwrap_or_default();
    // Reachable = enough of the window overlaps a monitor to see and grab it.
    let reachable = monitors.iter().any(|m| {
        let (mp, ms) = (m.position(), m.size());
        let overlap_x = (pos.x + size.width as i32).min(mp.x + ms.width as i32) - pos.x.max(mp.x);
        let overlap_y = (pos.y + size.height as i32).min(mp.y + ms.height as i32) - pos.y.max(mp.y);
        overlap_x >= 120 && overlap_y >= 40
    });
    if reachable {
        return;
    }
    // The minimise placeholder also shrinks the window to its caption, so give
    // it a usable size back before centring — `center()` works off the size.
    if size.width < 640 || size.height < 480 {
        let _ = window.set_size(tauri::PhysicalSize::new(1280u32, 800u32));
    }
    let _ = window.center();
    log::info!("window '{}' was off-screen at ({}, {}); brought back", window.label(), pos.x, pos.y);
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
    // Before anything resolves a path: the data folders may still carry the
    // pre-rename identifier (see migrate.rs). Logged once the log plugin is up.
    let migration_notes = migrate::migrate_identifier();
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
                .with_denylist(&["recorder", "dictation", "captions", "capture"])
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        );
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .manage(disk::DiskState::default())
        .manage(capture_tool::CaptureState::default())
        .invoke_handler(tauri::generate_handler![
            quit_app,
            capture_tool::capture_grab,
            capture_tool::capture_current,
            capture_tool::capture_pixels,
            capture_tool::capture_put,
            capture_tool::capture_finish,
            capture_tool::capture_ocr,
            capture_tool::capture_copy_image,
            capture_tool::capture_copy_text,
            capture_tool::capture_list,
            capture_tool::capture_delete,
            capture_tool::capture_set_title,
            capture_tool::capture_open_folder,
            capture_tool::capture_reveal,
            capture_tool::capture_cancel,
            capture_tool::capture_hide,
            capture_tool::capture_show_main,
            capture_tool::capture_hotkey_registered,
            automations::automations_watch_set,
            automations::automations_allow_folder,
            automations::automations_allowed_folders,
            automations::automations_write_text,
            automations::automations_import_file,
            automations::automations_list_folder,
            usage::usage_set_enabled,
            usage::usage_is_enabled,
            scroll_guard::scroll_guard_sync,
            scroll_guard::scroll_guard_note,
            cursor::get_cursor,
            cursor::get_screen_size,
            capture::list_display_sources,
            capture::capture_window_rect,
            input_track::input_track_start,
            input_track::input_track_stop,
            ffmpeg::ffmpeg_available,
            ffmpeg::convert_to_mp4,
            importer::import_legacy_data,
            launcher::launch_session,
            launcher::path_exists,
            dictation::dictation_status,
            dictation::dictation_remove_model,
            dictation::whisper_transcribe,
            parakeet::parakeet_install_runtime,
            parakeet::parakeet_transcribe,
            parakeet::parakeet_warmup,
            parakeet::parakeet_shutdown,
            parakeet::parakeet_remove_model,
            llm::llm_status,
            llm::llm_install_runtime,
            llm::llm_remove_model,
            llm::llm_ensure_server,
            llm::llm_complete,
            llm::llm_shutdown,
            dictation::type_text,
            dictation::mark_executable,
            permissions::accessibility_status,
            permissions::accessibility_request,
            dictation::dictation_target,
            dictation::press_enter,
            downloader::download_file,
            downloader::download_cancel,
            netlog::net_log,
            netlog::net_log_summary,
            netlog::net_log_recent,
            netlog::net_log_clear,
            netlog::privacy_offline_get,
            netlog::privacy_offline_set,
            diagnostics::read_log_tail,
            diagnostics::diagnostics_info,
            storage::storage_usage,
            storage::storage_open_folder,
            storage::storage_clear_cache,
            storage::storage_clear_downloads,
            storage::storage_delete,
            prefs::set_close_to_tray,
            hotkeys::dictation_hotkey,
            hotkeys::dictation_hotkey_registered,
            hotkeys::dictation_cancel_hotkey,
            social::social_agent_info,
            social::social_agent_regenerate_token,
            social::social_agent_configure,
            social::social_agent_targets,
            social::social_agent_install,
            shield::capture_shield,
            disk::disk_volumes,
            disk::disk_home,
            disk::disk_recent,
            disk::disk_scan_start,
            disk::disk_scan_cancel,
            disk::disk_summary,
            disk::disk_node,
            disk::disk_children,
            disk::disk_subtree,
            disk::disk_find,
            disk::disk_search,
            disk::disk_top_files,
            disk::disk_breakdown,
            disk::disk_quick_wins,
            disk::disk_reveal,
            disk::disk_open,
            disk::disk_trash,
            disk::disk_cleanup_check,
            disk::disk_dupes_start,
            disk::disk_dupes_cancel,
            disk::disk_dupes_result,
            disk::disk_dupes_trash,
            disk::disk_apps,
            disk::disk_app_uninstall,
            disk::disk_open_apps_settings,
            disk::disk_monitor_start,
            disk::disk_monitor_read,
            disk::disk_snapshot_save,
            disk::disk_snapshot_list,
            disk::disk_snapshot_delete,
            disk::disk_snapshot_diff,
            disk::disk_snapshot_open,
            audio_capture::audio_capture_devices,
            audio_capture::audio_capture_start,
            audio_capture::audio_capture_pause,
            audio_capture::audio_capture_resume,
            audio_capture::audio_capture_stop,
            sync::sync_set_device,
            sync::sync_set_folder,
            sync::sync_clear_folder,
            sync::sync_read_all,
            sync::sync_write,
            sync::sync_copy_out,
            sync::sync_copy_in,
            sync::sync_remove_out,
            sync::sync_watch,
            sync::sync_status,
            sync::sync_app_scan,
            sync::sync_app_remove,
            overlays::overlay_ready,
            overlays::overlay_ensure,
            overlays::overlay_release,
            bar::bar_set_bounds,
            bar::bar_sync,
            bar::bar_capture_exclusion,
            bar::bar_note_foreground,
            bar::bar_restore_foreground,
            bar::bar_drag
        ])
        .setup(move |app| {
            log::info!("owntools {} starting", app.package_info().version);
            for note in &migration_notes {
                log::info!("{note}");
            }
            match app.path().app_data_dir() {
                Ok(dir) => {
                    for note in migrate::migrate_layout(&dir) {
                        log::info!("{note}");
                    }
                }
                Err(e) => log::warn!("app data dir unavailable, layout migration skipped: {e}"),
            }
            // The sampler thread idles until the frontend enables time tracking
            // or arms the scroll guard; nothing is read from other windows before
            // that, and the scroll guard's input hooks are installed only on arm.
            #[cfg(windows)]
            usage::start(app.handle().clone());
            hotkeys::register_dictation_hotkey(app.handle());
            hotkeys::register_capture_hotkey(app.handle());
            // The social agent server (127.0.0.1, bearer token) + OAuth loopback.
            social::start(app.handle());
            // The pill can never show WebView2's own microphone prompt (see
            // permissions.rs), so our pages get the mic without one — the
            // recorder too, when overlays.rs builds it.
            for label in ["main", "dictation"] {
                if let Some(window) = app.get_webview_window(label) {
                    permissions::grant_media(&window);
                    // Hours in the tray, or hidden between takes: say so to the
                    // web view, which otherwise keeps rendering (webview_idle.rs).
                    webview_idle::attach(&window);
                }
            }
            // The recorder, captions and capture windows are built when they are
            // needed and closed when put away; nothing to do unless
            // OWNTOOLS_EAGER_WINDOWS asks for the old start-up (overlays.rs).
            overlays::setup(app.handle());
            // The bar shares the pill's window and shrinks below Windows'
            // minimum window size (bar.rs); its page shows it.
            bar::setup(app.handle());

            let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            // Ticked by the bar's page (bar_sync) once it has read the setting.
            let bar_item = CheckMenuItem::with_id(app, "bar", "Show the bar", true, true, None::<&str>)?;
            app.manage(bar::BarTray(bar_item.clone()));
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
            let menu = Menu::with_items(app, &[&show, &bar_item, &session, &toggle, &record, &note, &quit])?;

            let Some(icon) = app.default_window_icon().cloned() else {
                log::error!("no default window icon in the bundle; tray icon not created");
                return Ok(());
            };

            let _tray = TrayIconBuilder::with_id("tray")
                .icon(icon)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("owntools")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main(app),
                    // The page owns the setting; it flips it and ticks this back.
                    "bar" => {
                        let _ = app.emit_to(bar::LABEL, "bar-toggle", ());
                    }
                    "start-session" => {
                        show_main(app);
                        let _ = app.emit("tray-start-session", ());
                    }
                    "toggle-focus" => {
                        let _ = app.emit("tray-toggle-focus", ());
                    }
                    "record" => {
                        // Built on demand — never on this, the main, thread.
                        overlays::open_with(app, "recorder", |app, overlay| {
                            let _ = overlay.show();
                            let _ = overlay.set_focus();
                            // The page is told nothing when its window appears,
                            // so say it: the camera preview waits on this.
                            let _ = app.emit("recorder-visibility", true);
                        });
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
        .build(tauri::generate_context!())
        .expect("error while building owntools")
        .run(|_app, event| {
            // The resident speech recognizer is a child process; nothing
            // else reaps it, so a normal quit has to.
            if let tauri::RunEvent::Exit = event {
                parakeet::shutdown();
                llm::shutdown();
                // Open call recordings: stop the WASAPI threads and patch the
                // archive header so the file is playable.
                audio_capture::shutdown();
            }
        });
}
