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
            0x7c => "path invalid".into(),
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

/// Moves each path to the Recycle Bin / Trash; returns `(path, error)` for the ones that failed.
pub fn trash(paths: &[String]) -> Vec<(String, String)> {
    let mut failed = Vec::new();
    for p in paths {
        if let Err(e) = trash_one(p) {
            failed.push((p.clone(), e));
        }
    }
    failed
}
