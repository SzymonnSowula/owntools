//! What an agent needs beyond reading and writing posts: what each network
//! allows, whether a draft actually fits, and when the next free slot is.
//!
//! The catalogue is not duplicated here. `networks.ts` is the one source and
//! the frontend mirrors it into `<AppData>/social/networks.json` on start;
//! this module reads that file. The small table below is only a fallback for
//! the live networks, so an agent asking before the app has ever written the
//! mirror gets sane numbers rather than nothing.

use std::path::Path;

use chrono::{Datelike, Duration, Local, NaiveDate, SecondsFormat, TimeZone, Timelike};
use serde_json::{json, Map, Value};

use super::store::{self, ApiError, PostFilter};

const FALLBACK: &str = r#"[
  {"id":"x","name":"X","availability":"byo","chars":280,"images":4,"videos":1,"threads":true},
  {"id":"bluesky","name":"Bluesky","availability":"live","chars":300,"images":4,"videos":1,"threads":true,"videoBytes":52428800,"videoSeconds":180},
  {"id":"mastodon","name":"Mastodon","availability":"live","chars":500,"images":4,"videos":1,"threads":true},
  {"id":"telegram","name":"Telegram","availability":"live","chars":4096,"charsWithMedia":1024,"images":10,"videos":10},
  {"id":"discord","name":"Discord","availability":"live","chars":2000,"images":10,"videos":10},
  {"id":"slack","name":"Slack","availability":"live","chars":4000,"images":0,"videos":0},
  {"id":"mattermost","name":"Mattermost","availability":"live","chars":4000,"images":0,"videos":0},
  {"id":"devto","name":"Dev.to","availability":"live","chars":0,"images":1,"videos":0,"titleRequired":true},
  {"id":"medium","name":"Medium","availability":"live","chars":0,"images":0,"videos":0,"titleRequired":true}
]"#;

/// Every network the app knows, as the frontend mirrored it.
pub fn catalogue(root: &Path) -> Vec<Value> {
    store::read_json(&root.join("networks.json"))
        .and_then(|v| v.get("networks").and_then(Value::as_array).cloned())
        .filter(|list| !list.is_empty())
        .unwrap_or_else(|| serde_json::from_str::<Vec<Value>>(FALLBACK).unwrap_or_default())
}

pub fn network(root: &Path, id: &str) -> Option<Value> {
    catalogue(root).into_iter().find(|n| n.get("id").and_then(Value::as_str) == Some(id))
}

fn num(net: &Value, key: &str) -> Option<u64> {
    net.get(key).and_then(Value::as_u64)
}

/// twitter-text v3 weights: Latin, Cyrillic, punctuation = 1; emoji, CJK = 2.
fn x_weight(cp: u32) -> usize {
    match cp {
        0..=4351 => 1,
        8192..=8205 => 1,
        8208..=8223 => 1,
        8242..=8247 => 1,
        _ => 2,
    }
}

/// Byte ranges of every http(s) link in `text`, in character positions.
fn links(text: &str) -> Vec<(usize, usize)> {
    let chars: Vec<char> = text.chars().collect();
    let lower: String = text.to_lowercase();
    let lower_chars: Vec<char> = lower.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let starts_here = lower_chars[i..].starts_with(&['h', 't', 't', 'p'])
            && (i == 0 || !chars[i - 1].is_alphanumeric())
            && (lower_chars[i..].starts_with(&['h', 't', 't', 'p', 's', ':', '/', '/'])
                || lower_chars[i..].starts_with(&['h', 't', 't', 'p', ':', '/', '/']));
        if starts_here {
            let mut end = i;
            while end < chars.len() && !chars[end].is_whitespace() {
                end += 1;
            }
            // Trailing punctuation is not part of the link.
            while end > i && matches!(chars[end - 1], '.' | ',' | ';' | ')' | ']' | '!' | '?') {
                end -= 1;
            }
            out.push((i, end));
            i = end;
        } else {
            i += 1;
        }
    }
    out
}

/// How long `text` is in that network's own units — the same rules as
/// `limits.ts measure`, so the number an agent sees is the number the
/// composer shows. Grapheme clusters are approximated by chars, which only
/// differs for joined emoji.
pub fn measure(network_id: &str, text: &str) -> usize {
    let chars: Vec<char> = text.chars().collect();
    if network_id == "bluesky" {
        return chars.len();
    }
    let url_23 = matches!(network_id, "x" | "mastodon");
    let count = |slice: &[char]| -> usize {
        if network_id == "x" {
            slice.iter().map(|c| x_weight(*c as u32)).sum()
        } else {
            slice.len()
        }
    };
    if !url_23 {
        return count(&chars);
    }
    let mut total = 0;
    let mut cursor = 0;
    for (start, end) in links(text) {
        total += count(&chars[cursor..start]) + 23;
        cursor = end;
    }
    total + count(&chars[cursor..])
}

fn issue(level: &str, message: String) -> Value {
    json!({ "level": level, "message": message })
}

/// Would this go out cleanly? Same checks the composer runs, answered before
/// anything is written — an agent can fix the text instead of scheduling a
/// post that fails at midnight.
pub fn check_post(root: &Path, body: &Value) -> Result<Value, ApiError> {
    let text = body.get("text").and_then(Value::as_str).unwrap_or("");
    let title = body.get("title").and_then(Value::as_str).unwrap_or("");
    let media_ids: Vec<String> = body
        .get("media")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();
    let requested: Vec<String> = body
        .get("channelIds")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    let channels = store::list_channels(root);
    let media = store::list_media(root);
    let media_of = |id: &str| media.iter().find(|m| m.get("id").and_then(Value::as_str) == Some(id)).cloned();
    let targets: Vec<Value> = if requested.is_empty() {
        channels.clone()
    } else {
        channels
            .iter()
            .filter(|c| requested.iter().any(|id| c.get("id").and_then(Value::as_str) == Some(id.as_str())))
            .cloned()
            .collect()
    };
    if targets.is_empty() {
        return Err(ApiError::bad("no channel to check — connect one, or pass channelIds from list_channels"));
    }

    let images = media_ids
        .iter()
        .filter(|id| media_of(id).and_then(|m| m.get("mime").and_then(Value::as_str).map(|s| s.starts_with("image/"))).unwrap_or(false))
        .count();
    let videos = media_ids
        .iter()
        .filter(|id| media_of(id).and_then(|m| m.get("mime").and_then(Value::as_str).map(|s| s.starts_with("video/"))).unwrap_or(false))
        .count();

    let mut results = Vec::new();
    let mut worst_ok = true;
    for ch in &targets {
        let ch_id = ch.get("id").and_then(Value::as_str).unwrap_or("");
        let provider = ch.get("provider").and_then(Value::as_str).unwrap_or("");
        let net = network(root, provider).unwrap_or_else(|| json!({ "id": provider, "name": provider }));
        let name = net.get("name").and_then(Value::as_str).unwrap_or(provider).to_string();
        let mut issues = Vec::new();

        let limit = ch
            .get("preferences")
            .and_then(|p| p.get("charLimit"))
            .and_then(Value::as_u64)
            .or_else(|| if media_ids.is_empty() { None } else { num(&net, "charsWithMedia") })
            .or_else(|| num(&net, "chars"))
            .unwrap_or(0);
        let length = measure(provider, text);
        if limit > 0 && length as u64 > limit {
            issues.push(issue("error", format!("{} over the {}-character limit for {}.", length as u64 - limit, limit, name)));
        }
        if text.trim().is_empty() && media_ids.is_empty() {
            issues.push(issue("error", "Nothing to post — add text or media.".into()));
        }
        if net.get("titleRequired").and_then(Value::as_bool).unwrap_or(false) && title.trim().is_empty() {
            issues.push(issue("error", format!("{name} needs a title.")));
        }
        if let Some(max) = num(&net, "images") {
            if images as u64 > max {
                issues.push(issue(
                    if max == 0 { "warning" } else { "error" },
                    if max == 0 { format!("{name} takes no images — they are left out.") } else { format!("{name} allows {max} image(s); {images} attached.") },
                ));
            }
        }
        if let Some(max) = num(&net, "videos") {
            if videos as u64 > max {
                issues.push(issue(
                    if max == 0 { "warning" } else { "error" },
                    if max == 0 { format!("{name} takes no video — it is left out.") } else { format!("{name} allows {max} video(s).") },
                ));
            }
        }
        for id in &media_ids {
            let Some(item) = media_of(id) else {
                issues.push(issue("error", format!("no media `{id}` — list_media shows the ids.")));
                continue;
            };
            let bytes = item.get("bytes").and_then(Value::as_u64).unwrap_or(0);
            let is_video = item.get("mime").and_then(Value::as_str).map(|m| m.starts_with("video/")).unwrap_or(false);
            let file = item.get("name").and_then(Value::as_str).unwrap_or(id);
            if is_video {
                if let Some(max) = num(&net, "videoBytes") {
                    if bytes > max {
                        issues.push(issue("error", format!("{file} is {:.1} MB; {name} takes up to {} MB of video.", bytes as f64 / 1_048_576.0, max / 1_048_576)));
                    }
                }
                if let (Some(max), Some(secs)) = (num(&net, "videoSeconds"), item.get("duration").and_then(Value::as_f64)) {
                    if secs > max as f64 {
                        issues.push(issue("error", format!("{file} runs {:.0} s; {name} allows {max} s.", secs)));
                    }
                }
            } else if let Some(max) = num(&net, "imageBytes") {
                if bytes > max {
                    issues.push(issue("error", format!("{file} is {:.1} MB; {name} takes up to {} MB per image.", bytes as f64 / 1_048_576.0, max / 1_048_576)));
                }
            }
        }
        if ch.get("stub").and_then(Value::as_bool).unwrap_or(false) {
            issues.push(issue("error", format!("{name} publishing is not wired up in this build yet.")));
        }
        if ch.get("disabled").and_then(Value::as_bool).unwrap_or(false) {
            issues.push(issue("error", format!("{} is disabled.", ch.get("displayName").and_then(Value::as_str).unwrap_or(ch_id))));
        }
        // `health` is what the app learned from the channel's last publish or
        // connection test. Signed out blocks like disabled does; billing is a
        // warning, because credits can be added before the post's time.
        if let Some(health) = ch.get("health") {
            let label = ch.get("displayName").and_then(Value::as_str).unwrap_or(ch_id);
            let said = health.get("message").and_then(Value::as_str).unwrap_or("");
            match health.get("kind").and_then(Value::as_str) {
                Some("auth") => issues.push(issue(
                    "error",
                    format!("{label} is signed out — the person has to reconnect it in owntools → social → Channels. {name} said: {said}"),
                )),
                Some("billing") => issues.push(issue(
                    "warning",
                    format!("{label}'s last post was refused for API billing; it will fail again unless that is sorted before its time. {name} said: {said}"),
                )),
                _ => {}
            }
        }
        let ok = !issues.iter().any(|i| i.get("level").and_then(Value::as_str) == Some("error"));
        worst_ok &= ok;
        results.push(json!({
            "channelId": ch_id,
            "channel": ch.get("displayName").cloned().unwrap_or(Value::Null),
            "network": provider,
            "characters": length,
            "limit": limit,
            "ok": ok,
            "issues": issues,
        }));
    }
    Ok(json!({ "ok": worst_ok, "channels": results }))
}

fn parse_hhmm(raw: &str) -> (u32, u32) {
    let mut parts = raw.split(':');
    let h = parts.next().and_then(|s| s.trim().parse::<u32>().ok()).filter(|h| *h < 24).unwrap_or(9);
    let m = parts.next().and_then(|s| s.trim().parse::<u32>().ok()).filter(|m| *m < 60).unwrap_or(0);
    (h, m)
}

/// Free times to post at, starting from `from` (or now). Days get up to three
/// slots — the preferred hour from settings plus four and eight hours later —
/// and anything within `spacing` minutes of a post already on the calendar is
/// skipped, so an agent filling a week does not stack five posts on one hour.
pub fn suggest_slots(root: &Path, count: usize, from: Option<&str>, spacing_minutes: i64) -> Result<Value, ApiError> {
    let count = count.clamp(1, 20);
    let spacing = Duration::minutes(spacing_minutes.clamp(0, 24 * 60));
    let start = match from {
        Some(raw) if !raw.trim().is_empty() => store::parse_datetime(raw)
            .ok_or_else(|| ApiError::bad(format!("cannot parse `{raw}` (use ISO 8601)")))?
            .with_timezone(&Local),
        _ => Local::now() + Duration::minutes(30),
    };

    let settings = store::read_json(&store::settings_path(root)).unwrap_or(Value::Null);
    let (hour, minute) = parse_hhmm(settings.get("defaultTime").and_then(Value::as_str).unwrap_or("09:00"));

    let taken: Vec<chrono::DateTime<Local>> = store::list_posts(root, &PostFilter { status: None, from: None, to: None, limit: None })
        .iter()
        .filter(|p| matches!(p.get("status").and_then(Value::as_str), Some("scheduled") | Some("publishing")))
        .filter_map(|p| p.get("scheduledAt").and_then(Value::as_str).and_then(store::parse_datetime))
        .map(|d| d.with_timezone(&Local))
        .collect();

    let mut out: Vec<String> = Vec::new();
    let mut day = start.date_naive();
    let last = day + Duration::days(60);
    while out.len() < count && day <= last {
        for offset in [0i64, 4, 8] {
            if out.len() >= count {
                break;
            }
            let Some(base) = NaiveDate::from_ymd_opt(day.year(), day.month(), day.day()).and_then(|d| d.and_hms_opt(hour, minute, 0)) else {
                continue;
            };
            let candidate_naive = base + Duration::hours(offset);
            if candidate_naive.hour() >= 22 && offset > 0 {
                continue;
            }
            let Some(candidate) = Local.from_local_datetime(&candidate_naive).earliest() else {
                continue;
            };
            if candidate < start {
                continue;
            }
            let clash = taken.iter().any(|t| (*t - candidate).abs() < spacing)
                || out
                    .iter()
                    .filter_map(|s| store::parse_datetime(s))
                    .any(|t| (t.with_timezone(&Local) - candidate).abs() < spacing);
            if clash {
                continue;
            }
            out.push(candidate.to_rfc3339_opts(SecondsFormat::Secs, false));
        }
        day += Duration::days(1);
    }
    Ok(json!({ "slots": out, "preferredTime": format!("{hour:02}:{minute:02}"), "spacingMinutes": spacing.num_minutes() }))
}

/// Copies a file that is already on disk into the media library. An agent
/// working on a video should never have to base64 fifty megabytes through a
/// JSON-RPC call; it has the path, so it passes the path.
pub fn add_media_from_path(root: &Path, path: &str, alt: Option<&str>, name: Option<&str>) -> Result<Value, ApiError> {
    let source = Path::new(path);
    if !source.is_file() {
        return Err(ApiError::bad(format!("no file at `{path}`")));
    }
    let meta = std::fs::metadata(source).map_err(|e| ApiError::internal(e.to_string()))?;
    const MAX: u64 = 1024 * 1024 * 1024;
    if meta.len() > MAX {
        return Err(ApiError::bad(format!("{path} is {:.1} GB; the library takes up to 1 GB per file.", meta.len() as f64 / 1_073_741_824.0)));
    }
    let file_name = name
        .map(str::to_string)
        .filter(|n| !n.trim().is_empty())
        .or_else(|| source.file_name().and_then(|n| n.to_str()).map(String::from))
        .unwrap_or_else(|| "file".to_string());
    let bytes = std::fs::read(source).map_err(|e| ApiError::internal(e.to_string()))?;
    let mime = store::mime_for_name(&file_name);
    store::add_media(root, &file_name, mime, &bytes, alt)
}

/// The markdown an agent gets from `resources/read` — how this app expects to
/// be driven, in one page.
pub fn guide(root: &Path) -> String {
    let channels = store::list_channels(root);
    let lines: Vec<String> = channels
        .iter()
        .map(|c| {
            format!(
                "- `{}` — {} on {}{}",
                c.get("id").and_then(Value::as_str).unwrap_or("?"),
                c.get("displayName").and_then(Value::as_str).unwrap_or("?"),
                c.get("provider").and_then(Value::as_str).unwrap_or("?"),
                match (c.get("disabled").and_then(Value::as_bool).unwrap_or(false), c.pointer("/health/kind").and_then(Value::as_str)) {
                    (true, _) => " (disabled)",
                    (false, Some("auth")) => " (signed out — the person has to reconnect it)",
                    (false, Some("billing")) => " (last post refused for API billing)",
                    _ => "",
                },
            )
        })
        .collect();
    let channel_block = if lines.is_empty() {
        "No channels are connected yet. Tell the person to open owntools → social → Channels and connect one; you cannot do it for them.".to_string()
    } else {
        lines.join("\n")
    };
    format!(
        r#"# owntools social — how to drive it

Everything here runs on this machine. Posts you create land in the person's
calendar and go out from their desktop app; nothing is sent to a server of
ours, and nothing publishes without a time on it.

## The loop that works

1. `list_channels` — the ids you will post to. They are stable; keep them.
2. `check_post` — text plus those ids, before writing anything. It answers
   with the per-network character count and everything that would block
   publishing.
3. `suggest_times` — free slots, spaced out, from the person's own preferred
   hour. Do not invent times; a calendar full of 3 a.m. posts is a bug.
4. `create_post` (or `post_now` when they asked for it to go out now).
5. `get_post` after a publish to read the per-channel result and the URLs.

## Rules that save a retry

- Media: `add_media_from_path` with a path on this machine. Do not base64 a
  video. Attach the returned id through `media`.
- One video per post on nearly every network, and images and video do not mix.
- `thread` becomes real replies on X, Bluesky and Mastodon; everywhere else
  the parts are joined into one post.
- Times are ISO 8601. Without an offset they are read as this machine's local
  time.
- A post you did not schedule is a draft and stays in the calendar until the
  person finishes it. That is a fine way to hand over work.

## Connected channels

{channel_block}
"#
    )
}

/// Networks with what they take, for `list_networks`.
pub fn networks_summary(root: &Path) -> Value {
    let connected = store::list_channels(root);
    let list: Vec<Value> = catalogue(root)
        .into_iter()
        .map(|n| {
            let id = n.get("id").and_then(Value::as_str).unwrap_or("").to_string();
            let count = connected.iter().filter(|c| c.get("provider").and_then(Value::as_str) == Some(id.as_str())).count();
            let mut obj: Map<String, Value> = n.as_object().cloned().unwrap_or_default();
            obj.insert("connectedChannels".into(), json!(count));
            Value::Object(obj)
        })
        .collect();
    json!({ "networks": list })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn workspace(tag: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!("owntools-social-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("posts")).expect("create posts dir");
        fs::write(
            base.join("channels.json"),
            serde_json::to_string(&json!({
                "version": 1,
                "channels": [
                    { "id": "c_x", "provider": "x", "displayName": "owntools on X", "disabled": false, "preferences": {} },
                    { "id": "c_bsky", "provider": "bluesky", "displayName": "owntools on Bluesky", "disabled": false, "preferences": {} }
                ],
                "collections": ["Personal"]
            }))
            .unwrap(),
        )
        .expect("write channels");
        fs::write(base.join("settings.json"), serde_json::to_string(&json!({ "defaultTime": "09:00" })).unwrap()).expect("write settings");
        base
    }

    #[test]
    fn x_counts_links_as_23_and_emoji_as_2() {
        // Same rules as limits.ts, so the composer and an agent never disagree.
        assert_eq!(measure("x", "https://owntools.app/a/very/long/path/that/goes/on"), 23);
        assert_eq!(measure("x", "look https://owntools.app/x and more"), 5 + 23 + 9);
        assert_eq!(measure("x", "hi \u{1F680}"), 5);
        assert_eq!(measure("linkedin", "https://owntools.app"), 20);
        assert_eq!(measure("bluesky", "https://owntools.app"), 20);
    }

    #[test]
    fn trailing_punctuation_is_not_part_of_a_link() {
        assert_eq!(measure("x", "see https://owntools.app."), 4 + 23 + 1);
    }

    #[test]
    fn check_post_flags_the_over_long_channel_only() {
        let root = workspace("check");
        let body = json!({ "text": "x".repeat(290), "channelIds": ["c_x", "c_bsky"] });
        let out = check_post(&root, &body).expect("check");
        assert_eq!(out["ok"], json!(false));
        let channels = out["channels"].as_array().expect("channels");
        let x = channels.iter().find(|c| c["channelId"] == json!("c_x")).expect("x");
        let bsky = channels.iter().find(|c| c["channelId"] == json!("c_bsky")).expect("bluesky");
        assert_eq!(x["ok"], json!(false));
        assert_eq!(x["characters"], json!(290));
        assert_eq!(bsky["ok"], json!(true));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn check_post_passes_on_what_the_app_knows_about_a_channel() {
        let root = workspace("health");
        let mut file: Value = serde_json::from_str(&fs::read_to_string(root.join("channels.json")).unwrap()).unwrap();
        file["channels"][0]["health"] = json!({ "kind": "auth", "message": "X refused to refresh the session", "at": "2026-09-14T14:47:19Z" });
        file["channels"][1]["health"] = json!({ "kind": "billing", "message": "402: credits depleted", "at": "2026-09-14T14:46:35Z" });
        fs::write(root.join("channels.json"), serde_json::to_string(&file).unwrap()).unwrap();

        let out = check_post(&root, &json!({ "text": "hello", "channelIds": ["c_x", "c_bsky"] })).expect("check");
        let channels = out["channels"].as_array().expect("channels");
        let x = channels.iter().find(|c| c["channelId"] == json!("c_x")).expect("x");
        let bsky = channels.iter().find(|c| c["channelId"] == json!("c_bsky")).expect("bluesky");
        // Signed out blocks; out of credits warns but still lets the agent schedule.
        assert_eq!(x["ok"], json!(false));
        assert!(x["issues"][0]["message"].as_str().unwrap().contains("signed out"));
        assert_eq!(bsky["ok"], json!(true));
        assert_eq!(bsky["issues"][0]["level"], json!("warning"));
        assert!(guide(&root).contains("(signed out"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn check_post_wants_something_to_post() {
        let root = workspace("empty");
        let out = check_post(&root, &json!({ "text": "   " })).expect("check");
        assert_eq!(out["ok"], json!(false));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn slots_are_in_the_future_spaced_and_avoid_taken_times() {
        let root = workspace("slots");
        let first = suggest_slots(&root, 3, None, 60).expect("slots");
        let slots = first["slots"].as_array().expect("slots array").clone();
        assert_eq!(slots.len(), 3);
        let times: Vec<chrono::DateTime<chrono::Utc>> = slots
            .iter()
            .map(|s| store::parse_datetime(s.as_str().unwrap()).expect("parse"))
            .collect();
        assert!(times[0] > chrono::Utc::now(), "the first slot is in the future");
        assert!(times[1] > times[0] && times[2] > times[1], "slots come in order");
        assert!((times[1] - times[0]) >= Duration::minutes(60), "slots keep their distance");

        // A post sitting on the first slot pushes the suggestion past it.
        let taken = slots[0].as_str().unwrap().to_string();
        fs::write(
            root.join("posts").join("post_1.json"),
            serde_json::to_string(&json!({ "id": "post_1", "status": "scheduled", "scheduledAt": taken, "channelIds": ["c_x"] })).unwrap(),
        )
        .expect("write post");
        let second = suggest_slots(&root, 1, None, 60).expect("slots again");
        assert_ne!(second["slots"][0], slots[0], "the taken slot is not offered again");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn media_from_a_path_lands_in_the_library() {
        let root = workspace("media");
        let clip = root.join("clip.mp4");
        fs::write(&clip, [0u8, 1, 2, 3]).expect("write clip");
        let item = add_media_from_path(&root, clip.to_str().unwrap(), Some("a demo"), None).expect("add");
        assert_eq!(item["mime"], json!("video/mp4"));
        assert_eq!(item["alt"], json!("a demo"));
        assert_eq!(store::list_media(&root).len(), 1);
        assert!(root.join(item["file"].as_str().unwrap()).is_file());
        assert!(add_media_from_path(&root, root.join("nope.mp4").to_str().unwrap(), None, None).is_err());
        let _ = fs::remove_dir_all(&root);
    }
}
