"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { Play, X } from "lucide-react";
import { WinDots, ToolIcons } from "./WinDots";

/**
 * The about-us.mp4 hero tile. It opens into a near-fullscreen player that
 * grows out of the tile.
 *
 * The clip is web/public/shots/about-us.mp4 (+ a poster with the same name),
 * looked up at build time in page.tsx like the studio rows: when it is there
 * the tile shows its poster and a click plays it with sound and controls.
 * Until then the tile keeps the CSS-only loop - hover zooms out and "plays"
 * our own landing page inside the frame, with screeni-like cinematic zooms.
 */

function SiteShot() {
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ background: "linear-gradient(to bottom, #3f8fd9 0%, #5ea7e5 55%, #8ec4ee 86%, #b8dcd8 100%)" }}
    >
      {/* mini nav */}
      <div className="absolute left-1/2 top-[7%] flex -translate-x-1/2 items-center gap-3 rounded-full bg-white/90 px-4 py-1.5 shadow-md">
        <span className="flex items-center gap-1 text-[10px] font-bold text-[#1d1d1f]">
          <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden>
            <path d="M6 0.8L10.4 7.6H1.6L6 0.8ZM2 9H10L8.6 11.2H3.4L2 9Z" fill="currentColor" />
          </svg>
          owntools
        </span>
        <span className="hidden h-1 w-20 rounded bg-black/10 sm:block" />
        <span className="rounded-full bg-accent px-2 py-0.5 text-[8px] font-bold text-white">get owntools</span>
      </div>

      {/* hero copy */}
      <div className="absolute left-1/2 top-1/2 w-full -translate-x-1/2 -translate-y-1/2 text-center text-white">
        <p className="display text-3xl sm:text-5xl md:text-6xl" style={{ textShadow: "0 2px 18px rgba(10,30,60,0.35)" }}>
          your work.
          <br />
          your device.
        </p>
        <p className="mt-2 text-[10px] text-white/90 sm:text-xs" style={{ textShadow: "0 1px 8px rgba(10,30,60,0.4)" }}>
          dictate, transcribe, record, take notes - all on your own machine
        </p>
        <div className="mt-3 flex justify-center gap-2">
          <span className="rounded-full bg-white px-3 py-1 text-[9px] font-bold text-[#0b0b0d] shadow sm:text-[10px]">
            download for windows
          </span>
          <span className="rounded-full border border-white/40 bg-white/15 px-3 py-1 text-[9px] font-semibold text-white sm:text-[10px]">
            download for mac
          </span>
        </div>
      </div>

      {/* the hero's one floating window */}
      <div className="absolute right-[6%] top-[22%] w-[96px] rotate-[3deg] rounded-lg bg-[#111214] p-1.5 shadow-lg">
        <div
          className="h-9 rounded"
          style={{
            background:
              "radial-gradient(30px 22px at 30% 30%, #0a84ff, transparent 70%), radial-gradient(34px 26px at 75% 40%, #5e5ce6, transparent 70%), #101a2e",
          }}
        />
        <p className="mt-1 flex items-center gap-1 text-[6px] font-semibold text-white/70">
          <span className="rec-dot h-1 w-1 rounded-full bg-[#ff453a]" /> REC · auto-zoom
        </p>
      </div>

      {/* fake cursor screeni is following */}
      <div className="demo-cursor" aria-hidden>
        <span />
      </div>
    </div>
  );
}

type Phase = "closed" | "enter" | "open" | "exit";

/* 84 s -> "1:24" */
function runtime(seconds: number) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function DemoZoom({ media }: { media?: { video?: string; poster?: string } }) {
  const video = media?.video;
  const poster = video ? media?.poster : undefined;
  const [phase, setPhase] = useState<Phase>("closed");
  const [mounted, setMounted] = useState(false);
  const [duration, setDuration] = useState(0);
  const tileRef = useRef<HTMLDivElement>(null);
  const tileVideoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => setMounted(true), []);

  /* the runtime under the poster; metadata can arrive before hydration, when
     no React listener is attached yet, so read what is already there too */
  useEffect(() => {
    const el = tileVideoRef.current;
    if (!el) return;
    const read = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) setDuration(el.duration);
    };
    if (el.readyState >= 1) read();
    el.addEventListener("loadedmetadata", read);
    return () => el.removeEventListener("loadedmetadata", read);
  }, [video]);

  const openDemo = () => {
    if (!video) {
      setPhase((p) => (p === "closed" ? "enter" : p));
      return;
    }
    if (phase !== "closed") return;
    /* start the clip inside the click itself: Safari only lets a video play
       with sound from within the gesture, and the player does not exist until
       it has rendered */
    flushSync(() => setPhase("enter"));
    const el = videoRef.current;
    if (!el) return;
    /* the keys (space, arrows) belong to the player now, not the tile behind it */
    el.focus({ preventScroll: true });
    el.play().catch(() => {
      /* sound refused after all - play muted, the controls can unmute */
      el.muted = true;
      void el.play().catch(() => {});
    });
  };
  const closeDemo = () => {
    const el = videoRef.current;
    if (el) {
      el.pause();
      tileRef.current?.focus({ preventScroll: true });
    }
    setPhase((p) => (p === "open" || p === "enter" ? "exit" : p));
  };

  useEffect(() => {
    if (phase === "closed") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDemo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  /* FLIP: the player grows smoothly out of the tile (and shrinks back). */
  useLayoutEffect(() => {
    const player = playerRef.current;
    const backdrop = backdropRef.current;
    const tile = tileRef.current;
    if (!player || !backdrop || !tile) return;
    if (phase !== "enter" && phase !== "exit") return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setPhase(phase === "enter" ? "open" : "closed");
      return;
    }

    const t = tile.getBoundingClientRect();
    const p = player.getBoundingClientRect();
    if (t.width < 10 || p.width < 10) {
      /* tile not visible (e.g. small viewport) — no meaningful origin to fly from */
      setPhase(phase === "enter" ? "open" : "closed");
      return;
    }
    const dx = t.left + t.width / 2 - (p.left + p.width / 2);
    const dy = t.top + t.height / 2 - (p.top + p.height / 2);
    const s = Math.max(t.width / p.width, 0.05);
    const tileTransform = `translate(${dx}px, ${dy}px) scale(${s})`;
    const ease = "cubic-bezier(0.16, 1, 0.3, 1)";

    let timer = 0;
    const finish = () => {
      if (phase === "enter") {
        /* settle cleanly even if the transition was interrupted */
        player.style.transition = "";
        player.style.transform = "";
        player.style.opacity = "";
        backdrop.style.transition = "";
        backdrop.style.opacity = "";
        setPhase("open");
      } else {
        setPhase("closed");
      }
    };

    if (phase === "enter") {
      /* First: jump to the tile's position/size with transitions off… */
      player.style.transition = "none";
      player.style.transform = tileTransform;
      player.style.opacity = "0.35";
      backdrop.style.transition = "none";
      backdrop.style.opacity = "0";
      void player.offsetWidth; /* …flush so the start state is committed… */
      /* …then animate to the natural centered position. */
      player.style.transition = `transform 0.65s ${ease}, opacity 0.45s ease`;
      player.style.transform = "none";
      player.style.opacity = "1";
      backdrop.style.transition = "opacity 0.5s ease";
      backdrop.style.opacity = "1";
      timer = window.setTimeout(finish, 700);
    } else {
      player.style.transition = `transform 0.45s ${ease}, opacity 0.35s ease`;
      player.style.transform = tileTransform;
      player.style.opacity = "0.2";
      backdrop.style.transition = "opacity 0.4s ease";
      backdrop.style.opacity = "0";
      timer = window.setTimeout(finish, 460);
    }

    return () => clearTimeout(timer);
  }, [phase]);

  return (
    <>
      {/* the small hero tile - the drawn loop opens on hover, a real clip
          waits for a click, which is what lets it start with sound */}
      <div
        ref={tileRef}
        className="wincard wincard--light floaty w-[250px] cursor-zoom-in"
        style={{ ["--tilt" as string]: "3deg", animationDelay: "-2s" }}
        onMouseEnter={video ? undefined : openDemo}
        onClick={openDemo}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          openDemo();
        }}
        aria-label={video ? "play the about us video" : "play the owntools demo"}
      >
        <div className="wincard-bar">
          <WinDots icon={ToolIcons.video} />
          <span className="wincard-title">about-us.mp4</span>
        </div>
        <div className="relative bg-[#101012] p-3">
          {video ? (
            <video
              ref={tileVideoRef}
              /* #t=0.1 = a real first frame when there is no poster */
              src={`${video}#t=0.1`}
              poster={poster}
              muted
              playsInline
              preload="metadata"
              className="block h-[110px] w-full rounded-[8px] bg-[#101a2e] object-cover"
              aria-hidden
            />
          ) : (
            <div
              className="h-[110px] rounded-[8px]"
              style={{
                background:
                  "radial-gradient(80px 60px at 25% 25%, #0a84ff, transparent 70%), radial-gradient(90px 70px at 80% 30%, #5e5ce6, transparent 70%), radial-gradient(90px 60px at 55% 85%, #32ade6, transparent 70%), #101a2e",
              }}
            >
              <div className="relative left-[18%] top-[22%] h-[60%] w-[64%] rounded-[6px] border border-white/20 bg-white/90 shadow-xl" />
            </div>
          )}
          <span className="absolute left-1/2 top-[45%] flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-[10px] font-semibold text-white backdrop-blur-sm">
            <Play size={10} /> {video ? "play" : "hover to play"}
          </span>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-white/80">
            {video ? (
              <>about us{duration ? ` · ${runtime(duration)}` : ""}</>
            ) : (
              <>
                <span className="rec-dot inline-block h-2 w-2 rounded-full bg-[#ff453a]" /> REC 00:12 · auto-zoom on
              </>
            )}
          </p>
        </div>
      </div>

      {/* expanded player — portaled to <body>: the hero section is an
          isolated stacking context, so a fixed overlay inside it would
          lose to the fixed nav */}
      {phase !== "closed" && mounted ? createPortal(
        <div
          className={`fixed inset-0 z-[60] flex items-center justify-center p-4 md:p-10 ${phase === "exit" ? "pointer-events-none" : ""}`}
          /* not while it is still flying in: the second half of a double
             click would land here and close it again */
          onClick={() => {
            if (phase === "open") closeDemo();
          }}
          onMouseLeave={video ? undefined : closeDemo}
        >
          <div ref={backdropRef} className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-hidden />
          <div
            ref={playerRef}
            role="dialog"
            aria-modal="true"
            aria-label={video ? "about us video" : "owntools demo"}
            className="wincard wincard--light relative w-full max-w-5xl will-change-transform"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="wincard-bar">
              <WinDots icon={ToolIcons.video} />
              <span className="wincard-title">about-us.mp4</span>
              <button
                className="ml-auto flex h-6 w-6 items-center justify-center rounded-full text-[#6e6e73] transition hover:bg-black/10 hover:text-[#1d1d1f]"
                onClick={closeDemo}
                aria-label={video ? "close the video" : "close demo"}
              >
                <X size={14} />
              </button>
            </div>
            <div className="demo-screen">
              {video ? (
                <video
                  ref={videoRef}
                  src={video}
                  poster={poster}
                  controls
                  playsInline
                  preload="auto"
                  className="absolute inset-0 h-full w-full bg-black object-contain"
                />
              ) : (
                <>
                  {/* the site inside the frame, with cinematic auto-zoom */}
                  <div className="demo-siteshot">
                    <SiteShot />
                  </div>
                  {/* launch-style intro card, loops with the zoom */}
                  <div className="demo-intro dotted">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#6e6e73]">introducing</p>
                    <p className="display mt-2 text-5xl text-[#1d1d1f] md:text-7xl">owntools</p>
                    <span className="mt-4 inline-block h-1.5 w-14 rounded-full bg-accent" />
                  </div>
                  {/* recording chrome */}
                  <span className="absolute left-4 top-4 z-10 flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-[11px] font-semibold text-white backdrop-blur-sm">
                    <span className="rec-dot h-2 w-2 rounded-full bg-[#ff453a]" /> REC · auto-zoom on
                  </span>
                  <span className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/55 px-3.5 py-1.5 text-[11px] font-medium text-white/90 backdrop-blur-sm">
                    every click gets a cinematic zoom - no editing
                  </span>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
