import { Disclosure, Note, PostCta } from "../components/Chrome";

export default function Body() {
  return (
    <>
      <p>
        The first time we pointed our own duplicate finder at a whole <code>C:</code> drive, it
        offered up <strong>3,145 files, 25.1 GB</strong>, all ticked and ready for the Recycle Bin.
        Among them was <code>msalruntime_x86.dll</code>, sitting in the Visual Studio
        Installer&rsquo;s own folder. The copy it had decided to keep was in a temp directory that
        Windows would clear on its own schedule.
      </p>
      <p>
        That is not a bug in the hashing. The two files really were byte-for-byte identical. It is
        a bug in the idea that byte-for-byte identical means one of them is spare.
      </p>

      <h2>three reasons the same bytes exist twice on purpose</h2>
      <h3>Programs ship their own copies</h3>
      <p>
        A Windows program loads its libraries from its own directory first. That is deliberate:
        shipping the exact DLL it was tested against is what stops it breaking when something else
        upgrades a shared one. So the same library legitimately exists inside five different
        program folders, and each of those five programs needs the copy in <em>its</em> folder. A
        scanner sees one file and four wins.
      </p>
      <h3>Windows keeps one file under several names</h3>
      <p>
        The component store, <code>WinSxS</code>, is largely hard links - a second name for the
        same data on disk, not a second copy. Deleting one name frees nothing at all, because the
        data stays as long as any name points at it. You get zero space back and a missing path.
      </p>
      <h3>Dependency trees copy on purpose</h3>
      <p>
        <code>node_modules</code>, Python virtual environments, game asset packs, Unity libraries:
        these duplicate files per project so each project stays self-contained and reproducible.
        Deduplicating across them is how you get a project that builds on Tuesday and not on
        Wednesday, with no change in the repository to explain it.
      </p>

      <Note label="the number that matters">
        <p>
          After excluding installed programs, system folders and code projects, the same machine
          offered <strong>4 groups totalling 228 MB</strong> from 277 files compared - while
          leaving 23,725 files in installed programs, 6,118 in code projects and 830 in tool
          folders alone. The honest version of a duplicate scan finds about one percent of what the
          reckless one claims, and all of it is actually deletable.
        </p>
      </Note>

      <h2>what should never be in the scan</h2>
      <p>
        The working list, in the order it removes the most danger. A duplicate finder that does not
        do this is asking you to audit thousands of paths by eye:
      </p>
      <ul>
        <li>
          <code>Windows</code>, <code>Program Files</code>, <code>Program Files (x86)</code>,{" "}
          <code>ProgramData</code> and <code>AppData</code> - by known-folder path{" "}
          <em>and by name</em>, because on a real profile <code>AppData</code> is not even marked
          hidden.
        </li>
        <li>
          Any folder registered by an installed program, plus game libraries - Steam, Epic and the
          rest keep enormous identical asset files per title.
        </li>
        <li>
          Code projects. A folder containing <code>.git</code> is the reliable signal; your home
          directory is not.
        </li>
        <li>
          Hidden and system files, dot-folders, and files whose extension makes them program
          material - executables, libraries, virtual machine disks.
        </li>
        <li>
          Anything with a link count above one. That is a hard link, and removing it saves nothing.
        </li>
      </ul>
      <p>
        What is left is the part that was always the point: your documents, photos, music,
        downloads and desktop. That is where real duplicates live - the same invoice saved twice,
        a photo import run twice, the installer you downloaded in March and again in August.
      </p>

      <h2>the OneDrive trap</h2>
      <p>
        Files in OneDrive, iCloud Drive or Dropbox may be <strong>placeholders</strong>: a name and
        a size on disk with the contents still in the cloud. To hash one, a scanner has to read it
        - and reading it downloads it. Point a duplicate finder at a synced folder and you can pull
        your entire cloud drive onto a laptop with 40 GB free, which is the opposite of the errand
        you set out on.
      </p>
      <p>
        A well-behaved scanner checks the placeholder attributes on the open file handle and skips
        anything not already local. If yours does not document this, test it on a small synced
        folder and watch your free space before trusting it with the big one.
      </p>

      <h2>the size check nobody does</h2>
      <p>
        There is one more way this goes wrong, and it is the reason that 25.1 GB figure is worse
        than it looks. The Recycle Bin is not a folder that grows - it has a fixed size per drive,
        and on that machine it was 25.8 GB. Sending 25.1 GB into it would have evicted nearly
        everything already in there, and a batch any larger than the cap is destroyed outright
        rather than recycled. A bulk cleanup is exactly the situation where &ldquo;it&rsquo;s fine,
        it goes to the Recycle Bin&rdquo; stops being true.
      </p>

      <h2>doing it safely</h2>
      <ol>
        <li>
          <strong>Scan one folder, not the drive.</strong> Pictures, then Downloads, then
          Documents. If a tool only offers &ldquo;scan C:&rdquo;, that tells you how much thought
          went into it.
        </li>
        <li>
          <strong>Check the keep rule.</strong> &ldquo;Keep the oldest&rdquo; and &ldquo;keep the
          newest&rdquo; both routinely keep the wrong one. Better: keep the copy that is not named
          like a copy and not sitting in Downloads or on the Desktop - the one something is most
          likely to be pointing at.
        </li>
        <li>
          <strong>Verify at the moment of deletion, not at scan time.</strong> Minutes or hours
          pass between a scan and a click. A copy should be re-hashed immediately before it is
          moved, along with the copy that is staying.
        </li>
        <li>
          <strong>Never let the last copy go.</strong> Obvious, and a sort order plus a &ldquo;select
          all&rdquo; button has broken it in more than one tool.
        </li>
        <li>
          <strong>Delete in batches your Recycle Bin can hold</strong>, or move to a{" "}
          <code>to-delete</code> folder and wait a week.
        </li>
      </ol>

      <h2>the part no scanner can know</h2>
      <p>
        We still got one wrong after all of that. A project without a <code>.git</code> folder
        looks like ordinary documents, and two identical audio tracks inside an audiobook folder
        were offered as duplicates - they were two chapters that genuinely had the same silence in
        them, or the same file legitimately placed twice by whatever produced the audiobook. From
        the outside, a file cannot say why it exists.
      </p>
      <p>
        Which is why the last line of defence is not smarter rules. It is that everything goes to
        the Recycle Bin, the batch is small enough to fit, and you can put it back.
      </p>

      <PostCta title="A duplicate finder that leaves most of your disk alone." href="/#pricing" cta="see the disk tool">
        owntools scans only your own files, skips hard links and cloud placeholders, re-hashes
        every copy right before it moves it, and prints what it deliberately left out and why -
        including how many files in installed programs and code projects it refused to consider.
      </PostCta>

      <Disclosure>
        We build owntools, which includes a disk analyser. Every rule above was added after our own
        tool offered something it should not have - the Visual Studio DLL came out of a real run on
        a real machine, not a hypothetical.
      </Disclosure>
    </>
  );
}
