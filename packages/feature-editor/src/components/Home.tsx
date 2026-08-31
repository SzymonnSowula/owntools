import { useEffect, useRef } from "react";
import { WinDots, ToolIcons } from "@ui/WinDots";
import { Logo } from "./Logo";
import { TranscribeModal } from "./TranscribeModal";
import { formatTime } from "../lib/time";
import { uid } from "../lib/id";
import { ensureFiniteDuration } from "../lib/videoEl";
import { emptyProject, useAppStore } from "../store/appStore";

export function Home() {
  const recent = useAppStore((s) => s.recent);
  const hydrateRecent = useAppStore((s) => s.hydrateRecent);
  const openRecent = useAppStore((s) => s.openRecent);
  const openProject = useAppStore((s) => s.openProject);
  const showToast = useAppStore((s) => s.showToast);
  const setTranscribeOpen = useAppStore((s) => s.setTranscribeOpen);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void hydrateRecent();
  }, [hydrateRecent]);

  async function importVideo(file: File) {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "auto";
    video.src = url;
    // MediaRecorder WebMs report Infinity until we force a duration probe.
    const duration = await ensureFiniteDuration(video);
    if (!duration) throw new Error("Couldn't read the video duration.");
    const project = emptyProject({
      name: file.name.replace(/\.[^.]+$/, ""),
      duration,
      videoWidth: video.videoWidth || 1920,
      videoHeight: video.videoHeight || 1080,
      screenWidth: video.videoWidth || 1920,
      screenHeight: video.videoHeight || 1080,
      segments: [{ id: uid("seg"), start: 0, end: duration }],
      autoZoom: false,
    });
    await openProject(project, { screenUrl: url });
  }

  return (
    <div className="desktop-bg flex min-h-0 flex-1 flex-col overflow-y-auto px-10 pb-10 pt-6">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
        <div className="mt-8 max-w-xl">
          <Logo size={44} />
          <h1 className="mt-6 text-[42px] font-bold leading-[1.05] tracking-[-0.05em] text-ink">
            screeni
          </h1>
          <p className="mt-3 text-lg text-muted">Recordings that follow your cursor.</p>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-muted">
            Record your screen and clicks get zoomed in automatically. Then wrap the video in a
            soft gradient, add your camera and captions — and export.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button
              className="btn btn-primary px-5 py-3"
              onClick={() => void import("@core/recorderWindow").then((m) => m.openRecorderOverlay())}
            >
              <span className="h-2 w-2 rounded-full bg-white" />
              Record
            </button>
            <button className="btn btn-secondary px-5 py-3" onClick={() => fileRef.current?.click()}>
              Open editor
            </button>
            <button className="btn btn-secondary px-5 py-3" onClick={() => setTranscribeOpen(true)}>
              Transcribe a file
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  void importVideo(file).catch((err) =>
                    showToast(err instanceof Error ? err.message : "Import failed.", "error"),
                  );
                }
                e.currentTarget.value = "";
              }}
            />
          </div>
        </div>

        <section className="mt-14">
          <div className="mb-4 flex items-end justify-between">
            <h2 className="text-sm font-semibold tracking-[-0.01em]">Recent projects</h2>
            <span className="text-xs text-muted">stored on this computer</span>
          </div>
          {recent.length === 0 ? (
            <div className="rounded-[16px] border border-dashed border-line bg-card/70 px-6 py-12 text-center shadow-sm">
              <p className="text-sm font-medium">No recordings yet</p>
              <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
                Record your first one — the important parts get zoomed in for you.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {recent.map((item, i) => (
                <button
                  key={item.id}
                  className="wincard"
                  style={{ transform: `rotate(${i % 2 === 0 ? -0.6 : 0.6}deg)` }}
                  onClick={() => void openRecent(item.id)}
                >
                  <div className="wincard-bar">
                    <WinDots icon={ToolIcons.video} />
                    <span className="wincard-title truncate">
                      {item.name.toLowerCase().replace(/\s+/g, "-")}.mp4
                    </span>
                  </div>
                  <div className="wincard-body">
                    <div className="flex h-20 items-end rounded-[10px] bg-gradient-to-br from-violet/30 via-teal/25 to-coral/25 p-3">
                      <span className="text-[11px] font-medium text-ink/70">
                        {formatTime(item.duration)}
                      </span>
                    </div>
                    <p className="mt-3 truncate text-sm font-semibold">{item.name}</p>
                    <p className="mt-1 text-xs text-muted">
                      {new Date(item.createdAt).toLocaleString(undefined, {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
      <TranscribeModal />
    </div>
  );
}
