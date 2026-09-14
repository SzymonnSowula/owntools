import { useMemo, useRef, useState } from "react";
import { DEFAULT_SCROLL_SITES, normalizeSite, searchSites, siteLabel } from "../../../lib/scrollGuard";
import { useAppStore } from "../../../store/useAppStore";
import { Button, Card, NumberInput, Row, Switch } from "../ui";

export function FocusPage() {
  const settings = useAppStore((s) => s.settings);
  const update = useAppStore((s) => s.updateSettings);
  const timer = useAppStore((s) => s.timer);
  const setCustomMinutes = useAppStore((s) => s.setCustomMinutes);

  return (
    <>
      <Card id="timer" title="Custom timer" desc="The 25 and 50 minute presets keep their own 5 and 10 minute breaks.">
        <Row label="Focus length">
          <NumberInput
            label="Focus length in minutes"
            unit="min"
            min={1}
            max={180}
            value={settings.pomodoroFocus}
            onChange={(n) => {
              update({ pomodoroFocus: n });
              if (timer.preset === "custom") setCustomMinutes(n);
            }}
          />
        </Row>
        <Row label="Break length">
          <NumberInput
            label="Break length in minutes"
            unit="min"
            min={1}
            max={60}
            value={settings.pomodoroBreak}
            onChange={(n) => update({ pomodoroBreak: n })}
          />
        </Row>
      </Card>

      <Card id="session" title="During a session">
        <Row label="Full-screen timer" hint="The timer covers the whole screen while it runs. Esc leaves at any time.">
          <Switch
            label="Full-screen timer"
            checked={settings.timerFullscreen}
            onCheckedChange={(on) => update({ timerFullscreen: on })}
          />
        </Row>
        <Row label="Notify when a session ends">
          <Switch
            label="Notify when a session ends"
            checked={settings.notifications}
            onCheckedChange={(on) => update({ notifications: on })}
          />
        </Row>
      </Card>

      <Card id="heatmap" title="Stats">
        <Row label="Daily goal" hint="Active minutes that fill a day on the heatmap.">
          <NumberInput
            label="Daily goal in minutes"
            unit="min"
            min={10}
            max={480}
            value={settings.heatmapGoalMinutes}
            onChange={(n) => update({ heatmapGoalMinutes: n })}
          />
        </Row>
        <Row label="Count finished tasks" hint="A finished task adds 5 minutes to today's heatmap, even without the timer.">
          <Switch
            label="Count finished tasks"
            checked={settings.contributeOnTaskComplete}
            onCheckedChange={(on) => update({ contributeOnTaskComplete: on })}
          />
        </Row>
      </Card>

      <ScrollGuardCard />
    </>
  );
}

function ScrollGuardCard() {
  const settings = useAppStore((s) => s.settings);
  const tasks = useAppStore((s) => s.tasks);
  const setGuard = useAppStore((s) => s.setScrollGuard);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const openTasks = tasks.filter((t) => !t.done || t.id === settings.scrollGuardTaskId);

  const sites = settings.scrollGuardSites;
  const matches = useMemo(() => searchSites(query, sites), [query, sites]);
  // Anything with a dot can be blocked, catalogue or not - the search box is
  // also the "add your own" field.
  const custom = normalizeSite(query);
  const canAddCustom = Boolean(custom) && !sites.includes(custom!) && !matches.some((m) => m.host === custom);

  function add(host: string) {
    if (sites.includes(host)) return;
    setGuard({ sites: [...sites, host] });
    setQuery("");
    searchRef.current?.focus();
  }

  return (
    <Card
      id="scroll-guard"
      title="Scroll guard"
      desc="On the sites below, scrolling stops until the task you pick is done. Reading and clicking still work."
      action={
        <Switch
          label="Scroll guard"
          checked={settings.scrollGuardEnabled}
          onCheckedChange={(on) => setGuard({ enabled: on })}
        />
      }
    >
      <Row label="Until this task is done">
        <select
          className="st-select"
          value={settings.scrollGuardTaskId ?? ""}
          onChange={(e) => setGuard({ taskId: e.target.value || null })}
          aria-label="Task that lifts the guard"
        >
          <option value="">Choose a task</option>
          {openTasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      </Row>

      <Row label="Blocked sites" hint="Pick from the list or type any address." stack>
        <div className="guard-search">
          <input
            ref={searchRef}
            className="st-input"
            placeholder="Search or type a domain…"
            value={query}
            aria-label="Add a site"
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            /* a click on a result would blur first and unmount it */
            onBlur={() => window.setTimeout(() => setFocused(false), 120)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              const first = matches[0]?.host ?? custom;
              if (first) add(first);
            }}
          />
          {focused && (matches.length > 0 || canAddCustom) ? (
            <div className="guard-results">
              {canAddCustom ? (
                <button type="button" className="guard-result" onMouseDown={() => add(custom!)}>
                  <span className="guard-result-name">Block {custom}</span>
                  <span className="guard-result-group">custom</span>
                </button>
              ) : null}
              {matches.map((m) => (
                <button type="button" key={m.host} className="guard-result" onMouseDown={() => add(m.host)}>
                  <span className="guard-result-name">{m.label}</span>
                  <span className="guard-result-host">{m.host}</span>
                  <span className="guard-result-group">{m.group}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {sites.length ? (
          <div className="guard-list">
            {sites.map((host) => (
              <span key={host} className="guard-chip">
                <span className="guard-chip-name">{siteLabel(host)}</span>
                <span className="guard-chip-host">{host}</span>
                <button
                  type="button"
                  className="guard-chip-x"
                  aria-label={`Unblock ${host}`}
                  onClick={() => setGuard({ sites: sites.filter((s) => s !== host) })}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="st-empty">Nothing blocked yet - the guard does nothing until a site is on the list.</p>
        )}

        <div className="st-inline">
          <Button kind="ghost" onClick={() => setGuard({ sites: DEFAULT_SCROLL_SITES })}>
            Reset to defaults
          </Button>
          {sites.length ? (
            <Button kind="ghost" onClick={() => setGuard({ sites: [] })}>
              Clear all
            </Button>
          ) : null}
        </div>
      </Row>

      <div className="st-row-foot">
        Desktop app only. Keyboard and mouse hooks are installed only while the guard is armed, and removed the moment it is
        off.
      </div>
    </Card>
  );
}
