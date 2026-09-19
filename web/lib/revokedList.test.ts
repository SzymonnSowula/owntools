import { describe, expect, it } from "vitest";
import { RevokedFileError, parseRevokedFile, serializeRevokedFile, withRevoked, withoutRevoked, type RevokedFile } from "./revokedList";

const A = "00000000000000aa";
const B = "00000000000000bb";

describe("the revocation list as a file", () => {
  it("starts empty, and an empty list is written the way the repository has it", () => {
    expect(parseRevokedFile('{\n  "keys": []\n}\n')).toEqual({ keys: [] });
    expect(serializeRevokedFile({ keys: [] })).toBe('{\n  "keys": []\n}\n');
  });

  it("round-trips, oldest first, one entry a line", () => {
    const file: RevokedFile = {
      keys: [
        { tag: B, reason: "shared", since: "2026-10-02" },
        { tag: A, reason: "refunded", since: "2026-09-20" },
      ],
    };
    const text = serializeRevokedFile(file);
    expect(text.split("\n").filter((l) => l.includes('"tag"'))).toHaveLength(2);
    expect(text.indexOf(A)).toBeLessThan(text.indexOf(B));
    expect(parseRevokedFile(text).keys.map((k) => k.tag)).toEqual([A, B]);
    expect(serializeRevokedFile(parseRevokedFile(text))).toBe(text);
  });

  it("adds a key once, and keeps the first date", () => {
    const first = withRevoked({ keys: [] }, { tag: A.toUpperCase(), reason: "refunded", since: "2026-09-20" });
    expect(first.change).toBe("added");
    expect(first.file.keys).toEqual([{ tag: A, reason: "refunded", since: "2026-09-20" }]);
    const again = withRevoked(first.file, { tag: A, reason: "refunded", since: "2026-11-01" });
    expect(again.change).toBe("kept");
    expect(again.file.keys[0].since).toBe("2026-09-20");
  });

  it("a shared key whose order is then refunded becomes refunded; never the other way round", () => {
    const shared = withRevoked({ keys: [] }, { tag: A, reason: "shared", since: "2026-09-20" }).file;
    const refunded = withRevoked(shared, { tag: A, reason: "refunded", since: "2026-09-25" });
    expect(refunded.change).toBe("now-refunded");
    expect(refunded.file.keys).toEqual([{ tag: A, reason: "refunded", since: "2026-09-20" }]);
    expect(withRevoked(refunded.file, { tag: A, reason: "shared", since: "2026-09-26" }).change).toBe("kept");
  });

  it("takes a key off again", () => {
    const file = withRevoked({ keys: [] }, { tag: A, reason: "shared", since: "2026-09-20" }).file;
    expect(withoutRevoked(file, B)).toEqual({ file, removed: false });
    expect(withoutRevoked(file, A.toUpperCase())).toEqual({ file: { keys: [] }, removed: true });
  });

  it("refuses a file it cannot fully read, rather than dropping what it does not understand", () => {
    const bad = [
      "not json",
      "{}",
      '{"keys": {}}',
      '{"keys": [{"tag": "xyz", "reason": "refunded", "since": "2026-09-20"}]}',
      `{"keys": [{"tag": "${A.toUpperCase()}", "reason": "refunded", "since": "2026-09-20"}]}`,
      `{"keys": [{"tag": "${A}", "reason": "because", "since": "2026-09-20"}]}`,
      `{"keys": [{"tag": "${A}", "reason": "refunded", "since": "yesterday"}]}`,
      `{"keys": [{"tag": "${A}", "reason": "refunded", "since": "2026-09-20"}, {"tag": "${A}", "reason": "shared", "since": "2026-09-21"}]}`,
    ];
    for (const text of bad) expect(() => parseRevokedFile(text), text).toThrow(RevokedFileError);
    expect(() => withRevoked({ keys: [] }, { tag: "nope", reason: "shared", since: "2026-09-20" })).toThrow(RevokedFileError);
  });
});
