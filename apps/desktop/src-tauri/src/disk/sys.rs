//! The bits that touch the shell: reveal in Explorer / Finder, open with the
//! default app, and the Recycle Bin / Trash. Nothing here deletes for good:
//! `trash` goes through the shell's own undoable delete, so a wrong click is
//! a restore away.
//!
//! On Windows the move is one `IFileOperation` per batch rather than a
//! `SHFileOperationW` per item, for three reasons. It can ask for administrator
//! permission (`FOFX_SHOWELEVATIONPROMPT`: one UAC prompt for the batch, the
//! work done by Windows' own elevated copy engine, never by an elevated owntools)
//! — `Program Files`, `Windows\Temp` and `Windows.old` refused everything with
//! "access denied" before. And its progress sink sees each delete before it
//! happens: the old flags (`FOF_NOCONFIRMATION` without `FOF_WANTNUKEWARNING`)
//! let the shell delete for good, silently, anything it could not recycle
//! (removable and network drives, an item bigger than the bin, `NukeOnDelete`);
//! now the sink refuses every delete that would not land in the Recycle Bin.

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

/// Runs an uninstaller command line as the registry recorded it (after
/// `apps::quote_command` has given an unquoted path its quotes).
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

/// Why one item did not reach the Recycle Bin.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrashError {
    pub message: String,
    /// Windows refused for want of rights, and administrator permission may get
    /// it through. Never set on an attempt that already asked for it.
    pub needs_admin: bool,
}

impl TrashError {
    fn plain(message: impl Into<String>) -> Self {
        Self { message: message.into(), needs_admin: false }
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct TrashOptions {
    /// Let Windows ask for administrator permission: one UAC prompt for the batch.
    pub elevate: bool,
    /// The window that prompt belongs to, as a raw HWND; 0 for none.
    pub owner: isize,
}

/// What an HRESULT from the shell's copy engine (or the Win32 error inside
/// one) means for the item it came with.
pub fn describe_shell_error(code: u32, elevated: bool) -> TrashError {
    match code {
        // COPYENGINE_E_REQUIRES_ELEVATION · COPYENGINE_E_ACCESS_DENIED_SRC ·
        // E_ACCESSDENIED · ERROR_ELEVATION_REQUIRED
        0x8027_0002 | 0x8027_0021 | 0x8007_0005 | 0x8007_02E4 => {
            if elevated {
                TrashError::plain("Windows refused, even with administrator permission")
            } else {
                TrashError { message: "Windows protects it: needs administrator permission".into(), needs_admin: true }
            }
        }
        // COPYENGINE_E_ACCESSDENIED_READONLY · ERROR_WRITE_PROTECT
        0x8027_003F | 0x8007_0013 => TrashError::plain("it is read-only"),
        // COPYENGINE_E_SHARING_VIOLATION_SRC · ERROR_SHARING_VIOLATION · ERROR_LOCK_VIOLATION
        0x8027_0027 | 0x8007_0020 | 0x8007_0021 => TrashError::plain("a file in it is open in another program"),
        // COPYENGINE_E_RECYCLE_PATH_TOO_LONG · COPYENGINE_E_PATH_TOO_DEEP_SRC · ERROR_FILENAME_EXCED_RANGE
        0x8027_0038 | 0x8027_001D | 0x8007_00CE => TrashError::plain("a path in it is too long for the Recycle Bin"),
        // COPYENGINE_E_RECYCLE_SIZE_TOO_BIG
        0x8027_0037 => TrashError::plain("too big for the Recycle Bin"),
        // COPYENGINE_E_RECYCLE_BIN_NOT_FOUND · COPYENGINE_E_RECYCLE_FORCE_NUKE ·
        // COPYENGINE_E_RECYCLE_UNKNOWN_ERROR
        0x8027_003A | 0x8027_0036 | 0x8027_0035 => TrashError::plain("it could not go to the Recycle Bin"),
        // COPYENGINE_E_PATH_NOT_FOUND_SRC · ERROR_FILE_NOT_FOUND · ERROR_PATH_NOT_FOUND
        0x8027_0023 | 0x8007_0002 | 0x8007_0003 => TrashError::plain("not found"),
        // COPYENGINE_E_USER_CANCELLED · COPYENGINE_E_CANCELLED · ERROR_CANCELLED
        0x8027_0000 | 0x8027_0001 | 0x8007_04C7 => {
            TrashError::plain(if elevated { "administrator permission was not given" } else { "cancelled" })
        }
        // COPYENGINE_E_ROOT_DIR_SRC
        0x8027_001F => TrashError::plain("a drive's root cannot be moved"),
        // ERROR_DIR_NOT_EMPTY
        0x8007_0091 => TrashError::plain("a folder in it could not be emptied"),
        other => TrashError::plain(format!("shell error 0x{other:08x}")),
    }
}

/// The verdict on one queued item once the operation is over. What is on disk
/// decides whether it moved; the codes only explain why it did not. The engine
/// reports some refusals with a success code (an error "ignored" under
/// `FOF_NOERRORUI`), so a clean HRESULT alone proves nothing.
pub fn judge(item_hr: Option<i32>, still_there: bool, operation_hr: Option<i32>, elevated: bool) -> Option<TrashError> {
    if !still_there {
        return None;
    }
    let code = item_hr.filter(|hr| *hr < 0).or(operation_hr.filter(|hr| *hr < 0));
    Some(match code {
        Some(hr) => describe_shell_error(hr as u32, elevated),
        None => TrashError::plain("Windows left it where it was"),
    })
}

fn still_there(path: &str) -> bool {
    match std::fs::symlink_metadata(path) {
        Ok(_) => true,
        Err(err) => err.kind() != std::io::ErrorKind::NotFound,
    }
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

/// Shell calls want COM on the calling thread. The trash always runs on a
/// thread of its own (see `trash_with_progress`), so it brings its own
/// apartment and gives it back on the way out.
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

#[cfg(windows)]
mod shell {
    use super::{describe_shell_error, judge, still_there, ComGuard, TrashError, TrashOptions};
    use crate::disk::installed::{is_within, norm};
    use std::sync::{Arc, Mutex};
    use windows::core::{implement, Error as WinError, IUnknown, Ref, Result as WinResult, HRESULT, PCWSTR};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, IBindCtx, CLSCTX_ALL};
    use windows::Win32::UI::Shell::{
        FileOperation, IFileOperation, IFileOperationProgressSink, IFileOperationProgressSink_Impl, IShellItem,
        SHCreateItemFromParsingName, FOFX_RECYCLEONDELETE, FOFX_REQUIREELEVATION, FOFX_SHOWELEVATIONPROMPT, FOF_ALLOWUNDO,
        FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT, SIGDN_FILESYSPATH, TSF_DELETE_RECYCLE_IF_POSSIBLE,
    };

    /// HRESULT_FROM_WIN32(ERROR_CANCELLED): what the sink answers a permanent delete with.
    const REFUSE: HRESULT = HRESULT(0x8007_04C7u32 as i32);

    /// What the copy engine said about one queued item.
    #[derive(Debug, Clone, Default)]
    struct Report {
        path: String,
        key: String,
        pre_flags: Option<u32>,
        /// Flags, result, and whether it landed in the Recycle Bin.
        post: Option<(u32, i32, bool)>,
        /// The shell was about to delete it (or something in it) for good, and
        /// the sink said no.
        refused: bool,
    }

    struct Shared {
        reports: Vec<Report>,
        done: usize,
        progress: Box<dyn FnMut(usize, &str) + Send>,
    }

    #[implement(IFileOperationProgressSink)]
    struct Sink {
        shared: Arc<Mutex<Shared>>,
    }

    fn path_of(item: Ref<'_, IShellItem>) -> Option<String> {
        let item = item.as_ref()?;
        unsafe {
            let raw = item.GetDisplayName(SIGDN_FILESYSPATH).ok()?;
            let text = raw.to_string().ok();
            CoTaskMemFree(Some(raw.0 as *const _));
            text
        }
    }

    impl IFileOperationProgressSink_Impl for Sink_Impl {
        fn StartOperations(&self) -> WinResult<()> {
            Ok(())
        }
        fn FinishOperations(&self, _hrresult: HRESULT) -> WinResult<()> {
            Ok(())
        }
        fn PreRenameItem(&self, _dwflags: u32, _psiitem: Ref<'_, IShellItem>, _psznewname: &PCWSTR) -> WinResult<()> {
            Ok(())
        }
        fn PostRenameItem(&self, _dwflags: u32, _psiitem: Ref<'_, IShellItem>, _psznewname: &PCWSTR, _hrrename: HRESULT, _psinewlycreated: Ref<'_, IShellItem>) -> WinResult<()> {
            Ok(())
        }
        fn PreMoveItem(&self, _dwflags: u32, _psiitem: Ref<'_, IShellItem>, _psidestinationfolder: Ref<'_, IShellItem>, _psznewname: &PCWSTR) -> WinResult<()> {
            Ok(())
        }
        fn PostMoveItem(&self, _dwflags: u32, _psiitem: Ref<'_, IShellItem>, _psidestinationfolder: Ref<'_, IShellItem>, _psznewname: &PCWSTR, _hrmove: HRESULT, _psinewlycreated: Ref<'_, IShellItem>) -> WinResult<()> {
            Ok(())
        }
        fn PreCopyItem(&self, _dwflags: u32, _psiitem: Ref<'_, IShellItem>, _psidestinationfolder: Ref<'_, IShellItem>, _psznewname: &PCWSTR) -> WinResult<()> {
            Ok(())
        }
        fn PostCopyItem(&self, _dwflags: u32, _psiitem: Ref<'_, IShellItem>, _psidestinationfolder: Ref<'_, IShellItem>, _psznewname: &PCWSTR, _hrcopy: HRESULT, _psinewlycreated: Ref<'_, IShellItem>) -> WinResult<()> {
            Ok(())
        }
        /// The one place a permanent delete can still be stopped. Anything the
        /// shell cannot recycle — no Recycle Bin on that drive, bigger than the
        /// bin, `NukeOnDelete`, the `NoRecycleFiles` policy — arrives here
        /// without `TSF_DELETE_RECYCLE_IF_POSSIBLE`, and is refused.
        fn PreDeleteItem(&self, dwflags: u32, psiitem: Ref<'_, IShellItem>) -> WinResult<()> {
            let recycles = dwflags & TSF_DELETE_RECYCLE_IF_POSSIBLE.0 as u32 != 0;
            let path = path_of(psiitem);
            let key = path.as_deref().map(norm);
            if let Ok(mut shared) = self.shared.lock() {
                if !recycles {
                    if let Some(i) = key.as_deref().and_then(|k| shared.reports.iter().position(|r| is_within(k, &r.key))) {
                        shared.reports[i].refused = true;
                    }
                } else if let Some(i) = key.as_deref().and_then(|k| shared.reports.iter().position(|r| r.key == k && r.pre_flags.is_none())) {
                    shared.reports[i].pre_flags = Some(dwflags);
                    let (done, shown) = (shared.done, shared.reports[i].path.clone());
                    (shared.progress)(done, &shown);
                }
            }
            if recycles {
                Ok(())
            } else {
                Err(WinError::from_hresult(REFUSE))
            }
        }
        fn PostDeleteItem(&self, dwflags: u32, psiitem: Ref<'_, IShellItem>, hrdelete: HRESULT, psinewlycreated: Ref<'_, IShellItem>) -> WinResult<()> {
            let Some(path) = path_of(psiitem) else { return Ok(()) };
            let key = norm(&path);
            if let Ok(mut shared) = self.shared.lock() {
                if let Some(i) = shared.reports.iter().position(|r| r.key == key && r.post.is_none()) {
                    shared.reports[i].post = Some((dwflags, hrdelete.0, !psinewlycreated.is_null()));
                    shared.done += 1;
                }
            }
            Ok(())
        }
        fn PreNewItem(&self, _dwflags: u32, _psidestinationfolder: Ref<'_, IShellItem>, _psznewname: &PCWSTR) -> WinResult<()> {
            Ok(())
        }
        fn PostNewItem(&self, _dwflags: u32, _psidestinationfolder: Ref<'_, IShellItem>, _psznewname: &PCWSTR, _psztemplatename: &PCWSTR, _dwfileattributes: u32, _hrnew: HRESULT, _psinewitem: Ref<'_, IShellItem>) -> WinResult<()> {
            Ok(())
        }
        fn UpdateProgress(&self, _iworktotal: u32, _iworksofar: u32) -> WinResult<()> {
            Ok(())
        }
        fn ResetTimer(&self) -> WinResult<()> {
            Ok(())
        }
        fn PauseTimer(&self) -> WinResult<()> {
            Ok(())
        }
        fn ResumeTimer(&self) -> WinResult<()> {
            Ok(())
        }
    }

    pub fn trash(paths: &[String], options: TrashOptions, progress: Box<dyn FnMut(usize, &str) + Send>) -> Vec<(String, TrashError)> {
        let _com = ComGuard::enter();
        let shared = Arc::new(Mutex::new(Shared { reports: Vec::new(), done: 0, progress }));
        let failed = run(paths, options, &shared);
        if let Ok(mut s) = shared.lock() {
            (s.progress)(paths.len(), "");
        }
        failed
    }

    /// Batches until every item has had its turn: a refused permanent delete
    /// cancels whatever was still pending in that operation (that is how the
    /// shell treats an error from the sink), so those items go again in a new one.
    fn run(paths: &[String], options: TrashOptions, shared: &Arc<Mutex<Shared>>) -> Vec<(String, TrashError)> {
        let mut failed = Vec::new();
        let mut pending = paths.to_vec();
        while !pending.is_empty() {
            let (settled, cancelled) = one_batch(&pending, options, shared);
            failed.extend(settled);
            if cancelled.len() >= pending.len() {
                // Nothing moved forward; never loop on it.
                failed.extend(cancelled.into_iter().map(|p| (p, TrashError::plain("the Recycle Bin move stopped before it"))));
                break;
            }
            pending = cancelled;
        }
        failed
    }

    /// One `IFileOperation` over `paths`. Returns the failures it settled and
    /// the items a refusal cancelled before they started.
    fn one_batch(paths: &[String], options: TrashOptions, shared: &Arc<Mutex<Shared>>) -> (Vec<(String, TrashError)>, Vec<String>) {
        let fail_all = |why: String| (paths.iter().map(|p| (p.clone(), TrashError::plain(why.clone()))).collect::<Vec<_>>(), Vec::new());
        let op: IFileOperation = match unsafe { CoCreateInstance(&FileOperation, None::<&IUnknown>, CLSCTX_ALL) } {
            Ok(op) => op,
            Err(err) => {
                log::warn!("disk: no file operation from the shell: {err}");
                return fail_all(format!("the shell is unavailable ({err})"));
            }
        };
        let mut flags = FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI | FOF_ALLOWUNDO | FOFX_RECYCLEONDELETE;
        if options.elevate {
            flags = flags | FOFX_SHOWELEVATIONPROMPT | FOFX_REQUIREELEVATION;
        }
        if let Err(err) = unsafe { op.SetOperationFlags(flags) } {
            return fail_all(format!("the shell refused the options ({err})"));
        }
        if options.owner != 0 {
            let _ = unsafe { op.SetOwnerWindow(HWND(options.owner as *mut core::ffi::c_void)) };
        }
        let sink: IFileOperationProgressSink = Sink { shared: Arc::clone(shared) }.into();
        let cookie = unsafe { op.Advise(&sink) }.ok();

        let mut failed: Vec<(String, TrashError)> = Vec::new();
        let mut queued = 0usize;
        for path in paths {
            let wide: Vec<u16> = path.trim_end_matches(['\\', '/']).encode_utf16().chain(std::iter::once(0)).collect();
            let item: WinResult<IShellItem> = unsafe { SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None::<&IBindCtx>) };
            match item.and_then(|item| unsafe { op.DeleteItem(&item, None::<&IFileOperationProgressSink>) }) {
                Ok(()) => {
                    if let Ok(mut s) = shared.lock() {
                        s.reports.push(Report { path: path.clone(), key: norm(path), ..Default::default() });
                    }
                    queued += 1;
                }
                Err(err) => failed.push((path.clone(), describe_shell_error(err.code().0 as u32, options.elevate))),
            }
        }
        let operation = if queued > 0 { unsafe { op.PerformOperations() } } else { Ok(()) };
        if let Some(cookie) = cookie {
            let _ = unsafe { op.Unadvise(cookie) };
        }
        let operation_hr = operation.as_ref().err().map(|e| e.code().0);

        let reports = shared.lock().map(|mut s| std::mem::take(&mut s.reports)).unwrap_or_default();
        let refusal = reports.iter().any(|r| r.refused);
        let mut cancelled: Vec<String> = Vec::new();
        for report in reports {
            let there = still_there(&report.path);
            if report.refused {
                if there {
                    log::info!("disk: {} would have been deleted for good, not recycled: left alone", report.path);
                    failed.push((report.path, TrashError::plain("Windows would have deleted it for good instead of recycling it, so it was left alone")));
                } else {
                    log::warn!("disk: {} is gone although its permanent delete was refused", report.path);
                }
                continue;
            }
            if refusal && there && report.pre_flags.is_none() && report.post.is_none() {
                cancelled.push(report.path);
                continue;
            }
            if let Some((_, hr, false)) = report.post {
                if hr >= 0 && !there {
                    log::warn!("disk: {} was deleted rather than recycled", report.path);
                }
            }
            if let Some(error) = judge(report.post.map(|p| p.1), there, operation_hr, options.elevate) {
                log::info!(
                    "disk: {} stayed — pre {:?}, post {:?}, operation {:?}",
                    report.path,
                    report.pre_flags,
                    report.post.map(|(flags, hr, recycled)| (flags, format!("0x{:08x}", hr as u32), recycled)),
                    operation_hr.map(|hr| format!("0x{:08x}", hr as u32))
                );
                failed.push((report.path, error));
            }
        }
        (failed, cancelled)
    }
}

/// Moves each path to the Recycle Bin / Trash, calling `on_progress(done, path)`
/// as each item starts and once more (`path` empty) when the last is through;
/// returns `(path, error)` for the ones that stayed.
///
/// The shell moves a folder file by file, so a few large trees run for minutes.
/// It runs on a thread of its own, joined here: never call this on the main
/// thread — that freezes every window (see `disk_trash`).
pub fn trash_with_progress(
    paths: &[String],
    options: TrashOptions,
    on_progress: impl FnMut(usize, &str) + Send + 'static,
) -> Vec<(String, TrashError)> {
    let owned = paths.to_vec();
    let worker = std::thread::Builder::new().name("disk-trash".into()).spawn(move || {
        #[cfg(windows)]
        {
            shell::trash(&owned, options, Box::new(on_progress))
        }
        #[cfg(not(windows))]
        {
            let _ = options;
            let mut on_progress = on_progress;
            let _com = ComGuard::enter();
            let mut failed = Vec::new();
            for (i, p) in owned.iter().enumerate() {
                on_progress(i, p);
                if let Err(e) = trash_one(p) {
                    failed.push((p.clone(), TrashError::plain(e)));
                }
            }
            on_progress(owned.len(), "");
            failed
        }
    });
    match worker {
        Ok(handle) => handle
            .join()
            .unwrap_or_else(|_| paths.iter().map(|p| (p.clone(), TrashError::plain("the cleanup worker stopped"))).collect()),
        Err(err) => paths.iter().map(|p| (p.clone(), TrashError::plain(format!("could not start the cleanup ({err})")))).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refusals_that_administrator_permission_can_lift() {
        for code in [0x8027_0002u32, 0x8027_0021, 0x8007_0005, 0x8007_02E4] {
            let first = describe_shell_error(code, false);
            assert!(first.needs_admin, "0x{code:08x} should offer administrator permission");
            let again = describe_shell_error(code, true);
            assert!(!again.needs_admin, "an elevated attempt is not offered twice");
        }
        assert!(!describe_shell_error(0x8027_0027, false).needs_admin, "a file in use is not a rights problem");
        assert_eq!(describe_shell_error(0x8007_04C7, true).message, "administrator permission was not given");
        assert_eq!(describe_shell_error(0x1234_5678, false).message, "shell error 0x12345678");
    }

    #[test]
    fn what_is_on_disk_decides() {
        // Gone is moved, whatever the codes said.
        assert_eq!(judge(Some(0x8007_0005u32 as i32), false, None, false), None);
        // Still there with a clean code: the engine "ignored" an error under FOF_NOERRORUI.
        assert_eq!(judge(Some(0x0027_0005), true, None, false).unwrap().message, "Windows left it where it was");
        // The item's own code explains before the operation's does.
        let e = judge(Some(0x8007_0005u32 as i32), true, Some(0x8027_0000u32 as i32), false).unwrap();
        assert!(e.needs_admin);
        // No callback at all (the batch stopped first): the operation's code explains.
        assert_eq!(judge(None, true, Some(0x8007_04C7u32 as i32), true).unwrap().message, "administrator permission was not given");
    }

    /// The Recycle Bin move runs on a thread of its own, and shell APIs want COM
    /// on the calling thread. This checks the whole thing from a plain
    /// `std::thread` with no COM anywhere around it.
    ///
    /// `#[ignore]`d because it really does put a folder in the Recycle Bin:
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

        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::<(usize, String)>::new()));
        let log = std::sync::Arc::clone(&seen);
        let failed = std::thread::spawn(move || {
            trash_with_progress(&paths, TrashOptions::default(), move |done, path| log.lock().unwrap().push((done, path.to_string())))
        })
        .join()
        .unwrap();
        let seen = seen.lock().unwrap().clone();

        // The folder's own tick, then the closing one; the made-up path never starts.
        assert_eq!(seen.first(), Some(&(0, target.clone())), "progress ticks: {seen:?}");
        assert_eq!(seen.last(), Some(&(2, String::new())), "progress ticks: {seen:?}");

        // The real folder went to the Recycle Bin; the made-up path is reported,
        // not silently counted as freed.
        assert!(!base.exists(), "the folder should be gone from disk");
        assert_eq!(failed.len(), 1, "failures: {failed:?}");
        assert_eq!(failed[0].0, missing);
        assert_eq!(failed[0].1.message, "not found");
    }

    /// A folder Windows will not let this user move comes back `needs_admin`,
    /// which is what makes the cleanup offer administrator permission at all.
    /// Built from our own temp folder: deny DELETE on it and DELETE_CHILD on its
    /// parent for the current user (both are needed to block a rename).
    ///
    /// `#[ignore]`d: it changes ACLs on its temp folders (and undoes them):
    /// `cargo test -- --ignored a_refusal_for_rights_offers_administrator_permission`.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn a_refusal_for_rights_offers_administrator_permission() {
        let base = std::env::temp_dir().join(format!("owntools-denied-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let locked = base.join("locked");
        std::fs::create_dir_all(&locked).unwrap();
        std::fs::write(locked.join("inside.txt"), b"stays").unwrap();
        let user = std::env::var("USERNAME").unwrap();
        let icacls = |path: &std::path::Path, args: &[&str]| std::process::Command::new("icacls").arg(path).args(args).output().map(|o| o.status.success()).unwrap_or(false);
        assert!(icacls(&locked, &["/deny", &format!("{user}:(DE)")]), "icacls on the folder");
        assert!(icacls(&base, &["/deny", &format!("{user}:(DC)")]), "icacls on its parent");

        let target = locked.to_string_lossy().into_owned();
        let failed = shell::trash(&[target.clone()], TrashOptions::default(), Box::new(|_, _| {}));

        // Undo first, so a failing assert never leaves an undeletable folder behind.
        icacls(&base, &["/remove:d", &user]);
        icacls(&locked, &["/remove:d", &user]);
        let stayed = locked.exists();
        let _ = std::fs::remove_dir_all(&base);

        assert!(stayed, "the locked folder moved; failures: {failed:?}");
        assert_eq!(failed.len(), 1, "failures: {failed:?}");
        assert_eq!(failed[0].0, target);
        assert!(failed[0].1.needs_admin, "a refusal for rights must offer administrator permission: {:?}", failed[0].1);
    }

    /// A SUBST drive has no Recycle Bin, so the shell would delete a file there
    /// for good. The sink must refuse it, lose nothing, and still recycle the
    /// item queued after it (the refusal cancels the rest of that operation).
    ///
    /// `#[ignore]`d: it maps a spare drive letter with `subst` for a moment and
    /// recycles a temp file: `cargo test -- --ignored refuses_what_cannot_be_recycled`.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn refuses_what_cannot_be_recycled() {
        use windows::Win32::Storage::FileSystem::GetLogicalDrives;

        let base = std::env::temp_dir().join(format!("owntools-nuke-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("mapped")).unwrap();
        std::fs::write(base.join("mapped").join("keep-me.txt"), b"not for deleting").unwrap();
        std::fs::write(base.join("recycle-me.txt"), b"fine to recycle").unwrap();

        let used = unsafe { GetLogicalDrives() };
        let letter = (b'M'..=b'Y').rev().map(char::from).find(|c| used & (1 << (*c as u8 - b'A')) == 0).expect("a free drive letter");
        let drive = format!("{letter}:");
        let mapped = std::process::Command::new("subst").arg(&drive).arg(base.join("mapped")).status().unwrap();
        assert!(mapped.success(), "subst {drive} failed");

        let on_subst = format!("{drive}\\keep-me.txt");
        let normal = base.join("recycle-me.txt").to_string_lossy().into_owned();
        let failed = shell::trash(&[on_subst.clone(), normal.clone()], TrashOptions::default(), Box::new(|_, _| {}));

        let _ = std::process::Command::new("subst").arg(&drive).arg("/D").status();
        let kept = base.join("mapped").join("keep-me.txt").exists();
        let recycled = !std::path::Path::new(&normal).exists();
        let _ = std::fs::remove_dir_all(&base);

        assert!(kept, "the file on the SUBST drive was deleted for good; failures: {failed:?}");
        assert!(recycled, "the item after the refusal did not move; failures: {failed:?}");
        assert_eq!(failed.len(), 1, "failures: {failed:?}");
        assert_eq!(failed[0].0, on_subst);
        assert!(failed[0].1.message.contains("for good"), "{:?}", failed[0].1);
    }
}
