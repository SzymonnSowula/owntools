import type { CSSProperties } from "react";
import dynamic from "next/dynamic";
import { Reveal } from "../Reveal";

/* Code-split, still server-rendered: the demo's script loads beside the
   page's instead of inside it, and React hydrates it on its own. */
const BarDemo = dynamic(() => import("./BarDemo").then((m) => m.BarDemo));

/**
 * The bar (2026-09-16): the strip at the bottom of the screen that holds what
 * you do over other apps - dictate, record, a focus session, a meeting. One
 * heading, one sentence, and the bar itself, working; the demo says the rest.
 */
export function BarSection() {
  return (
    <section
      id="bar"
      className="cv px-5 py-16 md:py-24"
      style={{ "--cv": "860px", "--cv-lg": "960px" } as CSSProperties}
    >
      <div className="mx-auto max-w-5xl">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="kicker">the bar</p>
          <h2 className="display mt-3 text-4xl md:text-5xl">one click from any app</h2>
          <p className="mx-auto mt-4 max-w-xl text-muted">
            Dictate, record, focus or take meeting notes without leaving the app you&apos;re in.
          </p>
        </Reveal>
        <Reveal className="-mx-5 mt-10 sm:mx-0 md:mt-12">
          <BarDemo />
        </Reveal>
      </div>
    </section>
  );
}
