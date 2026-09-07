//! Volumes (drives) and the free-space monitor.
//!
//! Windows asks the kernel directly; other platforms parse `df -Pk`, which
//! is enough for a first macOS build. The monitor is a thread that samples
//! free space every 20 s into a ring buffer the Monitor page draws.

use serde::Serialize;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeInfo {
    /// Root path with its separator, e.g. `C:\` or `/`.
    pub path: String,
    pub label: String,
    pub fs: String,
    /// fixed · removable · remote · cdrom · ramdisk · unknown
    pub kind: &'static str,
    pub total: u64,
    pub free: u64,
    pub system: bool,
    pub cluster: u64,
}

fn now_secs() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

#[cfg(windows)]
fn wide(s: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
pub fn cluster_size(root: &Path) -> u64 {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceW;
    let root = root
        .components()
        .next()
        .map(|c| format!("{}\\", c.as_os_str().to_string_lossy()))
        .unwrap_or_default();
    if root.is_empty() {
        return 4096;
    }
    let w = wide(&root);
    let (mut spc, mut bps) = (0u32, 0u32);
    let ok = unsafe { GetDiskFreeSpaceW(PCWSTR(w.as_ptr()), Some(&mut spc), Some(&mut bps), None, None) }.is_ok();
    if ok && spc > 0 && bps > 0 {
        spc as u64 * bps as u64
    } else {
        4096
    }
}

#[cfg(not(windows))]
pub fn cluster_size(_root: &Path) -> u64 {
    4096
}

#[cfg(windows)]
pub fn list_volumes() -> Vec<VolumeInfo> {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW,
    };
    let system_drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into()).to_uppercase();
    let mask = unsafe { GetLogicalDrives() };
    let mut out = Vec::new();
    for i in 0..26u32 {
        if mask & (1 << i) == 0 {
            continue;
        }
        let letter = (b'A' + i as u8) as char;
        let root = format!("{letter}:\\");
        let w = wide(&root);
        let kind = match unsafe { GetDriveTypeW(PCWSTR(w.as_ptr())) } {
            2 => "removable",
            3 => "fixed",
            4 => "remote",
            5 => "cdrom",
            6 => "ramdisk",
            _ => continue,
        };
        let (mut free, mut total) = (0u64, 0u64);
        if unsafe { GetDiskFreeSpaceExW(PCWSTR(w.as_ptr()), Some(&mut free), Some(&mut total), None) }.is_err() {
            continue; // no media
        }
        let mut name_buf = [0u16; 256];
        let mut fs_buf = [0u16; 64];
        let _ = unsafe {
            GetVolumeInformationW(PCWSTR(w.as_ptr()), Some(&mut name_buf), None, None, None, Some(&mut fs_buf))
        };
        let label = String::from_utf16_lossy(&name_buf[..name_buf.iter().position(|&c| c == 0).unwrap_or(0)]);
        let fs = String::from_utf16_lossy(&fs_buf[..fs_buf.iter().position(|&c| c == 0).unwrap_or(0)]);
        let system = root.to_uppercase().starts_with(&system_drive);
        let label = if label.is_empty() {
            if system { "Windows".to_string() } else { "Local Disk".to_string() }
        } else {
            label
        };
        out.push(VolumeInfo {
            cluster: cluster_size(Path::new(&root)),
            path: root,
            label,
            fs,
            kind,
            total,
            free,
            system,
        });
    }
    out
}

#[cfg(not(windows))]
pub fn list_volumes() -> Vec<VolumeInfo> {
    let output = match std::process::Command::new("df").args(["-Pk"]).output() {
        Ok(o) => o,
        Err(_) => return Vec::new(),
    };
    let text = String::from_utf8_lossy(&output.stdout);
    let mut out = Vec::new();
    for line in text.lines().skip(1) {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 6 {
            continue;
        }
        let device = cols[0];
        let mount = cols[5..].join(" ");
        if !device.starts_with('/') {
            continue; // devfs, map auto_home, tmpfs …
        }
        if mount.starts_with("/System/Volumes/") && mount != "/System/Volumes/Data" {
            continue;
        }
        let total = cols[1].parse::<u64>().unwrap_or(0) * 1024;
        let free = cols[3].parse::<u64>().unwrap_or(0) * 1024;
        if total == 0 {
            continue;
        }
        let label = if mount == "/" {
            "Macintosh HD".to_string()
        } else {
            mount.rsplit('/').next().unwrap_or(&mount).to_string()
        };
        out.push(VolumeInfo {
            path: mount.clone(),
            label,
            fs: String::new(),
            kind: if mount.starts_with("/Volumes/") { "removable" } else { "fixed" },
            total,
            free,
            system: mount == "/" || mount == "/System/Volumes/Data",
            cluster: 4096,
        });
    }
    out
}

/// The volume a path lives on: longest matching root.
pub fn volume_for(path: &str, volumes: &[VolumeInfo]) -> Option<VolumeInfo> {
    let p = path.to_lowercase();
    volumes
        .iter()
        .filter(|v| {
            let root = v.path.to_lowercase();
            p.starts_with(&root) || p.trim_end_matches(['\\', '/']) == root.trim_end_matches(['\\', '/'])
        })
        .max_by_key(|v| v.path.len())
        .cloned()
}

// ---- monitor ---------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct MonitorSample {
    pub t: i64,
    /// Free bytes per volume, in `MonitorData::volumes` order.
    pub free: Vec<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorData {
    pub volumes: Vec<VolumeInfo>,
    pub samples: Vec<MonitorSample>,
    pub interval_s: u64,
}

const INTERVAL: Duration = Duration::from_secs(20);
const MAX_SAMPLES: usize = 24 * 60 * 3; // a day at 20 s

struct MonitorState {
    volumes: Vec<VolumeInfo>,
    samples: Vec<MonitorSample>,
}

static MONITOR: Mutex<Option<MonitorState>> = Mutex::new(None);
static MONITOR_RUNNING: AtomicBool = AtomicBool::new(false);

fn take_sample() {
    let volumes = list_volumes();
    let mut guard = match MONITOR.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    let state = guard.get_or_insert_with(|| MonitorState { volumes: Vec::new(), samples: Vec::new() });
    let same_set = state.volumes.len() == volumes.len()
        && state.volumes.iter().zip(volumes.iter()).all(|(a, b)| a.path == b.path);
    if !same_set {
        state.samples.clear();
    }
    let sample = MonitorSample { t: now_secs(), free: volumes.iter().map(|v| v.free).collect() };
    state.volumes = volumes;
    state.samples.push(sample);
    if state.samples.len() > MAX_SAMPLES {
        let drop = state.samples.len() - MAX_SAMPLES;
        state.samples.drain(..drop);
    }
}

/// Starts the sampler once; idempotent. Takes a sample right away.
pub fn monitor_start() {
    take_sample();
    if MONITOR_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::Builder::new()
        .name("disk-monitor".into())
        .spawn(|| loop {
            std::thread::sleep(INTERVAL);
            take_sample();
        })
        .ok();
}

pub fn monitor_read() -> MonitorData {
    let guard = MONITOR.lock().ok();
    match guard.as_deref() {
        Some(Some(state)) => MonitorData {
            volumes: state.volumes.clone(),
            samples: state.samples.clone(),
            interval_s: INTERVAL.as_secs(),
        },
        _ => MonitorData { volumes: list_volumes(), samples: Vec::new(), interval_s: INTERVAL.as_secs() },
    }
}
