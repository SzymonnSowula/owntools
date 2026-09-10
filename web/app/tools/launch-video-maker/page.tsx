import type { Metadata } from "next";
import Link from "next/link";
import LaunchMakerClient from "./LaunchMakerClient";

export const metadata: Metadata = {
  title: "Free launch video maker",
  description:
    "Paste a URL, get a 30-second product launch video - copy, colors and screenshots pulled from your site, rendered locally in your browser. Free, no sign-up, no upload.",
  alternates: { canonical: "/tools/launch-video-maker" },
};

export default function Page() {
  return (
    <div id="top">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <Link href="/" className="text-[17px] font-bold tracking-[-0.03em]">owntools</Link>
          <Link href="/#pricing" className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-black">
            get the desktop app
          </Link>
        </div>
      </header>
      <div className="dotted">
        <div className="mx-auto max-w-3xl px-5 pt-14 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-accent">free tool · runs in your browser</p>
          <h1 className="mt-3 text-5xl font-extrabold tracking-[-0.05em]">launch video maker</h1>
          <p className="mx-auto mt-4 max-w-xl text-muted">
            Paste your product’s URL - we read the page, build a brand kit, write the script
            and cut a 30-second launch video. Rendered on your device - nothing is uploaded,
            no account needed.
          </p>
        </div>
        <LaunchMakerClient />
      </div>
    </div>
  );
}
