import { describe, expect, it } from "vitest";
import { findFacets, findHashtags, replaceFacets, toByteRange, utf8Length } from "./facets";

describe("findFacets", () => {
  it("finds links, mentions and tags with positions", () => {
    const text = "New build at https://shipshape.app/changelog. Thanks @alice.bsky.social #shipshape #v2";
    const facets = findFacets(text);
    expect(facets.map((f) => [f.kind, f.value])).toEqual([
      ["link", "https://shipshape.app/changelog"],
      ["mention", "alice.bsky.social"],
      ["tag", "shipshape"],
      ["tag", "v2"],
    ]);
    const link = facets[0]!;
    expect(text.slice(link.start, link.end)).toBe("https://shipshape.app/changelog");
  });

  it("recognises bare domains with a real TLD and leaves versions alone", () => {
    const facets = findFacets("see shipshape.app/pricing or v1.2 of file.txt");
    expect(facets.map((f) => f.value)).toEqual(["https://shipshape.app/pricing"]);
  });

  it("does not turn an email into a mention or a numeric anchor into a tag", () => {
    const facets = findFacets("mail me@example.com, issue #42, and #real_tag");
    expect(facets.filter((f) => f.kind === "mention")).toHaveLength(0);
    expect(findHashtags("issue #42, and #real_tag")).toEqual(["real_tag"]);
  });

  it("handles unicode hashtags", () => {
    expect(findHashtags("#żółć and #日本語 today")).toEqual(["żółć", "日本語"]);
  });

  it("maps UTF-16 offsets to UTF-8 byte ranges for Bluesky", () => {
    const text = "żółć #tag";
    expect(utf8Length("żółć ")).toBe(9);
    const tag = findFacets(text)[0]!;
    expect(toByteRange(text, tag.start, tag.end)).toEqual({ byteStart: 9, byteEnd: 13 });
    const emoji = "🚀 https://a.io";
    const link = findFacets(emoji)[0]!;
    expect(toByteRange(emoji, link.start, link.end)).toEqual({ byteStart: 5, byteEnd: 17 });
  });

  it("replaces facets in order", () => {
    const out = replaceFacets("hi @bob see #x", (f) => `[${f.kind}]`);
    expect(out).toBe("hi [mention] see [tag]");
  });
});
