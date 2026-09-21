import Link from "next/link";
import { Disclosure, Note, PostCta } from "../components/Chrome";

export default function Body() {
  return (
    <>
      <p>
        If you press <kbd>Win</kbd>+<kbd>H</kbd> on a laptop with no connection, nothing happens.
        That is not a bug - it is the clearest possible statement of where your voice goes when you
        use Windows&rsquo; own voice typing. For some work that is fine. For interview recordings,
        clinical notes, legal drafts or anything under an NDA, it is the whole question.
      </p>

      <h2>why Win+H needs the internet</h2>
      <p>
        Voice typing sends your audio to Microsoft&rsquo;s online speech service and gets text
        back. The recognition happens on their servers, not your CPU, which is why it stops working
        offline and why it is as good as it is - it is running a far larger model than your laptop
        would.
      </p>
      <p>
        What happens to the audio afterwards depends on your privacy settings, your account type
        and a policy that can be revised. You can go and read those settings. The point is that you
        would have to keep going back to read them, and the alternative is not having to.
      </p>

      <h2>the offline option Windows already has</h2>
      <p>
        <strong>Voice Access</strong>, in Windows 11 22H2 and later, is a different feature from
        voice typing and runs <strong>on-device</strong> after a one-time language download. It is
        built for controlling the whole PC by voice and it dictates as part of that.
      </p>
      <p>
        Two things to know before you settle on it: it supports a much shorter list of languages
        than voice typing does, and it is a full voice-control mode rather than a press-to-talk
        key, which is a different way of working than most people want for dictating a paragraph
        into an email. If English is your language and you like the modality, it is free, built in,
        and it never sends audio anywhere. Start it from Accessibility settings.
      </p>

      <h2>the third route: a local recognition model</h2>
      <p>
        Two open speech models are good enough to run this way on an ordinary laptop, and between
        them they cover most needs:
      </p>
      <ul>
        <li>
          <strong>Whisper</strong> (OpenAI, open weights). Many languages, gives you word
          timestamps, can translate into English, and accepts a prompt so you can feed it names and
          jargon it would otherwise mangle. Slower.
        </li>
        <li>
          <strong>Parakeet</strong> (NVIDIA). Much faster on CPU - well under a second for a
          typical dictation take - but no timestamps, no translation and no prompt. Fewer
          languages.
        </li>
      </ul>
      <p>
        You can run either from a command line yourself; <code>whisper.cpp</code> is a single
        binary and a model file. What you will not get that way is the thing that makes dictation
        useful: a global hotkey that types the result into whatever window you are actually in. For
        that you want an app that wraps the engine. There are several for Windows now, open source
        and commercial, subscription and one-time.
      </p>

      <Note label="on speed">
        <p>
          &ldquo;Runs locally&rdquo; used to mean &ldquo;wait five seconds&rdquo;. It does not any
          more, but the difference is in the implementation rather than the model - keeping the
          recognizer loaded between takes and giving it the right number of threads was worth
          roughly 9x for us. We published{" "}
          <Link href="/blog/parakeet-vs-whisper-cpu">the numbers and what caused them</Link>.
        </p>
      </Note>

      <h2>the four options side by side</h2>
      <table>
        <thead>
          <tr>
            <th>approach</th>
            <th>audio leaves your PC</th>
            <th>types into any app</th>
            <th>setup</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Win+H voice typing</td>
            <td>yes</td>
            <td>yes</td>
            <td>none, built in</td>
          </tr>
          <tr>
            <td>Voice Access</td>
            <td>no</td>
            <td>yes</td>
            <td>one language download</td>
          </tr>
          <tr>
            <td>whisper.cpp yourself</td>
            <td>no</td>
            <td>no - files in, text out</td>
            <td>binary plus a model</td>
          </tr>
          <tr>
            <td>An app wrapping a local engine</td>
            <td>no</td>
            <td>yes</td>
            <td>install, download a model once</td>
          </tr>
        </tbody>
      </table>

      <h2>how to check a local app is telling the truth</h2>
      <p>
        &ldquo;Private&rdquo; and &ldquo;on-device&rdquo; are marketing words until you test them.
        Three ways, easiest first:
      </p>
      <ol>
        <li>
          <strong>Turn off wi-fi and dictate.</strong> A local recognizer keeps working. This
          catches most of it, and it takes ten seconds. Do it after the model has downloaded -
          every local app has to fetch its model once.
        </li>
        <li>
          <strong>Watch the network while you speak.</strong> Open Resource Monitor
          (<code>resmon</code>), go to the Network tab, find the app, and dictate a long
          paragraph. Audio going out is not subtle: you are looking for sustained kilobytes, not a
          few hundred bytes of update check.
        </li>
        <li>
          <strong>Block it outbound.</strong> Windows Defender Firewall lets you add an outbound
          rule for one program. If dictation still works with the app blocked, the audio is not
          going anywhere.
        </li>
      </ol>
      <p>
        If the app is open source you can go further and read what it sends - but for most people
        the firewall rule is a stronger guarantee than a privacy policy, because it does not depend
        on anyone keeping a promise.
      </p>

      <h2>what you give up, honestly</h2>
      <p>
        A local model is smaller than what a data centre runs. In practice that shows up in three
        places: <strong>proper nouns and product names</strong>, <strong>heavy accents</strong>,
        and <strong>very technical vocabulary</strong>. The first is fixable - most local apps let
        you supply a list of terms and spellings, which works well. The other two are real, and if
        dictation accuracy is the difference between the tool being used and not, test it on your
        own voice before deciding.
      </p>
      <p>
        The bigger practical win is nothing to do with privacy: local dictation does not care about
        your connection. It works on a train, on hotel wi-fi, and in the room with bad signal where
        the cloud one silently drops the first half of your sentence.
      </p>

      <PostCta title="Free dictation that runs on your machine." href="/#pricing" cta="download it">
        owntools has a dictation tool for Windows: one hotkey, Parakeet or whisper.cpp on your own
        CPU, text typed straight into whatever window has focus, plus a vocabulary for the names it
        would otherwise get wrong. It is free - no account, no word limit - and the source is
        public, so the firewall test above is not the only way to check it.
      </PostCta>

      <Disclosure>
        We build owntools, which is one of the apps in that last category. The comparison above is
        written to be useful even if you pick something else - Voice Access in particular is free,
        already installed, and genuinely on-device.
      </Disclosure>
    </>
  );
}
