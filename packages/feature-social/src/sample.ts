import { addDays, setHours, setMinutes, startOfDay, subDays } from "date-fns";
import { newPost } from "./model";
import { useSocialStore } from "./store";
import { toIso } from "./time";
import type { Channel, NetworkId, Post } from "./types";

/**
 * Browser-preview sample data: a few simulated channels and a week of
 * posts, so the calendar and the composer can be tried without connecting
 * anything. Never offered in the desktop app.
 */

const CHANNELS: { provider: NetworkId; handle: string; displayName: string; collection: string }[] = [
  { provider: "bluesky", handle: "@owntools.app", displayName: "owntools", collection: "Product" },
  { provider: "x", handle: "@owntoolsapp", displayName: "owntools", collection: "Product" },
  { provider: "linkedin", handle: "szymon", displayName: "Szymon", collection: "Personal" },
  { provider: "mastodon", handle: "@owntools@mastodon.social", displayName: "owntools", collection: "Product" },
  { provider: "telegram", handle: "@owntools_news", displayName: "owntools news", collection: "Product" },
];

const TEXTS = [
  { text: "Small daily workouts beat one heroic session a month. Same with shipping: one improvement a day, every day. #buildinpublic", tag: "tag_personal" },
  { text: "New in owntools: an endless whiteboard. Paste a screenshot, draw around it, keep many boards — every one a file on your disk. https://owntools.app/changelog", tag: "tag_news" },
  { text: "Dictation tip: the quieter the room, the better the transcript. Whisper mishears a quiet take far more than a hard word.", tag: "tag_product" },
  { text: "We moved the record button into the tray. One click, no window juggling.", tag: "tag_news" },
  { text: "Thread: how a URL becomes a launch video in 30 seconds 🧵", tag: "tag_product", thread: ["1/ Paste the link. The app reads the name, tagline, colours and the hero shot.", "2/ Pick a style and a length. The seed decides the arc — a new take is a real recut."] },
  { text: "Reminder: everything you record, write and schedule in owntools stays on your device. No cloud, no account.", tag: "tag_personal" },
  { text: "Draft idea: a short clip of the auto-zoom following the cursor, with captions written by whisper.", tag: "tag_product" },
];

export async function loadSampleData(): Promise<void> {
  const store = useSocialStore.getState();
  if (store.channels.length || store.posts.length) return;
  const created: Channel[] = [];
  for (const c of CHANNELS) {
    created.push(await store.addChannel({ ...c, avatar: null, disabled: false, preferences: {}, meta: { simulated: "true" } }, {}));
  }
  const ids = created.map((c) => c.id);
  // Relative to today, so the demo week is always ahead of the viewer.
  const today = startOfDay(new Date());
  const at = (dayOffset: number, h: number, m = 0) => toIso(setMinutes(setHours(addDays(today, dayOffset), h), m));
  const posts: Post[] = [
    newPost({ status: "published", scheduledAt: toIso(setHours(subDays(new Date(), 1), 9)), publishedAt: toIso(subDays(new Date(), 1)), channelIds: [ids[0]!, ids[3]!], content: { text: TEXTS[1]!.text, media: [], thread: [] }, tags: ["tag_news"], results: { [ids[0]!]: { status: "ok", url: "https://bsky.app/profile/owntools.app/post/3kx", at: toIso(subDays(new Date(), 1)), simulated: true }, [ids[3]!]: { status: "ok", url: null, at: toIso(subDays(new Date(), 1)), simulated: true } } }),
    newPost({ status: "scheduled", scheduledAt: at(0, 23, 30), channelIds: [ids[0]!, ids[1]!], content: { text: TEXTS[0]!.text, media: [], thread: [] }, tags: ["tag_personal"] }),
    newPost({ status: "scheduled", scheduledAt: at(1, 9), channelIds: [ids[2]!], content: { text: TEXTS[2]!.text, media: [], thread: [] }, tags: ["tag_product"] }),
    newPost({ status: "scheduled", scheduledAt: at(1, 15, 30), channelIds: [ids[4]!, ids[0]!], content: { text: TEXTS[3]!.text, media: [], thread: [] }, tags: ["tag_news"] }),
    newPost({ status: "scheduled", scheduledAt: at(2, 11), channelIds: [ids[1]!, ids[0]!], content: { text: TEXTS[4]!.text, media: [], thread: TEXTS[4]!.thread!.map((t) => ({ text: t, media: [] })) }, tags: ["tag_product"], repeat: { kind: "weekly" } }),
    newPost({ status: "failed", scheduledAt: at(0, 8), channelIds: [ids[1]!], content: { text: TEXTS[5]!.text, media: [], thread: [] }, tags: ["tag_personal"], attempts: 3, lastError: "X: 401: Unauthorized", results: { [ids[1]!]: { status: "error", error: "X: 401: Unauthorized", at: at(0, 8) } } }),
    newPost({ status: "draft", scheduledAt: at(3, 14), channelIds: [ids[0]!], content: { text: TEXTS[6]!.text, media: [], thread: [] }, tags: [] }),
    newPost({ status: "draft", scheduledAt: null, channelIds: [], content: { text: "Weekly changelog thread — collect the week's changes here.", media: [], thread: [] }, tags: ["tag_news"] }),
  ];
  for (const p of posts) await store.createPost(p);
}
