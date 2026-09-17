import type { Metadata, Viewport } from "next";
import { Inter, Outfit } from "next/font/google";
import "./globals.css";
import { plausibleDomain, siteUrl } from "@/lib/site";

/* Both are variable fonts: one file per script covers every weight. Only latin
   is preloaded - latin-ext is still declared, so the odd "ś" in a mockup loads
   it on demand instead of 100 KB of fonts racing the HTML on every visit. */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const DESCRIPTION =
  "Dictate, transcribe, record your screen and your calls, take notes and more. Eight tools in one desktop app that runs on your own device.";

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
  description: DESCRIPTION,
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
    description: DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "owntools - dictate, transcribe and record on your own device",
    description: DESCRIPTION,
  },
  alternates: { canonical: siteUrl },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${outfit.variable} ${inter.className} antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        {/* cookieless, privacy-friendly analytics — only when a domain is configured. Never
            on share pages: /v/<id> is the key to someone's video and must not reach a log. */}
        {plausibleDomain ? (
          <script defer data-domain={plausibleDomain} data-exclude="/v/**" src="https://plausible.io/js/script.exclusions.js" />
        ) : null}
      </head>
      <body>{children}</body>
    </html>
  );
}
