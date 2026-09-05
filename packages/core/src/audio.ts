/** Audio helpers for on-device speech recognition (whisper expects 16 kHz mono WAV). */

export const WHISPER_SAMPLE_RATE = 16000;

/**
 * Decodes any browser-supported audio blob into an AudioBuffer, resampled to
 * whisper's 16 kHz on the way: `decodeAudioData` renders at its context's
 * rate, and an OfflineAudioContext can be made at 16 kHz where an
 * AudioContext follows the sound card. An hour of 48 kHz stereo would
 * otherwise sit in the webview as ~1.4 GB of float PCM before the
 * downsample; at 16 kHz it is a third of that.
 */
export async function decodeAudioBlob(blob: Blob): Promise<AudioBuffer> {
  const arrayBuffer = await blob.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, WHISPER_SAMPLE_RATE);
  return ctx.decodeAudioData(arrayBuffer);
}

export interface WhisperAudioOptions {
  /** High-pass corner in Hz — removes rumble / AC hum whisper mistakes for speech. 0 = off. */
  highPassHz?: number;
  /** Peak-normalise to this level (0..1). 0 = off. Quiet mics are what breaks recognition most. */
  normalizePeak?: number;
  /** Hard ceiling on the normalisation gain, so a silent room isn't amplified into noise. */
  maxGain?: number;
  /** Silence padded at both ends — whisper otherwise swallows the first and last word. */
  padSeconds?: number;
  /** Whisper decodes 30 s windows; sub-second clips decode badly, so pad them out. */
  minSeconds?: number;
}

const AUDIO_DEFAULTS: Required<WhisperAudioOptions> = {
  highPassHz: 80,
  normalizePeak: 0.92,
  maxGain: 12,
  padSeconds: 0.25,
  minSeconds: 1.2,
};

/** Resamples an AudioBuffer to 16 kHz mono, optionally high-passed on the way. */
export async function toWhisperPcm(
  buffer: AudioBuffer,
  highPassHz = 0,
): Promise<Float32Array> {
  const length = Math.max(1, Math.ceil(buffer.duration * WHISPER_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, length, WHISPER_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  if (highPassHz > 0) {
    const hp = offline.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = highPassHz;
    hp.Q.value = 0.707;
    source.connect(hp);
    hp.connect(offline.destination);
  } else {
    source.connect(offline.destination);
  }
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}

/**
 * Levels a mono take for whisper: DC offset out, peak brought up to a sane
 * level, a beat of silence on both ends and a minimum length. Cheap, and it
 * matters more than any decoder flag when the mic is quiet or far away.
 */
export function conditionPcm(
  pcm: Float32Array,
  sampleRate: number,
  options: WhisperAudioOptions = {},
): Float32Array {
  const { normalizePeak, maxGain, padSeconds, minSeconds } = { ...AUDIO_DEFAULTS, ...options };

  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i];
  const dc = pcm.length ? sum / pcm.length : 0;

  let peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.abs(pcm[i] - dc);
    if (v > peak) peak = v;
  }

  // Below this the take is effectively silence — amplifying it only feeds
  // whisper hiss, which is exactly what makes it hallucinate.
  let gain = 1;
  if (normalizePeak > 0 && peak > 0.0015) {
    gain = Math.min(maxGain, normalizePeak / peak);
  }

  const pad = Math.round(padSeconds * sampleRate);
  const body = pcm.length;
  const minLength = Math.round(minSeconds * sampleRate);
  const total = Math.max(minLength, body + pad * 2);
  const out = new Float32Array(total);
  for (let i = 0; i < body; i++) {
    const v = (pcm[i] - dc) * gain;
    out[pad + i] = v > 1 ? 1 : v < -1 ? -1 : v;
  }
  return out;
}

/** Encodes mono float PCM as a 16-bit WAV file. */
export function encodeWav(pcm: Float32Array, sampleRate: number): Uint8Array {
  const bytesPerSample = 2;
  const dataSize = pcm.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

/** Blob (any audio) → conditioned 16 kHz mono WAV bytes. */
export async function blobToWhisperWav(
  blob: Blob,
  options: WhisperAudioOptions = {},
): Promise<Uint8Array> {
  const opts = { ...AUDIO_DEFAULTS, ...options };
  const decoded = await decodeAudioBlob(blob);
  const pcm = await toWhisperPcm(decoded, opts.highPassHz);
  return encodeWav(conditionPcm(pcm, WHISPER_SAMPLE_RATE, opts), WHISPER_SAMPLE_RATE);
}

/**
 * Mic constraints tuned for dictation: mono, browser DSP on (echo/noise/AGC),
 * which on Windows also picks the communications-mode capture path.
 */
export const DICTATION_MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
};

/** Picks the best recorder mime type this build of Chromium actually supports. */
export function preferredRecorderMime(): string | undefined {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/ogg;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ];
  if (typeof MediaRecorder === "undefined") return undefined;
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}
