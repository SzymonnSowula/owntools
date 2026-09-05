"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

/**
 * Day/night switch. Day (light) is the default brand theme; night flips
 * data-theme="dark" on <html>. Persisted in localStorage("shipshape-theme");
 * an inline script in layout.tsx applies it before first paint.
 */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.dataset.theme === "dark");
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    if (next) {
      document.documentElement.dataset.theme = "dark";
    } else {
      delete document.documentElement.dataset.theme;
    }
    try {
      localStorage.setItem("shipshape-theme", next ? "dark" : "light");
    } catch {}
  };

  return (
    <button
      onClick={toggle}
      aria-label={dark ? "switch to day theme" : "switch to night theme"}
      title={dark ? "day" : "night"}
      className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-card/60 text-muted transition hover:text-ink"
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
