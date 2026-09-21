import Link from "next/link";
import { Disclosure, Note, PostCta } from "../components/Chrome";

export default function Body() {
  return (
    <>
      <p>
        You have seen the videos: a product demo where the screen glides in towards
        whatever is being clicked, holds, and pulls back out, with a soft shadow
        around the window and a cursor that moves like it means it. Nobody edited
        that by hand. It is one feature - the camera follows the pointer - and it is
        the difference between a demo that looks made and one that looks recorded.
      </p>
      <p>
        The app most of those videos come from, Screen Studio, is macOS only and has
        been since it launched. So the question for everyone else is what does this
        on Windows.
      </p>

      <h2>what auto-zoom actually is</h2>
      <p>
        A screen recorder captures the whole screen. Auto-zoom is a second pass over
        the recording: a virtual camera moves across that captured image, scaling in
        around the places where something happened - usually clicks - and easing back
        out when nothing does. The recording itself never changes. That is why it can
        be re-cut afterwards, and why a good tool lets you move, lengthen or delete a
        zoom after the fact.
      </p>
      <p>
        It works because it does what an editor would do manually and what a viewer
        wants anyway: at 1440p, a menu item is about forty pixels tall, and nobody
        watching on a phone can see which one you picked.
      </p>

      <h2>three ways it goes wrong, and what to look for</h2>
      <p>
        Auto-zoom is easy to implement badly, and the failures are specific enough
        that you can test for them in five minutes with any tool you are considering.
      </p>

      <h3>1. The drawn cursor lands in the wrong place</h3>
      <p>
        Most tools draw their own pointer - bigger, smoother, with a click ripple.
        To put it in the right place they have to map the pointer&rsquo;s position,
        which the operating system reports in <em>whole-desktop</em> coordinates,
        onto the rectangle that was actually recorded. On a single monitor those are
        the same thing. On a second monitor, or when recording one window, they are
        not.
      </p>
      <p>
        Get it wrong and the pointer is drawn a long way from where it was. In our
        own tool, before we fixed it, a click that belonged at x = 1632 was drawn at
        x = 933 on a two-monitor desk. Nothing about the video looks broken - the
        pointer is just subtly, maddeningly beside the button.
      </p>
      <p>
        <strong>Test:</strong> record a window - not the full screen - on a
        multi-monitor setup, click something near an edge, and watch where the drawn
        cursor is.
      </p>

      <h3>2. The zoom cuts off the thing you clicked</h3>
      <p>
        A naive implementation treats the click position as the centre of the zoomed
        view and clamps it so the view stays inside the frame. Click something in the
        bottom-right corner - an account menu, a Save button - and the clamp pushes
        the view back until the very thing you clicked is outside it. The menu that
        opens is cut off at the edge.
      </p>
      <p>
        The fix is to treat the click as a <em>point of interest</em> rather than a
        centre: keep it in shot, and let the view sit flush against the frame edge
        when there is no room to centre it.
      </p>
      <p>
        <strong>Test:</strong> click something in a corner and open a menu from it.
      </p>

      <h3>3. The pointer walks out of the shot</h3>
      <p>
        This is the one that separates the tools. If zooming is treated as a filter -
        &ldquo;move the view some fraction of the way towards the cursor each
        frame&rdquo; - then a fast movement outruns it and the cursor leaves the
        visible area entirely. The viewer is watching an empty region of a toolbar
        while you do something off-screen.
      </p>
      <p>
        Treating it as a camera fixes it: a dead zone the pointer can roam in without
        the view moving at all (ours is about a quarter of the visible width), a
        damped spring that carries the view when the pointer pushes past it, reading
        the cursor slightly ahead of where it is, and a hard limit - a leash - that
        the pointer can never be outside. A fast sweep should also widen the shot
        rather than chase it, the way a camera operator pulls back when they lose
        their subject.
      </p>
      <p>
        We measured this on two real recordings. With the follow-the-cursor approach
        the pointer was outside the visible area for 5.8% and 13.4% of the zoomed
        frames. With the camera, both were zero.
      </p>
      <p>
        <strong>Test:</strong> record yourself dragging something quickly across the
        screen, then watch it zoomed in.
      </p>

      <Note label="why this matters more than the feature list">
        <p>
          Every tool in this category lists &ldquo;automatic zoom&rdquo;. None of them
          say which of the three above they get right, and you cannot tell from a
          marketing page - only from a recording of your own desk, with your own
          monitors. Record ninety seconds before you pay for anything.
        </p>
      </Note>

      <h2>the options on Windows</h2>
      <table>
        <thead>
          <tr>
            <th>route</th>
            <th>auto-zoom</th>
            <th>cost</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>OBS Studio</td>
            <td>no - it records, you edit</td>
            <td>free</td>
          </tr>
          <tr>
            <td>A video editor, by hand</td>
            <td>keyframes per zoom</td>
            <td>your evening, per video</td>
          </tr>
          <tr>
            <td>FocuSee</td>
            <td>yes</td>
            <td>subscription</td>
          </tr>
          <tr>
            <td>owntools (screeni)</td>
            <td>yes</td>
            <td>one-time key</td>
          </tr>
        </tbody>
      </table>
      <p>
        OBS is the right answer if what you need is a recording and you are happy
        cutting it yourself - it is free, it is excellent, and nothing here competes
        with it on capture. The reason people pay for something else is the hour per
        video that keyframing zooms costs, every time.
      </p>

      <h2>the rest of what makes a demo look made</h2>
      <p>
        Auto-zoom is the headline, but a demo video that reads as finished usually has
        four more things, and it is worth knowing they exist so you can look for them:
      </p>
      <ul>
        <li>
          <strong>A backdrop and rounded window frame</strong>, so the recording is a
          window on a surface rather than a raw screenshot of your desktop.
        </li>
        <li>
          <strong>Click and keystroke sounds</strong> timed to what actually happened,
          which is only possible if the recorder captured input timing while
          recording.
        </li>
        <li>
          <strong>Silence cut automatically</strong> - the dead air while you think is
          most of the length of a first take.
        </li>
        <li>
          <strong>Captions</strong>, because a large share of the people who watch a
          demo do it with the sound off.
        </li>
      </ul>

      <PostCta title="Auto-zoom recording on Windows, bought once." href="/#pricing" cta="see screeni">
        screeni records your screen, follows the pointer as a camera rather than a
        filter, and gives you the zooms as clips you can move, lengthen or delete
        afterwards - with backdrops, click sounds, captions and silence cutting. It is
        part of owntools, which is a one-time key rather than a subscription.
      </PostCta>

      <Disclosure>
        We build owntools, and screeni is the recorder in it - so the three failures
        above are not hypothetical, they are bugs we shipped and then fixed, with the
        measurements from fixing them. If you are comparing tools, run those three
        tests on ours too.{" "}
        <Link href="/blog/dictate-on-windows-without-the-cloud">
          Our dictation tool
        </Link>{" "}
        is the free part of the same app.
      </Disclosure>
    </>
  );
}
