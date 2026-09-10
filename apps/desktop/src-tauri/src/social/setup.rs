//! Putting the MCP server into the agent's own config, so "let Claude post
//! for me" is a button rather than a paragraph of copy-paste.
//!
//! Every target here keeps its servers in a file with a documented shape, so
//! we read that file, merge one key into it and write it back atomically —
//! nothing else in it is touched, and a file we cannot parse is refused
//! rather than overwritten. The Agents page confirms before calling this:
//! writing into another program's configuration is not something to do
//! quietly.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Map, Value};

pub const SERVER_KEY: &str = "owntools-social";

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Target {
    ClaudeCode,
    Cursor,
    Windsurf,
    Codex,
}

impl Target {
    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            "claude-code" => Some(Self::ClaudeCode),
            "cursor" => Some(Self::Cursor),
            "windsurf" => Some(Self::Windsurf),
            "codex" => Some(Self::Codex),
            _ => None,
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Self::ClaudeCode => "claude-code",
            Self::Cursor => "cursor",
            Self::Windsurf => "windsurf",
            Self::Codex => "codex",
        }
    }

    /// The file this agent reads its MCP servers from, under the user's home.
    fn config_path(self) -> Option<PathBuf> {
        let home = dirs::home_dir()?;
        Some(match self {
            Self::ClaudeCode => home.join(".claude.json"),
            Self::Cursor => home.join(".cursor").join("mcp.json"),
            Self::Windsurf => home.join(".codeium").join("windsurf").join("mcp_config.json"),
            Self::Codex => home.join(".codex").join("config.toml"),
        })
    }

    /// Something that says this agent is actually installed — we only offer
    /// the button for agents the person has.
    fn marker(self) -> Option<PathBuf> {
        let home = dirs::home_dir()?;
        Some(match self {
            Self::ClaudeCode => home.join(".claude"),
            Self::Cursor => home.join(".cursor"),
            Self::Windsurf => home.join(".codeium"),
            Self::Codex => home.join(".codex"),
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetInfo {
    pub id: &'static str,
    /// Its config file exists, or the folder it lives in does.
    pub detected: bool,
    /// Our server is already in there.
    pub installed: bool,
    pub path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallOutcome {
    pub target: &'static str,
    pub path: String,
    /// "created" for a new file, "updated" for an existing one.
    pub action: &'static str,
    /// What the person still has to do (restart the agent, usually).
    pub note: String,
}

fn config_exists(path: &Path) -> bool {
    path.is_file()
}

pub fn targets() -> Vec<TargetInfo> {
    [Target::ClaudeCode, Target::Cursor, Target::Windsurf, Target::Codex]
        .into_iter()
        .map(|t| {
            let path = t.config_path();
            let installed = path.as_deref().map(|p| already_installed(t, p)).unwrap_or(false);
            TargetInfo {
                id: t.id(),
                detected: path.as_deref().map(config_exists).unwrap_or(false) || t.marker().map(|m| m.exists()).unwrap_or(false),
                installed,
                path: path.map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
            }
        })
        .collect()
}

fn already_installed(target: Target, path: &Path) -> bool {
    let Ok(text) = fs::read_to_string(path) else {
        return false;
    };
    match target {
        Target::Codex => text.contains(&format!("[mcp_servers.{SERVER_KEY}]")),
        _ => serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| v.get("mcpServers").and_then(|m| m.get(SERVER_KEY)).cloned())
            .is_some(),
    }
}

fn write_atomic(path: &Path, text: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    let tmp = path.with_extension(format!("owntools-{}.tmp", std::process::id()));
    fs::write(&tmp, text).map_err(|e| format!("{}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("{}: {e}", path.display())
    })
}

/// The `mcpServers` entry every JSON-configured agent understands.
fn server_entry(url: &str, token: &str) -> Value {
    json!({
        "type": "http",
        "url": url,
        "headers": { "Authorization": format!("Bearer {token}") }
    })
}

fn install_json(path: &Path, url: &str, token: &str) -> Result<&'static str, String> {
    let existed = config_exists(path);
    let mut root: Value = if existed {
        let text = fs::read_to_string(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
        if text.trim().is_empty() {
            json!({})
        } else {
            serde_json::from_str(&text).map_err(|e| {
                format!(
                    "{} is not valid JSON ({e}) — fix or move it first; it was left untouched",
                    path.display()
                )
            })?
        }
    } else {
        json!({})
    };
    if !root.is_object() {
        return Err(format!("{} does not hold a JSON object", path.display()));
    }
    let obj = root.as_object_mut().expect("checked object");
    let servers = obj.entry("mcpServers").or_insert_with(|| Value::Object(Map::new()));
    if !servers.is_object() {
        *servers = Value::Object(Map::new());
    }
    servers
        .as_object_mut()
        .expect("checked object")
        .insert(SERVER_KEY.to_string(), server_entry(url, token));
    let text = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    write_atomic(path, &format!("{text}\n"))?;
    Ok(if existed { "updated" } else { "created" })
}

/// Codex keeps TOML. The block is replaced when it is already there (a
/// regenerated token has to land), appended when it is not, and the rest of
/// the file is copied through line by line.
fn install_toml(path: &Path, url: &str, token: &str) -> Result<&'static str, String> {
    let existed = config_exists(path);
    let current = if existed {
        fs::read_to_string(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?
    } else {
        String::new()
    };
    let header = format!("[mcp_servers.{SERVER_KEY}]");
    let block = format!(
        "{header}\nurl = \"{url}\"\nhttp_headers = {{ Authorization = \"Bearer {token}\" }}\n",
    );
    let out = if current.contains(&header) {
        let mut kept: Vec<&str> = Vec::new();
        let mut skipping = false;
        for line in current.lines() {
            let trimmed = line.trim_start();
            if trimmed.starts_with('[') {
                skipping = trimmed.starts_with(&header);
            }
            if !skipping {
                kept.push(line);
            }
        }
        format!("{}\n{block}", kept.join("\n").trim_end())
    } else if current.trim().is_empty() {
        block
    } else {
        format!("{}\n\n{block}", current.trim_end())
    };
    write_atomic(path, &out)?;
    Ok(if existed { "updated" } else { "created" })
}

pub fn install(target_id: &str, url: &str, token: &str) -> Result<InstallOutcome, String> {
    let target = Target::from_id(target_id).ok_or_else(|| format!("unknown agent `{target_id}`"))?;
    if token.trim().is_empty() {
        return Err("the agent server has no token yet — open social → Agents once".into());
    }
    let path = target.config_path().ok_or("cannot find your home folder")?;
    let action = match target {
        Target::Codex => install_toml(&path, url, token)?,
        _ => install_json(&path, url, token)?,
    };
    let note = match target {
        Target::ClaudeCode => "Start a new Claude Code session; /mcp lists the tools.".to_string(),
        Target::Cursor => "Reload Cursor (or toggle the server in Settings → MCP).".to_string(),
        Target::Windsurf => "Refresh the MCP servers in Windsurf's Cascade panel.".to_string(),
        Target::Codex => "Restart Codex; the server is under [mcp_servers].".to_string(),
    };
    Ok(InstallOutcome { target: target.id(), path: path.to_string_lossy().to_string(), action, note })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("owntools-setup-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn json_install_keeps_everything_else_in_the_file() {
        let dir = temp("json");
        let path = dir.join("mcp.json");
        fs::write(&path, r#"{"mcpServers":{"other":{"url":"http://x"}},"theme":"dark"}"#).unwrap();
        assert_eq!(install_json(&path, "http://127.0.0.1:7474/mcp", "ss_abc").unwrap(), "updated");
        let v: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(v["theme"], json!("dark"));
        assert_eq!(v["mcpServers"]["other"]["url"], json!("http://x"));
        assert_eq!(v["mcpServers"][SERVER_KEY]["headers"]["Authorization"], json!("Bearer ss_abc"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn json_install_creates_a_missing_file() {
        let dir = temp("json-new");
        let path = dir.join("nested").join("mcp.json");
        assert_eq!(install_json(&path, "http://127.0.0.1:7474/mcp", "ss_abc").unwrap(), "created");
        assert!(already_installed(Target::Cursor, &path));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn broken_json_is_refused_not_overwritten() {
        let dir = temp("json-bad");
        let path = dir.join("mcp.json");
        fs::write(&path, "{ not json").unwrap();
        assert!(install_json(&path, "http://x/mcp", "ss_abc").is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "{ not json");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn toml_install_replaces_our_block_and_keeps_the_neighbours() {
        let dir = temp("toml");
        let path = dir.join("config.toml");
        fs::write(
            &path,
            "model = \"gpt\"\n\n[mcp_servers.owntools-social]\nurl = \"http://old\"\n\n[mcp_servers.other]\nurl = \"http://other\"\n",
        )
        .unwrap();
        assert_eq!(install_toml(&path, "http://127.0.0.1:7474/mcp", "ss_new").unwrap(), "updated");
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains("model = \"gpt\""));
        assert!(text.contains("[mcp_servers.other]"));
        assert!(text.contains("http://127.0.0.1:7474/mcp"));
        assert!(!text.contains("http://old"));
        assert_eq!(text.matches("[mcp_servers.owntools-social]").count(), 1);
        let _ = fs::remove_dir_all(&dir);
    }
}
