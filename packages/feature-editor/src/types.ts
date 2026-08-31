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

export interface Segment {
  id: string;
  start: number;
  end: number;
}

export interface ZoomClip {
  id: string;
  start: number;
  end: number;
  scale: number;
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
}

export interface WebcamSettings {
  enabled: boolean;
  corner: WebcamCorner;
  size: number;
  radius: number;
  border: boolean;
  borderColor: string;
}

export interface BackgroundSettings {
  presetId: string;
  customImage?: string;
  padding: number;
  windowRadius: number;
  shadow: number;
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
  webcamOffset: number;
  cursor: CursorSample[];
  autoZoom: boolean;
  segments: Segment[];
  zooms: ZoomClip[];
  captions: Caption[];
  texts: TextOverlay[];
  webcam: WebcamSettings;
  background: BackgroundSettings;
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

export type Selection =
  | { type: "segment"; id: string }
  | { type: "zoom"; id: string }
  | { type: "caption"; id: string }
  | { type: "text"; id: string };

export interface MediaUrls {
  screenUrl: string;
  webcamUrl?: string;
  backgroundUrl?: string;
}

export interface Toast {
  id: string;
  message: string;
  type: "error" | "info";
}
