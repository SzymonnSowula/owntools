import { addDays, addHours, nextMonday, setHours, setMinutes } from "date-fns";
import { CalendarClock } from "lucide-react";
import { useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { formatDateTime, nextDefaultSlot, parseHm, slotDate } from "../../time";
import { Popover } from "../primitives";

/**
 * Date + time in one popover: a month grid, a time field and a few quick
 * picks. `value` null means "no date yet" (a draft).
 */
export function DateTimePicker({
  value,
  onChange,
  weekStart,
  defaultTime,
  disabled,
}: {
  value: Date | null;
  onChange: (d: Date | null) => void;
  weekStart: 0 | 1;
  defaultTime: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [h, m] = parseHm(defaultTime) ?? [9, 0];
  const base = value ?? nextDefaultSlot();
  const timeValue = `${String(base.getHours()).padStart(2, "0")}:${String(base.getMinutes()).padStart(2, "0")}`;
  const now = new Date();
  const quick: { label: string; at: () => Date }[] = [
    { label: "in 1 h", at: () => setMinutes(addHours(now, 1), 0) },
    { label: `tomorrow ${defaultTime}`, at: () => slotDate(addDays(now, 1), h, m) },
    { label: `next monday ${defaultTime}`, at: () => slotDate(nextMonday(now), h, m) },
    { label: "next free slot", at: () => nextDefaultSlot(now) },
  ];
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="top"
      align="end"
      className="p-3"
      trigger={
        <button className={`sc-btn${value && value < now ? " !text-[#ff453a]" : ""}`} disabled={disabled} title="Date and time">
          <CalendarClock /> {value ? formatDateTime(value) : "Pick a time"}
        </button>
      }
    >
      <div className="sc-daypicker">
        <DayPicker
          mode="single"
          weekStartsOn={weekStart}
          selected={value ?? undefined}
          defaultMonth={base}
          onSelect={(d) => {
            if (!d) return;
            onChange(slotDate(d, base.getHours(), base.getMinutes()));
          }}
          showOutsideDays
        />
      </div>
      <div className="mt-2 flex items-center gap-2 border-t border-line pt-3">
        <span className="sc-label !mb-0">Time</span>
        <input
          type="time"
          className="sc-field !w-[124px]"
          value={timeValue}
          onChange={(e) => {
            const hm = parseHm(e.target.value);
            if (!hm) return;
            onChange(setMinutes(setHours(base, hm[0]), hm[1]));
          }}
        />
        {value ? (
          <button className="sc-btn ghost sm ml-auto" onClick={() => onChange(null)}>
            No date (draft)
          </button>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {quick.map((q) => (
          <button
            key={q.label}
            className="sc-chip"
            onClick={() => {
              onChange(q.at());
              setOpen(false);
            }}
          >
            {q.label}
          </button>
        ))}
      </div>
    </Popover>
  );
}
