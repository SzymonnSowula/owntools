//! Session launcher — starts the apps, links, folders and terminals that a
//! workspace's ritual is made of. Everything here is user-configured and runs
//! on the user's own machine; nothing is fetched or resolved remotely.

use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchStep {
    pub id: String,
    /// "app" | "url" | "folder" | "terminal"
    pub kind: String,
    pub target: String,
    #[serde(default)]
    pub args: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchOutcome {
    pub id: String,
    pub ok: bool,
    pub error: Option<String>,
}

/// Quote-aware split, so `--profile "My Profile" -n` survives as two args.
fn split_args(raw: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    let mut started = false;
    for ch in raw.chars() {
        match ch {
            '"' => {
                quoted = !quoted;
                started = true;
            }
            c if c.is_whitespace() && !quoted => {
                if started {
                    out.push(std::mem::take(&mut cur));
                    started = false;
                }
            }
            c => {
                cur.push(c);
                started = true;
            }
        }
    }
    if started {
        out.push(cur);
    }
    out
}

fn dir(cwd: &Option<String>) -> Option<&str> {
    cwd.as_deref().filter(|d| !d.trim().is_empty())
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;

    /// Double quotes would break out of the `cmd /C start ""` wrapper.
    fn quote_safe(value: &str) -> String {
        value.replace('"', "")
    }

    /// `cmd /C <raw>` with no console flash — used for the shell's `start` verb,
    /// which is what resolves .lnk/.url files and the default browser.
    fn shell(raw: String, cwd: Option<&str>) -> std::io::Result<()> {
        let mut cmd = Command::new("cmd");
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.raw_arg("/C");
        cmd.raw_arg(raw);
        if let Some(d) = cwd {
            cmd.current_dir(d);
        }
        cmd.spawn().map(|_| ())
    }

    pub fn app(step: &LaunchStep) -> std::io::Result<()> {
        let lower = step.target.to_ascii_lowercase();
        let args = step.args.as_deref().unwrap_or("");
        if lower.ends_with(".lnk") || lower.ends_with(".url") {
            // Shortcuts have to go through the shell to be resolved.
            let raw = format!("start \"\" \"{}\" {}", quote_safe(&step.target), args);
            return shell(raw, dir(&step.cwd));
        }
        let mut cmd = Command::new(&step.target);
        cmd.args(split_args(args));
        if let Some(d) = dir(&step.cwd) {
            cmd.current_dir(d);
        }
        cmd.spawn().map(|_| ())
    }

    pub fn url(step: &LaunchStep) -> std::io::Result<()> {
        shell(format!("start \"\" \"{}\"", quote_safe(&step.target)), None)
    }

    pub fn folder(step: &LaunchStep) -> std::io::Result<()> {
        Command::new("explorer")
            .arg(&step.target)
            .spawn()
            .map(|_| ())
    }

    pub fn terminal(step: &LaunchStep) -> std::io::Result<()> {
        // A fresh console that stays open after the command finishes, so
        // `pnpm dev`, `claude` or `codex` keep running in it.
        let mut cmd = Command::new("cmd");
        cmd.creation_flags(CREATE_NEW_CONSOLE);
        cmd.raw_arg("/K");
        cmd.raw_arg(step.target.clone());
        if let Some(d) = dir(&step.cwd) {
            cmd.current_dir(d);
        }
        cmd.spawn().map(|_| ())
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;

    fn shell_escape(value: &str) -> String {
        format!("'{}'", value.replace('\'', "'\\''"))
    }

    pub fn app(step: &LaunchStep) -> std::io::Result<()> {
        let args = split_args(step.args.as_deref().unwrap_or(""));
        if step.target.to_ascii_lowercase().ends_with(".app") {
            let mut cmd = Command::new("open");
            cmd.arg("-a").arg(&step.target);
            if !args.is_empty() {
                cmd.arg("--args").args(args);
            }
            return cmd.spawn().map(|_| ());
        }
        let mut cmd = Command::new(&step.target);
        cmd.args(args);
        if let Some(d) = dir(&step.cwd) {
            cmd.current_dir(d);
        }
        cmd.spawn().map(|_| ())
    }

    pub fn url(step: &LaunchStep) -> std::io::Result<()> {
        Command::new("open").arg(&step.target).spawn().map(|_| ())
    }

    pub fn folder(step: &LaunchStep) -> std::io::Result<()> {
        url(step)
    }

    pub fn terminal(step: &LaunchStep) -> std::io::Result<()> {
        let script = match dir(&step.cwd) {
            Some(d) => format!("cd {} && {}", shell_escape(d), step.target),
            None => step.target.clone(),
        };
        let apple = format!(
            "tell application \"Terminal\" to do script \"{}\"",
            script.replace('\\', "\\\\").replace('"', "\\\"")
        );
        Command::new("osascript")
            .arg("-e")
            .arg(apple)
            .arg("-e")
            .arg("tell application \"Terminal\" to activate")
            .spawn()
            .map(|_| ())
    }
}

#[cfg(all(not(windows), not(target_os = "macos")))]
mod platform {
    use super::*;

    pub fn app(step: &LaunchStep) -> std::io::Result<()> {
        let mut cmd = Command::new(&step.target);
        cmd.args(split_args(step.args.as_deref().unwrap_or("")));
        if let Some(d) = dir(&step.cwd) {
            cmd.current_dir(d);
        }
        cmd.spawn().map(|_| ())
    }

    pub fn url(step: &LaunchStep) -> std::io::Result<()> {
        Command::new("xdg-open")
            .arg(&step.target)
            .spawn()
            .map(|_| ())
    }

    pub fn folder(step: &LaunchStep) -> std::io::Result<()> {
        url(step)
    }

    pub fn terminal(step: &LaunchStep) -> std::io::Result<()> {
        let mut cmd = Command::new("x-terminal-emulator");
        cmd.arg("-e")
            .arg("sh")
            .arg("-c")
            .arg(format!("{}; exec sh", step.target));
        if let Some(d) = dir(&step.cwd) {
            cmd.current_dir(d);
        }
        cmd.spawn().map(|_| ())
    }
}

fn run_step(step: &LaunchStep) -> Result<(), String> {
    if step.target.trim().is_empty() {
        return Err("nothing to launch".into());
    }
    let result = match step.kind.as_str() {
        "app" => platform::app(step),
        "url" => platform::url(step),
        "folder" => platform::folder(step),
        "terminal" => platform::terminal(step),
        other => return Err(format!("unknown step type: {other}")),
    };
    result.map_err(|e| e.to_string())
}

/// Launch every step in order and report per-step outcomes; one failure never
/// stops the rest of the session from starting.
#[tauri::command(async)]
pub fn launch_session(steps: Vec<LaunchStep>) -> Vec<LaunchOutcome> {
    steps
        .iter()
        .map(|step| match run_step(step) {
            Ok(()) => LaunchOutcome {
                id: step.id.clone(),
                ok: true,
                error: None,
            },
            Err(error) => LaunchOutcome {
                id: step.id.clone(),
                ok: false,
                error: Some(error),
            },
        })
        .collect()
}

/// The ritual editor points at paths outside the fs plugin's scope (Program
/// Files, project folders), so it asks the backend instead.
#[tauri::command(async)]
pub fn path_exists(path: String) -> bool {
    !path.trim().is_empty() && std::path::Path::new(&path).exists()
}
