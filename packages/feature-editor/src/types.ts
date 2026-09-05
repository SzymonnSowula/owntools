export type View = "home" | "recorder" | "editor";

export type AspectRatio = "16:9" | "9:16" | "1:1";

export type WebcamCorner = "tl" | "tr" | "bl" | "br";

export type CaptionStyle = "tiktok" | "subtitle";

export type Easing = "ease-in-out" | "ease-out" | "linear";

export type SpeechLang = "pl-PL" | "en-US";

export interface CursorSample {
  t: number;
  x: number;
  y: number;
  down: boolean;
}

export interface ScreenBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What `getDisplayMedia` actually captured, per the track's `displaySurface`. */
export type CaptureSurface = "monitor" | "window" | "browser" | "unknown";

/** A rectangle of the desktop, in the same virtual-screen pixels the cursor is sampled in. */
export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How `captureRect` was arrived at — it decides how much the editor trusts it. */
export type CaptureSource = "monitor" | "window" | "estimated" | "manual";

/** The recorded rectangle at a moment, for a window that was moved or resized mid-take. */
export interface SurfaceSample extends CaptureRect {
  t: number;
}

/** The user's manual correction, in frame fractions. Identity is `{0, 0, 1}`. */
export interface CursorAlign {
  dx: number;
  dy: number;
  scale: number;
}

/** A monitor as the OS reports it (physical pixels, virtual-screen space). */
export interface MonitorInfo {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  primary: boolean;
}

/** A visible top-level window, rectangle from the DWM frame bounds. */
export interface WindowInfo {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  foreground: boolean;
}

export interface DisplaySources {
  monitors: MonitorInfo[];
  windows: WindowInfo[];
  virtualScreen: CaptureRect;
}

export type TransitionKind =
  | "none"
  | "crossfade"
  | "dip-black"
  | "dip-white"
  | "slide-left"
  | "slide-up"
  | "zoom";

/** How a segment is joined to the one before it. Lives on the incoming segment. */
export interface Transition {
  kind: TransitionKind;
  /** Seconds, 0.2–1.5. */
  duration: number;
}

export interface Segment {
  id: string;
  start: number;
  end: number;
  transition?: Transition;
}

export interface ZoomClip {
  id: string;
  start: number;
  end: number;
  scale: number;
  /** The point of interest, in frame fractions; the view centres on it as far as the edges allow. */
  x: number;
  y: number;
  easing: Easing;
  followCursor: boolean;
  source?: "auto" | "manual";
}

export interface CaptionWord {
  word: string;
  start: number;
  end: number;
}

export interface Caption {
  id: string;
  start: number;
  end: number;
  text: string;
  words?: CaptionWord[];
  style: CaptionStyle;
}

export type OverlayFont = "outfit" | "inter" | "mono";

export interface TextOverlay {
  id: string;
  start: number;
  end: number;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  weight: number;
  align: "left" | "center" | "right";
  /** A translucent pill behind the text — the "lower third" look. */
  background: boolean;
  font: OverlayFont;
}

/** A logo, sticker or screenshot laid over the frame. `src` is a file inside the project folder. */
export interface ImageOverlay {
  id: string;
  start: number;
  end: number;
  src: string;
  /** Centre, as a fraction of the canvas. */
  x: number;
  y: number;
  /** Width as a fraction of the canvas width; height follows the image. */
  width: number;
  opacity: number;
  radius: number;
}

export type CameraShape = "rounded" | "circle" | "square";

export interface WebcamSettings {
  enabled: boolean;
  corner: WebcamCorner;
  size: number;
  radius: number;
  border: boolean;
  borderColor: string;
  shape: CameraShape;
  /** Border width in canvas pixels at 1080p. */
  borderWidth: number;
  shadow: number;
  mirror: boolean;
  /** Distance from the frame edge, as a fraction of the shorter canvas side. */
  margin: number;
}

export type BackgroundMode = "wallpaper" | "gradient" | "color" | "image";

export type FrameStyle = "none" | "bar";

export interface BackgroundSettings {
  mode: BackgroundMode;
  /** Wallpaper id (`wallpapers.ts`). */
  presetId: string;
  gradientId: string;
  /** Degrees, for the gradient mode. */
  gradientAngle: number;
  color: string;
  customImage?: string;
  /** 0–1; 1 is a heavy blur of the wallpaper or image. */
  blur: number;
  padding: number;
  windowRadius: number;
  shadow: number;
  /** 0–1 opacity of a hairline highlight along the window edge. */
  border: number;
  frame: FrameStyle;
}

export type CursorStyle = "system" | "arrow" | "dot";

export interface CursorSettings {
  /** `system` leaves the captured pointer alone; the others draw on top of it. */
  style: CursorStyle;
  /** 1–3, relative to a normal pointer. */
  size: number;
  color: string;
  clicks: boolean;
  clickColor: string;
  spotlight: boolean;
  /** Radius of the lit circle as a fraction of the shorter frame side. */
  spotlightSize: number;
  /** 0–0.85 darkness outside the spotlight. */
  spotlightDim: number;
}

export interface ProgressBarSettings {
  enabled: boolean;
  color: string;
  /** Height in canvas pixels at 1080p. */
  height: number;
  position: "bottom" | "top";
}

export interface AudioSettings {
  /** 0–2, linear gain. */
  volume: number;
  muted: boolean;
  fadeIn: number;
  fadeOut: number;
}

/** Fade from / to black at the ends of the timeline, in seconds. */
export interface FadeSettings {
  in: number;
  out: number;
}

export interface ShareLink {
  id: string;
  url: string;
  /** Lets this machine delete the upload; never shown in full. */
  ownerToken: string;
  createdAt: number;
  bytes: number;
  expiresAt?: number;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  duration: number;
  videoWidth: number;
  videoHeight: number;
  screenWidth: number;
  screenHeight: number;
  screenPath?: string;
  webcamPath?: string;
  backgroundPath?: string;
  captureSurface?: CaptureSurface;
  /**
   * The rectangle of the desktop this video shows. Every cursor position and
   * every zoom anchor is measured against it; without one, cursor effects stay
   * off rather than land somewhere wrong.
   */
  captureRect?: CaptureRect;
  captureSource?: CaptureSource;
  /** Human-readable surface, e.g. "Display 1 · 2560×1440". */
  captureLabel?: string;
  /** Present only when the recorded window moved or resized during the take. */
  surfaceTrack?: SurfaceSample[];
  cursorAlign?: CursorAlign;
  webcamOffset: number;
  cursor: CursorSample[];
  autoZoom: boolean;
  segments: Segment[];
  zooms: ZoomClip[];
  captions: Caption[];
  texts: TextOverlay[];
  overlays: ImageOverlay[];
  webcam: WebcamSettings;
  background: BackgroundSettings;
  cursorStyle: CursorSettings;
  progressBar: ProgressBarSettings;
  audio: AudioSettings;
  fade: FadeSettings;
  shares: ShareLink[];
  aspect: AspectRatio;
  speechLang: SpeechLang;
}

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  duration: number;
  dir?: string;
}

/** Media of a finished recording that is already on disk (AppData-relative paths). */
export interface RecordedMedia {
  screenPath: string;
  webcamPath?: string;
}

export type Selection =
  | { type: "segment"; id: string }
  | { type: "zoom"; id: string }
  | { type: "caption"; id: string }
  | { type: "text"; id: string }
  | { type: "overlay"; id: string };

export interface MediaUrls {
  screenUrl: string;
  webcamUrl?: string;
  backgroundUrl?: string;
  /** Object URLs of image overlays, keyed by `ImageOverlay.src`. */
  overlayUrls?: Record<string, string>;
}

export interface Toast {
  id: string;
  message: string;
  type: "error" | "info";
}
