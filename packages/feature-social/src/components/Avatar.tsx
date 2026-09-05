import { useEffect, useState } from "react";
import { useSocialStore } from "../store";
import type { Channel } from "../types";
import { NetworkIcon, badgeColor } from "./NetworkIcon";

/** Channel avatar (stored file or initials) with the provider badge in the corner. */
export function Avatar({
  channel,
  size = "md",
  muted = false,
  title,
}: {
  channel: Channel;
  size?: "sm" | "md" | "lg";
  muted?: boolean;
  title?: string;
}) {
  const avatarUrl = useSocialStore((s) => s.avatarUrl);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!channel.avatar) {
      setUrl(null);
      return;
    }
    void avatarUrl(channel).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [avatarUrl, channel]);

  const initials = channel.displayName
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <span
      className={`sc-avatar ${size === "md" ? "" : size}${muted ? " muted" : ""}`}
      title={title ?? `${channel.displayName} · ${channel.handle}`}
    >
      {url ? <img src={url} alt="" draggable={false} /> : <span className="sc-avatar-fallback">{initials || "•"}</span>}
      <span className="sc-avatar-badge" style={{ background: badgeColor(channel.provider) }}>
        <NetworkIcon id={channel.provider} />
      </span>
    </span>
  );
}
