import { useCallback, useEffect, useRef, useState } from "react";
import { monthOf, onNetLog, type NetEntry, type NetSummary } from "@core/net";
import { fetchRecent, fetchSummary } from "./api";

export interface NetSummaryState {
  /** "YYYY-MM" being shown. */
  month: string;
  setMonth: (month: string) => void;
  summary: NetSummary | null;
  /** Newest first; empty until loaded. */
  recent: NetEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * The month's summary plus the recent list, refreshed when the window gets
 * focus, every 30 s, and right after this window notes a request (the
 * `NET_LOG_EVENT`, debounced so a burst of uploads is one reload).
 */
export function useNetSummary(recentLimit = 60): NetSummaryState {
  const [month, setMonth] = useState(() => monthOf(Date.now()));
  const [summary, setSummary] = useState<NetSummary | null>(null);
  const [recent, setRecent] = useState<NetEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([fetchSummary(month), fetchRecent(recentLimit)]);
      if (!alive.current) return;
      setSummary(s);
      setRecent(r);
      setError(null);
    } catch (err) {
      if (!alive.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [month, recentLimit]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const every = window.setInterval(() => void refresh(), 30_000);
    const onFocus = () => void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    let debounce: number | null = null;
    const offLog = onNetLog(() => {
      if (debounce !== null) window.clearTimeout(debounce);
      debounce = window.setTimeout(() => void refresh(), 250);
    });
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive.current = false;
      window.clearInterval(every);
      if (debounce !== null) window.clearTimeout(debounce);
      offLog();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return { month, setMonth, summary, recent, loading, error, refresh };
}
