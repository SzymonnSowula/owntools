import { useState, type ReactNode } from "react";

export interface HubTabDef<T extends string> {
  id: T;
  label: string;
}

/** Local tab state that remembers the last tab per hub in localStorage. */
export function useHubTab<T extends string>(
  storageKey: string,
  ids: readonly T[],
): [T, (tab: T) => void] {
  const [tab, setTab] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved && (ids as readonly string[]).includes(saved)) return saved as T;
    } catch {
      /* private mode etc. */
    }
    return ids[0];
  });
  const select = (next: T) => {
    setTab(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      /* ignore */
    }
  };
  return [tab, select];
}

interface Props<T extends string> {
  tabs: readonly HubTabDef<T>[];
  active: T;
  onSelect: (tab: T) => void;
  /** Optional right-aligned content on the tab-bar row (e.g. voice note button). */
  right?: ReactNode;
}

export function HubTabs<T extends string>({ tabs, active, onSelect, right }: Props<T>) {
  return (
    <div className="hub-tabs-row">
      <div className="hub-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            className={active === t.id ? "active" : ""}
            onClick={() => onSelect(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {right}
    </div>
  );
}
