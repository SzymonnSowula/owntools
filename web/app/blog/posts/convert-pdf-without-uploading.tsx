import Link from "next/link";
import { Disclosure, Note, PostCta } from "../components/Chrome";

export default function Body() {
  return (
    <>
      <p>
        The first result for &ldquo;pdf to word&rdquo; asks you to drop the file on a
        web page. It works, it is free, and for a train timetable it is completely
        fine. For a signed contract, a payslip, a medical letter or a scan of your
        passport, you have just emailed a stranger a document you would not have
        emailed a stranger.
      </p>
      <p>
        Nothing in a PDF conversion needs a server. The libraries that do it run
        perfectly well on your own machine, and in some cases inside your own browser
        tab.
      </p>

      <h2>what a free converter site actually does with the file</h2>
      <p>
        The typical one uploads your document, converts it on their machine, gives you
        a download link, and deletes it after some number of hours. The reputable ones
        say so plainly in their privacy policy and hold to it. The point is not that
        they are villains - it is what you are agreeing to:
      </p>
      <ul>
        <li>
          The file sits on someone else&rsquo;s disk for a while, and the download
          link often works for anyone who has it.
        </li>
        <li>
          If the document contains other people&rsquo;s personal data - a payroll
          report, a class list, a patient letter - you have shared it with a
          processor, which is a thing you may have to be able to justify.
        </li>
        <li>
          Under a confidentiality clause, &ldquo;I used a free website&rdquo; is not a
          defence anyone wants to have to make.
        </li>
      </ul>

      <Note label="not every website uploads">
        <p>
          Some browser tools genuinely do the work in the page, with no upload at all,
          and they deserve credit for it. You can tell which is which in about twenty
          seconds: open DevTools (<kbd>F12</kbd>), go to the <strong>Network</strong>{" "}
          tab, and convert a file. If your document goes up, you will see a request of
          roughly its size. The blunter test: disconnect from the internet after the
          page has loaded and try again. A tool that works offline never had your file.
        </p>
      </Note>

      <h2>first: is your PDF text, or a photograph of text?</h2>
      <p>
        This one distinction decides what is possible, and most disappointing
        conversions come from not checking it. Open the PDF and try to select a
        sentence with the mouse.
      </p>
      <ul>
        <li>
          <strong>The text highlights</strong> - it is a real text PDF. Converting is
          reliable, fast, and can be done entirely locally.
        </li>
        <li>
          <strong>Nothing highlights, or the whole page highlights as one block</strong>{" "}
          - it is a scan. There is no text in the file at all, only an image of it,
          and getting text out needs OCR. That is a different, slower job with a real
          error rate, and it is where free tools vary wildly.
        </li>
      </ul>

      <h2>what converts well, and what never will</h2>
      <table>
        <thead>
          <tr>
            <th>from a text PDF to</th>
            <th>how well it goes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Plain text or Markdown</td>
            <td>Reliable. The catch is layout: columns, headers and footers have to be regrouped into reading order, and that is where tools differ.</td>
          </tr>
          <tr>
            <td>Word (.docx)</td>
            <td>Approximate, always. A PDF stores glyphs at coordinates, not paragraphs, so the converter is reconstructing a document that was thrown away. Expect to fix spacing.</td>
          </tr>
          <tr>
            <td>Images (PNG / JPG)</td>
            <td>Exact - it is a render, nothing is being guessed.</td>
          </tr>
          <tr>
            <td>Back to PDF from images</td>
            <td>Exact, and the usual way to get a signed page back into one file.</td>
          </tr>
        </tbody>
      </table>
      <p>
        If you are converting to Word purely to pull the words out, convert to text or
        Markdown instead. It is the conversion that cannot go wrong, and you skip an
        hour of fighting with a reconstructed layout.
      </p>

      <h2>doing it locally</h2>
      <p>Three routes, in increasing order of convenience:</p>
      <ol>
        <li>
          <strong>LibreOffice</strong> opens PDFs directly and exports to .docx. Free,
          offline, and about as good as the paid converters at layout. It is heavy to
          install for one file and it is genuinely the right answer if you have it.
        </li>
        <li>
          <strong>A browser tool that runs in the page.</strong> Verified with the
          Network-tab test above, these are perfectly safe and need nothing installed.
        </li>
        <li>
          <strong>A desktop app.</strong> Worth it when this is not a one-off: no
          upload, no per-file limit, no queue, and the same tool handles the reverse
          direction and the neighbouring jobs - images to PDF, page extraction,
          formats.
        </li>
      </ol>
      <p>
        The same logic covers the rest of the everyday file jobs that have quietly
        become web services: converting audio and video, resizing and re-encoding
        images, turning a video into a GIF, converting subtitles, taking a background
        out of a photo. All of it runs on a normal computer. Most of it did, twenty
        years ago, before it became a signup.
      </p>

      <PostCta title="The file jobs, on your own machine." href="/#pricing" cta="download it free">
        owntools has fourteen small file tools that run entirely on your computer: PDF
        to text, Markdown, Word or images, images to PDF, image and audio and video
        converters, video to GIF, subtitles, background removal. No upload, no
        account, no file-size limit - and they are free, alongside{" "}
        <Link href="/blog/dictate-on-windows-without-the-cloud">dictation</Link>.
      </PostCta>

      <Disclosure>
        We build owntools, which includes those file tools. The advice above is
        deliberately useful without it - LibreOffice really will convert your PDF, and
        the DevTools check really will tell you whether a website is uploading your
        documents.
      </Disclosure>
    </>
  );
}
