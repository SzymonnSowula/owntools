import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ThemeToggle } from "../../components/ThemeToggle";
import { ToolIcons, WinDots } from "../../components/WinDots";
import { loadShare, mediaUrl, viewUrl } from "@/lib/share";
import { contactEmail, siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/** The metadata and the page read the same share: one storage read per view, not two. */
const getShare = cache(loadShare);

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} kB`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const share = await getShare(id);
  if (!share) return { title: "Link not found", robots: { index: false } };
  const { meta } = share;
  // Stable addresses on this site, not signed storage URLs: previews are
  // fetched (and re-fetched by chat apps' image proxies) long after an hour.
  const poster = meta.poster ? mediaUrl(meta.id, "poster.jpg") : undefined;
  const video = mediaUrl(meta.id, `video.${meta.ext}`);
  const description = `${formatDuration(meta.duration)} screen recording, shared from owntools.`;
  return {
    title: meta.name,
    description,
    robots: { index: false, follow: false },
    alternates: { canonical: viewUrl(meta.id) },
    openGraph: {
      type: "video.other",
      url: viewUrl(meta.id),
      title: meta.name,
      description,
      siteName: "owntools",
      images: poster ? [{ url: poster, width: meta.width || 1280, height: meta.height || 720 }] : undefined,
      videos: [{ url: video, type: meta.contentType, width: meta.width || 1920, height: meta.height || 1080 }],
    },
    twitter: {
      // "player" needs a twitter:player iframe page, which a share does not have;
      // without one X drops the card altogether
      card: poster ? "summary_large_image" : "summary",
      title: meta.name,
      description,
      images: poster ? [poster] : undefined,
    },
  };
}

/**
 * The player page behind a share link. No account, no comments, no tracking:
 * the video, its poster, a download, and a quiet nudge toward the app that
 * made it. Links are unlisted (robots: noindex) and expire with the upload.
 */
export default async function SharePage({ params }: Props) {
  const { id } = await params;
  const share = await getShare(id);
  if (!share) notFound();
  const { meta } = share;
  const videoUrl = mediaUrl(meta.id, `video.${meta.ext}`);
  const posterUrl = meta.poster ? mediaUrl(meta.id, "poster.jpg") : undefined;
  const report = `mailto:${contactEmail}?subject=${encodeURIComponent(`Report a shared video: ${viewUrl(meta.id)}`)}`;
  const created = new Date(meta.createdAt).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
  const expires = meta.expiresAt ? new Date(meta.expiresAt).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : null;
  const portrait = meta.height > meta.width;

  return (
    <div id="top">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <Link href="/" className="display text-[17px] font-bold tracking-[-0.03em]">
            owntools
          </Link>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link href="/#pricing" className="btn btn-primary !h-9 !px-4 text-[13px]">
              get the desktop app
            </Link>
          </div>
        </div>
      </header>

      <main className="dotted">
        <div className={`mx-auto px-5 pb-24 pt-10 md:pt-14 ${portrait ? "max-w-xl" : "max-w-5xl"}`}>
          <p className="kicker">shared recording</p>
          <h1 className="display mt-2 text-3xl md:text-4xl">{meta.name}</h1>
          <p className="mt-2 text-sm text-muted">
            {formatDuration(meta.duration)} · {formatBytes(meta.bytes)} · shared {created}
            {expires ? ` · available until ${expires}` : ""}
          </p>

          <div className="wincard mt-6 overflow-hidden">
            <div className="wincard-bar">
              <WinDots icon={ToolIcons.video} />
              <span className="wincard-title">{meta.name.toLowerCase().replace(/\s+/g, "-")}.{meta.ext}</span>
            </div>
            <video
              className="block w-full bg-black"
              style={{ aspectRatio: meta.width && meta.height ? `${meta.width} / ${meta.height}` : "16 / 9" }}
              controls
              playsInline
              preload="metadata"
              poster={posterUrl}
              src={videoUrl}
            />
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <a className="btn btn-primary !h-10 !px-5 text-sm" href={videoUrl} download={`${meta.name.replace(/[^\w\-]+/g, "_") || "recording"}.${meta.ext}`}>
              download {meta.ext}
            </a>
            <span className="text-sm text-muted">
              Made with{" "}
              <Link href="/" className="font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
                owntools
              </Link>
              , a screen recorder that runs on your own machine.
            </span>
          </div>

          <p className="mt-10 text-xs text-muted">
            This link is unlisted: only people who have it can watch. The person who shared it can take it down at any time.
            Something here that shouldn&rsquo;t be?{" "}
            <a href={report} className="underline">
              Report it
            </a>
            . Site: <Link href={siteUrl} className="underline">{siteUrl.replace(/^https?:\/\//, "")}</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
