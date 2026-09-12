import type { Metadata, Viewport } from "next";
import { Inter, Outfit } from "next/font/google";
import "./globals.css";
import { plausibleDomain, siteUrl } from "@/lib/site";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700", "800"],
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin", "latin-ext"],
  weight: ["500", "600", "700", "800"],
});

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#060608" },
  ],
};

/* Applies the saved theme before first paint (day is the default). */
const themeInit = `try{if(localStorage.getItem("owntools-theme")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "owntools - dictate, transcribe and record on your own device",
    template: "%s · owntools",
  },
  description:
    "Dictate into any app, transcribe audio and video, record your screen, record and transcribe your calls, take notes, sketch on a whiteboard, schedule your social posts, see what is eating your disk, translate, and turn a link into a video. One desktop app that runs on your own machine and keeps working offline.",
  keywords: [
    "dictation app",
    "voice typing",
    "speech to text",
    "offline transcription",
    "screen recorder",
    "meeting recorder",
    "meeting transcription without a bot",
    "live captions",
    "subtitle generator",
    "note taking app",
    "whiteboard app",
    "social media scheduler",
    "schedule posts with AI agents",
    "focus timer",
    "local-first",
    "on-device AI",
    "whisper dictation",
    "screen studio alternative",
  ],
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "owntools",
    title: "owntools - dictate, transcribe and record on your own device",
    description:
      "Dictate anywhere, transcribe anything, record your screen and your calls, take notes, sketch on a whiteboard, schedule posts, reclaim disk space, translate. One app, no account, nothing uploaded.",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "owntools - dictate, transcribe and record on your own device",
    description:
      "Dictate anywhere, transcribe anything, record your screen and your calls, take notes, sketch on a whiteboard, schedule posts, reclaim disk space, translate. One app, no account, nothing uploaded.",
  },
  alternates: { canonical: siteUrl },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${outfit.variable} ${inter.className} antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        {/* cookieless, privacy-friendly analytics — only when a domain is configured */}
        {plausibleDomain ? (
          <script defer data-domain={plausibleDomain} src="https://plausible.io/js/script.js" />
        ) : null}
      </head>
      <body>{children}</body>
    </html>
  );
}
