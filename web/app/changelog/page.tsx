import type { Metadata } from "next";
import { LegalPage } from "../components/LegalPage";
import { CHANGELOG } from "@/lib/changelog";

export const metadata: Metadata = {
  title: "Changelog",
  description: "Every public build of the shipshape desktop app, newest first.",
  alternates: { canonical: "/changelog" },
};

export default function ChangelogPage() {
  return (
    <LegalPage kicker="releases" title="changelog" intro="Every public build of the desktop app, newest first.">
      {CHANGELOG.map((entry) => (
        <section key={entry.version}>
          <div className="flex items-center gap-3 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
            <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-accent">v{entry.version}</span>
            <time dateTime={entry.date}>{entry.date}</time>
          </div>
          <h2>{entry.title}</h2>
          <ul>
            {entry.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      ))}
    </LegalPage>
  );
}
