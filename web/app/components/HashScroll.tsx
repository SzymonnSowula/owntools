"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Makes a jump to `#pricing` (or any other anchor) land on it.
 *
 * It did not: every section below the hero is `content-visibility: auto` (.cv
 * in globals.css), so until a section has been on screen its height is a
 * guess. A jump is aimed using those guesses, and the moment it lands the
 * sections around the target render, get their real heights, and everything
 * below them moves - measured on the live page at 1615 px: "pricing" in the nav
 * ended 1,869 px past the pricing section, in the FAQ; opening /#pricing ended
 * on the roadmap. Smooth scrolling made it as bad as it can get, because the
 * destination is worked out once and every section passed on the way then
 * changes height under it - so the page jumps instead (globals.css), which is
 * also the only way twenty sections are not laid out just for being flown over.
 *
 * What is left after an instant jump is a settling error of a hundred pixels
 * or so, and that is this component: after a jump it puts the target back where
 * it belongs on every frame until a few frames in a row needed no correction.
 * It never fights a person - any wheel, touch, key or mouse press ends it - and
 * it covers every way of arriving: a click on an in-page link (also when the
 * hash is already the current one, which fires no `hashchange`), back and
 * forward, a link from another page, and a page opened with the hash in its URL
 * (once more after `load`, because late images move things too).
 *
 * `scrollIntoView` honours the `scroll-margin-top` that keeps a section clear
 * of the floating nav, and the page's `zoom`, so none of that is computed here.
 */
export function HashScroll() {
  const pathname = usePathname();

  useEffect(() => {
    let run = 0;
    let frame = 0;
    let touched = false;

    const stop = () => {
      run += 1;
      cancelAnimationFrame(frame);
    };

    const settleOn = (hash: string) => {
      let id = hash.replace(/^#/, "");
      try {
        id = decodeURIComponent(id);
      } catch {
        /* a malformed escape: try it as written */
      }
      const target = id ? document.getElementById(id) : null;
      if (!target) return;

      stop();
      const mine = run;
      let calm = 0;
      let frames = 0;
      const step = () => {
        if (mine !== run) return;
        const before = target.getBoundingClientRect().top;
        target.scrollIntoView({ block: "start", behavior: "instant" });
        const drift = Math.abs(target.getBoundingClientRect().top - before);
        calm = drift < 1 ? calm + 1 : 0;
        // four quiet frames = nothing around the target is still rendering; ~0.7 s at most
        if (calm < 4 && ++frames < 40) frame = requestAnimationFrame(step);
      };
      step();
    };

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank") return;
      const url = new URL(link.href, location.href);
      if (url.origin !== location.origin || url.pathname !== location.pathname || !url.hash) return;
      touched = false;
      // the browser does the navigating (URL, history, focus); this only settles where it ends
      frame = requestAnimationFrame(() => settleOn(url.hash));
    };

    const onHashChange = () => {
      touched = false;
      settleOn(location.hash);
    };
    const onLoad = () => {
      if (!touched && location.hash) settleOn(location.hash);
    };
    const onUserScroll = () => {
      touched = true;
      stop();
    };

    document.addEventListener("click", onClick);
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("wheel", onUserScroll, { passive: true });
    window.addEventListener("touchstart", onUserScroll, { passive: true });
    window.addEventListener("keydown", onUserScroll);
    window.addEventListener("mousedown", onUserScroll);
    if (location.hash) settleOn(location.hash);
    if (document.readyState !== "complete") window.addEventListener("load", onLoad, { once: true });

    return () => {
      stop();
      document.removeEventListener("click", onClick);
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("wheel", onUserScroll);
      window.removeEventListener("touchstart", onUserScroll);
      window.removeEventListener("keydown", onUserScroll);
      window.removeEventListener("mousedown", onUserScroll);
      window.removeEventListener("load", onLoad);
    };
    // a new path is a new page under the same layout: a link like /#pricing from /terms arrives here
  }, [pathname]);

  return null;
}
