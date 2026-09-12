//! What an agent needs beyond CRUD: the posting queue, upcoming/search views,
//! reschedule/duplicate, rule-based per-network variants, and the week as
//! markdown. Every function reads the same JSON files the frontend writes
//! (`channels.json`, `posts/<id>.json`, `voice.md`) — no second store.
//!
//! Queue slots: a channel carries `slots: [{ days: [0..6], time: "HH:MM" }]`
//! (0 = Sunday, like JavaScript's `getDay`); a channel without slots uses the
//! same defaults as `packages/feature-social/src/slots.ts` — weekdays at 09:00,
//! 13:00 and 17:00 local time. "Next free" = the earliest slot of the chosen
//! channels not already holding a scheduled (or awaiting-review) post within
//! a minute of it.

use std::path::Path;

use chrono::{DateTime, Datelike, Duration, Local, NaiveTime, SecondsFormat, TimeZone, Utc};
use serde_json::{json, Map, Value};

use super::plan;
use super::store::{self, ApiError, PostFilter};

const DEFAULT_SLOTS: &[(&[u32], &str)] = &[
    (&[1, 2, 3, 4, 5], "09:00"),
    (&[1, 2, 3, 4, 5], "13:00"),
    (&[1, 2, 3, 4, 5], "17:00"),
];

/// How far ahead the queue looks for a free slot.
const HORIZON_DAYS: i64 = 28;

fn string_list(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect())
        .unwrap_or_default()
}

fn parse_time(raw: &str) -> Option<NaiveTime> {
    NaiveTime::parse_from_str(raw.trim(), "%H:%M").ok()
}

/// The slots of one channel, defaults when it has none.
fn slots_of(channel: &Value) -> Vec<(Vec<u32>, NaiveTime)> {
    let own: Vec<(Vec<u32>, NaiveTime)> = channel
        .get("slots")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|s| {
                    let days: Vec<u32> = s
                        .get("days")
                        .and_then(Value::as_array)
                        .map(|d| d.iter().filter_map(Value::as_u64).map(|n| n as u32).collect())
                        .unwrap_or_default();
                    let time = parse_time(s.get("time").and_then(Value::as_str)?)?;
                    if days.is_empty() {
                        return None;
                    }
                    Some((days, time))
                })
                .collect()
        })
        .unwrap_or_default();
    if !own.is_empty() {
        return own;
    }
    DEFAULT_SLOTS
        .iter()
        .filter_map(|(days, time)| Some((days.to_vec(), parse_time(time)?)))
        .collect()
}

fn to_local_iso(t: DateTime<Local>) -> String {
    t.to_rfc3339_opts(SecondsFormat::Secs, false)
}

fn post_channels(post: &Value) -> Vec<String> {
    string_list(post.get("channelIds"))
}

fn post_text(post: &Value) -> &str {
    post.get("content")
        .and_then(|c| c.get("text"))
        .and_then(Value::as_str)
        .unwrap_or("")
}

fn first_line(text: &str, max: usize) -> String {
    let line = text.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim();
    let chars: Vec<char> = line.chars().collect();
    if chars.len() <= max {
        line.to_string()
    } else {
        format!("{}…", chars[..max].iter().collect::<String>().trim_end())
    }
}

/// Pure core of `next_free_slot`, so tests need no files.
pub fn next_free_slot_in(
    channels: &[Value],
    posts: &[Value],
    channel_ids: &[String],
    from: DateTime<Local>,
) -> Option<DateTime<Local>> {
    let chosen: Vec<&Value> = channels
        .iter()
        .filter(|c| c.get("id").and_then(Value::as_str).map(|id| channel_ids.iter().any(|x| x == id)).unwrap_or(false))
        .collect();
    let mut slots: Vec<(Vec<u32>, NaiveTime)> = if chosen.is_empty() {
        slots_of(&Value::Null)
    } else {
        chosen.iter().flat_map(|c| slots_of(c)).collect()
    };
    slots.sort_by_key(|(_, t)| *t);
    slots.dedup();

    let taken: Vec<DateTime<Utc>> = posts
        .iter()
        .filter(|p| matches!(p.get("status").and_then(Value::as_str), Some("scheduled") | Some("needs_review")))
        .filter(|p| channel_ids.is_empty() || post_channels(p).iter().any(|c| channel_ids.contains(c)))
        .filter_map(|p| p.get("scheduledAt").and_then(Value::as_str).and_then(store::parse_datetime))
        .collect();

    let mut candidates: Vec<DateTime<Local>> = Vec::new();
    for day in 0..=HORIZON_DAYS {
        let date = (from + Duration::days(day)).date_naive();
        let weekday = date.weekday().num_days_from_sunday();
        for (days, time) in &slots {
            if !days.contains(&weekday) {
                continue;
            }
            let Some(candidate) = Local.from_local_datetime(&date.and_time(*time)).single() else {
                continue;
            };
            if candidate < from {
                continue;
            }
            let utc = candidate.with_timezone(&Utc);
            if taken.iter().any(|t| (*t - utc).num_seconds().abs() < 60) {
                continue;
            }
            candidates.push(candidate);
        }
    }
    candidates.sort();
    candidates.into_iter().next()
}

pub fn next_free_slot(root: &Path, channel_ids: &[String], from: Option<&str>) -> Option<DateTime<Local>> {
    let from = from
        .and_then(store::parse_datetime)
        .map(|d| d.with_timezone(&Local))
        .unwrap_or_else(|| Local::now() + Duration::minutes(30));
    let channels = store::list_channels(root);
    let posts = store::list_posts(root, &PostFilter { status: None, from: None, to: None, limit: None });
    next_free_slot_in(&channels, &posts, channel_ids, from)
}

/// `add_to_queue { channelIds, text, client_ref?, from? }`: the next free slot
/// of those channels, then the same create path as `create_post` (so
/// `client_ref` and the review rule apply).
pub fn add_to_queue(root: &Path, args: &Value) -> Result<Value, ApiError> {
    let channel_ids = string_list(args.get("channelIds"));
    if channel_ids.is_empty() {
        return Err(ApiError::bad("`channelIds` is required — see list_channels"));
    }
    let text = args.get("text").and_then(Value::as_str).unwrap_or("").trim();
    if text.is_empty() {
        return Err(ApiError::bad("`text` is required"));
    }
    let slot = next_free_slot(root, &channel_ids, args.get("from").and_then(Value::as_str))
        .ok_or_else(|| ApiError::bad("no free slot in the next four weeks — add slots to the channel or reschedule something"))?;
    let mut body = Map::new();
    body.insert("channelIds".into(), json!(channel_ids));
    body.insert("text".into(), json!(text));
    body.insert("scheduledAt".into(), json!(to_local_iso(slot)));
    body.insert("status".into(), json!("scheduled"));
    for key in ["client_ref", "clientRef", "tags", "title", "mediaIds"] {
        if let Some(v) = args.get(key) {
            body.insert(key.into(), v.clone());
        }
    }
    let created = store::create_post(root, &Value::Object(body))?;
    let mut out = created.response();
    out["slot"] = json!(to_local_iso(slot));
    Ok(out)
}

/// Scheduled and awaiting-review posts in the next `days`, soonest first.
pub fn list_upcoming(root: &Path, days: i64) -> Vec<Value> {
    let days = days.clamp(1, 90);
    let now = Utc::now();
    let until = now + Duration::days(days);
    let mut posts: Vec<Value> = store::list_posts(root, &PostFilter { status: None, from: None, to: None, limit: None })
        .into_iter()
        .filter(|p| matches!(p.get("status").and_then(Value::as_str), Some("scheduled") | Some("needs_review")))
        .filter(|p| {
            p.get("scheduledAt")
                .and_then(Value::as_str)
                .and_then(store::parse_datetime)
                .map(|d| d >= now - Duration::minutes(5) && d <= until)
                .unwrap_or(false)
        })
        .collect();
    posts.sort_by_key(|p| p.get("scheduledAt").and_then(Value::as_str).unwrap_or("").to_string());
    posts
}

/// Case-insensitive substring over text, thread parts, tags and title.
pub fn search_posts(root: &Path, q: &str, status: Option<&str>) -> Vec<Value> {
    let needle = q.trim().to_lowercase();
    if needle.is_empty() {
        return Vec::new();
    }
    store::list_posts(root, &PostFilter { status: status.map(String::from), from: None, to: None, limit: None })
        .into_iter()
        .filter(|p| {
            let mut hay = post_text(p).to_lowercase();
            if let Some(thread) = p.get("content").and_then(|c| c.get("thread")).and_then(Value::as_array) {
                for part in thread {
                    if let Some(t) = part.get("text").and_then(Value::as_str) {
                        hay.push('\n');
                        hay.push_str(&t.to_lowercase());
                    }
                }
            }
            for tag in string_list(p.get("tags")) {
                hay.push('\n');
                hay.push_str(&tag.to_lowercase());
            }
            if let Some(title) = p.get("title").and_then(Value::as_str) {
                hay.push('\n');
                hay.push_str(&title.to_lowercase());
            }
            hay.contains(&needle)
        })
        .take(50)
        .collect()
}

/// Moves a post to `at`. A draft becomes scheduled; a post awaiting review
/// keeps waiting; anything published cannot move.
pub fn reschedule(root: &Path, id: &str, at: &str) -> Result<Value, ApiError> {
    let post = store::read_post(root, id).ok_or_else(|| ApiError::not_found(format!("no post `{id}`")))?;
    let parsed = store::parse_datetime(at).ok_or_else(|| ApiError::bad("`at` must be an ISO 8601 date-time"))?;
    let status = post.get("status").and_then(Value::as_str).unwrap_or("draft");
    if matches!(status, "published" | "publishing") {
        return Err(ApiError::conflict(format!("post `{id}` is {status}; duplicate it instead")));
    }
    let mut patch = Map::new();
    patch.insert("scheduledAt".into(), json!(to_local_iso(parsed.with_timezone(&Local))));
    if status == "draft" || status == "failed" {
        patch.insert("status".into(), json!("scheduled"));
    }
    if let Some(v) = post.get("version") {
        patch.insert("version".into(), v.clone());
    }
    let updated = store::patch_post(root, id, &Value::Object(patch))?;
    store::log_activity(root, "agent", "update", id, Some(&post), Some(&updated), Some("rescheduled"));
    Ok(updated)
}

/// A new draft with the same content (media included) for the same or other channels.
pub fn duplicate_post(root: &Path, id: &str, channel_ids: Option<Vec<String>>) -> Result<Value, ApiError> {
    let post = store::read_post(root, id).ok_or_else(|| ApiError::not_found(format!("no post `{id}`")))?;
    let mut body = Map::new();
    body.insert("channelIds".into(), json!(channel_ids.unwrap_or_else(|| post_channels(&post))));
    body.insert("text".into(), json!(post_text(&post)));
    if let Some(content) = post.get("content") {
        body.insert("content".into(), content.clone());
    }
    if let Some(tags) = post.get("tags") {
        body.insert("tags".into(), tags.clone());
    }
    if let Some(title) = post.get("title") {
        body.insert("title".into(), title.clone());
    }
    body.insert("status".into(), json!("draft"));
    let created = store::create_post(root, &Value::Object(body))?;
    let mut out = created.response();
    out["duplicatedFrom"] = json!(id);
    Ok(out)
}

/// Drops whole trailing sentences until the text fits, then hard-cuts with an
/// ellipsis. `measure` is the network's own counting (X weights, Bluesky graphemes).
pub fn shorten(network_id: &str, text: &str, limit: usize) -> String {
    if limit == 0 || plan::measure(network_id, text) <= limit {
        return text.to_string();
    }
    // Sentence ends: ., !, ? followed by whitespace, plus paragraph breaks.
    let mut cuts: Vec<usize> = Vec::new();
    let bytes: Vec<(usize, char)> = text.char_indices().collect();
    for (i, (idx, ch)) in bytes.iter().enumerate() {
        let next_ws = bytes.get(i + 1).map(|(_, c)| c.is_whitespace()).unwrap_or(false);
        if (matches!(ch, '.' | '!' | '?' | '…') && next_ws) || *ch == '\n' {
            cuts.push(idx + ch.len_utf8());
        }
    }
    for cut in cuts.iter().rev() {
        let candidate = text[..*cut].trim_end();
        if !candidate.is_empty() && plan::measure(network_id, candidate) <= limit {
            return candidate.to_string();
        }
    }
    // Hard cut on a word boundary, leaving room for the ellipsis.
    let mut out = String::new();
    for word in text.split_whitespace() {
        let attempt = if out.is_empty() { word.to_string() } else { format!("{out} {word}") };
        if plan::measure(network_id, &format!("{attempt}…")) > limit {
            break;
        }
        out = attempt;
    }
    if out.is_empty() {
        let chars: Vec<char> = text.chars().collect();
        let keep = limit.saturating_sub(1).min(chars.len());
        out = chars[..keep].iter().collect();
    }
    format!("{out}…")
}

/// `adapt_post { text, channelIds }` — one variant per channel that fits its
/// network's limit. Rules only (the composer's in-app version can ask the
/// model); the answer says so in `model`.
pub fn adapt(root: &Path, text: &str, channel_ids: &[String]) -> Value {
    let channels = store::list_channels(root);
    let mut variants = Vec::new();
    for id in channel_ids {
        let Some(channel) = channels.iter().find(|c| c.get("id").and_then(Value::as_str) == Some(id)) else {
            variants.push(json!({ "channelId": id, "error": "unknown channel — see list_channels" }));
            continue;
        };
        let network_id = channel.get("provider").and_then(Value::as_str).unwrap_or("");
        let limit = plan::network(root, network_id)
            .and_then(|n| n.get("chars").and_then(Value::as_u64))
            .unwrap_or(0) as usize;
        let variant = shorten(network_id, text, limit);
        let length = plan::measure(network_id, &variant);
        variants.push(json!({
            "channelId": id,
            "network": network_id,
            "text": variant,
            "length": length,
            "limit": if limit == 0 { Value::Null } else { json!(limit) },
            "fits": limit == 0 || length <= limit,
            "changed": variant != text,
        }));
    }
    json!({ "variants": variants, "model": "rules", "note": "trailing sentences dropped to fit each limit; the composer's Adapt button uses the language model when one is set up" })
}

/// This week's calendar as markdown — the `owntools://social/week` resource.
pub fn week_markdown(root: &Path) -> String {
    let channels = store::list_channels(root);
    let name_of = |id: &str| -> String {
        channels
            .iter()
            .find(|c| c.get("id").and_then(Value::as_str) == Some(id))
            .map(|c| {
                let provider = c.get("provider").and_then(Value::as_str).unwrap_or("?");
                let handle = c.get("handle").and_then(Value::as_str).unwrap_or("");
                if handle.is_empty() { provider.to_string() } else { format!("{provider} {handle}") }
            })
            .unwrap_or_else(|| id.to_string())
    };
    let posts = list_upcoming(root, 7);
    let mut out = String::from("# This week on social\n\n");
    if posts.is_empty() {
        out.push_str("Nothing scheduled in the next seven days. `add_to_queue` fills the next free slot; `suggest_times` lists several.\n");
        return out;
    }
    let mut day = String::new();
    for p in &posts {
        let when = p
            .get("scheduledAt")
            .and_then(Value::as_str)
            .and_then(store::parse_datetime)
            .map(|d| d.with_timezone(&Local));
        let (d, t) = match when {
            Some(w) => (w.format("%A %-d %B").to_string(), w.format("%H:%M").to_string()),
            None => ("Unscheduled".to_string(), "--:--".to_string()),
        };
        if d != day {
            out.push_str(&format!("\n## {d}\n"));
            day = d;
        }
        let status = p.get("status").and_then(Value::as_str).unwrap_or("");
        let flag = if status == "needs_review" { " · **awaiting your review**" } else { "" };
        let chans: Vec<String> = post_channels(p).iter().map(|c| name_of(c)).collect();
        out.push_str(&format!(
            "- {t} · {} · {}{flag} — {}\n",
            chans.join(", "),
            p.get("id").and_then(Value::as_str).unwrap_or(""),
            first_line(post_text(p), 90)
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn channel(id: &str, provider: &str, slots: Option<Vec<(Vec<u32>, &str)>>) -> Value {
        let mut c = json!({ "id": id, "provider": provider, "handle": "@me" });
        if let Some(slots) = slots {
            c["slots"] = json!(slots.iter().map(|(d, t)| json!({ "days": d, "time": t })).collect::<Vec<_>>());
        }
        c
    }

    fn post(id: &str, status: &str, at: &str, channels: &[&str]) -> Value {
        json!({ "id": id, "status": status, "scheduledAt": at, "channelIds": channels, "content": { "text": "hi" } })
    }

    #[test]
    fn default_slots_are_weekdays_nine_one_five() {
        // Monday 2026-09-14 08:00 local → first slot that day at 09:00.
        let from = Local.with_ymd_and_hms(2026, 9, 14, 8, 0, 0).unwrap();
        let slot = next_free_slot_in(&[channel("a", "bluesky", None)], &[], &["a".into()], from).unwrap();
        assert_eq!(slot.format("%Y-%m-%d %H:%M").to_string(), "2026-09-14 09:00");
    }

    #[test]
    fn a_taken_slot_is_skipped_and_weekends_have_no_default_slots() {
        // Friday 2026-09-18 16:00 → 17:00 today is taken → Monday 09:00.
        let from = Local.with_ymd_and_hms(2026, 9, 18, 16, 0, 0).unwrap();
        let taken = to_local_iso(Local.with_ymd_and_hms(2026, 9, 18, 17, 0, 0).unwrap());
        let posts = [post("p1", "scheduled", &taken, &["a"])];
        let slot = next_free_slot_in(&[channel("a", "bluesky", None)], &posts, &["a".into()], from).unwrap();
        assert_eq!(slot.format("%Y-%m-%d %H:%M").to_string(), "2026-09-21 09:00");
    }

    #[test]
    fn custom_slots_and_other_channels_posts_do_not_block() {
        let from = Local.with_ymd_and_hms(2026, 9, 14, 8, 0, 0).unwrap();
        let chans = [channel("a", "mastodon", Some(vec![(vec![1, 3], "12:30")])), channel("b", "x", None)];
        // A post on channel b at 12:30 Monday must not take a's slot.
        let other = to_local_iso(Local.with_ymd_and_hms(2026, 9, 14, 12, 30, 0).unwrap());
        let posts = [post("p", "scheduled", &other, &["b"])];
        let slot = next_free_slot_in(&chans, &posts, &["a".into()], from).unwrap();
        assert_eq!(slot.format("%Y-%m-%d %H:%M").to_string(), "2026-09-14 12:30");
    }

    #[test]
    fn shorten_drops_sentences_first_then_words() {
        let text = "First sentence here. Second one is longer than the first. Third.";
        assert_eq!(shorten("mastodon", text, 500), text);
        assert_eq!(shorten("mastodon", text, 45), "First sentence here.");
        let hard = shorten("mastodon", "onewordthatisverylong and more words after it", 20);
        assert!(hard.ends_with('…'));
        assert!(plan::measure("mastodon", &hard) <= 20, "{hard}");
    }

    #[test]
    fn first_line_trims_and_ellipsises() {
        assert_eq!(first_line("\n\n  hello world  \nmore", 90), "hello world");
        assert_eq!(first_line("abcdefghij", 4), "abcd…");
    }
}
