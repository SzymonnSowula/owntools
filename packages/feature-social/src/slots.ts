import { addDays, startOfDay } from "date-fns";
import { parseHm, slotDate } from "./time";
import type { Channel, Post, QueueSlot } from "./types";

/**
 * Queue slots — the Buffer idea. Every channel has a handful of recurring
 * posting times ("weekdays at 9, 13 and 17"); "Next free slot" in the
 * composer, `queue: true` from another tool and an agent's `add_to_queue`
 * all drop a post into the first of those that nothing else holds yet, so
 * a week planned by an agent lands on the times the person chose instead of
 * on invented timestamps.
 *
 * Pure: everything here takes the channels and posts it needs. The Rust
 * twin in `plan.rs` (`next_free_slot`) follows the same rules, so the slot
 * an agent is offered over MCP is the slot the composer would offer.
 */

/** What a channel without its own slots uses: weekdays at 9, 13 and 17 local time. */
export const DEFAULT_SLOTS: QueueSlot[] = [
  { days: [1, 2, 3, 4, 5], time: "09:00" },
  { days: [1, 2, 3, 4, 5], time: "13:00" },
  { days: [1, 2, 3, 4, 5], time: "17:00" },
];

/** How far ahead a free slot is looked for before giving up. */
export const SLOT_HORIZON_DAYS = 60;

/** Statuses that hold a time on the calendar — a slot they sit on is taken. */
const HOLDS = new Set<Post["status"]>(["scheduled", "publishing", "needs_review"]);

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function slotsFor(channel: Pick<Channel, "slots"> | null | undefined): QueueSlot[] {
  return channel?.slots?.length ? channel.slots : DEFAULT_SLOTS;
}

/** "weekdays 9:00, 13:00, 17:00" / "every day 10:30" / "Mon, Thu 8:00" — for the channel row. */
export function describeSlots(slots: QueueSlot[]): string {
  if (!slots.length) return "no queue slots";
  const times = Array.from(new Set(slots.map((s) => s.time))).sort();
  const daySets = slots.map((s) => s.days.join(","));
  const sameDays = daySets.every((d) => d === daySets[0]);
  const days = sameDays ? describeDays(slots[0]!.days) : "mixed days";
  return `${days} ${times.map(trimTime).join(", ")}`;
}

export function describeDays(days: number[]): string {
  const key = [...days].sort().join(",");
  if (key === "1,2,3,4,5") return "weekdays";
  if (key === "0,1,2,3,4,5,6") return "every day";
  if (key === "0,6") return "weekends";
  return [...days].sort().map((d) => DAY_NAMES[d] ?? "?").join(", ");
}

function trimTime(hhmm: string): string {
  const hm = parseHm(hhmm);
  if (!hm) return hhmm;
  return `${hm[0]}:${String(hm[1]).padStart(2, "0")}`;
}

/** Every occurrence of `slots` strictly after `from`, ascending, within `days` days. */
export function slotOccurrences(slots: QueueSlot[], from: Date, days = SLOT_HORIZON_DAYS): Date[] {
  const out: Date[] = [];
  const first = startOfDay(from);
  for (let i = 0; i <= days; i += 1) {
    const day = addDays(first, i);
    const weekday = day.getDay();
    for (const s of slots) {
      if (!s.days.includes(weekday)) continue;
      const hm = parseHm(s.time);
      if (!hm) continue;
      const at = slotDate(day, hm[0], hm[1]);
      if (at > from) out.push(at);
    }
  }
  out.sort((a, b) => a.getTime() - b.getTime());
  return out.filter((d, i) => i === 0 || d.getTime() !== out[i - 1]!.getTime());
}

export interface SlotContext {
  channels: Channel[];
  posts: Post[];
  /** The post being edited — its own time never counts as taken. */
  excludeId?: string | null;
}

const minuteOf = (iso: string): number => Math.floor(Date.parse(iso) / 60_000);

/**
 * Whether `at` is free for every channel in `channelIds`: no post that
 * still holds a time (scheduled, publishing, waiting for review) targets one
 * of those channels at that minute. With no channels, any held post at that
 * minute takes the slot.
 */
export function isSlotFree(at: Date, channelIds: string[], ctx: SlotContext): boolean {
  const minute = Math.floor(at.getTime() / 60_000);
  for (const p of ctx.posts) {
    if (p.id === ctx.excludeId || !p.scheduledAt || !HOLDS.has(p.status)) continue;
    if (minuteOf(p.scheduledAt) !== minute) continue;
    if (channelIds.length === 0 || p.channelIds.some((id) => channelIds.includes(id))) return false;
  }
  return true;
}

/**
 * The first `count` free slots for these channels after `from`. Candidates are
 * the union of the selected channels' slots (the defaults when none is
 * selected or none has slots); a candidate counts only when it is free for
 * all of them, so a post going to two channels lands on one time both are
 * free at.
 */
export function nextFreeSlots(channelIds: string[], from: Date, ctx: SlotContext, count = 1): Date[] {
  const selected = channelIds.map((id) => ctx.channels.find((c) => c.id === id)).filter((c): c is Channel => Boolean(c));
  const sets = selected.length ? selected.map((c) => slotsFor(c)) : [DEFAULT_SLOTS];
  const seen = new Set<number>();
  const candidates: Date[] = [];
  for (const slots of sets) {
    for (const d of slotOccurrences(slots, from)) {
      if (seen.has(d.getTime())) continue;
      seen.add(d.getTime());
      candidates.push(d);
    }
  }
  candidates.sort((a, b) => a.getTime() - b.getTime());
  const out: Date[] = [];
  for (const at of candidates) {
    if (out.length >= count) break;
    if (isSlotFree(at, channelIds, ctx)) out.push(at);
  }
  return out;
}

/** The next free slot, or null when nothing is free within the horizon. */
export function nextFreeSlot(channelIds: string[], from: Date, ctx: SlotContext): Date | null {
  return nextFreeSlots(channelIds, from, ctx, 1)[0] ?? null;
}

/** Slots as a JSON-safe copy (for settings, the API and tests). */
export function cloneSlots(slots: QueueSlot[]): QueueSlot[] {
  return slots.map((s) => ({ days: [...s.days], time: s.time }));
}
