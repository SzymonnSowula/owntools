// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentDictationSink, insertDictatedText, registerDictationSink } from "./insert";

let unregister: (() => void) | null = null;

beforeEach(() => {
  document.body.innerHTML = "";
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) },
  });
});

afterEach(() => {
  unregister?.();
  unregister = null;
});

describe("insertDictatedText", () => {
  it("inserts at the caret of the focused textarea with a space before a word", async () => {
    const area = document.createElement("textarea");
    area.value = "hello world";
    document.body.appendChild(area);
    area.focus();
    area.setSelectionRange(5, 5); // "hello|" — caret follows a word
    const seen: string[] = [];
    area.addEventListener("input", () => seen.push(area.value));

    expect(await insertDictatedText("  there ")).toBe("field");
    expect(area.value).toBe("hello there  world");
    expect(area.selectionStart).toBe("hello there ".length);
    expect(seen).toEqual(["hello there  world"]);
  });

  it("does not add a leading space after whitespace or at the start", async () => {
    const input = document.createElement("input");
    input.type = "text";
    input.value = "one ";
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(4, 4);
    expect(await insertDictatedText("two")).toBe("field");
    expect(input.value).toBe("one two ");

    input.value = "";
    input.setSelectionRange(0, 0);
    expect(await insertDictatedText("start")).toBe("field");
    expect(input.value).toBe("start ");
  });

  it("replaces a selection", async () => {
    const area = document.createElement("textarea");
    area.value = "keep DROP end";
    document.body.appendChild(area);
    area.focus();
    area.setSelectionRange(5, 9);
    await insertDictatedText("new");
    expect(area.value).toBe("keep new  end");
  });

  it("skips read-only, disabled and non-text inputs", async () => {
    const ro = document.createElement("input");
    ro.type = "text";
    ro.readOnly = true;
    document.body.appendChild(ro);
    ro.focus();
    expect(await insertDictatedText("x")).toBe("clipboard");
    expect(ro.value).toBe("");

    const num = document.createElement("input");
    num.type = "number";
    document.body.appendChild(num);
    num.focus();
    expect(await insertDictatedText("x")).toBe("clipboard");
  });

  it("hands the text to the registered sink when nothing is focused", async () => {
    const insert = vi.fn(() => true);
    unregister = registerDictationSink({ name: "board", insert });
    expect(await insertDictatedText(" a note ")).toBe("sink");
    expect(insert).toHaveBeenCalledWith("a note");
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("prefers the focused field over the sink", async () => {
    const insert = vi.fn(() => true);
    unregister = registerDictationSink({ name: "board", insert });
    const area = document.createElement("textarea");
    document.body.appendChild(area);
    area.focus();
    expect(await insertDictatedText("typed")).toBe("field");
    expect(insert).not.toHaveBeenCalled();
  });

  it("falls back to the clipboard when the sink declines or throws", async () => {
    unregister = registerDictationSink({ name: "no", insert: () => false });
    expect(await insertDictatedText("words")).toBe("clipboard");
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("words");
    unregister();

    unregister = registerDictationSink({
      name: "broken",
      insert: () => {
        throw new Error("boom");
      },
    });
    expect(await insertDictatedText("again")).toBe("clipboard");
  });

  it("reports none for empty text and when even the clipboard fails", async () => {
    expect(await insertDictatedText("   ")).toBe("none");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) },
    });
    expect(await insertDictatedText("lost")).toBe("none");
  });

  it("unregistering only removes the sink it was given", () => {
    const first = { name: "a", insert: () => true };
    const second = { name: "b", insert: () => true };
    const offFirst = registerDictationSink(first);
    unregister = registerDictationSink(second);
    offFirst();
    expect(currentDictationSink()).toBe(second);
  });
});
