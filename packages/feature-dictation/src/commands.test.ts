import { describe, expect, it } from "vitest";
import { applyVoiceCommands, commandPhrases, VOICE_COMMANDS } from "./commands";

const run = (text: string, segments?: string[]) => applyVoiceCommands(text, { segments });

describe("new line / new paragraph", () => {
  it("breaks the line where the command sits on a clause boundary", () => {
    expect(run("Send the invoice tomorrow. New line. Best regards, Anna.").text).toBe(
      "Send the invoice tomorrow.\nBest regards, Anna.",
    );
    expect(run("First item, new line, second item.").text).toBe("First item\nSecond item.");
    expect(run("Zrobimy to jutro. Nowa linia. Pozdrawiam.").text).toBe("Zrobimy to jutro.\nPozdrawiam.");
  });

  it("leaves 'new line' alone when it is plainly words", () => {
    const literal = "We added a new line of products this spring.";
    expect(run(literal)).toEqual({ text: literal, send: false, undo: false, applied: [] });
    // No punctuation at all: the recognizer did not hear a pause, so neither do we.
    expect(run("first item new line second item").text).toBe("First item new line second item");
  });

  it("starts a new paragraph anywhere, in either language", () => {
    expect(run("koniec wstępu nowy akapit dalej treść").text).toBe("Koniec wstępu\n\nDalej treść");
    expect(run("a new paragraph b new paragraph c").text).toBe("A\n\nB\n\nC");
    expect(run("Thanks. New paragraph. Now the details.").applied).toEqual(["paragraph"]);
  });

  it("keeps a trailing line break so the next take lands on a new line", () => {
    expect(run("Milk, eggs, new line").text).toBe("Milk, eggs\n");
  });
});

describe("scratch that", () => {
  it("drops the previous sentence when the command opens a sentence", () => {
    expect(run("Let's go with option B. Scratch that. Option C.").text).toBe("Option C.");
    expect(run("Idziemy w opcję B. Skasuj to. Opcja C.").text).toBe("Opcja C.");
    expect(run("Keep this. Drop this one. Scratch that. And this.").text).toBe("Keep this. And this.");
  });

  it("drops what was said in this sentence when it comes mid-sentence", () => {
    expect(run("we need five scratch that six apples").text).toBe("Six apples");
    expect(run("Keep this sentence. we need five, scratch that, six apples.").text).toBe(
      "Keep this sentence. Six apples.",
    );
  });

  it("drops the whole previous live segment when the command opens one", () => {
    const segments = ["Let's meet at five", "scratch that let's meet at six"];
    expect(run("", segments).text).toBe("Let's meet at six");
    const three = ["Hi Anna.", "The invoice is attached. Let me know.", "Strike that. Attached below."];
    expect(run("", three).text).toBe("Hi Anna. Attached below.");
  });

  it("does nothing harmful at the very start", () => {
    expect(run("Scratch that, hello.").text).toBe("Hello.");
  });
});

describe("delete last word", () => {
  it("removes the word before the command, with its comma", () => {
    expect(run("Send the invoice tomorrow, delete last word, today.").text).toBe("Send the invoice today.");
    expect(run("Wyślij fakturę jutro usuń ostatnie słowo dzisiaj").text).toBe("Wyślij fakturę dzisiaj");
  });

  it("reaches back into the previous live segment", () => {
    expect(run("", ["see you at noon", "delete the last word one"]).text).toBe("See you at one");
  });
});

describe("send it / undo", () => {
  it("strips a trailing 'send it' and asks for Enter", () => {
    const r = run("Thanks, see you tomorrow. Send it.");
    expect(r.text).toBe("Thanks, see you tomorrow.");
    expect(r.send).toBe(true);
    expect(run("Dzięki, do jutra. Wyślij.").send).toBe(true);
    expect(run("Dzięki, do jutra wyślij to").text).toBe("Dzięki, do jutra");
  });

  it("is not a command in the middle of a sentence", () => {
    const r = run("Please send it to Anna before noon.");
    expect(r.text).toBe("Please send it to Anna before noon.");
    expect(r.send).toBe(false);
    // "wyślij" as the first word is the sentence, not the command.
    expect(run("Wyślij fakturę jutro.").send).toBe(false);
  });

  it("recognises undo so the pill can say it is not available", () => {
    const r = run("Undo.");
    expect(r).toMatchObject({ text: "", undo: true, applied: ["undo"] });
    expect(run("cofnij").undo).toBe(true);
    // "cofnij to" is a scratch, never an undo.
    expect(run("Opcja A. Cofnij to. Opcja B.").applied).toEqual(["scratch"]);
  });
});

describe("combinations", () => {
  it("applies several commands left to right", () => {
    // Mid-sentence, "scratch that" drops the whole clause since the last
    // boundary — the line break from the command before it counts as one, so
    // the correction lands on the new line the person asked for.
    const r = run("Hi Anna. New line. We ship Monday, scratch that, Tuesday. New paragraph. Thanks. Send it.");
    expect(r.text).toBe("Hi Anna.\nTuesday.\n\nThanks.");
    expect(r.send).toBe(true);
    expect(r.applied).toEqual(["newline", "scratch", "paragraph", "send"]);
  });

  it("returns the text untouched when nothing is spoken as a command", () => {
    const plain = "Zwykłe zdanie po polsku, bez poleceń.";
    expect(run(plain).text).toBe(plain);
  });

  it("lists every command with its phrases for the settings page", () => {
    for (const c of VOICE_COMMANDS) {
      const p = commandPhrases(c);
      expect(p.en.length).toBeGreaterThan(0);
      expect(p.pl.length).toBeGreaterThan(0);
      expect(c.effect.length).toBeGreaterThan(10);
    }
  });
});
