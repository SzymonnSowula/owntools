//! meet's ears: the microphone and the system mix, captured side by side.
//!
//! Contract: `docs/contracts-2026-09-11.md` §3. Two sources — `"mic"` (the
//! default or a chosen capture endpoint) and `"system"` (WASAPI loopback on
//! the default render endpoint, i.e. whatever the other side of a call is
//! saying through the speakers) — each on its own thread with its own COM
//! apartment, sharing one clock. Every closed stretch of speech becomes a
//! 16 kHz mono WAV under `<dir>/segments/` and an `audio-capture-segment`
//! event, so the frontend can transcribe it while the call goes on; the whole
//! call is archived as `<dir>/audio.wav`, 48 kHz stereo, left = mic, right =
//! system.
//!
//! ## Time
//!
//! `startMs` / `endMs` are milliseconds of *recording time*: since
//! `audio_capture_start`, minus paused time, on one `Instant` (QPC-backed on
//! Windows) for both sources. A worker does not trust the device clock for
//! that: WASAPI loopback delivers **no packets at all** while nothing is
//! playing, and a mic can hiccup, so each source keeps a `Timeline` of how
//! much audio it has delivered and fills the gap with silence whenever it
//! falls more than `GAP_MS` behind the clock. That is what keeps the two
//! archive channels aligned and the segment times honest without a second
//! clock; in the normal case (packets every 10 ms) nothing is inserted.
//!
//! ## What runs where
//!
//! Commands are async and only spawn or signal threads — the main thread is
//! the whole app's event loop (see CLAUDE.md, "A sync `#[tauri::command]`
//! runs on the main thread"). The pure parts (resampler, VAD, WAV, timeline)
//! are platform-independent and unit-tested; the WASAPI code is `cfg(windows)`
//! and every command on another platform answers `UNAVAILABLE`.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs::File;
use std::io::{BufWriter, Seek, SeekFrom, Write};
use std::path::Path;

/// The exact string the contract asks for on macOS / Linux.
#[cfg_attr(windows, allow(dead_code))]
pub const UNAVAILABLE: &str = "Audio capture is not available on this platform yet.";

/// Segments are what the speech engines want.
pub const SEGMENT_RATE: u32 = 16_000;
/// The archive rate, whatever the devices run at.
pub const ARCHIVE_RATE: u32 = 48_000;
/// VAD frame length.
pub const FRAME_MS: u32 = 20;
/// How far a source may lag recording time before silence is inserted.
pub const GAP_MS: f64 = 150.0;

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Mic,
    System,
}

impl Source {
    fn index(self) -> usize {
        match self {
            Source::Mic => 0,
            Source::System => 1,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Source::Mic => "mic",
            Source::System => "system",
        }
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub default: bool,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct Devices {
    pub inputs: Vec<DeviceInfo>,
    pub outputs: Vec<DeviceInfo>,
}

/// What the caller may tune; anything omitted takes the contract's default.
#[derive(Deserialize, Clone, Copy, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct VadArgs {
    pub threshold_db: Option<f32>,
    pub min_speech_ms: Option<u32>,
    pub hangover_ms: Option<u32>,
    pub max_segment_ms: Option<u32>,
    pub pad_ms: Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct VadConfig {
    pub threshold_db: f32,
    pub min_speech_ms: u32,
    pub hangover_ms: u32,
    pub max_segment_ms: u32,
    pub pad_ms: u32,
}

impl Default for VadConfig {
    fn default() -> Self {
        Self {
            threshold_db: -42.0,
            min_speech_ms: 300,
            hangover_ms: 600,
            max_segment_ms: 20_000,
            pad_ms: 200,
        }
    }
}

impl From<VadArgs> for VadConfig {
    fn from(a: VadArgs) -> Self {
        let d = VadConfig::default();
        Self {
            threshold_db: a.threshold_db.unwrap_or(d.threshold_db),
            min_speech_ms: a.min_speech_ms.unwrap_or(d.min_speech_ms).max(FRAME_MS),
            hangover_ms: a.hangover_ms.unwrap_or(d.hangover_ms).max(FRAME_MS),
            max_segment_ms: a.max_segment_ms.unwrap_or(d.max_segment_ms).max(1_000),
            pad_ms: a.pad_ms.unwrap_or(d.pad_ms),
        }
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StopResult {
    pub wav_path: Option<String>,
    pub duration_ms: u64,
    pub segments: u32,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SegmentEvent {
    pub session: String,
    pub source: Source,
    pub start_ms: u64,
    pub end_ms: u64,
    pub path: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct LevelEvent {
    pub session: String,
    pub mic: f32,
    pub system: f32,
}

#[derive(Serialize, Clone, Debug)]
pub struct ErrorEvent {
    pub session: String,
    pub message: String,
}

pub const SEGMENT_EVENT: &str = "audio-capture-segment";
pub const LEVEL_EVENT: &str = "audio-capture-level";
pub const ERROR_EVENT: &str = "audio-capture-error";

// ---------------------------------------------------------------------------
// Pure parts: level, resampling, VAD, WAV, timeline
// ---------------------------------------------------------------------------

/// RMS of a frame in dBFS; -100 for digital silence so the threshold
/// comparison never sees -inf.
pub fn rms_dbfs(frame: &[f32]) -> f32 {
    let rms = rms_linear(frame);
    if rms <= 1e-5 {
        -100.0
    } else {
        20.0 * rms.log10()
    }
}

/// RMS as a 0..1 figure (the level meter).
pub fn rms_linear(frame: &[f32]) -> f32 {
    if frame.is_empty() {
        return 0.0;
    }
    let sum: f64 = frame.iter().map(|&s| (s as f64) * (s as f64)).sum();
    ((sum / frame.len() as f64).sqrt() as f32).min(1.0)
}

/// Rate conversion for a live stream: a windowed-sinc low-pass at 0.45 of the
/// lower rate, then linear interpolation. Stateful, so chunks of any size
/// join without a click; passthrough when the rates already match.
pub struct Resampler {
    step: f64,
    taps: Vec<f32>,
    /// The last `taps.len() - 1` raw inputs, for the filter across chunks.
    history: Vec<f32>,
    /// Filtered samples not fully consumed by the interpolator.
    filtered: Vec<f32>,
    /// Read position into `filtered`, in input samples.
    pos: f64,
}

impl Resampler {
    pub fn new(in_rate: u32, out_rate: u32) -> Self {
        let in_rate = in_rate.max(1);
        let out_rate = out_rate.max(1);
        if in_rate == out_rate {
            return Self {
                step: 1.0,
                taps: Vec::new(),
                history: Vec::new(),
                filtered: Vec::new(),
                pos: 0.0,
            };
        }
        // Cutoff relative to the input rate; Blackman window keeps the stopband
        // quiet enough that a downsampled mic does not alias into the VAD.
        let cutoff = 0.45 * in_rate.min(out_rate) as f64 / in_rate as f64;
        let n = 47usize;
        let mid = (n - 1) as f64 / 2.0;
        let mut taps: Vec<f32> = (0..n)
            .map(|i| {
                let x = i as f64 - mid;
                let sinc = if x.abs() < 1e-9 {
                    2.0 * cutoff
                } else {
                    (2.0 * std::f64::consts::PI * cutoff * x).sin() / (std::f64::consts::PI * x)
                };
                let w = 0.42 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / (n - 1) as f64).cos()
                    + 0.08 * (4.0 * std::f64::consts::PI * i as f64 / (n - 1) as f64).cos();
                (sinc * w) as f32
            })
            .collect();
        let gain: f32 = taps.iter().sum();
        for t in &mut taps {
            *t /= gain;
        }
        Self {
            step: in_rate as f64 / out_rate as f64,
            taps,
            history: vec![0.0; n - 1],
            filtered: Vec::new(),
            pos: 0.0,
        }
    }

    pub fn is_passthrough(&self) -> bool {
        self.taps.is_empty()
    }

    /// Feeds `input` and appends the converted samples to `out`.
    pub fn push(&mut self, input: &[f32], out: &mut Vec<f32>) {
        if self.is_passthrough() {
            out.extend_from_slice(input);
            return;
        }
        if input.is_empty() {
            return;
        }
        // Filter: convolve over history + input.
        let n = self.taps.len();
        let mut window = Vec::with_capacity(self.history.len() + input.len());
        window.extend_from_slice(&self.history);
        window.extend_from_slice(input);
        self.filtered.reserve(input.len());
        for i in 0..input.len() {
            let mut acc = 0.0f32;
            let slice = &window[i..i + n];
            for (s, t) in slice.iter().zip(self.taps.iter()) {
                acc += s * t;
            }
            self.filtered.push(acc);
        }
        let keep = n - 1;
        self.history.clear();
        self.history.extend_from_slice(&window[window.len() - keep..]);

        // Interpolate.
        while (self.pos.floor() as usize) + 1 < self.filtered.len() {
            let i = self.pos.floor() as usize;
            let frac = (self.pos - i as f64) as f32;
            let a = self.filtered[i];
            let b = self.filtered[i + 1];
            out.push(a + (b - a) * frac);
            self.pos += self.step;
        }
        let consumed = self.pos.floor() as usize;
        let consumed = consumed.min(self.filtered.len());
        if consumed > 0 {
            self.filtered.drain(..consumed);
            self.pos -= consumed as f64;
        }
    }
}

/// A closed stretch of speech, in the VAD's rate, with its place in
/// recording time.
#[derive(Debug, Clone, PartialEq)]
pub struct Segment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub samples: Vec<f32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VadState {
    Idle,
    /// Loud frames seen, not yet `min_speech_ms` of them.
    Candidate,
    Speech,
}

/// Energy VAD over 20 ms frames: a stretch opens when frames cross the
/// threshold for `min_speech_ms`, keeps `pad_ms` before the first loud frame,
/// closes after `hangover_ms` of quiet (keeping `pad_ms` after the last loud
/// frame) or is cut at `max_segment_ms` so one long monologue still streams
/// out in pieces the engine can take.
pub struct Vad {
    cfg: VadConfig,
    frame_len: usize,
    pad_frames: usize,
    pending: Vec<f32>,
    pre_roll: VecDeque<Vec<f32>>,
    state: VadState,
    /// Frames of the current stretch, first frame = `start_frame`.
    current: Vec<Vec<f32>>,
    start_frame: u64,
    frames_seen: u64,
    loud_frames: u32,
    silence_run: u32,
    last_loud: u64,
}

impl Vad {
    pub fn new(cfg: VadConfig, rate: u32) -> Self {
        let frame_len = (rate as usize * FRAME_MS as usize) / 1000;
        Self {
            cfg,
            frame_len: frame_len.max(1),
            pad_frames: (cfg.pad_ms / FRAME_MS) as usize,
            pending: Vec::new(),
            pre_roll: VecDeque::new(),
            state: VadState::Idle,
            current: Vec::new(),
            start_frame: 0,
            frames_seen: 0,
            loud_frames: 0,
            silence_run: 0,
            last_loud: 0,
        }
    }

    fn frame_ms(&self, frame: u64) -> u64 {
        frame * FRAME_MS as u64
    }

    /// Feeds samples at the VAD's rate; returns every segment closed by them.
    pub fn push(&mut self, samples: &[f32]) -> Vec<Segment> {
        let mut out = Vec::new();
        self.pending.extend_from_slice(samples);
        while self.pending.len() >= self.frame_len {
            let frame: Vec<f32> = self.pending.drain(..self.frame_len).collect();
            if let Some(seg) = self.step(frame) {
                out.push(seg);
            }
        }
        out
    }

    fn step(&mut self, frame: Vec<f32>) -> Option<Segment> {
        let f = self.frames_seen;
        self.frames_seen += 1;
        let loud = rms_dbfs(&frame) > self.cfg.threshold_db;
        match self.state {
            VadState::Idle => {
                if loud {
                    self.start_frame = f.saturating_sub(self.pre_roll.len() as u64);
                    self.current = self.pre_roll.drain(..).collect();
                    self.current.push(frame);
                    self.loud_frames = 1;
                    self.silence_run = 0;
                    self.last_loud = f;
                    self.state = VadState::Candidate;
                } else {
                    self.remember(frame);
                }
                None
            }
            VadState::Candidate => {
                self.current.push(frame);
                if loud {
                    self.loud_frames += 1;
                    self.silence_run = 0;
                    self.last_loud = f;
                } else {
                    self.silence_run += 1;
                }
                if self.loud_frames * FRAME_MS >= self.cfg.min_speech_ms {
                    self.state = VadState::Speech;
                } else if self.silence_run * FRAME_MS >= self.cfg.hangover_ms {
                    // A blip, not speech: keep its tail as the next pre-roll.
                    let dropped = std::mem::take(&mut self.current);
                    for fr in dropped {
                        self.remember(fr);
                    }
                    self.state = VadState::Idle;
                }
                None
            }
            VadState::Speech => {
                self.current.push(frame);
                if loud {
                    self.silence_run = 0;
                    self.last_loud = f;
                } else {
                    self.silence_run += 1;
                }
                if self.silence_run * FRAME_MS >= self.cfg.hangover_ms {
                    // Close at the last loud frame plus the pad; what follows
                    // is silence and becomes the next stretch's pre-roll.
                    let keep = ((self.last_loud - self.start_frame + 1) as usize + self.pad_frames)
                        .min(self.current.len());
                    let mut frames = std::mem::take(&mut self.current);
                    let tail = frames.split_off(keep);
                    for fr in tail {
                        self.remember(fr);
                    }
                    self.state = VadState::Idle;
                    return Some(self.segment(frames, self.start_frame));
                }
                if self.frame_ms(f - self.start_frame + 1) >= self.cfg.max_segment_ms as u64 {
                    // Cut and carry on: the speech has not stopped, so the next
                    // stretch is already confirmed and starts on the next frame.
                    let frames = std::mem::take(&mut self.current);
                    let start = self.start_frame;
                    self.start_frame = f + 1;
                    self.loud_frames = 0;
                    self.silence_run = 0;
                    self.state = if loud { VadState::Speech } else { VadState::Candidate };
                    if !loud {
                        // Not loud right now: give the continuation the same
                        // chance a fresh stretch gets rather than closing it
                        // on the next quiet frame.
                        self.loud_frames = 0;
                    }
                    return Some(self.segment(frames, start));
                }
                None
            }
        }
    }

    /// The end of the stream: whatever is open comes out.
    pub fn flush(&mut self) -> Option<Segment> {
        let confirmed = match self.state {
            VadState::Speech => true,
            VadState::Candidate => self.loud_frames * FRAME_MS >= self.cfg.min_speech_ms,
            VadState::Idle => false,
        };
        self.state = VadState::Idle;
        self.pre_roll.clear();
        self.pending.clear();
        let frames = std::mem::take(&mut self.current);
        if !confirmed || frames.is_empty() {
            return None;
        }
        Some(self.segment(frames, self.start_frame))
    }

    fn remember(&mut self, frame: Vec<f32>) {
        if self.pad_frames == 0 {
            return;
        }
        self.pre_roll.push_back(frame);
        while self.pre_roll.len() > self.pad_frames {
            self.pre_roll.pop_front();
        }
    }

    fn segment(&self, frames: Vec<Vec<f32>>, start_frame: u64) -> Segment {
        let n = frames.len() as u64;
        let mut samples = Vec::with_capacity(frames.len() * self.frame_len);
        for fr in frames {
            samples.extend_from_slice(&fr);
        }
        Segment {
            start_ms: self.frame_ms(start_frame),
            end_ms: self.frame_ms(start_frame + n),
            samples,
        }
    }
}

/// The 44-byte canonical PCM16 header.
pub fn wav_header(rate: u32, channels: u16, data_bytes: u32) -> [u8; 44] {
    let block_align = channels * 2;
    let byte_rate = rate * block_align as u32;
    let mut h = [0u8; 44];
    h[0..4].copy_from_slice(b"RIFF");
    h[4..8].copy_from_slice(&(36u32.wrapping_add(data_bytes)).to_le_bytes());
    h[8..12].copy_from_slice(b"WAVE");
    h[12..16].copy_from_slice(b"fmt ");
    h[16..20].copy_from_slice(&16u32.to_le_bytes());
    h[20..22].copy_from_slice(&1u16.to_le_bytes());
    h[22..24].copy_from_slice(&channels.to_le_bytes());
    h[24..28].copy_from_slice(&rate.to_le_bytes());
    h[28..32].copy_from_slice(&byte_rate.to_le_bytes());
    h[32..34].copy_from_slice(&block_align.to_le_bytes());
    h[34..36].copy_from_slice(&16u16.to_le_bytes());
    h[36..40].copy_from_slice(b"data");
    h[40..44].copy_from_slice(&data_bytes.to_le_bytes());
    h
}

fn to_i16(s: f32) -> i16 {
    (s.clamp(-1.0, 1.0) * 32767.0).round() as i16
}

/// Writes a mono PCM16 WAV in one go (a segment).
pub fn write_wav_mono16(path: &Path, rate: u32, samples: &[f32]) -> std::io::Result<()> {
    let mut bytes = Vec::with_capacity(44 + samples.len() * 2);
    bytes.extend_from_slice(&wav_header(rate, 1, (samples.len() * 2) as u32));
    for &s in samples {
        bytes.extend_from_slice(&to_i16(s).to_le_bytes());
    }
    std::fs::write(path, bytes)
}

/// The archive: header written up front with zero sizes, patched on `finish`.
/// A stream that dies mid-call still leaves a file every player opens once
/// the header is patched, and most players cope even when it is not.
pub struct WavWriter {
    file: BufWriter<File>,
    rate: u32,
    channels: u16,
    data_bytes: u64,
}

/// RIFF sizes are 32-bit; past this the writer stops appending (~6 h of
/// stereo 48 kHz) rather than producing a file nothing can open.
const WAV_MAX_DATA: u64 = u32::MAX as u64 - 44;

impl WavWriter {
    pub fn create(path: &Path, rate: u32, channels: u16) -> std::io::Result<Self> {
        let mut file = BufWriter::new(File::create(path)?);
        file.write_all(&wav_header(rate, channels, 0))?;
        Ok(Self { file, rate, channels, data_bytes: 0 })
    }

    /// Interleaved frames, `channels` samples each.
    pub fn write_frames(&mut self, interleaved: &[f32]) -> std::io::Result<()> {
        let bytes = (interleaved.len() * 2) as u64;
        if self.data_bytes + bytes > WAV_MAX_DATA {
            return Ok(());
        }
        let mut buf = Vec::with_capacity(interleaved.len() * 2);
        for &s in interleaved {
            buf.extend_from_slice(&to_i16(s).to_le_bytes());
        }
        self.file.write_all(&buf)?;
        self.data_bytes += bytes;
        Ok(())
    }

    pub fn finish(mut self) -> std::io::Result<u64> {
        self.file.flush()?;
        let file = self.file.get_mut();
        file.seek(SeekFrom::Start(0))?;
        file.write_all(&wav_header(self.rate, self.channels, self.data_bytes as u32))?;
        file.flush()?;
        Ok(self.data_bytes)
    }
}

/// How much audio a source has delivered against recording time, so a source
/// that goes quiet (loopback with nothing playing) is padded rather than left
/// to drift against the other one.
#[derive(Debug, Clone)]
pub struct Timeline {
    rate: f64,
    delivered: u64,
}

impl Timeline {
    pub fn new(rate: u32) -> Self {
        Self { rate: rate.max(1) as f64, delivered: 0 }
    }

    pub fn delivered_ms(&self) -> f64 {
        self.delivered as f64 * 1000.0 / self.rate
    }

    pub fn advance(&mut self, frames: usize) {
        self.delivered += frames as u64;
    }

    /// Frames of silence to insert before the next real packet so the stream
    /// catches up to within half a gap of `now_ms`; 0 when it is on time.
    pub fn fill_needed(&self, now_ms: f64) -> usize {
        let behind = now_ms - self.delivered_ms();
        if behind <= GAP_MS {
            return 0;
        }
        ((behind - GAP_MS / 2.0) * self.rate / 1000.0) as usize
    }
}

// ---------------------------------------------------------------------------
// The session (Windows)
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod live {
    use super::*;
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::sync::mpsc;
    use std::sync::{Arc, Mutex, OnceLock};
    use std::thread::JoinHandle;
    use std::time::{Duration, Instant};
    use tauri::{AppHandle, Emitter, Manager};
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::Media::Audio::{
        eCapture, eConsole, eRender, EDataFlow, IAudioCaptureClient, IAudioClient, IMMDevice,
        IMMDeviceEnumerator, MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK, DEVICE_STATE_ACTIVE, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
        WAVE_FORMAT_PCM,
    };
    use windows::Win32::System::Com::StructuredStorage::{
        PropVariantClear, PropVariantToStringAlloc, PROPVARIANT,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
        COINIT_DISABLE_OLE1DDE, COINIT_MULTITHREADED, STGM_READ,
    };

    const POLL: Duration = Duration::from_millis(10);
    const WRITER_TICK: Duration = Duration::from_millis(50);
    const LEVEL_EVERY: Duration = Duration::from_millis(100);
    /// How long `start` waits for a device to come up before calling it failed.
    const READY_TIMEOUT: Duration = Duration::from_secs(4);
    /// Shared-mode buffer: a second, so a stalled poll never drops audio.
    const BUFFER_HNS: i64 = 10_000_000;
    const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
    const WAVE_FORMAT_EXTENSIBLE: u16 = 0xFFFE;
    const SUBTYPE_PCM: u128 = 0x00000001_0000_0010_8000_00aa00389b71;
    const SUBTYPE_IEEE_FLOAT: u128 = 0x00000003_0000_0010_8000_00aa00389b71;

    /// COM for the calling thread, given back on the way out (the pattern
    /// from `disk/sys.rs`). Audio clients are happy in an MTA.
    struct ComGuard(bool);

    impl ComGuard {
        fn enter() -> Self {
            let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED | COINIT_DISABLE_OLE1DDE) };
            Self(hr.is_ok())
        }
    }

    impl Drop for ComGuard {
        fn drop(&mut self) {
            if self.0 {
                unsafe { CoUninitialize() };
            }
        }
    }

    fn describe(context: &str, e: windows::core::Error) -> String {
        format!("{context}: {} (0x{:08x})", e.message(), e.code().0 as u32)
    }

    unsafe fn take_string(p: PWSTR) -> String {
        if p.is_null() {
            return String::new();
        }
        let s = p.to_string().unwrap_or_default();
        CoTaskMemFree(Some(p.0 as *const _));
        s
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn enumerator() -> Result<IMMDeviceEnumerator, String> {
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
            .map_err(|e| describe("audio device enumerator", e))
    }

    fn device_id(device: &IMMDevice) -> String {
        unsafe { device.GetId().map(|p| take_string(p)).unwrap_or_default() }
    }

    fn device_name(device: &IMMDevice) -> String {
        unsafe {
            let Ok(store) = device.OpenPropertyStore(STGM_READ) else {
                return String::new();
            };
            let Ok(mut value) = store.GetValue(&PKEY_Device_FriendlyName) else {
                return String::new();
            };
            let name = PropVariantToStringAlloc(&value as *const PROPVARIANT)
                .map(|p| take_string(p))
                .unwrap_or_default();
            let _ = PropVariantClear(&mut value);
            name
        }
    }

    fn list_endpoints(en: &IMMDeviceEnumerator, flow: EDataFlow) -> Vec<DeviceInfo> {
        unsafe {
            let default_id = en
                .GetDefaultAudioEndpoint(flow, eConsole)
                .map(|d| device_id(&d))
                .unwrap_or_default();
            let Ok(collection) = en.EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE) else {
                return Vec::new();
            };
            let count = collection.GetCount().unwrap_or(0);
            let mut out = Vec::with_capacity(count as usize);
            for i in 0..count {
                let Ok(device) = collection.Item(i) else { continue };
                let id = device_id(&device);
                if id.is_empty() {
                    continue;
                }
                let mut name = device_name(&device);
                if name.is_empty() {
                    name = "Audio device".to_string();
                }
                let default = id == default_id;
                out.push(DeviceInfo { id, name, default });
            }
            // Default first, then by name: the picker shows the right one on top.
            out.sort_by(|a, b| b.default.cmp(&a.default).then_with(|| a.name.cmp(&b.name)));
            out
        }
    }

    pub fn devices() -> Result<Devices, String> {
        let _com = ComGuard::enter();
        let en = enumerator()?;
        Ok(Devices {
            inputs: list_endpoints(&en, eCapture),
            outputs: list_endpoints(&en, eRender),
        })
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    enum SampleKind {
        F32,
        I16,
        I24,
        I32,
    }

    /// One open WASAPI stream, read by polling.
    struct Stream {
        client: IAudioClient,
        capture: IAudioCaptureClient,
        rate: u32,
        channels: usize,
        kind: SampleKind,
        block_align: usize,
    }

    impl Stream {
        fn open(source: Source, mic_device: Option<&str>) -> Result<Self, String> {
            unsafe {
                let en = enumerator()?;
                let device = match source {
                    Source::System => en
                        .GetDefaultAudioEndpoint(eRender, eConsole)
                        .map_err(|e| describe("no default speakers to listen to", e))?,
                    Source::Mic => match mic_device {
                        Some(id) if !id.is_empty() => {
                            let w = wide(id);
                            en.GetDevice(PCWSTR(w.as_ptr()))
                                .map_err(|e| describe("that microphone is not available", e))?
                        }
                        _ => en
                            .GetDefaultAudioEndpoint(eCapture, eConsole)
                            .map_err(|e| describe("no default microphone", e))?,
                    },
                };
                let client: IAudioClient = device
                    .Activate(CLSCTX_ALL, None)
                    .map_err(|e| describe("could not open the audio device", e))?;
                let fmt_ptr = client
                    .GetMixFormat()
                    .map_err(|e| describe("could not read the device format", e))?;
                if fmt_ptr.is_null() {
                    return Err("the device reported no mix format".into());
                }
                let fmt: WAVEFORMATEX = std::ptr::read_unaligned(fmt_ptr);
                let tag = fmt.wFormatTag;
                let bits = fmt.wBitsPerSample;
                let kind = if tag == WAVE_FORMAT_EXTENSIBLE {
                    let ext: WAVEFORMATEXTENSIBLE =
                        std::ptr::read_unaligned(fmt_ptr as *const WAVEFORMATEXTENSIBLE);
                    // Packed struct: copy the field out before touching it.
                    let sub_format: windows::core::GUID = ext.SubFormat;
                    let sub = sub_format.to_u128();
                    if sub == SUBTYPE_IEEE_FLOAT {
                        Some(SampleKind::F32)
                    } else if sub == SUBTYPE_PCM {
                        pcm_kind(bits)
                    } else {
                        None
                    }
                } else if tag == WAVE_FORMAT_IEEE_FLOAT {
                    Some(SampleKind::F32)
                } else if tag as u32 == WAVE_FORMAT_PCM {
                    pcm_kind(bits)
                } else {
                    None
                };
                let Some(kind) = kind else {
                    CoTaskMemFree(Some(fmt_ptr as *const _));
                    return Err(format!(
                        "unsupported device format (tag {tag}, {bits} bits per sample)"
                    ));
                };
                let flags = match source {
                    Source::System => AUDCLNT_STREAMFLAGS_LOOPBACK,
                    Source::Mic => 0,
                };
                let init = client.Initialize(
                    AUDCLNT_SHAREMODE_SHARED,
                    flags,
                    BUFFER_HNS,
                    0,
                    fmt_ptr as *const WAVEFORMATEX,
                    None,
                );
                CoTaskMemFree(Some(fmt_ptr as *const _));
                init.map_err(|e| describe("could not start the audio stream", e))?;
                let capture: IAudioCaptureClient = client
                    .GetService()
                    .map_err(|e| describe("no capture client on this device", e))?;
                client
                    .Start()
                    .map_err(|e| describe("the audio stream would not start", e))?;
                Ok(Self {
                    client,
                    capture,
                    rate: fmt.nSamplesPerSec,
                    channels: (fmt.nChannels as usize).max(1),
                    kind,
                    block_align: (fmt.nBlockAlign as usize).max(1),
                })
            }
        }

        /// Drains every pending packet, appending mono f32 samples to `out`.
        fn read(&self, out: &mut Vec<f32>) -> Result<(), String> {
            unsafe {
                loop {
                    let packet = self
                        .capture
                        .GetNextPacketSize()
                        .map_err(|e| describe("the audio device stopped answering", e))?;
                    if packet == 0 {
                        return Ok(());
                    }
                    let mut data: *mut u8 = std::ptr::null_mut();
                    let mut frames: u32 = 0;
                    let mut flags: u32 = 0;
                    self.capture
                        .GetBuffer(&mut data, &mut frames, &mut flags, None, None)
                        .map_err(|e| describe("could not read from the audio device", e))?;
                    let n = frames as usize;
                    if flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 || data.is_null() {
                        out.extend(std::iter::repeat(0.0f32).take(n));
                    } else {
                        let bytes = std::slice::from_raw_parts(data, n * self.block_align);
                        decode_mono(bytes, self.kind, self.channels, n, out);
                    }
                    let _ = self.capture.ReleaseBuffer(frames);
                }
            }
        }

        fn stop(&self) {
            unsafe {
                let _ = self.client.Stop();
            }
        }
    }

    fn pcm_kind(bits: u16) -> Option<SampleKind> {
        match bits {
            16 => Some(SampleKind::I16),
            24 => Some(SampleKind::I24),
            32 => Some(SampleKind::I32),
            _ => None,
        }
    }

    /// Interleaved device samples → mono f32 by averaging the channels.
    fn decode_mono(bytes: &[u8], kind: SampleKind, channels: usize, frames: usize, out: &mut Vec<f32>) {
        let sample_bytes = match kind {
            SampleKind::F32 | SampleKind::I32 => 4,
            SampleKind::I24 => 3,
            SampleKind::I16 => 2,
        };
        let inv = 1.0 / channels as f32;
        out.reserve(frames);
        for f in 0..frames {
            let mut acc = 0.0f32;
            for c in 0..channels {
                let at = (f * channels + c) * sample_bytes;
                if at + sample_bytes > bytes.len() {
                    break;
                }
                let s = &bytes[at..at + sample_bytes];
                acc += match kind {
                    SampleKind::F32 => f32::from_le_bytes([s[0], s[1], s[2], s[3]]),
                    SampleKind::I16 => i16::from_le_bytes([s[0], s[1]]) as f32 / 32768.0,
                    SampleKind::I24 => {
                        let v = ((s[2] as i32) << 24 | (s[1] as i32) << 16 | (s[0] as i32) << 8) >> 8;
                        v as f32 / 8_388_608.0
                    }
                    SampleKind::I32 => i32::from_le_bytes([s[0], s[1], s[2], s[3]]) as f32 / 2_147_483_648.0,
                };
            }
            out.push(acc * inv);
        }
    }

    /// Recording time: since start, minus paused time, frozen at stop.
    struct Clock {
        t0: Instant,
        paused_total: Duration,
        pause_started: Option<Instant>,
        stopped: Option<Duration>,
    }

    impl Clock {
        fn elapsed(&self) -> Duration {
            if let Some(s) = self.stopped {
                return s;
            }
            let mut e = self.t0.elapsed().saturating_sub(self.paused_total);
            if let Some(p) = self.pause_started {
                e = e.saturating_sub(p.elapsed());
            }
            e
        }
    }

    struct Shared {
        session: String,
        segments_dir: PathBuf,
        vad: VadConfig,
        archive: bool,
        enabled: [bool; 2],
        clock: Mutex<Clock>,
        paused: AtomicBool,
        stop: AtomicBool,
        /// The workers are gone; the writer may drain and close.
        finish: AtomicBool,
        levels: [AtomicU32; 2],
        /// Archive-rate mono samples per source, waiting to be interleaved.
        queues: [Mutex<VecDeque<f32>>; 2],
        segments: AtomicU32,
        app: AppHandle,
    }

    impl Shared {
        fn elapsed_ms(&self) -> f64 {
            self.clock.lock().map(|c| c.elapsed().as_secs_f64() * 1000.0).unwrap_or(0.0)
        }

        fn set_level(&self, source: Source, level: f32) {
            self.levels[source.index()].store(level.to_bits(), Ordering::Relaxed);
        }

        fn level(&self, source: Source) -> f32 {
            f32::from_bits(self.levels[source.index()].load(Ordering::Relaxed))
        }

        fn error(&self, message: String) {
            log::warn!("audio capture [{}]: {message}", self.session);
            let _ = self.app.emit(
                ERROR_EVENT,
                ErrorEvent { session: self.session.clone(), message },
            );
        }
    }

    struct Session {
        shared: Arc<Shared>,
        workers: Vec<JoinHandle<()>>,
        writer: Option<JoinHandle<()>>,
        wav_path: Option<PathBuf>,
    }

    fn sessions() -> &'static Mutex<HashMap<String, Session>> {
        static SESSIONS: OnceLock<Mutex<HashMap<String, Session>>> = OnceLock::new();
        SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
    }

    /// One source: open the device, then poll it until told to stop, feeding
    /// the archive queue and the VAD, filling gaps against the clock.
    fn run_source(shared: Arc<Shared>, source: Source, mic_device: Option<String>, ready: mpsc::Sender<Result<u32, String>>) {
        let _com = ComGuard::enter();
        let stream = match Stream::open(source, mic_device.as_deref()) {
            Ok(s) => s,
            Err(e) => {
                let _ = ready.send(Err(e));
                return;
            }
        };
        let _ = ready.send(Ok(stream.rate));
        log::info!(
            "audio capture [{}]: {} open at {} Hz, {} ch, {:?}",
            shared.session,
            source.label(),
            stream.rate,
            stream.channels,
            stream.kind
        );

        let mut to_archive = Resampler::new(stream.rate, ARCHIVE_RATE);
        let mut to_vad = Resampler::new(stream.rate, SEGMENT_RATE);
        let mut vad = Vad::new(shared.vad, SEGMENT_RATE);
        let mut timeline = Timeline::new(stream.rate);
        let mut mono: Vec<f32> = Vec::new();
        let mut archive_buf: Vec<f32> = Vec::new();
        let mut vad_buf: Vec<f32> = Vec::new();
        let mut zeros: Vec<f32> = Vec::new();

        let process = |samples: &[f32],
                           timeline: &mut Timeline,
                           to_archive: &mut Resampler,
                           to_vad: &mut Resampler,
                           vad: &mut Vad,
                           archive_buf: &mut Vec<f32>,
                           vad_buf: &mut Vec<f32>| {
            timeline.advance(samples.len());
            if shared.archive {
                archive_buf.clear();
                to_archive.push(samples, archive_buf);
                if let Ok(mut q) = shared.queues[source.index()].lock() {
                    q.extend(archive_buf.iter().copied());
                }
            }
            vad_buf.clear();
            to_vad.push(samples, vad_buf);
            for seg in vad.push(vad_buf) {
                emit_segment(&shared, source, seg);
            }
        };

        while !shared.stop.load(Ordering::Relaxed) {
            mono.clear();
            if let Err(e) = stream.read(&mut mono) {
                shared.error(format!("{}: {e}", source.label()));
                break;
            }
            if shared.paused.load(Ordering::Relaxed) {
                // Keep draining so the device buffer never overflows; the
                // clock is frozen, so nothing is behind when we come back.
                shared.set_level(source, 0.0);
                std::thread::sleep(POLL);
                continue;
            }
            let now_ms = shared.elapsed_ms();
            let fill = timeline.fill_needed(now_ms);
            if fill > 0 {
                zeros.clear();
                zeros.resize(fill, 0.0);
                process(&zeros, &mut timeline, &mut to_archive, &mut to_vad, &mut vad, &mut archive_buf, &mut vad_buf);
            }
            if !mono.is_empty() {
                shared.set_level(source, rms_linear(&mono));
                process(&mono, &mut timeline, &mut to_archive, &mut to_vad, &mut vad, &mut archive_buf, &mut vad_buf);
            }
            std::thread::sleep(POLL);
        }
        stream.stop();
        if let Some(seg) = vad.flush() {
            emit_segment(&shared, source, seg);
        }
        shared.set_level(source, 0.0);
    }

    fn emit_segment(shared: &Shared, source: Source, seg: Segment) {
        let path = shared
            .segments_dir
            .join(format!("{}-{}.wav", source.label(), seg.start_ms));
        if let Err(e) = write_wav_mono16(&path, SEGMENT_RATE, &seg.samples) {
            shared.error(format!("could not write a segment: {e}"));
            return;
        }
        shared.segments.fetch_add(1, Ordering::Relaxed);
        let _ = shared.app.emit(
            SEGMENT_EVENT,
            SegmentEvent {
                session: shared.session.clone(),
                source,
                start_ms: seg.start_ms,
                end_ms: seg.end_ms,
                path: path.to_string_lossy().to_string(),
            },
        );
    }

    /// Interleaves the two archive queues into the WAV and reports levels.
    fn run_writer(shared: Arc<Shared>, wav_path: Option<PathBuf>) {
        let mut writer = match wav_path {
            Some(p) => match WavWriter::create(&p, ARCHIVE_RATE, 2) {
                Ok(w) => Some(w),
                Err(e) => {
                    shared.error(format!("could not create audio.wav: {e}"));
                    None
                }
            },
            None => None,
        };
        let mut last_level = Instant::now();
        let mut frame_buf: Vec<f32> = Vec::new();
        loop {
            std::thread::sleep(WRITER_TICK);
            let finishing = shared.finish.load(Ordering::Relaxed);
            if let Some(w) = writer.as_mut() {
                let mut qs: Vec<_> = shared.queues.iter().map(|q| q.lock().ok()).collect();
                let len = |i: usize, qs: &Vec<Option<std::sync::MutexGuard<VecDeque<f32>>>>| -> usize {
                    if !shared.enabled[i] {
                        return usize::MAX;
                    }
                    qs[i].as_ref().map(|q| q.len()).unwrap_or(0)
                };
                let (l, r) = (len(0, &qs), len(1, &qs));
                let n = if finishing { l.min(r).max(if l == usize::MAX { r } else if r == usize::MAX { l } else { l.max(r) }) } else { l.min(r) };
                let n = if n == usize::MAX { 0 } else { n };
                if n > 0 {
                    frame_buf.clear();
                    frame_buf.reserve(n * 2);
                    for _ in 0..n {
                        let a = qs[0].as_mut().and_then(|q| q.pop_front()).unwrap_or(0.0);
                        let b = qs[1].as_mut().and_then(|q| q.pop_front()).unwrap_or(0.0);
                        frame_buf.push(a);
                        frame_buf.push(b);
                    }
                    drop(qs);
                    if let Err(e) = w.write_frames(&frame_buf) {
                        shared.error(format!("could not write audio.wav: {e}"));
                        writer = None;
                    }
                }
            }
            if last_level.elapsed() >= LEVEL_EVERY && !finishing {
                last_level = Instant::now();
                let paused = shared.paused.load(Ordering::Relaxed);
                let _ = shared.app.emit(
                    LEVEL_EVENT,
                    LevelEvent {
                        session: shared.session.clone(),
                        mic: if paused { 0.0 } else { shared.level(Source::Mic) },
                        system: if paused { 0.0 } else { shared.level(Source::System) },
                    },
                );
            }
            if finishing {
                if let Some(w) = writer.take() {
                    match w.finish() {
                        Ok(bytes) => log::info!("audio capture [{}]: audio.wav closed, {bytes} bytes", shared.session),
                        Err(e) => shared.error(format!("could not close audio.wav: {e}")),
                    }
                }
                return;
            }
        }
    }

    fn resolve_dir(app: &AppHandle, dir: &str) -> Result<PathBuf, String> {
        let rel = Path::new(dir);
        if dir.trim().is_empty()
            || rel.is_absolute()
            || rel.components().any(|c| matches!(c, std::path::Component::ParentDir | std::path::Component::Prefix(_)))
        {
            return Err("dir must be a relative path inside the app's data folder".into());
        }
        let base = app.path().app_data_dir().map_err(|e| format!("app data dir: {e}"))?;
        Ok(base.join(rel))
    }

    pub fn start(
        app: AppHandle,
        session: String,
        sources: Vec<Source>,
        mic_device: Option<String>,
        dir: String,
        archive: bool,
        vad: VadConfig,
    ) -> Result<(), String> {
        if session.trim().is_empty() {
            return Err("session must not be empty".into());
        }
        let mut wanted: Vec<Source> = Vec::new();
        for s in sources {
            if !wanted.contains(&s) {
                wanted.push(s);
            }
        }
        if wanted.is_empty() {
            return Err("pick at least one source: mic or system".into());
        }
        {
            let map = sessions().lock().map_err(|_| "audio capture state poisoned".to_string())?;
            if map.contains_key(&session) {
                return Err(format!("session '{session}' is already recording"));
            }
        }
        let dir = resolve_dir(&app, &dir)?;
        let segments_dir = dir.join("segments");
        std::fs::create_dir_all(&segments_dir).map_err(|e| format!("could not create {}: {e}", segments_dir.display()))?;
        let wav_path = archive.then(|| dir.join("audio.wav"));

        let shared = Arc::new(Shared {
            session: session.clone(),
            segments_dir,
            vad,
            archive,
            enabled: [wanted.contains(&Source::Mic), wanted.contains(&Source::System)],
            clock: Mutex::new(Clock { t0: Instant::now(), paused_total: Duration::ZERO, pause_started: None, stopped: None }),
            paused: AtomicBool::new(false),
            stop: AtomicBool::new(false),
            finish: AtomicBool::new(false),
            levels: [AtomicU32::new(0), AtomicU32::new(0)],
            queues: [Mutex::new(VecDeque::new()), Mutex::new(VecDeque::new())],
            segments: AtomicU32::new(0),
            app,
        });

        let mut workers = Vec::new();
        let mut failures: Vec<(Source, String)> = Vec::new();
        let mut opened = 0usize;
        for source in &wanted {
            let (tx, rx) = mpsc::channel();
            let s = Arc::clone(&shared);
            let src = *source;
            let dev = if src == Source::Mic { mic_device.clone() } else { None };
            let handle = std::thread::Builder::new()
                .name(format!("audio-capture-{}", src.label()))
                .spawn(move || run_source(s, src, dev, tx))
                .map_err(|e| format!("could not start a capture thread: {e}"))?;
            match rx.recv_timeout(READY_TIMEOUT) {
                Ok(Ok(_rate)) => {
                    opened += 1;
                    workers.push(handle);
                }
                Ok(Err(e)) => {
                    let _ = handle.join();
                    failures.push((src, e));
                }
                Err(_) => {
                    // The thread is stuck in device init; let it die on its own
                    // when the stop flag is seen, but do not wait for it.
                    failures.push((src, "the device did not answer in time".into()));
                    workers.push(handle);
                }
            }
        }
        if opened == 0 {
            shared.stop.store(true, Ordering::Relaxed);
            for h in workers {
                let _ = h.join();
            }
            let msg = failures
                .iter()
                .map(|(s, e)| format!("{}: {e}", s.label()))
                .collect::<Vec<_>>()
                .join("; ");
            return Err(msg);
        }
        for (src, e) in &failures {
            shared.error(format!("{} is not being recorded — {e}", src.label()));
        }

        // The clock starts now, with the devices open: t = 0 is the first
        // packet, not the moment the person pressed the button.
        if let Ok(mut c) = shared.clock.lock() {
            c.t0 = Instant::now();
        }
        let writer = {
            let s = Arc::clone(&shared);
            let p = wav_path.clone();
            std::thread::Builder::new()
                .name("audio-capture-writer".into())
                .spawn(move || run_writer(s, p))
                .ok()
        };
        log::info!(
            "audio capture [{session}]: started ({}), archive {}",
            wanted.iter().map(|s| s.label()).collect::<Vec<_>>().join(" + "),
            if archive { "on" } else { "off" }
        );
        let mut map = sessions().lock().map_err(|_| "audio capture state poisoned".to_string())?;
        map.insert(session, Session { shared, workers, writer, wav_path });
        Ok(())
    }

    fn with_session<T>(session: &str, f: impl FnOnce(&Session) -> T) -> Result<T, String> {
        let map = sessions().lock().map_err(|_| "audio capture state poisoned".to_string())?;
        let s = map.get(session).ok_or_else(|| format!("no recording session '{session}'"))?;
        Ok(f(s))
    }

    pub fn pause(session: &str) -> Result<(), String> {
        with_session(session, |s| {
            if let Ok(mut c) = s.shared.clock.lock() {
                if c.pause_started.is_none() {
                    c.pause_started = Some(Instant::now());
                }
            }
            s.shared.paused.store(true, Ordering::Relaxed);
        })
    }

    pub fn resume(session: &str) -> Result<(), String> {
        with_session(session, |s| {
            if let Ok(mut c) = s.shared.clock.lock() {
                if let Some(p) = c.pause_started.take() {
                    c.paused_total += p.elapsed();
                }
            }
            s.shared.paused.store(false, Ordering::Relaxed);
        })
    }

    pub fn stop(session: &str) -> Result<StopResult, String> {
        let s = {
            let mut map = sessions().lock().map_err(|_| "audio capture state poisoned".to_string())?;
            map.remove(session).ok_or_else(|| format!("no recording session '{session}'"))?
        };
        Ok(close(s))
    }

    fn close(s: Session) -> StopResult {
        let Session { shared, workers, writer, wav_path } = s;
        // Freeze the clock first so a paused session reports the right length.
        if let Ok(mut c) = shared.clock.lock() {
            if let Some(p) = c.pause_started.take() {
                c.paused_total += p.elapsed();
            }
            let e = c.elapsed();
            c.stopped = Some(e);
        }
        shared.stop.store(true, Ordering::Relaxed);
        for h in workers {
            let _ = h.join();
        }
        shared.finish.store(true, Ordering::Relaxed);
        if let Some(w) = writer {
            let _ = w.join();
        }
        let duration_ms = shared.clock.lock().map(|c| c.elapsed().as_millis() as u64).unwrap_or(0);
        let segments = shared.segments.load(Ordering::Relaxed);
        log::info!(
            "audio capture [{}]: stopped after {duration_ms} ms, {segments} segment(s)",
            shared.session
        );
        StopResult {
            wav_path: wav_path.map(|p| p.to_string_lossy().to_string()),
            duration_ms,
            segments,
        }
    }

    /// The folders sessions are writing into right now (`<dir>`, the parent of `segments/`).
    pub fn recording_dirs() -> Vec<PathBuf> {
        match sessions().lock() {
            Ok(map) => map
                .values()
                .filter_map(|s| s.shared.segments_dir.parent().map(Path::to_path_buf))
                .collect(),
            Err(_) => Vec::new(),
        }
    }

    /// Every session, closed. Called on `RunEvent::Exit`.
    pub fn shutdown() {
        let drained: Vec<Session> = match sessions().lock() {
            Ok(mut map) => map.drain().map(|(_, s)| s).collect(),
            Err(_) => return,
        };
        for s in drained {
            let _ = close(s);
        }
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[cfg(windows)]
#[tauri::command]
pub async fn audio_capture_devices() -> Result<Devices, String> {
    tauri::async_runtime::spawn_blocking(live::devices)
        .await
        .map_err(|e| format!("the device worker stopped: {e}"))?
}

#[cfg(windows)]
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn audio_capture_start(
    app: tauri::AppHandle,
    session: String,
    sources: Vec<Source>,
    mic_device: Option<String>,
    dir: String,
    archive: Option<bool>,
    vad: Option<VadArgs>,
) -> Result<(), String> {
    let cfg: VadConfig = vad.unwrap_or_default().into();
    tauri::async_runtime::spawn_blocking(move || {
        live::start(app, session, sources, mic_device, dir, archive.unwrap_or(true), cfg)
    })
    .await
    .map_err(|e| format!("the capture worker stopped: {e}"))?
}

#[cfg(windows)]
#[tauri::command(async)]
pub fn audio_capture_pause(session: String) -> Result<(), String> {
    live::pause(&session)
}

#[cfg(windows)]
#[tauri::command(async)]
pub fn audio_capture_resume(session: String) -> Result<(), String> {
    live::resume(&session)
}

#[cfg(windows)]
#[tauri::command]
pub async fn audio_capture_stop(session: String) -> Result<StopResult, String> {
    tauri::async_runtime::spawn_blocking(move || live::stop(&session))
        .await
        .map_err(|e| format!("the capture worker stopped: {e}"))?
}

/// Closes every open capture; called from `RunEvent::Exit` in lib.rs.
pub fn shutdown() {
    #[cfg(windows)]
    live::shutdown();
}

/// Folders a meeting or captions session is recording into right now — what
/// Settings → Storage leaves alone.
pub fn recording_dirs() -> Vec<std::path::PathBuf> {
    #[cfg(windows)]
    {
        live::recording_dirs()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

#[cfg(not(windows))]
#[tauri::command(async)]
pub fn audio_capture_devices() -> Result<Devices, String> {
    Err(UNAVAILABLE.to_string())
}

#[cfg(not(windows))]
#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn audio_capture_start(
    _app: tauri::AppHandle,
    _session: String,
    _sources: Vec<Source>,
    _mic_device: Option<String>,
    _dir: String,
    _archive: Option<bool>,
    _vad: Option<VadArgs>,
) -> Result<(), String> {
    Err(UNAVAILABLE.to_string())
}

#[cfg(not(windows))]
#[tauri::command(async)]
pub fn audio_capture_pause(_session: String) -> Result<(), String> {
    Err(UNAVAILABLE.to_string())
}

#[cfg(not(windows))]
#[tauri::command(async)]
pub fn audio_capture_resume(_session: String) -> Result<(), String> {
    Err(UNAVAILABLE.to_string())
}

#[cfg(not(windows))]
#[tauri::command(async)]
pub fn audio_capture_stop(_session: String) -> Result<StopResult, String> {
    Err(UNAVAILABLE.to_string())
}

// ---------------------------------------------------------------------------
// Tests: the pure parts
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(rate: u32, hz: f32, ms: u32, amp: f32) -> Vec<f32> {
        let n = (rate as u64 * ms as u64 / 1000) as usize;
        (0..n)
            .map(|i| amp * (2.0 * std::f32::consts::PI * hz * i as f32 / rate as f32).sin())
            .collect()
    }

    fn zero_crossings(s: &[f32]) -> usize {
        s.windows(2).filter(|w| (w[0] < 0.0) != (w[1] < 0.0)).count()
    }

    #[test]
    fn dbfs_of_silence_and_full_scale() {
        assert!(rms_dbfs(&[0.0; 320]) <= -99.0);
        let full = sine(16_000, 440.0, 1000, 1.0);
        let db = rms_dbfs(&full);
        assert!((db + 3.01).abs() < 0.1, "full-scale sine is -3 dBFS, got {db}");
        assert!((rms_linear(&full) - 0.707).abs() < 0.01);
    }

    #[test]
    fn resampler_passthrough_when_rates_match() {
        let mut r = Resampler::new(48_000, 48_000);
        let input = sine(48_000, 1000.0, 100, 0.5);
        let mut out = Vec::new();
        r.push(&input, &mut out);
        assert_eq!(out, input);
    }

    #[test]
    fn resampler_48k_to_16k_keeps_a_1khz_tone() {
        let mut r = Resampler::new(48_000, SEGMENT_RATE);
        let input = sine(48_000, 1000.0, 1000, 0.8);
        let mut out = Vec::new();
        // Chunks of odd sizes, so the state across chunks is exercised.
        for chunk in input.chunks(437) {
            r.push(chunk, &mut out);
        }
        let expected = 16_000usize;
        assert!((out.len() as i64 - expected as i64).abs() < 64, "got {} samples", out.len());
        // Skip the filter's warm-up before measuring.
        let body = &out[400..out.len() - 100];
        let rms = rms_linear(body);
        assert!((rms - 0.8 * 0.7071).abs() < 0.03, "rms {rms}");
        let seconds = body.len() as f32 / 16_000.0;
        let zc = zero_crossings(body) as f32 / seconds;
        assert!((zc - 2000.0).abs() < 60.0, "zero crossings per second {zc}");
    }

    #[test]
    fn resampler_removes_what_would_alias() {
        let mut r = Resampler::new(48_000, SEGMENT_RATE);
        // 11 kHz cannot exist at 16 kHz; without the low-pass it would fold to 5 kHz.
        let input = sine(48_000, 11_000.0, 500, 1.0);
        let mut out = Vec::new();
        r.push(&input, &mut out);
        let rms = rms_linear(&out[400..]);
        assert!(rms < 0.03, "aliased energy rms {rms}");
    }

    #[test]
    fn resampler_44k1_to_48k_upsamples() {
        let mut r = Resampler::new(44_100, 48_000);
        let input = sine(44_100, 440.0, 1000, 0.5);
        let mut out = Vec::new();
        for chunk in input.chunks(441) {
            r.push(chunk, &mut out);
        }
        assert!((out.len() as i64 - 48_000).abs() < 64, "got {}", out.len());
        let body = &out[500..out.len() - 100];
        let seconds = body.len() as f32 / 48_000.0;
        let zc = zero_crossings(body) as f32 / seconds;
        assert!((zc - 880.0).abs() < 30.0, "zero crossings per second {zc}");
    }

    fn tone_ms(ms: u32, db: f32) -> Vec<f32> {
        let amp = 10f32.powf(db / 20.0) * std::f32::consts::SQRT_2;
        sine(SEGMENT_RATE, 300.0, ms, amp)
    }

    fn silence_ms(ms: u32) -> Vec<f32> {
        vec![0.0; (SEGMENT_RATE * ms / 1000) as usize]
    }

    #[test]
    fn vad_closes_one_segment_with_padding() {
        let mut vad = Vad::new(VadConfig::default(), SEGMENT_RATE);
        let mut stream = silence_ms(500);
        stream.extend(tone_ms(1000, -20.0));
        stream.extend(silence_ms(1500));
        let mut segs = Vec::new();
        for chunk in stream.chunks(1000) {
            segs.extend(vad.push(chunk));
        }
        segs.extend(vad.flush());
        assert_eq!(segs.len(), 1, "segments: {:?}", segs.iter().map(|s| (s.start_ms, s.end_ms)).collect::<Vec<_>>());
        let s = &segs[0];
        // Speech at 500–1500 ms, padded by 200 ms on both sides.
        assert!((s.start_ms as i64 - 300).abs() <= 20, "start {}", s.start_ms);
        assert!((s.end_ms as i64 - 1700).abs() <= 20, "end {}", s.end_ms);
        assert_eq!(s.samples.len() as u64, (s.end_ms - s.start_ms) * SEGMENT_RATE as u64 / 1000);
    }

    #[test]
    fn vad_ignores_a_blip_shorter_than_min_speech() {
        let mut vad = Vad::new(VadConfig::default(), SEGMENT_RATE);
        let mut stream = silence_ms(400);
        stream.extend(tone_ms(150, -20.0));
        stream.extend(silence_ms(1200));
        let mut segs = vad.push(&stream);
        segs.extend(vad.flush());
        assert!(segs.is_empty(), "a 150 ms blip is not speech");
    }

    #[test]
    fn vad_cuts_a_monologue_at_max_segment() {
        let cfg = VadConfig { max_segment_ms: 5_000, ..VadConfig::default() };
        let mut vad = Vad::new(cfg, SEGMENT_RATE);
        let mut stream = tone_ms(12_000, -20.0);
        stream.extend(silence_ms(1000));
        let mut segs = Vec::new();
        for chunk in stream.chunks(3200) {
            segs.extend(vad.push(chunk));
        }
        segs.extend(vad.flush());
        assert_eq!(segs.len(), 3, "{:?}", segs.iter().map(|s| (s.start_ms, s.end_ms)).collect::<Vec<_>>());
        assert_eq!(segs[0].start_ms, 0);
        assert_eq!(segs[0].end_ms, 5_000);
        assert_eq!(segs[1].start_ms, 5_000);
        assert_eq!(segs[1].end_ms, 10_000);
        assert_eq!(segs[2].start_ms, 10_000);
        // Speech until 12 000 ms plus the 200 ms pad.
        assert!((segs[2].end_ms as i64 - 12_200).abs() <= 20, "end {}", segs[2].end_ms);
        // Nothing lost between the cuts.
        let total: usize = segs.iter().map(|s| s.samples.len()).sum();
        assert_eq!(total as u64, segs[2].end_ms * SEGMENT_RATE as u64 / 1000);
    }

    #[test]
    fn vad_flush_closes_speech_at_the_end_of_the_stream() {
        let mut vad = Vad::new(VadConfig::default(), SEGMENT_RATE);
        let stream = tone_ms(900, -20.0);
        let mut segs = vad.push(&stream);
        assert!(segs.is_empty());
        segs.extend(vad.flush());
        assert_eq!(segs.len(), 1);
        assert_eq!(segs[0].start_ms, 0);
        assert_eq!(segs[0].end_ms, 900);
    }

    #[test]
    fn vad_threshold_is_respected() {
        let quiet = VadConfig { threshold_db: -30.0, ..VadConfig::default() };
        let mut vad = Vad::new(quiet, SEGMENT_RATE);
        let mut stream = tone_ms(1000, -40.0);
        stream.extend(silence_ms(1000));
        let mut segs = vad.push(&stream);
        segs.extend(vad.flush());
        assert!(segs.is_empty(), "-40 dBFS is under a -30 dB threshold");
    }

    #[test]
    fn wav_header_fields() {
        let h = wav_header(48_000, 2, 1000);
        assert_eq!(&h[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes([h[4], h[5], h[6], h[7]]), 1036);
        assert_eq!(&h[8..12], b"WAVE");
        assert_eq!(&h[12..16], b"fmt ");
        assert_eq!(u16::from_le_bytes([h[20], h[21]]), 1);
        assert_eq!(u16::from_le_bytes([h[22], h[23]]), 2);
        assert_eq!(u32::from_le_bytes([h[24], h[25], h[26], h[27]]), 48_000);
        assert_eq!(u32::from_le_bytes([h[28], h[29], h[30], h[31]]), 192_000);
        assert_eq!(u16::from_le_bytes([h[32], h[33]]), 4);
        assert_eq!(u16::from_le_bytes([h[34], h[35]]), 16);
        assert_eq!(&h[36..40], b"data");
        assert_eq!(u32::from_le_bytes([h[40], h[41], h[42], h[43]]), 1000);
    }

    #[test]
    fn wav_writer_patches_sizes_and_parses_back() {
        let dir = std::env::temp_dir().join(format!("owntools-ac-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("archive.wav");
        let mut w = WavWriter::create(&path, ARCHIVE_RATE, 2).unwrap();
        w.write_frames(&[0.5, -0.5, 0.25, -0.25]).unwrap();
        w.write_frames(&[1.0, -1.0]).unwrap();
        assert_eq!(w.finish().unwrap(), 12);
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(bytes.len(), 56);
        assert_eq!(u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]), 48);
        assert_eq!(u32::from_le_bytes([bytes[40], bytes[41], bytes[42], bytes[43]]), 12);
        let first = i16::from_le_bytes([bytes[44], bytes[45]]);
        assert_eq!(first, 16384);
        let last = i16::from_le_bytes([bytes[54], bytes[55]]);
        assert_eq!(last, -32767);

        let seg = dir.join("seg.wav");
        write_wav_mono16(&seg, SEGMENT_RATE, &[0.0, 0.5, -0.5]).unwrap();
        let pcm = crate::parakeet::parse_wav(&std::fs::read(&seg).unwrap()).unwrap();
        assert_eq!(pcm.rate, SEGMENT_RATE);
        assert_eq!(pcm.samples.len(), 3);
        assert!((pcm.samples[1] - 0.5).abs() < 0.001);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn timeline_fills_only_when_behind() {
        let mut t = Timeline::new(48_000);
        t.advance(48_000); // one second delivered
        assert_eq!(t.fill_needed(1050.0), 0, "50 ms late is normal jitter");
        assert_eq!(t.fill_needed(1150.0), 0, "at the edge, still nothing");
        let fill = t.fill_needed(1400.0);
        // 400 ms behind: catch up to within half a gap → 325 ms of silence.
        assert_eq!(fill, (0.325 * 48_000.0) as usize);
        t.advance(fill);
        assert_eq!(t.fill_needed(1400.0), 0);
    }

    #[test]
    fn vad_config_defaults_and_overrides() {
        let d: VadConfig = VadArgs::default().into();
        assert_eq!(d, VadConfig::default());
        let custom: VadConfig = VadArgs { threshold_db: Some(-36.0), pad_ms: Some(100), ..VadArgs::default() }.into();
        assert_eq!(custom.threshold_db, -36.0);
        assert_eq!(custom.pad_ms, 100);
        assert_eq!(custom.hangover_ms, 600);
    }

    #[test]
    fn source_serialises_lowercase() {
        assert_eq!(serde_json::to_string(&Source::Mic).unwrap(), "\"mic\"");
        let v: Vec<Source> = serde_json::from_str("[\"system\",\"mic\"]").unwrap();
        assert_eq!(v, vec![Source::System, Source::Mic]);
        let e = SegmentEvent { session: "s".into(), source: Source::System, start_ms: 1, end_ms: 2, path: "p".into() };
        let json = serde_json::to_string(&e).unwrap();
        assert!(json.contains("\"startMs\":1"));
        assert!(json.contains("\"source\":\"system\""));
    }
}
