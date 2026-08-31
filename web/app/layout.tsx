import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700", "800"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://shipshape.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "shipshape — the local-first studio for people who ship",
    template: "%s · shipshape",
  },
  description:
    "Focus timer, screen recordings that follow your cursor, product launch videos from a URL, and on-device dictation — one desktop app, everything stays on your machine.",
  keywords: [
    "screen recorder",
    "focus app",
    "product launch video",
    "on-device dictation",
    "local-first",
    "screen studio alternative",
    "whisper dictation",
  ],
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "shipshape",
    title: "shipshape — the local-first studio for people who ship",
    description:
      "focus · record · launch · dictate — one desktop app, no accounts, no cloud.",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "shipshape — the local-first studio for people who ship",
    description:
      "focus · record · launch · dictate — one desktop app, no accounts, no cloud.",
  },
  alternates: { canonical: siteUrl },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${inter.className} antialiased`}>
      <body>{children}</body>
    </html>
  );
}
