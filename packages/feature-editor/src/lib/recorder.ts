export function pickRecorderMime(): string {
  const types = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

export async function getDisplayStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({
    video: {
      frameRate: { ideal: 60, max: 60 },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
    audio: true,
  });
}

export async function getWebcamStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
    audio: false,
  });
}

export function recordStream(stream: MediaStream): {
  recorder: MediaRecorder;
  done: Promise<Blob>;
} {
  const mime = pickRecorderMime();
  const recorder = mime
    ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 })
    : new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  const done = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onerror = () => reject(new Error("Recording failed."));
    recorder.onstop = () => {
      const type = recorder.mimeType || mime || "video/webm";
      resolve(new Blob(chunks, { type }));
    };
  });
  recorder.start(250);
  return { recorder, done };
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}
