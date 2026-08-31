export type DictationCommand =
  | "paragraph"
  | "heading"
  | "list"
  | "todo"
  | "stop";

export type SpeechStatus = "idle" | "listening" | "unsupported" | "error";

const COMMANDS: { test: RegExp; command: DictationCommand }[] = [
  { test: /^(koniec dyktowania|zatrzymaj dyktowanie|stop dyktowanie|stop dictation|end dictation|stop)$/i, command: "stop" },
  { test: /^(nowy akapit|nowy paragraf|akapit|new paragraph|paragraph)$/i, command: "paragraph" },
  { test: /^(nagłówek|naglowek|tytuł|tytul|heading|title)$/i, command: "heading" },
  { test: /^(lista|wypunktowanie|list|bullet list)$/i, command: "list" },
  { test: /^(zadanie|to do|todo|checkbox|task)$/i, command: "todo" },
];

export function speechSupported(): boolean {
  return typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function classifyUtterance(raw: string): { command: DictationCommand | null; text: string } {
  const text = raw.trim();
  if (!text) return { command: null, text: "" };
  const folded = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,!?]/g, "")
    .trim();
  for (const row of COMMANDS) {
    if (row.test.test(text) || row.test.test(folded)) {
      return { command: row.command, text: "" };
    }
  }
  return { command: null, text };
}

export function errorMessage(code: string): string {
  if (code === "not-allowed" || code === "service-not-allowed") {
    return "Microphone access denied. Allow access when the system asks for it.";
  }
  if (code === "audio-capture") {
    return "No microphone found. Connect a device and try again.";
  }
  if (code === "no-speech") {
    return "Didn't hear anything. Click Dictate and speak closer to the microphone.";
  }
  if (code === "network") {
    return "Windows speech recognition didn't respond. Check the language pack and speech recognition in the system.";
  }
  if (code === "unsupported") {
    return "Web Speech API is unavailable. In WebView2 / Edge, enable Windows speech recognition and a language pack.";
  }
  return "Dictation failed. Check your microphone and the Windows language pack.";
}

export function createRecognizer(lang: string): SpeechRecognition | null {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  return rec;
}
