import { useDroppable } from "@dnd-kit/core";
import { isSameDay } from "date-fns";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { HOURS, formatDayHeader, formatHour, fromIso, isPastSlot, minutesOfDay, slotDate } from "../../time";
import type { Channel, Post, Tag } from "../../types";
import { PostCard } from "./PostCard";

export const slotKey = (day: Date, hour: number) => `slot:${day.getFullYear()}-${day.getMonth()}-${day.getDate()}:${hour}`;

function Slot({
  day,
  hour,
  posts,
  channels,
  tags,
  now,
  onOpen,
  onAdd,
}: {
  day: Date;
  hour: number;
  posts: Post[];
  channels: Channel[];
  tags: Tag[];
  now: Date;
  onOpen: (post: Post) => void;
  onAdd: (at: Date) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: slotKey(day, hour), data: { day, hour } });
  const past = isPastSlot(day, hour, now);
  const today = isSameDay(day, now);
  const nowLine = today && now.getHours() === hour ? (minutesOfDay(now) - hour * 60) / 60 : null;
  return (
    <div ref={setNodeRef} className={`sc-slot${past ? " past" : ""}${today ? " today" : ""}${isOver ? " over" : ""}`}>
      {nowLine !== null ? <div className="sc-now" style={{ top: `${nowLine * 100}%` }} /> : null}
      {posts.map((p) => (
        <PostCard key={p.id} post={p} channels={channels} tags={tags} onOpen={onOpen} showTime />
      ))}
      {posts.length === 0 ? (
        <button className="sc-slot-add" aria-label={`New post ${formatHour(hour)}`} onClick={() => onAdd(slotDate(day, hour))}>
          <Plus />
        </button>
      ) : (
        <button className="sc-btn ghost sm sc-day-add self-start" onClick={() => onAdd(slotDate(day, hour))} aria-label="Add another post here">
          <Plus /> add
        </button>
      )}
    </div>
  );
}

export function WeekView({
  days,
  posts,
  channels,
  tags,
  onOpen,
  onAdd,
}: {
  days: Date[];
  posts: Post[];
  channels: Channel[];
  tags: Tag[];
  onOpen: (post: Post) => void;
  onAdd: (at: Date) => void;
}) {
  const [now, setNow] = useState(() => new Date());
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  // First paint: scroll so the working day starts near the top.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const rowHeight = 60;
    el.scrollTop = Math.max(0, (Math.min(now.getHours(), 8) - 1) * rowHeight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byDayHour = new Map<string, Post[]>();
  for (const p of posts) {
    const d = fromIso(p.scheduledAt);
    if (!d) continue;
    const day = days.find((x) => isSameDay(x, d));
    if (!day) continue;
    const key = slotKey(day, d.getHours());
    const list = byDayHour.get(key) ?? [];
    list.push(p);
    byDayHour.set(key, list);
  }
  for (const list of byDayHour.values()) list.sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));

  return (
    <div ref={scroller} className="sc-content sc-scroll">
      <div className="sc-week-head">
        <div />
        {days.map((d) => {
          const h = formatDayHeader(d);
          const today = isSameDay(d, now);
          return (
            <div key={d.toISOString()} className={`sc-day-head${today ? " today" : ""}`}>
              <b>{h.day}</b>
              <span>{h.weekday}</span>
            </div>
          );
        })}
      </div>
      <div className="sc-week">
        {HOURS.map((hour) => (
          <div key={hour} className="contents">
            <div className="sc-hour-label">{hour === 0 ? "" : formatHour(hour)}</div>
            {days.map((day) => (
              <Slot
                key={slotKey(day, hour)}
                day={day}
                hour={hour}
                posts={byDayHour.get(slotKey(day, hour)) ?? []}
                channels={channels}
                tags={tags}
                now={now}
                onOpen={onOpen}
                onAdd={onAdd}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
