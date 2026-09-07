import { describe, expect, it } from "vitest";
import {
  createEntry,
  entriesFromText,
  entriesToText,
  promptTerms,
  removeEntry,
  replacementRules,
  sanitizeEntries,
  searchEntries,
  sortEntries,
  spellingTerms,
  upsertEntry,
  type VocabularyEntry,
} from "./vocabulary";

function entry(spoken: string, replacement = "", createdAt = 0): VocabularyEntry {
  return { id: `${spoken}|${replacement}`, spoken, replacement, createdAt };
}

describe("createEntry", () => {
  it("trims and collapses the spoken form and drops one-letter entries", () => {
    expect(createEntry("  ship   shape ")?.spoken).toBe("ship shape");
    expect(createEntry("a")).toBeNull();
    expect(createEntry("   ")).toBeNull();
  });

  it("keeps a replacement's line breaks but not its outer whitespace", () => {
    const e = createEntry("my sign-off", "\n Best,\nAnna \n");
    expect(e?.replacement).toBe("Best,\nAnna");
  });

  it("treats a replacement identical to the spoken form as a plain spelling", () => {
    expect(createEntry("Tauri", "Tauri")?.replacement).toBe("");
  });
});

describe("upsertEntry / removeEntry", () => {
  it("puts the new entry first and drops an older rule for the same phrase", () => {
    const list = [entry("Tauri"), entry("my email", "old@x.dev")];
    const next = upsertEntry(list, { ...entry("My Email", "new@x.dev"), id: "n" });
    expect(next.map((e) => e.replacement)).toEqual(["new@x.dev", ""]);
    expect(next[0].id).toBe("n");
    expect(removeEntry(next, "n")).toEqual([entry("Tauri")]);
  });
});

describe("entriesFromText", () => {
  it("migrates the old comma / newline field into spelling entries", () => {
    const out = entriesFromText("Kubernetes, PostgreSQL\nAnna Nowak;Rzeszów");
    expect(out.map((e) => e.spoken)).toEqual(["Kubernetes", "PostgreSQL", "Anna Nowak", "Rzeszów"]);
    expect(out.every((e) => e.replacement === "")).toBe(true);
    expect(new Set(out.map((e) => e.id)).size).toBe(4);
  });

  it("reads arrow lines as replacements", () => {
    const out = entriesFromText("super whisper -> Superwhisper\nmy email address → anna@x.dev");
    expect(out).toMatchObject([
      { spoken: "super whisper", replacement: "Superwhisper" },
      { spoken: "my email address", replacement: "anna@x.dev" },
    ]);
  });

  it("round-trips through entriesToText", () => {
    const list = [entry("Tauri"), entry("my sign-off", "Best,\nAnna")];
    expect(entriesToText(list)).toBe("Tauri\nmy sign-off -> Best, Anna");
  });
});

describe("sanitizeEntries", () => {
  it("keeps well-formed entries and drops the rest", () => {
    const out = sanitizeEntries([
      { id: "a", spoken: "  Tauri ", replacement: "", createdAt: 5 },
      { id: "b", spoken: "x", replacement: "" },
      { id: "a", spoken: "duplicate id", replacement: "" },
      null,
      "junk",
      { spoken: "no id", replacement: 3, createdAt: "nope" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ id: "a", spoken: "Tauri", replacement: "", createdAt: 5 });
    expect(out[1]).toMatchObject({ spoken: "no id", replacement: "", createdAt: 0 });
    expect(out[1].id).toBeTruthy();
    expect(sanitizeEntries("not a list")).toEqual([]);
  });
});

describe("spellingTerms / replacementRules / promptTerms", () => {
  const list = [
    entry("shipshape"),
    entry("my email address", "anna@shipshape.app"),
    entry("super whisper", "Superwhisper"),
    entry("my sign-off", "Best regards,\nAnna from shipshape"),
    entry("my email", "short@x.dev"),
  ];

  it("splits spellings from rules and orders rules longest-first", () => {
    expect(spellingTerms(list)).toEqual(["shipshape"]);
    expect(replacementRules(list).map((r) => r.spoken)).toEqual([
      "my email address",
      "super whisper",
      "my sign-off",
      "my email",
    ]);
  });

  it("primes whisper with spellings and word-like replacement targets only", () => {
    // Addresses and multi-line snippets are not words the model should learn.
    expect(promptTerms(list)).toEqual(["shipshape", "Superwhisper"]);
  });

  it("deduplicates case-insensitively and caps the list", () => {
    const many = Array.from({ length: 120 }, (_, i) => entry(`term${i}`));
    expect(promptTerms([entry("Tauri"), entry("tauri"), ...many])).toHaveLength(80);
  });
});

describe("searchEntries / sortEntries", () => {
  it("matches either side, case-insensitively", () => {
    const list = [entry("Tauri"), entry("my email", "anna@x.dev")];
    expect(searchEntries(list, "ANNA")).toEqual([list[1]]);
    expect(searchEntries(list, "tau")).toEqual([list[0]]);
    expect(searchEntries(list, "  ")).toEqual(list);
  });

  it("sorts newest first without touching the input", () => {
    const list = [entry("old", "", 1), entry("new", "", 3), entry("mid", "", 2)];
    expect(sortEntries(list).map((e) => e.spoken)).toEqual(["new", "mid", "old"]);
    expect(list[0].spoken).toBe("old");
  });
});
