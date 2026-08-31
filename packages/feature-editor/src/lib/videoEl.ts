export async function waitForMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 1 && Number.isFinite(video.duration)) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Wideo nie załadowało się.")), 20000);
    const ok = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("loadedmetadata", ok);
      video.removeEventListener("error", fail);
      resolve();
    };
    const fail = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("loadedmetadata", ok);
      video.removeEventListener("error", fail);
      reject(new Error("Nie można odczytać wideo."));
    };
    video.addEventListener("loadedmetadata", ok);
    video.addEventListener("error", fail);
    if (video.readyState >= 1) ok();
  });
}

/** Chrome/WebView2 often reports MediaRecorder WebM duration as Infinity until we seek past the end. */
export async function ensureFiniteDuration(video: HTMLVideoElement): Promise<number> {
  await waitForMetadata(video);
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;

  await new Promise<void>((resolve) => {
    const done = () => {
      video.removeEventListener("timeupdate", done);
      video.removeEventListener("seeked", done);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(done, 1800);
    video.addEventListener("timeupdate", done);
    video.addEventListener("seeked", done);
    try {
      video.currentTime = 1e101;
    } catch {
      done();
    }
  });

  if (Number.isFinite(video.duration) && video.duration > 0) {
    video.currentTime = 0;
    return video.duration;
  }
  return 0;
}

export async function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  if (!Number.isFinite(video.duration) || video.duration <= 0) return;
  const target = Math.min(Math.max(0, time), Math.max(0, video.duration - 0.04));
  if (Math.abs(video.currentTime - target) < 0.012 && video.readyState >= 2) return;

  await new Promise<void>((resolve) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(done, 280);
    video.addEventListener("seeked", done);
    video.currentTime = target;
  });
}
