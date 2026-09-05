import { useDroppable } from "@dnd-kit/core";
import { format, isSameDay, isSameMonth } from "date-fns";
import { Plus } from "lucide-react";
import { useState } from "react";
import { fromIso, isPastDay, parseHm, slotDate } from "../../time";
import type { Channel, Post, Tag } from "../../types";
import { PostCard } from "./PostCard";

export const dayKey = (day: Date) => `day:${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;

function DayCell({
  day,
  anchor,
  posts,
  channels,
  tags,
  now,
  defaultTime,
  onOpen,
  onAdd,
}: {
  day: Date;
  anchor: Date;
  posts: Post[];
  channels: Channel[];
  tags: Tag[];
  now: Date;
  defaultTime: string;
  onOpen: (post: Post) => void;
  onAdd: (at: Date) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dayKey(day), data: { day } });
  const [expanded, setExpanded] = useState(false);
  const other = !isSameMonth(day, anchor);
  const past = isPastDay(day, now);
  const today = isSameDay(day, now);
  const shown = expanded ? posts : posts.slice(0, 3);
  const [h, m] = parseHm(defaultTime) ?? [9, 0];
  return (
    <div ref={setNodeRef} className={`sc-day${other ? " other" : ""}${past ? " past" : ""}${today ? " today" : ""}${isOver ? " over" : ""}`}>
      <div className="sc-day-num">
        <b>{format(day, "d")}</b>
        <button className="sc-icon-btn sc-day-add !h-6 !w-6" aria-label="New post on this day" onClick={() => onAdd(slotDate(day, h, m))}>
          <Plus />
        </button>
      </div>
      {shown.map((p) => (
        <PostCard key={p.id} post={p} channels={channels} tags={tags} onOpen={onOpen} showTime />
      ))}
      {posts.length > 3 && !expanded ? (
        <button className="sc-more" onClick={() => setExpanded(true)}>
          +{posts.length - 3} more
        </button>
      ) : null}
    </div>
  );
}

export function MonthView({
  rows,
  anchor,
  posts,
  channels,
  tags,
  weekStart,
  defaultTime,
  onOpen,
  onAdd,
}: {
  rows: Date[][];
  anchor: Date;
  posts: Post[];
  channels: Channel[];
  tags: Tag[];
  weekStart: 0 | 1;
  defaultTime: string;
  onOpen: (post: Post) => void;
  onAdd: (at: Date) => void;
}) {
  const now = new Date();
  const byDay = new Map<string, Post[]>();
  for (const p of posts) {
    const d = fromIso(p.scheduledAt);
    if (!d) continue;
    const key = dayKey(d);
    const list = byDay.get(key) ?? [];
    list.push(p);
    byDay.set(key, list);
  }
  for (const list of byDay.values()) list.sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));
  const names = weekStart === 1 ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return (
    <div className="sc-content sc-scroll">
      <div className="sc-month-head">
        {names.map((n) => (
          <div key={n}>{n}</div>
        ))}
      </div>
      <div className="sc-month">
        {rows.flat().map((day) => (
          <DayCell
            key={dayKey(day)}
            day={day}
            anchor={anchor}
            posts={byDay.get(dayKey(day)) ?? []}
            channels={channels}
            tags={tags}
            now={now}
            defaultTime={defaultTime}
            onOpen={onOpen}
            onAdd={onAdd}
          />
        ))}
      </div>
    </div>
  );
}
