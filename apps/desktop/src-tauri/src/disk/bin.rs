//! The Recycle Bin, measured before anything is sent to it.
//!
//! "Moved to the Recycle Bin" is only a promise while the bin really takes the
//! item, and there are two ways it does not:
//!
//! 1. **There is no bin to take it.** A removable, network or SUBST drive, a
//!    bin set to delete right away (`NukeOnDelete`), a policy that turns it off
//!    (`NoRecycleFiles`) — and a shell operation told not to ask deletes for
//!    good. `sys.rs` refuses that at the last moment inside the file operation
//!    itself; this is the early answer, per drive, that a dialog can show.
//! 2. **The bin is full.** It keeps a fixed amount per drive — `MaxCapacity`
//!    (MB) under `BitBucket\Volume\{GUID}`, by default 10 % of the first 40 GiB
//!    plus 5 % of the rest, which is 26,416 MB on a 476 GB drive (checked on a
//!    real machine, 2026-09-13) — and Windows makes room by erasing its oldest
//!    items for good. A cleanup bigger than the bin therefore erases part of
//!    itself: the duplicates page was one click away from sending 25.1 GB into
//!    a 25.8 GB bin.
//!
//! So a batch is measured per drive first, and a drive's share that does not
//! fit is refused as a whole: nothing half-done, nothing silently gone.

use serde::Serialize;
use std::collections::HashMap;

const MIB: u64 = 1024 * 1024;
const GIB: u64 = 1024 * MIB;

/// One drive's Recycle Bin.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BinInfo {
    pub has_bin: bool,
    /// Why there is no bin, when there is none.
    pub reason: Option<String>,
    /// Bytes the bin keeps before Windows erases its oldest items.
    pub capacity: u64,
    /// Bytes already in it.
    pub used: u64,
}

/// A drive's bin and what a batch would put in it — what a confirm dialog shows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinUse {
    /// The drive, e.g. `C:\`.
    pub root: String,
    pub has_bin: bool,
    pub reason: Option<String>,
    pub capacity: u64,
    pub used: u64,
    pub adding: u64,
    pub items: u32,
    /// The batch would push this much of what is already in the bin out for good.
    pub evicts: u64,
}

pub struct Recyclable {
    /// `(id, path, bytes)` the bin will take.
    pub ok: Vec<(u32, String, u64)>,
    /// `(id, path, why)` left alone, because Windows would delete them for good.
    pub refused: Vec<(u32, String, String)>,
    pub bins: Vec<BinUse>,
}

/// Splits `(id, path, bytes)` targets into what the Recycle Bin will take and
/// what it would not (see the module docs), drive by drive.
pub fn recyclable(targets: &[(u32, String, u64)]) -> Recyclable {
    recyclable_with(targets, volume_root, bin_info)
}

fn recyclable_with(
    targets: &[(u32, String, u64)],
    root_of: impl Fn(&str) -> String,
    info_of: impl Fn(&str) -> BinInfo,
) -> Recyclable {
    let mut roots: Vec<String> = Vec::new();
    let mut members: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, (_, path, _)) in targets.iter().enumerate() {
        let root = root_of(path);
        let key = if cfg!(windows) { root.to_lowercase() } else { root.clone() };
        if !members.contains_key(&key) {
            roots.push(root);
        }
        members.entry(key).or_default().push(i);
    }
    let mut out = Recyclable { ok: Vec::new(), refused: Vec::new(), bins: Vec::new() };
    for root in roots {
        let key = if cfg!(windows) { root.to_lowercase() } else { root.clone() };
        let idx = &members[&key];
        let info = info_of(&root);
        let adding: u64 = idx.iter().map(|&i| targets[i].2).sum();
        let why = if !info.has_bin {
            Some(format!("{} — it would be deleted for good, so it was left alone", info.reason.clone().unwrap_or_else(|| format!("{root} has no Recycle Bin"))))
        } else if adding > info.capacity {
            Some(format!(
                "{} together is more than the Recycle Bin on {root} holds ({}); Windows would erase part of it for good. Move less at a time",
                human(adding),
                human(info.capacity)
            ))
        } else {
            None
        };
        for &i in idx {
            let (id, path, bytes) = &targets[i];
            match &why {
                Some(why) => out.refused.push((*id, path.clone(), why.clone())),
                None => out.ok.push((*id, path.clone(), *bytes)),
            }
        }
        out.bins.push(BinUse {
            evicts: if info.has_bin { (info.used + adding).saturating_sub(info.capacity).min(info.used) } else { 0 },
            root,
            has_bin: info.has_bin,
            reason: info.reason,
            capacity: info.capacity,
            used: info.used,
            adding,
            items: idx.len() as u32,
        });
    }
    out
}

/// Windows' default bin size for a drive of `total` bytes, when no one set one.
pub fn default_capacity(total: u64) -> u64 {
    let first = total.min(40 * GIB);
    first / 10 + total.saturating_sub(40 * GIB) / 20
}

/// "25.8 GB" — binary-scaled, like the UI's `formatBytes`.
pub fn human(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        return format!("{bytes} B");
    }
    let digits = if value >= 100.0 { 0 } else if value >= 10.0 { 1 } else { 2 };
    let text = format!("{value:.digits$}");
    let text = if digits > 0 { text.trim_end_matches('0').trim_end_matches('.').to_string() } else { text };
    format!("{text} {}", UNITS[unit])
}

#[cfg(windows)]
fn wide(s: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
fn from_wide(buf: &[u16]) -> String {
    String::from_utf16_lossy(&buf[..buf.iter().position(|&c| c == 0).unwrap_or(buf.len())])
}

/// The root of the volume `path` lives on: `C:\`, or the folder a volume is mounted in.
#[cfg(windows)]
pub fn volume_root(path: &str) -> String {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetVolumePathNameW;
    let w = wide(path);
    let mut buf = [0u16; 1024];
    if unsafe { GetVolumePathNameW(PCWSTR(w.as_ptr()), &mut buf) }.is_ok() {
        let root = from_wide(&buf);
        if !root.is_empty() {
            return root;
        }
    }
    std::path::Path::new(path)
        .components()
        .next()
        .map(|c| format!("{}\\", c.as_os_str().to_string_lossy()))
        .unwrap_or_default()
}

#[cfg(windows)]
pub fn bin_info(root: &str) -> BinInfo {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        GetDiskFreeSpaceExW, GetDriveTypeW, GetVolumeNameForVolumeMountPointW, QueryDosDeviceW,
    };
    use windows::Win32::UI::Shell::{SHQueryRecycleBinW, SHQUERYRBINFO};
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let none = |why: String| BinInfo { has_bin: false, reason: Some(why), capacity: 0, used: 0 };
    let w = wide(root);
    match unsafe { GetDriveTypeW(PCWSTR(w.as_ptr())) } {
        3 => {} // DRIVE_FIXED
        2 => return none(format!("{root} is a removable drive, which has no Recycle Bin")),
        4 => return none(format!("{root} is a network drive, which has no Recycle Bin")),
        _ => return none(format!("{root} has no Recycle Bin")),
    }
    // A SUBST drive reports as fixed, and deleting on it is for good.
    let letter = root.trim_end_matches(['\\', '/']);
    if letter.len() == 2 && letter.ends_with(':') {
        let mut target = [0u16; 512];
        if unsafe { QueryDosDeviceW(PCWSTR(wide(letter).as_ptr()), Some(&mut target)) } > 0 && from_wide(&target).starts_with("\\??\\") {
            return none(format!("{root} is a SUBST drive, which has no Recycle Bin"));
        }
    }
    let policy = |hive| {
        RegKey::predef(hive)
            .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Policies\Explorer")
            .and_then(|k| k.get_value::<u32, _>("NoRecycleFiles"))
            .map(|v| v == 1)
            .unwrap_or(false)
    };
    if policy(HKEY_CURRENT_USER) || policy(HKEY_LOCAL_MACHINE) {
        return none("a policy on this PC turns the Recycle Bin off".into());
    }
    let mut total = 0u64;
    let _ = unsafe { GetDiskFreeSpaceExW(PCWSTR(w.as_ptr()), None, Some(&mut total), None) };
    let mut capacity = default_capacity(total);
    let mut volume = [0u16; 128];
    if unsafe { GetVolumeNameForVolumeMountPointW(PCWSTR(w.as_ptr()), &mut volume) }.is_ok() {
        let name = from_wide(&volume); // \\?\Volume{GUID}\
        if let (Some(a), Some(b)) = (name.find('{'), name.rfind('}')) {
            let key = format!(r"Software\Microsoft\Windows\CurrentVersion\Explorer\BitBucket\Volume\{}", &name[a..=b]);
            if let Ok(k) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(key) {
                if k.get_value::<u32, _>("NukeOnDelete").map(|v| v == 1).unwrap_or(false) {
                    return none(format!("the Recycle Bin on {root} is set to delete files right away"));
                }
                if let Ok(mb) = k.get_value::<u32, _>("MaxCapacity") {
                    capacity = mb as u64 * MIB;
                }
            }
        }
    }
    let mut query = SHQUERYRBINFO { cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32, ..Default::default() };
    let used = if unsafe { SHQueryRecycleBinW(PCWSTR(w.as_ptr()), &mut query) }.is_ok() { query.i64Size.max(0) as u64 } else { 0 };
    BinInfo { has_bin: true, reason: None, capacity, used }
}

/// Not measured outside Windows yet: the Trash has no size limit to overflow,
/// and a volume without one is Finder's call (see docs/macos.md).
#[cfg(not(windows))]
pub fn volume_root(_path: &str) -> String {
    "/".into()
}

#[cfg(not(windows))]
pub fn bin_info(_root: &str) -> BinInfo {
    BinInfo { has_bin: true, reason: None, capacity: u64::MAX, used: 0 }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_size_matches_windows() {
        // A 476 GB system drive whose registry says MaxCapacity = 26416 (MB).
        let got = default_capacity(510_983_663_616) as f64 / MIB as f64;
        assert!((got - 26_416.0).abs() < 26.0, "{got} MB");
        assert_eq!(default_capacity(20 * GIB), 2 * GIB);
        assert_eq!(default_capacity(0), 0);
    }

    #[test]
    fn formats_like_the_ui() {
        assert_eq!(human(512), "512 B");
        assert_eq!(human(26_416 * MIB), "25.8 GB");
        assert_eq!(human(25 * GIB), "25 GB");
        assert_eq!(human(1536 * MIB), "1.5 GB");
        assert_eq!(human(140 * MIB), "140 MB");
    }

    #[test]
    fn a_batch_the_bin_cannot_hold_is_refused_per_drive() {
        let targets = vec![
            (1, "C:\\Users\\me\\a.mkv".to_string(), 10 * GIB),
            (2, "D:\\stick\\b.mkv".to_string(), GIB),
            (3, "E:\\big\\c.mkv".to_string(), 20 * GIB),
            (4, "C:\\Users\\me\\d.mkv".to_string(), 5 * GIB),
            (5, "E:\\big\\e.mkv".to_string(), 10 * GIB),
        ];
        let got = recyclable_with(
            &targets,
            |p| format!("{}\\", &p[..2]),
            |root| match root {
                "C:\\" => BinInfo { has_bin: true, reason: None, capacity: 25 * GIB, used: 12 * GIB },
                "D:\\" => BinInfo { has_bin: false, reason: Some("D:\\ is a removable drive, which has no Recycle Bin".into()), capacity: 0, used: 0 },
                _ => BinInfo { has_bin: true, reason: None, capacity: 25 * GIB, used: 0 },
            },
        );
        assert_eq!(got.ok.iter().map(|t| t.0).collect::<Vec<_>>(), vec![1, 4]);
        assert_eq!(got.refused.iter().map(|t| t.0).collect::<Vec<_>>(), vec![2, 3, 5]);
        assert!(got.refused[0].2.contains("removable"));
        assert!(got.refused[1].2.contains("more than the Recycle Bin on E:\\ holds (25 GB)"), "{}", got.refused[1].2);
        let c = &got.bins[0];
        assert_eq!((c.root.as_str(), c.adding, c.items), ("C:\\", 15 * GIB, 2));
        // 12 GB already in a 25 GB bin plus 15 GB: the oldest 2 GB go for good.
        assert_eq!(c.evicts, 2 * GIB);
        assert_eq!(got.bins.len(), 3);
    }

    /// Prints this machine's bins: `cargo test -- --ignored bins_on_this_machine --nocapture`.
    #[test]
    #[ignore]
    fn bins_on_this_machine() {
        for root in ["C:\\", "D:\\"] {
            println!("{root}: {:?}", bin_info(root));
        }
        println!("root of this crate: {}", volume_root(env!("CARGO_MANIFEST_DIR")));
    }
}
