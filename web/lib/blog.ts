/**
 * The blog's index. One entry per post; the body lives next to it as a React
 * component in `web/app/blog/posts/<slug>.tsx` and is wired up by the record in
 * `web/app/blog/bodies.ts`.
 *
 * Why an array here instead of MDX: the site has no MDX pipeline and a post
 * that draws a table wants real components anyway. The trade is that a new post
 * touches three places - this list, a body file and that record - and
 * `blog.test.ts` fails if they disagree.
 *
 * **What belongs here.** A post answers a question somebody types *while having
 * a problem one of the tools solves*. Not an engineering story that happens to
 * be ours: a reader searching "why did Windows delete my files" wants their
 * files back, not a desktop app, and a post aimed at them is traffic that
 * converts into nothing. The order of the array is the order on the page, so
 * the free tier - what somebody can download today - goes first.
 *
 * `answer` is the question's answer in one or two sentences: it opens the page,
 * it is the JSON-LD `abstract`, it is what an AI assistant quotes, and if it
 * cannot be written the post is not focused enough to publish.
 */

export type FaqItem = {
  /** The question as somebody would ask it, not as a heading. */
  q: string;
  /** Answered in full in one paragraph - it is quoted without the page. */
  a: string;
};

export type Post = {
  slug: string;
  /** The <h1>, and the <title> before the " · owntools" template. */
  title: string;
  /** The meta description and the card on /blog. Aim for 140-160 characters. */
  description: string;
  /** The answer, up front, before any preamble. */
  answer: string;
  /** ISO date. Never backdated: a post is published the day it is written. */
  published: string;
  /** ISO date, set only when the body actually changed after publication. */
  updated?: string;
  tags: string[];
  /** Reading time in minutes, measured from the body by `pnpm blog:minutes`. */
  minutes: number;
  /** Rendered at the foot of the post and emitted as FAQPage structured data. */
  faq?: FaqItem[];
  /**
   * schema.org type. `TechArticle` is for the posts written for people who
   * will open the source files; `Article` for everyone else.
   */
  schema: "Article" | "TechArticle";
};

export const POSTS: Post[] = [
  {
    slug: "dictate-on-windows-without-the-cloud",
    title: "How to dictate on Windows without sending your voice to the cloud",
    description:
      "Windows' Win+H voice typing streams audio to Microsoft's servers. Voice Access, Whisper and Parakeet do not. What each one costs you in accuracy and setup.",
    answer:
      "Windows' built-in Win+H voice typing needs an internet connection because it sends your speech to Microsoft to be transcribed. For dictation that never leaves the machine you have three options: Voice Access, which is built into Windows 11 and runs on-device after a one-time language download, or a third-party app running Whisper or Parakeet locally.",
    published: "2026-09-21",
    tags: ["dictation", "windows", "privacy", "speech to text"],
    minutes: 5,
    schema: "Article",
    faq: [
      {
        q: "Does Windows voice typing work offline?",
        a: "No. Win+H voice typing streams your audio to Microsoft's online speech service, which is why it fails with no connection. Voice Access, a separate feature in Windows 11 version 22H2 and later, does run on-device after you download its language pack once, but it supports far fewer languages than voice typing does.",
      },
      {
        q: "Does Microsoft keep recordings of my voice typing?",
        a: "Microsoft's speech service transcribes the audio it receives; whether samples are retained for product improvement depends on the \"online speech recognition\" and diagnostic-data settings in Windows privacy settings and on your account type. The honest summary is that the audio leaves your computer and what happens to it afterwards is governed by a policy that can change. If that is not acceptable for what you dictate - medical notes, interviews, anything under NDA - use a recognizer that runs locally instead of auditing the setting every release.",
      },
      {
        q: "Is local dictation accurate enough for real work?",
        a: "For a modern model on a normal laptop, yes for prose and email, with the same weak spots every recognizer has: proper nouns, product names and acronyms. Those are fixable - most local setups let you supply a list of terms - and dictating into a quiet microphone helps more than changing model. Highly technical or heavily accented speech is where cloud services with much larger models still have an edge.",
      },
      {
        q: "Do I need a GPU?",
        a: "No. Both engines described here run on the CPU. A 0.6B parameter model transcribes a few seconds of speech in well under a second on a four-core laptop; the larger Whisper models are slower but still usable, and they are the ones you want for subtitles and translation rather than for live dictation.",
      },
    ],
  },
  {
    slug: "transcribe-audio-without-uploading",
    title: "How to transcribe audio without uploading it to anyone's server",
    description:
      "Interviews, calls and notes you are not allowed to upload. What Whisper does on an ordinary laptop, how fast it really is, and the one thing it will not do.",
    answer:
      "Run the speech model yourself. Whisper is openly available and runs on an ordinary laptop CPU through whisper.cpp, so the recording never leaves your machine: no processor to name in your records, no retention policy to read. The trade is speed - roughly real time on four cores - and no automatic speaker labels.",
    published: "2026-09-21",
    tags: ["transcription", "privacy", "whisper", "gdpr"],
    minutes: 5,
    schema: "Article",
    faq: [
      {
        q: "Can I transcribe an interview without uploading it anywhere?",
        a: "Yes. Whisper, the speech model behind many transcription services, is openly available and runs on a normal laptop CPU through whisper.cpp or an app that wraps it. The audio, the transcript and the model all stay on your disk, which is what lets you tell an interviewee truthfully that the recording stays with you.",
      },
      {
        q: "How long does local transcription take?",
        a: "On a four-core laptop CPU the large turbo Whisper model runs at roughly real time - we measured 33 to 37 seconds for 24 seconds of speech - so a one-hour interview takes about an hour. Smaller models are several times faster and noticeably worse on names and technical terms, and a machine with a capable GPU is far quicker than either.",
      },
      {
        q: "Does local transcription label who is speaking?",
        a: "No. Whisper transcribes speech but does not separate speakers, so you get the words without \"Interviewer:\" and \"Participant:\" in front of them. Cloud services often add that step on top. For a two-person recording it is usually a few minutes of editing; for a focus group it is real work, and worth knowing before you plan around it.",
      },
      {
        q: "Is uploading a recording to a transcription service a GDPR problem?",
        a: "It is not automatically a problem, but it is a decision you have to be able to justify. A recording of someone talking is personal data, so the service becomes a processor you should have a data processing agreement with and list in your records, and its retention period becomes yours. Transcribing on your own device removes the transfer altogether, which is why it is usually the easier answer to give an ethics board or a DPO.",
      },
    ],
  },
  {
    slug: "screen-recording-auto-zoom-windows",
    title: "Screen recording that zooms in by itself, on Windows",
    description:
      "Screen Studio is macOS only. What auto-zoom actually does, the three ways it gets implemented badly, and how to test any tool for them in five minutes.",
    answer:
      "Screen Studio, the app most of those polished demo videos are made with, is macOS only. On Windows the choices are FocuSee, owntools' screeni, or keyframing every zoom by hand in a video editor. What separates a good implementation from a bad one is whether the zoom behaves like a camera or like a filter, and you can test that yourself in five minutes.",
    published: "2026-09-21",
    tags: ["screen recording", "windows", "video", "demo videos"],
    minutes: 5,
    schema: "Article",
    faq: [
      {
        q: "Is Screen Studio available for Windows?",
        a: "No. Screen Studio is a macOS-only application and has been since it launched. On Windows the equivalent job - recording the screen and automatically zooming in on clicks - is done by FocuSee, by owntools' screeni, or by recording with something like OBS and adding the zooms yourself in a video editor.",
      },
      {
        q: "What is auto-zoom in a screen recorder?",
        a: "It is a second pass over the finished recording: a virtual camera moves across the captured image, scaling in around the places where something happened, usually clicks, and easing back out when nothing does. The recording itself is untouched, which is why a good tool lets you move, lengthen or delete individual zooms afterwards rather than baking them in.",
      },
      {
        q: "How do I tell whether a tool's auto-zoom is any good?",
        a: "Record ninety seconds of your own desk and check three things. Record a single window on a multi-monitor setup and see whether the drawn cursor lands where you actually clicked. Click something in a corner and open a menu from it, to see whether the zoom cuts off the thing you clicked. Then drag something quickly across the screen and watch whether the pointer leaves the visible area. Those three failures are common and none of them appear on a feature list.",
      },
      {
        q: "Can I do auto-zoom for free?",
        a: "You can get the same result with OBS Studio for the recording and any video editor for the zooms, keyframing each one by hand. It costs nothing and it looks just as good; what it costs is roughly an hour per video, every video, which is the entire reason paid tools in this category exist.",
      },
    ],
  },
  {
    slug: "convert-pdf-without-uploading",
    title: "How to convert a PDF without uploading it to a website",
    description:
      "Contracts, payslips and scans do not belong on a stranger's server. What converts well on your own machine, what never converts well, and how to spot an upload.",
    answer:
      "Nothing in a PDF conversion needs a server. LibreOffice converts to Word offline, some browser tools genuinely do the work inside the page, and a desktop app handles the rest - and you can tell in twenty seconds which websites upload your file by watching the Network tab in your browser's developer tools while you convert.",
    published: "2026-09-21",
    tags: ["pdf", "privacy", "file conversion"],
    minutes: 4,
    schema: "Article",
    faq: [
      {
        q: "Is it safe to use a free online PDF converter?",
        a: "For a document that would not matter if a stranger read it, yes. The typical converter uploads your file, converts it on its own machine, gives you a download link and deletes it after some hours - so for a contract, a payslip, a medical letter or anything containing other people's personal data, you are sharing the document with a third party and inheriting its retention policy. That is a decision worth making deliberately rather than by habit.",
      },
      {
        q: "How can I tell if a website uploads my file or converts it locally?",
        a: "Open your browser's developer tools with F12, go to the Network tab, and convert a file. If the document is being uploaded you will see a request roughly the size of your file. The blunter version of the same test: load the page, disconnect from the internet, and convert. A tool that still works never had your file in the first place.",
      },
      {
        q: "Why does my PDF convert to Word badly?",
        a: "Because a PDF does not contain paragraphs. It stores glyphs at coordinates, so any converter is reconstructing a document structure that was thrown away when the PDF was made, and spacing, columns and tables are educated guesses. If you only need the words rather than the layout, convert to plain text or Markdown instead - that is the conversion that cannot really go wrong.",
      },
      {
        q: "Why can't I get any text out of my PDF?",
        a: "It is almost certainly a scan: a photograph of a page rather than text. Try selecting a sentence with the mouse - if nothing highlights, there is no text in the file to extract, and getting some requires OCR, which recognises the characters in the image. That is a slower job with a real error rate, and it is where free tools differ most.",
      },
    ],
  },
  {
    slug: "what-your-tools-cost-a-year",
    title: "What your tools cost you a year, added up",
    description:
      "Ten subscriptions for jobs a desktop app does locally come to $964.93 a year. The list, the rules behind the numbers, and which of them genuinely need a server.",
    answer:
      "Ten separate subscriptions for the jobs one desktop app does come to $964.93 a year, taking each vendor's cheapest yearly plan for one person. Most of those jobs - dictation, screen recording, file conversion, transcription - finish on your own processor and need no server at all, which is the test worth applying to your own bill.",
    published: "2026-09-21",
    tags: ["subscriptions", "pricing", "local-first"],
    minutes: 4,
    schema: "Article",
    faq: [
      {
        q: "How much do productivity subscriptions cost per year?",
        a: "Taking the ten jobs an ordinary desk worker pays for separately - dictation, screen recording with auto-zoom, editing video by editing text, transcription, meeting notes, post scheduling, screenshots, a whiteboard, focus music and PDF tools - and the cheapest yearly plan for one person on Windows for each, the total is $964.93 a year. No single line is unreasonable, which is exactly how the total gets there.",
      },
      {
        q: "Which subscriptions are actually worth paying for?",
        a: "The ones where something runs for you continuously. Several people editing the same document, publishing to another service's API on a schedule, syncing files between your phone and your laptop, or a model far too large to run at home all genuinely need infrastructure, and paying monthly for infrastructure is honest. Dictation, screen recording, file conversion and transcription all finish on your own machine, and paying rent for those is paying for a licence to use your own processor.",
      },
      {
        q: "Are one-time purchases better than subscriptions?",
        a: "Not automatically. A subscription funds development that continues, support from a person, and any part of the product that really does run on a server; plenty of software bought once has been abandoned by its author. The case for buying once is strongest for a job that completes locally and does not change much - converting a file, recording a screen, typing what you dictate.",
      },
      {
        q: "How do I cut my software subscriptions?",
        a: "List what actually renewed over the last twelve months from your card statement, mark the ones you used in the last month rather than the ones you would use, and for each of the rest ask whether the job needs a server. Where it does not, there is usually something that does it on your machine, often free and open source. Cancel at the renewal date rather than today, since you have already paid to the end of the term.",
      },
    ],
  },
  {
    slug: "are-duplicate-files-safe-to-delete",
    title: "Are duplicate files safe to delete? What a duplicate finder cannot know",
    description:
      "Two files with identical bytes are often both load-bearing: program folders, WinSxS hard links, node_modules. What to exclude before ticking 25 GB of \"duplicates\".",
    answer:
      "Often not. Identical bytes do not mean a spare copy: programs load libraries from their own folder, Windows keeps one file under several names through hard links, and dependency folders carry copies on purpose. Only treat files as duplicates inside your own documents, photos and downloads - never inside an installed program, a system folder or a code project.",
    published: "2026-09-21",
    tags: ["windows", "disk space", "duplicates", "data loss"],
    minutes: 5,
    schema: "Article",
    faq: [
      {
        q: "Is it safe to delete duplicate files found by a duplicate finder?",
        a: "Only where the copies are your own documents, photos, music or downloads. Anything inside Windows, Program Files, ProgramData, AppData, an installed game or a code project should be left alone, because a second copy of a file there is usually a copy the software needs in that exact location. A scan of a whole system drive will offer thousands of such files - on one real run, 3,145 files and 25 GB of them - and almost none of them are safe wins.",
      },
      {
        q: "Why do the same files appear twice in Windows?",
        a: "Three ordinary reasons. Windows keeps a component store, WinSxS, where system files are hard links to the same bytes, so a scanner sees two paths and one file. Programs ship their own copies of shared libraries so they do not depend on a system-wide version. And dependency trees - node_modules, Python virtual environments, game asset packs - deliberately duplicate files per project so each project stays self-contained.",
      },
      {
        q: "What is a hard link, and why does it matter here?",
        a: "A hard link is a second name for the same data on disk, not a second copy. Deleting one name frees nothing until the last one is gone, so \"reclaiming\" hard-linked duplicates saves no space while quietly breaking whatever used that name. A file's link count says how many names it has, and anything above one should be skipped.",
      },
      {
        q: "How much space do real duplicates actually take?",
        a: "Far less than a scan suggests. On one Windows profile, restricting the scan to the person's own files left 4 groups totalling 228 MB out of 277 files compared, while the excluded areas held 23,725 files in installed programs and 6,118 in code projects. Duplicate photos and downloads are worth clearing; duplicate DLLs are not yours to clear.",
      },
    ],
  },
  {
    slug: "parakeet-vs-whisper-cpu",
    title: "Parakeet vs whisper.cpp on a laptop CPU: 6.4 s to 0.7 s per take",
    description:
      "Measured on a 4-core i5: the model load dominated, and halving the thread count nearly doubled the speed. Numbers for both engines, and where each one wins.",
    answer:
      "On a 4-core i5-10300H, a 3.9 second dictation take went from 6.4 seconds to about 0.7 seconds - by keeping the recognizer resident instead of loading the model per take, and by giving onnxruntime 4 threads instead of 7. The thread count alone was worth roughly 2x.",
    published: "2026-09-21",
    tags: ["speech recognition", "onnxruntime", "whisper", "parakeet", "benchmark"],
    minutes: 5,
    schema: "TechArticle",
    faq: [
      {
        q: "Is Parakeet faster than Whisper on a CPU?",
        a: "On the machine measured here, by a wide margin. For about 24 seconds of speech, Parakeet TDT 0.6B v3 int8 through sherpa-onnx needed 1.5 to 1.8 seconds of decoding, where whisper.cpp with large-v3-turbo q5_0 took 33 to 37 seconds. Both were accurate, including on Polish. The comparison is not quite fair - large-v3-turbo is a much bigger model - but it is the choice you actually face on a laptop.",
      },
      {
        q: "How many threads should onnxruntime get?",
        a: "As many as the machine has physical cores, not logical ones. On a 4-core, 8-thread i5-10300H, 4 threads decoded a take in 660 ms while 8 threads took 1300 ms: hyperthreads share the execution units that matrix multiplication saturates, so the extra threads mostly add contention. Count cores with GetLogicalProcessorInformationEx on Windows, or hw.perflevel0.physicalcpu on Apple Silicon, rather than std::thread::available_parallelism.",
      },
      {
        q: "What does Whisper still do better?",
        a: "Timestamps, translation and prompt biasing. Parakeet returns text with no word timings, so subtitles and any edit-by-transcript feature need Whisper; it does not translate; and it takes no initial prompt, so you cannot feed it a vocabulary of names and jargon the way Whisper's --prompt accepts one.",
      },
      {
        q: "Why is the first take after opening the app still slow?",
        a: "Loading the model is 3 to 4.5 seconds and it happens once per process, so the first take pays for it unless you start loading earlier. Trigger the load the moment recording starts rather than when it stops - the person is speaking for a second or two anyway, and that is enough to hide most of it.",
      },
    ],
  },
];

/** Newest first; posts published the same day keep the order of this list. */
export const postsByDate = (): Post[] =>
  [...POSTS].sort((a, b) => (a.published < b.published ? 1 : a.published > b.published ? -1 : 0));

export const findPost = (slug: string): Post | undefined => POSTS.find((p) => p.slug === slug);

/** The date a post last changed - what the sitemap and the feed report. */
export const postModified = (post: Post): string => post.updated ?? post.published;

export const postPath = (slug: string): string => `/blog/${slug}`;

/**
 * Two other posts to read next: same tag first, then whatever is newest. Keeps
 * every post linked from every other one, which is most of what internal
 * linking has to do on a site this size.
 */
export function relatedPosts(slug: string, count = 2): Post[] {
  const post = findPost(slug);
  if (!post) return postsByDate().slice(0, count);
  const others = postsByDate().filter((p) => p.slug !== slug);
  const shared = (p: Post) => p.tags.filter((t) => post.tags.includes(t)).length;
  return [...others].sort((a, b) => shared(b) - shared(a)).slice(0, count);
}
