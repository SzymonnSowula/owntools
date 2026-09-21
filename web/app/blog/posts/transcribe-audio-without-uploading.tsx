import Link from "next/link";
import { Disclosure, Note, PostCta } from "../components/Chrome";

export default function Body() {
  return (
    <>
      <p>
        Every free transcription site works the same way: you hand over the
        recording, it comes back as text. For a podcast episode that is fine. For a
        research interview, a client call, a patient conversation or anything with a
        confidentiality clause on it, &ldquo;hand over the recording&rdquo; is the
        part you are not allowed to do.
      </p>
      <p>
        The useful thing that changed in the last couple of years is that you no
        longer have to. A speech model good enough for real transcription runs on an
        ordinary laptop, offline, for free.
      </p>

      <h2>what uploading actually commits you to</h2>
      <p>
        A recording of someone talking is personal data, and often special-category
        data - health, opinions, employment, a name said out loud. Sending it to a
        transcription service means:
      </p>
      <ul>
        <li>
          <strong>A processor you have to name.</strong> If you work under GDPR, that
          service is a data processor and belongs in your records, usually with a
          data processing agreement behind it.
        </li>
        <li>
          <strong>Retention you do not control.</strong> Most services keep the audio
          and the transcript until you delete them, and some keep backups longer.
        </li>
        <li>
          <strong>A promise you passed on.</strong> If you told an interviewee the
          recording stays with you, a free web converter is the moment that stopped
          being true - whatever the service does with it afterwards.
        </li>
      </ul>
      <p>
        None of that is an accusation against any particular service. It is the
        ordinary consequence of the file leaving your computer, and the reason ethics
        boards, DPOs and in-house counsel ask about it.
      </p>

      <Note label="the short version for a form">
        <p>
          &ldquo;Transcription is performed locally on the researcher&rsquo;s device
          using an open-source speech recognition model. No audio or transcript is
          transmitted to a third party.&rdquo; That sentence is much easier to get
          approved than a list of sub-processors, which is on its own a good reason to
          work this way.
        </p>
      </Note>

      <h2>what runs locally, and how well</h2>
      <p>
        The model to know about is <strong>Whisper</strong>, released openly by
        OpenAI and runnable through <code>whisper.cpp</code> on a normal CPU. It
        handles a long list of languages, produces word-level timestamps, and can
        translate into English. This is the same family of model the paid services
        run - the difference is where it runs, not what it is.
      </p>
      <p>Two things to be realistic about before you commit a deadline to it:</p>
      <h3>Speed</h3>
      <p>
        On a four-core laptop CPU, the large turbo model transcribes roughly in real
        time - we measured 33 to 37 seconds for 24 seconds of speech. So a one-hour
        interview is about an hour of your laptop working, which is fine overnight or
        over lunch and painful if you need it in five minutes. Smaller models are
        several times faster and noticeably worse on names. A machine with a decent
        GPU changes this picture completely.
      </p>
      <h3>Speakers</h3>
      <p>
        Whisper transcribes speech; it does not tell you who is talking. Cloud
        services often add speaker labels on top. If your workflow depends on
        &ldquo;Interviewer:&rdquo; and &ldquo;Participant:&rdquo; being filled in for
        you, a local transcript will need that pass by hand - for a two-person
        interview that is usually minutes, but it is honest work you should know
        about in advance.
      </p>

      <h2>getting a usable transcript, not a wall of text</h2>
      <p>
        Raw model output is one long block, which is unreadable and unquotable. Three
        things make it work as a document:
      </p>
      <ol>
        <li>
          <strong>Sentence or paragraph grouping.</strong> The model emits short cues
          that often end mid-sentence, so they need regrouping into sentences and
          paragraphs before anyone can read it.
        </li>
        <li>
          <strong>Timestamps you can cite.</strong> For a quote you will want to go
          back to, a timestamp every paragraph beats a timestamp every four words.
        </li>
        <li>
          <strong>A vocabulary.</strong> Names, places, product names and jargon are
          where every recognizer fails. Whisper accepts an initial prompt - give it
          the participant&rsquo;s name and the six terms your field uses and the
          transcript stops being littered with near-misses.
        </li>
      </ol>
      <p>
        If you need subtitles rather than a document, the same run gives you an{" "}
        <code>.srt</code> or <code>.vtt</code> file, because the timings are already
        there.
      </p>

      <h2>the three ways to do it</h2>
      <table>
        <thead>
          <tr>
            <th>route</th>
            <th>audio leaves your computer</th>
            <th>effort</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>An online transcription service</td>
            <td>yes</td>
            <td>none, plus a subscription and a DPA</td>
          </tr>
          <tr>
            <td>
              <code>whisper.cpp</code> from the command line
            </td>
            <td>no</td>
            <td>a binary, a model file, and flags to learn</td>
          </tr>
          <tr>
            <td>A desktop app that wraps it</td>
            <td>no</td>
            <td>install, pick a model once, drop the file in</td>
          </tr>
        </tbody>
      </table>
      <p>
        The command line is genuinely fine if you transcribe something twice a year.
        The reason most people end up wanting an app is not the transcription - it is
        the formats, the regrouping, the vocabulary and not re-reading a manual every
        time.
      </p>

      <h2>how to check the claim</h2>
      <p>
        Any tool that says &ldquo;runs locally&rdquo; can be tested in ten seconds:
        turn off wi-fi after the model has downloaded, and transcribe something. If it
        works offline, the audio is not going anywhere. For a stronger guarantee, add
        an outbound block rule for the program in Windows Defender Firewall and try
        again. We wrote the same test up for dictation in{" "}
        <Link href="/blog/dictate-on-windows-without-the-cloud">
          dictating on Windows without the cloud
        </Link>
        .
      </p>

      <PostCta title="Drop a file in, get the transcript." href="/#pricing" cta="download it free">
        owntools transcribes audio and video on your own machine with whisper.cpp -
        one line, full sentences or paragraphs, with or without timestamps, plus{" "}
        <code>.srt</code> subtitles and translation into English. It is part of the
        free tier: no account, no upload, no per-minute charge.
      </PostCta>

      <Disclosure>
        We build owntools, which includes the transcription tool described at the end.
        The speed figures above are our own measurements on one four-core laptop, and
        the speaker-labelling limitation is a real one we would rather you hear from
        us than discover at midnight.
      </Disclosure>
    </>
  );
}
