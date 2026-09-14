"use client";

import { useEffect, useRef } from "react";

/**
 * A studio clip that plays only while it is on screen and does not download
 * until then (preload="none" once there is a poster to show meanwhile).
 * Reduced motion gets the controls instead of a loop.
 */
export function ShowcaseVideo({ src, poster, label }: { src: string; poster?: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      video.controls = true;
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void video.play().catch(() => {});
        else video.pause();
      },
      { threshold: 0.25 },
    );
    io.observe(video);
    return () => io.disconnect();
  }, []);

  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      preload={poster ? "none" : "metadata"}
      aria-label={label}
    />
  );
}
