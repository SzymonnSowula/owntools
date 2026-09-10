"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { WinDots, ToolIcons } from "./WinDots";
import type { Ground } from "./Scene";

/**
 * The studio section: one tall row per tool, each led by a big media panel
 * (a clip of the tool doing its job, or a screenshot, or the hand-built mock
 * as a fallback). Rows fade and shrink with their distance from the middle of
 * the viewport, so a scroll lands on exactly one tool at a time instead of
 * showing six at once. CSS lives in globals.css (.ts-*).
 */

export type ShowcaseTool = {
  /** tool name — also the kicker over the headline */
  name: string;
  /** which traffic-light glyph the window bar wears */
  icon: keyof typeof ToolIcons;
  /** window-bar title, e.g. "demo-take.mp4" */
  file: string;
  /** hue for the frame, bubble and glow — blue → indigo → cyan arc */
  tint: string;
  /** the one gesture that starts this tool, shown as a bubble */
  trigger: string;
  headline: string;
  desc: string;
  chips: string[];
  link?: { href: string; label: string };
  /** dropped into web/public/shots — see docs/launch-video.md */
  media?: { video?: string; poster?: string };
  /** weather behind the drawn stand-in; ignored once a real clip exists */
  ground?: Ground;
  /** drawn stand-in, used until a real clip or shot exists */
  mock: ReactNode;
};

export function ToolShowcase({ tools }: { tools: ShowcaseTool[] }) {
  const root = useRef<HTMLDivElement>(null);

  /* focus = how close a row is to the middle of the screen (0..1) */
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const rows = Array.from(el.querySelectorAll<HTMLElement>("[data-ts-row]"));
    if (!rows.length) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      rows.forEach((row) => row.style.setProperty("--f", "1"));
      return;
    }

    let frame = 0;
    const paint = () => {
      frame = 0;
      // a viewport with no height (a hidden tab, a headless capture) would put
      // every row at distance ∞ and fade the whole section out
      if (window.innerHeight < 200) return;
      const mid = window.innerHeight / 2;
      const range = Math.max(window.innerHeight * 0.85, 520);
      for (const row of rows) {
        const box = row.getBoundingClientRect();
        const away = Math.abs(box.top + box.height / 2 - mid) / range;
        const t = Math.max(0, 1 - away);
        row.style.setProperty("--f", (t * t * (3 - 2 * t)).toFixed(3));
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };

    paint();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  /* only the clip on screen plays; reduced motion gets controls instead */
  useEffect(() => {
    const videos = Array.from(root.current?.querySelectorAll("video") ?? []);
    if (!videos.length) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      videos.forEach((video) => {
        video.pause();
        video.controls = true;
      });
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const video = entry.target as HTMLVideoElement;
          if (entry.isIntersecting) void video.play().catch(() => {});
          else video.pause();
        }
      },
      { threshold: 0.25 },
    );
    videos.forEach((video) => io.observe(video));
    return () => io.disconnect();
  }, []);

  return (
    <div ref={root} className="ts-rows">
      {tools.map((tool, i) => (
        <article
          key={tool.name}
          data-ts-row
          className={`ts-row ${i % 2 ? "ts-row--flip" : ""}`}
          style={{ ["--tint" as string]: tool.tint }}
        >
          <div className="ts-media">
            <div className="ts-frame">
              <div className="wincard wincard--light ts-window">
                <div className="wincard-bar">
                  <WinDots icon={ToolIcons[tool.icon]} />
                  <span className="wincard-title">{tool.file}</span>
                </div>
                <div
                  className={
                    tool.media?.video || tool.media?.poster
                      ? "ts-stage"
                      : `ts-stage ground ground--${tool.ground ?? "meadow"}`
                  }
                >
                  {tool.media?.video ? (
                    <video
                      src={tool.media.video}
                      poster={tool.media.poster}
                      autoPlay
                      muted
                      loop
                      playsInline
                      preload="metadata"
                      aria-label={`${tool.name} in use`}
                    />
                  ) : tool.media?.poster ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={tool.media.poster} alt={`${tool.name} in use`} />
                  ) : (
                    <div className="ts-mock">{tool.mock}</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="ts-copy">
            <p className="ts-bubble">{tool.trigger}</p>
            <p className="ts-name">{tool.name}</p>
            <h3 className="display mt-1 text-3xl leading-[1.1] md:text-[38px]">{tool.headline}</h3>
            <p className="mt-4 max-w-md text-[15px] leading-7 text-muted">{tool.desc}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {tool.chips.map((chip) => (
                <span key={chip} className="ts-chip">
                  {chip}
                </span>
              ))}
            </div>
            {tool.link ? (
              <a href={tool.link.href} className="ts-link">
                {tool.link.label} <ArrowRight size={14} />
              </a>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}
