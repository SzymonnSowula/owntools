import { ImageResponse } from "next/og";
import { POSTS, findPost } from "@/lib/blog";

/**
 * The card a post gets when its link is pasted somewhere. The root
 * opengraph-image would be inherited otherwise, and every post would share one
 * generic picture - on the sites these posts are written for, the preview is
 * most of the click.
 *
 * Same constraints as the root card: the bundled default font, no external
 * assets, so it renders in CI.
 */

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "owntools blog";

/* Drawn at build time, not per scrape: a crawler that waits for an image route
   to render is a crawler that sometimes gives up and shows no preview. */
export function generateStaticParams() {
  return POSTS.map((post) => ({ slug: post.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = findPost(slug);
  const title = post?.title ?? "owntools blog";
  /* long headlines are the norm here, so the type size follows the length
     rather than the other way round */
  const fontSize = title.length > 72 ? 56 : title.length > 52 ? 64 : 74;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "68px 72px",
          position: "relative",
          background: "#060608",
          color: "#f5f5f7",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: -160,
            top: 190,
            width: 900,
            height: 900,
            borderRadius: 450,
            background:
              "radial-gradient(circle, rgba(10,132,255,0.5) 0%, rgba(94,92,230,0.2) 38%, rgba(6,6,8,0) 70%)",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <svg width="34" height="34" viewBox="0 0 12 12">
            <path d="M6 0.8L10.4 7.6H1.6L6 0.8ZM2 9H10L8.6 11.2H3.4L2 9Z" fill="#f5f5f7" />
          </svg>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: -1 }}>owntools</div>
          <div style={{ fontSize: 22, color: "rgba(245,245,247,0.45)" }}>/ blog</div>
        </div>

        <div
          style={{
            display: "flex",
            fontSize,
            fontWeight: 700,
            letterSpacing: -2.5,
            lineHeight: 1.1,
            maxWidth: 1000,
          }}
        >
          {title}
        </div>

        <div style={{ display: "flex", fontSize: 24, color: "rgba(245,245,247,0.62)" }}>
          {post ? `${post.minutes} min read · owntools.app/blog` : "owntools.app/blog"}
        </div>
      </div>
    ),
    { ...size },
  );
}
