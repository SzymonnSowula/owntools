"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Check, LoaderCircle } from "lucide-react";

export type KeyFormState = "idle" | "sending" | "sent" | "invalid" | "busy" | "unconfigured" | "error";
type State = KeyFormState;

/**
 * One field, one button. The answer is the same whether the address bought
 * anything or not (the server never says), so the copy has to cover both: what
 * to expect, and what to check when nothing arrives.
 *
 * It works without its script too: the form posts to /api/key, which answers a
 * plain form post with a redirect to /key?state=…, and `initial` is that state.
 * `method="post"` is what keeps an address out of a URL when the script is
 * blocked.
 */
export function KeyForm({ contact, initial = "idle" }: { contact: string; initial?: KeyFormState }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>(initial);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (state === "sending") return;
    setState("sending");
    try {
      const res = await fetch("/api/key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => null)) as { state?: State } | null;
      setState(data?.state ?? (res.ok ? "sent" : "error"));
    } catch {
      setState("error");
    }
  };

  if (state === "sent") {
    return (
      <div className="wincard p-6">
        <p className="flex items-center gap-2 font-semibold text-ink">
          <Check size={16} className="text-accent" /> check your inbox
        </p>
        <p className="mt-2 text-[14.5px] leading-6 text-muted">
          If there is a purchase under{" "}
          {email ? <span className="font-semibold text-ink">{email}</span> : "that address"}, the key is on its way
          there. Give it a minute, and look in spam too.
        </p>
        <p className="mt-3 text-[14.5px] leading-6 text-muted">
          Nothing after a few minutes? Then the purchase was made with a different address - it is the one Polar&rsquo;s
          receipt went to.{" "}
          {/* a link, so it also works when the script did not run */}
          <a
            href="/key"
            className="font-semibold text-accent underline underline-offset-4"
            onClick={(e) => {
              e.preventDefault();
              setState("idle");
            }}
          >
            Try another address
          </a>
          .
        </p>
      </div>
    );
  }

  const note: Partial<Record<State, string>> = {
    invalid: "That does not look like an e-mail address.",
    busy: "That was a few requests in a row. Wait a little and try again - an e-mail that is already on its way is not sent twice.",
    error: "The key could not be sent just now. Try again in a minute.",
  };

  return (
    <form onSubmit={(e) => void submit(e)} method="post" action="/api/key" className="wincard p-6">
      <label htmlFor="key-email" className="font-semibold text-ink">
        the e-mail address you paid with
      </label>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <input
          id="key-email"
          type="email"
          name="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (state !== "idle" && state !== "sending") setState("idle");
          }}
          className="h-11 w-full min-w-0 rounded-[12px] border border-line bg-paper px-4 text-[15px] text-ink outline-none placeholder:text-muted/70 focus:border-accent"
        />
        {/* never disabled for being empty: without the script it could not be enabled again; `required` does that job */}
        <button type="submit" disabled={state === "sending"} className="btn btn-accent !h-11 shrink-0 disabled:opacity-60">
          {state === "sending" ? <LoaderCircle size={15} className="animate-spin" /> : null}
          send my key <ArrowRight size={15} />
        </button>
      </div>
      {state === "unconfigured" ? (
        <p role="status" className="mt-3 text-[13.5px] leading-6 text-muted">
          This server cannot send e-mail yet. Write to{" "}
          <a href={`mailto:${contact}`} className="font-semibold text-accent underline underline-offset-4">
            {contact}
          </a>{" "}
          from the address you paid with and you will get your key.
        </p>
      ) : note[state] ? (
        <p role="status" className="mt-3 text-[13.5px] leading-6 text-muted">
          {note[state]}
        </p>
      ) : null}
    </form>
  );
}
