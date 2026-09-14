fn main() {
    // tauri-build compiles icons/icon.ico into the exe's resources (what Explorer,
    // the taskbar and Alt+Tab show) but only asks cargo to rerun for
    // tauri.conf.json and capabilities/, so a new icon alone kept linking the old
    // resource. icon.png is the default window icon on macOS / Linux.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.png");
    tauri_build::build()
}
