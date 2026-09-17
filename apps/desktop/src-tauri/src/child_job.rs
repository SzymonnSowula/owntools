//! Child processes that must not outlive owntools.
//!
//! The resident recognizer (parakeet.rs) and the language model server (llm.rs)
//! hold 0.6–3.7 GB between them, and they were only ever stopped on a clean
//! `RunEvent::Exit`. The updater leaves through `process::exit`, which fires no
//! such event; a crash or End task does not either — each left the servers
//! running until the next reboot, and the next start launched a second copy.
//!
//! Windows closes every handle a process holds when it ends, however it ends,
//! and a Job Object created with `KILL_ON_JOB_CLOSE` takes its processes down
//! with its last handle. owntools holds the only one. Only the servers go in:
//! whatever owntools opens on the person's behalf (apps and terminals of a
//! workspace session, an uninstaller, the installer the updater runs) has to
//! outlive it.

use std::process::Child;

/// Ties the child's lifetime to this process. Best effort: a failure is logged
/// and the child still runs, with the old exit-time cleanup behind it.
#[cfg(windows)]
pub fn adopt(child: &Child) {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::AssignProcessToJobObject;

    let Some(job) = platform::job() else {
        return;
    };
    // SAFETY: both handles are valid for the duration of the call; the child's
    // is owned by `child`, the job's by the process-wide static.
    let assigned = unsafe { AssignProcessToJobObject(job, HANDLE(child.as_raw_handle())) };
    if let Err(e) = assigned {
        log::warn!("child process {} is not tied to owntools' lifetime: {e}", child.id());
    }
}

#[cfg(not(windows))]
pub fn adopt(_child: &Child) {}

#[cfg(windows)]
mod platform {
    use std::sync::OnceLock;

    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::{
        CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    /// The job, created on first use and never closed: its handle closing is
    /// precisely the moment owntools is gone.
    pub fn job() -> Option<HANDLE> {
        static JOB: OnceLock<Option<usize>> = OnceLock::new();
        let raw = *JOB.get_or_init(|| {
            // SAFETY: plain kernel calls on a handle this function owns.
            let created = unsafe {
                let job = CreateJobObjectW(None, PCWSTR::null());
                job.and_then(|job| {
                    let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
                    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                    SetInformationJobObject(
                        job,
                        JobObjectExtendedLimitInformation,
                        &info as *const _ as *const core::ffi::c_void,
                        std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                    )
                    .map(|()| job)
                })
            };
            match created {
                Ok(job) => Some(job.0 as usize),
                Err(e) => {
                    log::warn!("no job object for the model servers: {e}");
                    None
                }
            }
        });
        raw.map(|h| HANDLE(h as *mut core::ffi::c_void))
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    /// A child in the job is killed when the job's last handle goes; here the
    /// handle stays open (it belongs to the test process), so it only checks
    /// that adoption succeeds and the child keeps running until it is stopped.
    #[test]
    fn a_child_can_be_adopted() {
        let mut child = std::process::Command::new("ping")
            .args(["-n", "30", "127.0.0.1"])
            .stdout(std::process::Stdio::null())
            .spawn()
            .expect("ping starts");
        assert!(platform::job().is_some());
        adopt(&child);
        assert!(child.try_wait().expect("status").is_none(), "still running after adoption");
        child.kill().expect("kill");
        let _ = child.wait();
    }
}
