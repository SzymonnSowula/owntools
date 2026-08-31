import type { Metadata } from "next";
import LaunchMakerClient from "./LaunchMakerClient";

export const metadata: Metadata = {
  title: "Free launch video maker",
  description:
    "Make a product launch video in your browser — keynote-style templates, your colors and screenshot, rendered locally. Free, no sign-up, no upload.",
  alternates: { canonical: "/tools/launch-video-maker" },
};

export default function Page() {
  return (
    <div id="top">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <a href="/" className="text-[17px] font-bold tracking-[-0.03em]">shipshape</a>
          <a href="/#pricing" className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-black">
            get the desktop app
          </a>
        </div>
      </header>
      <div className="dotted">
        <div className="mx-auto max-w-3xl px-5 pt-14 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-accent">free tool · runs in your browser</p>
          <h1 className="mt-3 text-5xl font-extrabold tracking-[-0.05em]">launch video maker</h1>
          <p className="mx-auto mt-4 max-w-xl text-muted">
            Type your product's name, pick a template, export a keynote-style launch video.
            Rendered on your device — nothing is uploaded, no account needed.
          </p>
        </div>
        <LaunchMakerClient />
      </div>
    </div>
  );
}
