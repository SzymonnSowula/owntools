import type { ReactNode } from "react";
import Link from "next/link";
import { ThemeToggle } from "../../components/ThemeToggle";
import { type Post, postPath } from "@/lib/blog";

/**
 * The frame every blog page shares. Same vocabulary as the legal pages - the
 * sticky bar, the dotted desk, one readable column - with the nav a reader of
 * an article actually wants.
 */
export function BlogHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
        <Link href="/" className="display text-[17px] font-bold tracking-[-0.03em]">
          owntools
        </Link>
        <div className="flex items-center gap-3">
          <nav className="hidden items-center gap-4 text-sm font-medium text-muted md:flex">
            <Link href="/blog" className="transition hover:text-ink">
              blog
            </Link>
            <Link href="/#tools" className="transition hover:text-ink">
              tools
            </Link>
            <Link href="/changelog" className="transition hover:text-ink">
              changelog
            </Link>
          </nav>
          <ThemeToggle />
          <Link href="/#pricing" className="btn btn-primary !h-9 !px-4 text-[13px]">
            get the desktop app
          </Link>
        </div>
      </div>
    </header>
  );
}

/** "21 September 2026" - written out, so it does not read as an American date. */
export function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** A post in the index and in the "read next" row. */
export function PostCard({ post }: { post: Post }) {
  return (
    <Link
      href={postPath(post.slug)}
      className="group block rounded-2xl border border-line bg-card p-5 transition hover:border-accent/40 hover:shadow-[0_10px_40px_-24px_rgba(10,132,255,0.55)] md:p-6"
    >
      <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
        <time dateTime={post.published}>{formatDate(post.published)}</time>
        <span aria-hidden> · </span>
        {post.minutes} min read
      </p>
      <h2 className="display mt-2 text-[22px] leading-[1.25] transition group-hover:text-accent md:text-[25px]">
        {post.title}
      </h2>
      <p className="mt-2.5 text-[15px] leading-7 text-muted">{post.description}</p>
      <p className="mt-3 text-sm font-semibold text-accent">read it →</p>
    </Link>
  );
}

/**
 * An aside inside a post: the trap, the caveat, the number we measured
 * ourselves. Styled by `.doc .note` in globals.css.
 */
export function Note({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <aside className="note">
      {label ? <span className="note-label">{label}</span> : null}
      {children}
    </aside>
  );
}

/**
 * Said once in every post that mentions the app, in the post's own voice.
 * A reader who finds out at the end that the article was an advert stops
 * trusting the numbers above it - and the numbers are the point.
 */
export function Disclosure({ children }: { children: ReactNode }) {
  return (
    <p className="mt-10 border-t border-line pt-5 text-[13.5px] leading-6 text-muted">
      <strong className="font-semibold text-ink">Who wrote this.</strong> {children}
    </p>
  );
}

/** The one call to action a post gets, at its foot. */
export function PostCta({ title, children, href = "/#pricing", cta = "see what it does" }: {
  title: string;
  children: ReactNode;
  href?: string;
  cta?: string;
}) {
  return (
    <div className="mt-10 rounded-2xl border border-line bg-card p-6">
      <p className="display text-[19px] leading-snug">{title}</p>
      <p className="mt-2 text-[15px] leading-7 text-muted">{children}</p>
      <Link href={href} className="btn btn-primary mt-4 !h-10 !px-5 text-[13px]">
        {cta}
      </Link>
    </div>
  );
}
