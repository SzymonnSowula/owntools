import Link from "next/link";
import { Disclosure, Note, PostCta } from "../components/Chrome";

export default function Body() {
  return (
    <>
      <p>
        Push-to-talk dictation is unusable if it thinks for five seconds after you let go of the
        key. Ours did. Getting it under a second took three changes, and the one that mattered
        most was the one we would have bet against: using fewer CPU threads.
      </p>

      <h2>what was measured</h2>
      <p>
        An i5-10300H laptop - 4 physical cores, 8 logical - running Windows. No GPU involvement:
        everything below is CPU. The engine is sherpa-onnx with NVIDIA&rsquo;s Parakeet TDT 0.6B
        v3, int8 quantised, against whisper.cpp with large-v3-turbo q5_0 for comparison. Times are
        wall clock from the end of speech to text in hand, medians of repeated runs on the same
        audio.
      </p>
      <p>
        Two clips recur below: a short one, 3.9 seconds, which is what a dictation take actually
        looks like, and a long one, about 24 seconds, where decoding dominates.
      </p>

      <h2>where the 6.4 seconds went</h2>
      <p>
        The first implementation ran the sherpa-onnx command line tool once per take. For the 3.9
        second clip that took 6,100-6,500 ms, of which <strong>4,400-4,800 ms was loading the
        model</strong>. We were paying for the model load on every single press of the hotkey.
      </p>
      <p>
        This is the whole game on CPU inference and it is easy to miss, because a benchmark of your
        decoder looks fine in isolation. The fix is to stop exiting: sherpa-onnx ships{" "}
        <code>sherpa-onnx-offline-websocket-server</code>, which keeps the recognizer in memory and
        takes audio over a socket. We keep one alive per model and thread count, on loopback, and
        shut it down after 15 minutes idle so a 600 MB resident model does not sit there all day.
      </p>

      <Note label="a note on dependencies">
        <p>
          The wire format is a <code>u32</code> sample rate, a <code>u32</code> byte count, then
          f32 samples, and the answer is one JSON message. That did not seem worth an async runtime
          and a TLS stack, so the client is about 150 lines of hand-written WebSocket framing. The
          peer is our own child process on loopback: no TLS, no deflate, and{" "}
          <code>Sec-WebSocket-Accept</code> deliberately unchecked. An ignored integration test
          verifies the framing against the real server, because that is the part that would break
          silently.
        </p>
      </Note>

      <h2>the thread count, which we got backwards</h2>
      <p>
        The one-shot tool had been running with logical cores minus one - 7 threads. The obvious
        move when latency matters is to give it everything. Instead:
      </p>
      <table>
        <thead>
          <tr>
            <th>threads</th>
            <th className="num">3.9 s clip, warm</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>4 (physical cores)</td>
            <td className="num">660 ms</td>
          </tr>
          <tr>
            <td>8 (logical cores)</td>
            <td className="num">1,300 ms</td>
          </tr>
        </tbody>
      </table>
      <p>
        Twice as slow with twice the threads. Hyperthreads share the execution units that the
        matrix multiplication in onnxruntime already saturates, so the extra threads add scheduling
        and synchronisation and take back nothing. We had been throwing away half our speed by
        asking for more.
      </p>
      <p>
        Which means <code>std::thread::available_parallelism</code> is the wrong function - it
        counts logical processors. Count physical cores:{" "}
        <code>GetLogicalProcessorInformationEx</code> with <code>RelationProcessorCore</code> on
        Windows, and on Apple Silicon <code>hw.perflevel0.physicalcpu</code>, which gives you the
        performance cores rather than the total including efficiency cores.
      </p>

      <h2>two more levers on the same path</h2>
      <p>
        <strong>Warm up while they are talking.</strong> Even resident, the first request after
        launch pays the load. Trigger it the moment recording starts rather than when it stops:
        the person speaks for a second or two anyway, and the load hides inside that.
      </p>
      <p>
        <strong>Trim silence, but only for live takes.</strong> A push-to-talk recording carries
        dead air at both ends from human reaction time, and the decoder charges for it. Cutting it
        is free speed. Do not do it to a file the user is transcribing for subtitles - its timings
        become the subtitle timings, and you have just shifted every cue.
      </p>

      <h3>the result</h3>
      <table>
        <thead>
          <tr>
            <th>3.9 second take</th>
            <th className="num">time</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>One-shot CLI, 7 threads</td>
            <td className="num">6,100-6,500 ms</td>
          </tr>
          <tr>
            <td>Resident, 4 threads, warm</td>
            <td className="num">660-806 ms</td>
          </tr>
        </tbody>
      </table>
      <p>About nine times faster, and none of it came from a better model.</p>

      <h2>against whisper.cpp</h2>
      <p>On the ~24 second clip, same machine:</p>
      <table>
        <thead>
          <tr>
            <th>engine</th>
            <th className="num">model load</th>
            <th className="num">decode</th>
            <th className="num">total</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Parakeet TDT 0.6B v3 int8</td>
            <td className="num">3.2 s</td>
            <td className="num">1.5-1.8 s</td>
            <td className="num">5.0-5.3 s</td>
          </tr>
          <tr>
            <td>whisper.cpp large-v3-turbo q5_0</td>
            <td className="num">-</td>
            <td className="num">-</td>
            <td className="num">33-37 s</td>
          </tr>
        </tbody>
      </table>
      <p>
        Both were accurate, including on Polish, which we did not expect from a 0.6B model. The
        comparison is not apples to apples - large-v3-turbo is far bigger - but it is the choice
        you actually face when picking a default for a laptop.
      </p>
      <p>
        Whisper stays in the product anyway, because Parakeet gives us{" "}
        <strong>no timestamps, no translation and no prompt biasing</strong>. Subtitles need word
        timings. Translation needs a model that translates. And a vocabulary of names and jargon
        gets into Whisper through its initial prompt, which Parakeet has no equivalent for. So
        dictation runs on Parakeet where it is installed, and anything involving a file or another
        language goes to Whisper regardless of what is selected.
      </p>

      <h2>what we did not get</h2>
      <p>
        Sub-300 ms is the number people quote for models in this family, and we are not at it. At a
        real-time factor around 0.17, the arithmetic says you cannot be: a 4 second take costs
        ~700 ms of decode no matter how warm the model is, because the decode only begins when the
        speech ends.
      </p>
      <p>
        The only way past that is to stop waiting - run a voice activity detector over the incoming
        audio, ship each segment as it closes, and leave just the tail to decode when the key comes
        up. That is a different architecture, not a tuning pass, and it is the honest answer to
        &ldquo;why is it not 300 ms&rdquo;: because we have not rewritten it to decode during
        speech yet.
      </p>

      <h3>if you are doing this yourself</h3>
      <ul>
        <li>Measure the model load separately from the decode. It is probably most of your time.</li>
        <li>Try physical-core thread counts before anything else. It is one line.</li>
        <li>
          Start loading on record-start, not on record-stop. Users measure latency from when they
          stop talking.
        </li>
        <li>
          Put the number in the interface. Ours prints the time under the test transcript, so a
          regression is visible to somebody other than the person waiting.
        </li>
      </ul>

      <PostCta title="This is the free part of the app." href="/#pricing" cta="see the dictation tool">
        The dictation described here - a hotkey, on-device recognition, text typed into whatever
        app has focus - is free in owntools, on Windows. No account, and the audio never leaves the
        machine. If you want the background,{" "}
        <Link href="/blog/dictate-on-windows-without-the-cloud">
          the options for dictating on Windows without the cloud
        </Link>{" "}
        covers what else is out there.
      </PostCta>

      <Disclosure>
        We build owntools. These are our own measurements on one laptop, which is a sample of one -
        if your numbers differ, particularly the thread finding on a machine with more cores, we
        would genuinely like to hear it.
      </Disclosure>
    </>
  );
}
