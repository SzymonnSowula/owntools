//! WebView2 asks "allow the microphone?" with a bar drawn inside the webview
//! itself. The dictation pill is 76 px tall, transparent and never activated,
//! so that bar could never be seen or clicked — `getUserMedia` would simply
//! wait forever and the pill would sit on "Ready". Our own pages get the
//! microphone and camera without the prompt; Windows' privacy setting for the
//! app still applies, and any other origin keeps the default behaviour.

use tauri::WebviewWindow;

/// True for the app's own pages only: the bundled `tauri://` / `tauri.localhost`
/// origin and the Vite dev server on localhost.
fn is_own_page(uri: &str) -> bool {
    let lower = uri.trim().to_ascii_lowercase();
    if lower.starts_with("tauri://") {
        return true;
    }
    let Some(rest) = lower
        .strip_prefix("http://")
        .or_else(|| lower.strip_prefix("https://"))
    else {
        return false;
    };
    let host = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("");
    matches!(host, "tauri.localhost" | "localhost" | "127.0.0.1")
}

#[cfg(windows)]
pub fn grant_media(window: &WebviewWindow) {
    let label = window.label().to_string();
    let inner_label = label.clone();
    let result = window.with_webview(move |webview| {
        let label = inner_label;
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_CAMERA,
            COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
        };
        use webview2_com::{take_pwstr, PermissionRequestedEventHandler};
        use windows::core::PWSTR;

        let core = match unsafe { webview.controller().CoreWebView2() } {
            Ok(core) => core,
            Err(e) => {
                log::warn!("[{label}] media permission: no CoreWebView2: {e}");
                return;
            }
        };
        let handler = PermissionRequestedEventHandler::create(Box::new(|_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
            unsafe { args.PermissionKind(&mut kind)? };
            if kind != COREWEBVIEW2_PERMISSION_KIND_MICROPHONE
                && kind != COREWEBVIEW2_PERMISSION_KIND_CAMERA
            {
                return Ok(());
            }
            let uri = unsafe {
                let mut uri = PWSTR::null();
                args.Uri(&mut uri)?;
                take_pwstr(uri)
            };
            if is_own_page(&uri) {
                unsafe { args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)? };
            }
            Ok(())
        }));
        let mut token: i64 = 0;
        match unsafe { core.add_PermissionRequested(&handler, &mut token) } {
            Ok(()) => log::info!("[{label}] microphone/camera granted to the app's own pages"),
            Err(e) => log::warn!("[{label}] media permission handler not installed: {e}"),
        }
    });
    if let Err(e) = result {
        log::warn!("[{label}] media permission: with_webview failed: {e}");
    }
}

#[cfg(not(windows))]
pub fn grant_media(_window: &WebviewWindow) {}

#[cfg(test)]
mod tests {
    use super::is_own_page;

    #[test]
    fn own_pages_only() {
        assert!(is_own_page("http://tauri.localhost/dictation.html"));
        assert!(is_own_page("https://tauri.localhost/"));
        assert!(is_own_page("tauri://localhost/index.html"));
        assert!(is_own_page("http://localhost:1430/dictation.html"));
        assert!(is_own_page("http://127.0.0.1:1430/"));
        assert!(!is_own_page("https://example.com/"));
        assert!(!is_own_page("http://tauri.localhost.evil.com/"));
        assert!(!is_own_page("http://localhost.evil.com:1430/"));
        assert!(!is_own_page(""));
    }
}
