/**
 * A terminal running Claude Code, with a line that was spoken rather than
 * typed. The old stand-in was a generic black box with three green lines; this
 * one follows the real welcome screen — the rounded frame with the version in
 * its top rule, the greeting and the art, the model line, the working
 * directory, the tips and recent-activity panes stacked to the right, and then
 * the prompt.
 *
 * The frames are CSS borders with a label sitting on the rule, not box-drawing
 * characters: the characters are what the real thing uses, but they only line
 * up when the reader happens to have a monospace font that ships them.
 */

/** A pane whose title sits on its top border, the way the CLI draws it. */
function Framed({
  title,
  className = "",
  tone = "#5c5c66",
  children,
}: {
  title?: string;
  className?: string;
  tone?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`relative rounded-[6px] border p-2.5 ${className}`} style={{ borderColor: tone }}>
      {title ? (
        <span
          className="absolute -top-[7px] left-2.5 bg-[#141414] px-1.5 text-[10px] leading-none"
          style={{ color: tone }}
        >
          {title}
        </span>
      ) : null}
      {children}
    </div>
  );
}

/* The welcome art, drawn as a pixel grid — the same 12-wide block shape the
   CLI prints, in its terracotta, without lifting anyone's logo file. */
const ART = [
  "..###....###..",
  ".#####..#####.",
  "##############",
  "###..####..###",
  "##############",
  "##############",
  ".####....####.",
  "..##......##..",
];

function WelcomeArt() {
  return (
    <span className="mx-auto my-3 grid w-fit" aria-hidden>
      {ART.map((row, y) => (
        <span key={y} className="flex">
          {[...row].map((c, x) => (
            <span
              key={x}
              className="h-[5px] w-[5px]"
              style={{ background: c === "#" ? "#d97757" : "transparent" }}
            />
          ))}
        </span>
      ))}
    </span>
  );
}

export function ClaudeCodeMock() {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[14px] bg-[#1c1c1e] shadow-[0_30px_70px_rgba(12,22,44,0.35)]">
      {/* window chrome */}
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="h-[11px] w-[11px] rounded-full bg-[#ff5f57]" />
        <span className="h-[11px] w-[11px] rounded-full bg-[#febc2e]" />
        <span className="h-[11px] w-[11px] rounded-full bg-[#28c840]" />
      </div>

      <div className="flex flex-1 flex-col bg-[#141414] p-4 font-mono text-[11px] leading-[1.55] text-[#c8c8cc] md:p-5">
        <div className="flex items-start gap-3">
          {/* the welcome frame */}
          <Framed title="Claude Code v2.1.12" tone="#8a5a44" className="min-w-0 flex-1 !p-3">
            <p className="text-center text-[#e8e8ea]">Welcome back!</p>
            <WelcomeArt />
            <p className="mt-2 truncate text-[#8e8e96]">
              Opus 5 <span className="text-[#5c5c66]">·</span> Claude Team{" "}
              <span className="text-[#5c5c66]">·</span> <span className="text-[#d97757]">owntools</span>
            </p>
            <p className="truncate text-[#8e8e96]">~/dev/yourapp</p>
          </Framed>

          {/* the side panes, overlapping the frame the way the CLI stacks them */}
          <div className="hidden w-[42%] shrink-0 space-y-2 lg:block">
            <Framed title="Tips for getting started" tone="#5c5c66" className="!p-2 !pt-2.5">
              <p className="truncate text-[10px] text-[#8e8e96]">Run /init to create a …</p>
            </Framed>
            <Framed title="Recent activity" tone="#5c5c66" className="!p-2 !pt-2.5">
              <p className="truncate text-[10px] text-[#8e8e96]">settings-view.tsx · 2h ago</p>
            </Framed>
          </div>
        </div>

        {/* what you said, where you would have typed */}
        <div className="mt-4 flex gap-2">
          <span className="select-none text-[#d97757]">&gt;</span>
          <p className="min-w-0 text-[#e8e8ea]">
            In <span className="text-[#7aa2f7]">@settings-view.tsx</span> add a dark mode toggle
            right under the language picker, persist the choice in the prefs store so it survives a
            restart, and make it follow the system theme when nobody has picked one yet. Then update
            the tests that cover the settings panel, and check the timer overlay still reads
            properly on the dark background.
          </p>
        </div>
        <p className="mt-1.5 pl-4 italic text-[#6f6f78]">…spoken, not typed - on screen 3.4 s after I stopped talking</p>

        {/* the agent answering, so the window is a session and not a screenshot
            of an empty prompt */}
        <div className="mt-4 flex gap-2">
          <span className="select-none text-[#28c840]">●</span>
          <p className="min-w-0 text-[#c8c8cc]">
            Added the toggle to the settings view and persisted the choice in the prefs slice.
          </p>
        </div>
        <ul className="mt-2 space-y-0.5 pl-4 text-[10.5px] text-[#8e8e96]">
          {[
            ["Update(app/settings-view.tsx)", "+18 -2"],
            ["Update(app/store/prefs.ts)", "+6 -0"],
            ["Update(app/settings.test.tsx)", "+24 -0"],
          ].map(([file, diff]) => (
            <li key={file} className="flex gap-2">
              <span className="text-[#5c5c66]">⎿</span>
              <span className="min-w-0 flex-1 truncate">{file}</span>
              <span className="shrink-0 text-[#6f6f78]">{diff}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 pl-4 text-[#28c840]">
          ✓ 3 files changed <span className="text-[#5c5c66]">·</span> 12 tests passing
        </p>

        <div className="mt-4 flex items-center gap-2">
          <span className="flex w-fit items-center gap-2 rounded-full bg-[#232326] px-2.5 py-1.5 text-[10px] font-semibold text-[#e8e8ea]">
            <span className="rec-dot h-1.5 w-1.5 rounded-full bg-[#ff453a]" /> listening…
          </span>
          <span className="text-[10px] text-[#6f6f78]">ctrl+shift+space to stop</span>
        </div>
      </div>
    </div>
  );
}
