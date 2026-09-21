import Link from "next/link";
import { Disclosure, Note, PostCta } from "../components/Chrome";
import {
  SUBSCRIPTIONS,
  SUBSCRIPTIONS_CHECKED,
  SUBSCRIPTIONS_TOTAL_CENTS,
  centsToAmount,
} from "@/lib/comparison";

export default function Body() {
  return (
    <>
      <p>
        Nobody decides to spend a thousand dollars a year on utilities. It arrives one
        eight-dollar decision at a time, each of them obviously worth it on the day,
        and then it renews quietly for as long as the card works.
      </p>
      <p>
        So here is the arithmetic, done properly, for the ten jobs a person doing
        ordinary desk work ends up paying for.
      </p>

      <h2>the bill</h2>
      <p>
        Rules these numbers were collected under, because a comparison is worth
        nothing if you cannot check it: each vendor&rsquo;s own pricing page, in USD,
        the cheapest paid plan for one person billed yearly, Windows only, all checked
        on <strong>{SUBSCRIPTIONS_CHECKED}</strong>.
      </p>
      <table>
        <thead>
          <tr>
            <th>the job</th>
            <th>bought as</th>
            <th className="num">per year</th>
          </tr>
        </thead>
        <tbody>
          {SUBSCRIPTIONS.map((row) => (
            <tr key={row.app}>
              <td>{row.job}</td>
              <td>{row.app}</td>
              <td className="num">${centsToAmount(row.cents)}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={2}>
              <strong>total</strong>
            </td>
            <td className="num">
              <strong>${centsToAmount(SUBSCRIPTIONS_TOTAL_CENTS)}</strong>
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        Every year. Not one of those prices is unreasonable for what that app does -
        that is exactly why the total gets to where it gets.
      </p>

      <Note label="the fair version">
        <p>
          Almost nobody pays all ten. Most people pay for three or four and do the
          rest badly by hand, or with a free tool that uploads their files somewhere.
          Both halves of that are the cost: the money you spend, and the jobs you
          avoid because paying for another subscription to do them once a month is
          absurd.
        </p>
      </Note>

      <h2>how ordinary desktop jobs became rent</h2>
      <p>
        Dictation, screen recording, PDF conversion, file transcoding - these ran on
        a desktop computer twenty years ago, bought once, working offline. They did
        not become subscriptions because they started needing a server. They became
        subscriptions because subscriptions are a better business.
      </p>
      <p>
        And for a while there was a real technical reason in some of them: speech
        recognition genuinely was too heavy for a laptop, so it had to run in a data
        centre, and a data centre has a monthly bill. That reason expired. A speech
        model that transcribes a sentence in under a second now{" "}
        <Link href="/blog/parakeet-vs-whisper-cpu">runs on a four-core laptop CPU</Link>
        . The pricing model outlived its justification.
      </p>

      <h2>the test that tells you which is which</h2>
      <p>
        Not every subscription is rent for something your computer could do. The
        question worth asking about each line on your own bill:{" "}
        <strong>does this job actually need a server?</strong>
      </p>
      <table>
        <thead>
          <tr>
            <th>needs a server</th>
            <th>does not</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Several people editing the same document</td>
            <td>Dictating into a text field</td>
          </tr>
          <tr>
            <td>Publishing to someone else&rsquo;s API on a schedule</td>
            <td>Recording and editing your screen</td>
          </tr>
          <tr>
            <td>Your files on your phone and your laptop</td>
            <td>Converting a PDF, an image, an audio file</td>
          </tr>
          <tr>
            <td>A model far too large to run locally</td>
            <td>Transcribing a recording</td>
          </tr>
        </tbody>
      </table>
      <p>
        Where the answer is yes, a subscription is honest: something is running for
        you, continuously, and it costs money to keep running. Where the answer is no,
        you are renting a licence to use your own processor.
      </p>

      <h2>what a subscription genuinely buys</h2>
      <p>
        Being fair about this matters, because the opposite argument is usually made
        dishonestly:
      </p>
      <ul>
        <li>
          <strong>Development that continues.</strong> A one-time purchase funds the
          version you bought. Plenty of bought-once software has been abandoned.
        </li>
        <li>
          <strong>Support by a person.</strong> Cheap software mostly means a docs
          page and an issue tracker.
        </li>
        <li>
          <strong>Teams and sharing</strong>, which genuinely do need infrastructure.
        </li>
        <li>
          <strong>The very best accuracy</strong>, in speech and image work, still
          tends to be a model too big to run at home.
        </li>
      </ul>
      <p>
        If you need those, pay for them. The waste is not subscriptions as such - it
        is paying a monthly fee, forever, for a job that finishes on your own machine
        in four seconds.
      </p>

      <h2>doing something about it, in an evening</h2>
      <ol>
        <li>
          <strong>List what actually renewed.</strong> Card statement or app store
          subscriptions, twelve months back. The forgotten ones are usually the
          expensive part.
        </li>
        <li>
          <strong>Mark the ones you used in the last month.</strong> Not &ldquo;would
          use&rdquo; - used.
        </li>
        <li>
          <strong>For each of the rest, ask whether the job needs a server.</strong>{" "}
          If not, there is almost certainly something that does it on your machine -
          often free and open source.
        </li>
        <li>
          <strong>Cancel at the renewal date, not today.</strong> You have already
          paid to the end of the term.
        </li>
      </ol>
      <p>
        You will not replace all ten and it is not worth pretending otherwise. Getting
        three of them off the list is several hundred dollars a year and one fewer
        password.
      </p>

      <PostCta title="Nine of those jobs, one app, paid for once." href="/#pricing" cta="see the price">
        owntools does dictation, transcription, screen recording, screenshots,
        meeting notes, notes and tasks, a whiteboard, post scheduling and disk
        cleanup - on your own machine, with no account. Dictation and the file tools
        are free; the rest is a one-time key, not a renewal.
      </PostCta>

      <Disclosure>
        We build owntools, so we are plainly not neutral about the conclusion. The
        numbers are the reason to publish it anyway: they are from each vendor&rsquo;s
        own pricing page on {SUBSCRIPTIONS_CHECKED}, the rules for picking them are
        stated above, and prices drift - so check any line that matters to you before
        you act on it.
      </Disclosure>
    </>
  );
}
