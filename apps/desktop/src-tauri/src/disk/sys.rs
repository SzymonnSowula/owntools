//! The bits that touch the shell: reveal in Explorer / Finder, open with the
//! default app, and the Recycle Bin / Trash. Nothing here deletes for good:
//! `trash` goes through the shell's own undoable delete, so a wrong click is
//! a restore away.

use std::process::Command;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn reveal(path: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        Command::new("explorer.exe")
            .raw_arg(format!("/select,\"{}\"", path.trim_end_matches(['\\', '/'])))
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg("-R").arg(path).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let parent = std::path::Path::new(path).parent().map(|p| p.to_path_buf()).unwrap_or_default();
        Command::new("xdg-open").arg(parent).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
}

pub fn open(path: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        Command::new("explorer.exe").arg(path).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg(path).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open").arg(path).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
}

/// Windows "Apps & features"; a no-op elsewhere.
pub fn open_apps_settings() -> Result<(), String> {
    #[cfg(windows)]
    {
        Command::new("explorer.exe").arg("ms-settings:appsfeatures").spawn().map(|_| ()).map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

/// Runs an uninstaller command line as the registry recorded it.
pub fn run_uninstall(command: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        Command::new("cmd.exe")
            .raw_arg(format!("/C start \"\" {command}"))
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = command;
        Err("not supported here".into())
    }
}

#[cfg(windows)]
fn trash_one(path: &str) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::{
        SHFileOperationW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT, FO_DELETE, SHFILEOPSTRUCTW,
    };
    // Double-null-terminated list of one path.
    let mut wide: Vec<u16> = std::ffi::OsStr::new(path.trim_end_matches(['\\', '/'])).encode_wide().collect();
    wide.push(0);
    wide.push(0);
    let flags = (FOF_ALLOWUNDO.0 | FOF_NOCONFIRMATION.0 | FOF_SILENT.0 | FOF_NOERRORUI.0) as u16;
    let mut op = SHFILEOPSTRUCTW {
        wFunc: FO_DELETE,
        pFrom: PCWSTR(wide.as_ptr()),
        pTo: PCWSTR::null(),
        fFlags: flags,
        ..Default::default()
    };
    let code = unsafe { SHFileOperationW(&mut op) };
    if code != 0 {
        return Err(match code {
            0x71 => "same file".into(),
            0x72 => "several destinations".into(),
            0x78 => "access denied".into(),
            // Seen on a real folder that plainly exists: a tree is refused when
            // its deepest entry would pass MAX_PATH once re-rooted under
            // C:\$Recycle.Bin\<SID>\, which is ~30 characters longer than most
            // source roots.
            0x7c => "the path is not valid for the Recycle Bin (often: too long once moved there)".into(),
            0x7e => "already exists".into(),
            0x80 => "file in use".into(),
            0x81 => "path too long".into(),
            0x83 => "not on this volume".into(),
            0x86 => "cannot move to the Recycle Bin".into(),
            0x8e => "this file is in use".into(),
            0x2 | 0x3 => "not found".into(),
            0x5 => "access denied".into(),
            other => format!("shell error 0x{other:x}"),
        });
    }
    if op.fAnyOperationsAborted.as_bool() {
        return Err("aborted".into());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn trash_one(path: &str) -> Result<(), String> {
    let script = format!(
        "tell application \"Finder\" to delete POSIX file \"{}\"",
        path.replace('\\', "\\\\").replace('"', "\\\"")
    );
    let out = Command::new("osascript").args(["-e", &script]).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn trash_one(path: &str) -> Result<(), String> {
    let out = Command::new("gio").args(["trash", path]).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Shell calls want COM on the calling thread. The main thread already has it
/// (WebView2 sets it up); the trash worker runs off it, so it brings its own
/// and gives it back on the way out.
struct ComGuard(bool);

impl ComGuard {
    fn enter() -> Self {
        #[cfg(windows)]
        {
            use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE};
            // S_FALSE = already initialised on this thread, and still ours to balance.
            // RPC_E_CHANGED_MODE = someone else's apartment: leave it alone.
            let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) };
            return Self(hr.is_ok());
        }
        #[cfg(not(windows))]
        Self(false)
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        #[cfg(windows)]
        if self.0 {
            unsafe { windows::Win32::System::Com::CoUninitialize() };
        }
    }
}

/// Moves each path to the Recycle Bin / Trash, calling `on_progress(done, path)`
/// before each one and once more when the last is through; returns
/// `(path, error)` for the ones that failed.
///
/// The shell moves a folder file by file, so a few large trees run for minutes.
/// Never call this on the main thread — that freezes every window (see
/// `disk_trash`) — and give the callback something the user can watch.
pub fn trash_with_progress(paths: &[String], mut on_progress: impl FnMut(usize, &str)) -> Vec<(String, String)> {
    let _com = ComGuard::enter();
    let mut failed = Vec::new();
    for (i, p) in paths.iter().enumerate() {
        on_progress(i, p);
        if let Err(e) = trash_one(p) {
            failed.push((p.clone(), e));
        }
    }
    on_progress(paths.len(), "");
    failed
}
#[cfg(test)]
mod tests {
    use super::*;

    /// The Recycle Bin move runs on a worker thread now (see `disk_trash`), and
    /// shell APIs want COM on the calling thread — the main one gets it from
    /// WebView2, a worker does not. This checks the whole thing from a plain
    /// `std::thread` with no COM anywhere around it.
    ///
    /// `#[ignore]`d because it really does put a file in the Recycle Bin:
    /// `cargo test -- --ignored trash_from_a_worker_thread`.
    #[test]
    #[ignore]
    fn trash_from_a_worker_thread() {
        let base = std::env::temp_dir().join(format!("owntools-trash-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("nested")).unwrap();
        std::fs::write(base.join("nested/a.bin"), vec![7u8; 4096]).unwrap();
        std::fs::write(base.join("b.txt"), b"bye").unwrap();

        let target = base.to_string_lossy().into_owned();
        let missing = base.join("not-here").to_string_lossy().into_owned();
        let paths = vec![target.clone(), missing.clone()];

        let ticks = std::thread::spawn(move || {
            let mut seen: Vec<(usize, String)> = Vec::new();
            let failed = trash_with_progress(&paths, |done, path| seen.push((done, path.to_string())));
            (seen, failed)
        })
        .join()
        .unwrap();
        let (seen, failed) = ticks;

        // One tick per item plus the closing one, counting up from zero.
        assert_eq!(seen.len(), 3, "progress ticks: {seen:?}");
        assert_eq!(seen[0], (0, target.clone()));
        assert_eq!(seen[1], (1, missing.clone()));
        assert_eq!(seen[2].0, 2);
        assert!(seen[2].1.is_empty(), "the last tick names nothing");

        // The real folder went to the Recycle Bin; the made-up path is reported,
        // not silently counted as freed.
        assert!(!base.exists(), "the folder should be gone from disk");
        assert_eq!(failed.len(), 1, "failures: {failed:?}");
        assert_eq!(failed[0].0, missing);
    }
}
