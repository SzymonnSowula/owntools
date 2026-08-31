export type DictationCommand =
  | "paragraph"
  | "heading"
  | "list"
  | "todo"
  | "stop";

export type SpeechStatus = "idle" | "listening" | "unsupported" | "error";

const COMMANDS: { test: RegExp; command: DictationCommand }[] = [
  { test: /^(koniec dyktowania|zatrzymaj dyktowanie|stop dyktowanie|stop)$/i, command: "stop" },
  { test: /^(nowy akapit|nowy paragraf|akapit)$/i, command: "paragraph" },
  { test: /^(nagłówek|naglowek|tytuł|tytul)$/i, command: "heading" },
  { test: /^(lista|wypunktowanie)$/i, command: "list" },
  { test: /^(zadanie|to do|todo|checkbox)$/i, command: "todo" },
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
    return "Brak zgody na mikrofon. Pozwól na dostęp, gdy system o to poprosi.";
  }
  if (code === "audio-capture") {
    return "Nie znaleziono mikrofonu. Podłącz urządzenie i spróbuj ponownie.";
  }
  if (code === "no-speech") {
    return "Nie usłyszałem nic. Kliknij Dyktuj i mów bliżej mikrofonu.";
  }
  if (code === "network") {
    return "Rozpoznawanie mowy Windows nie odpowiedziało. Sprawdź pakiet językowy (polski) i rozpoznawanie mowy w systemie.";
  }
  if (code === "unsupported") {
    return "Web Speech API jest niedostępne. W WebView2 / Edge włącz Rozpoznawanie mowy Windows i pakiet językowy.";
  }
  return "Nie udało się dyktować. Sprawdź mikrofon i pakiet językowy Windows.";
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
