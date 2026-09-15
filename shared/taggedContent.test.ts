import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTaggedContent, truncateTaggedContent } from "./taggedContent.js";

describe("parseTaggedContent", () => {
  it("parses sibling tags with a text gap between them", () => {
    const raw = "<command-name>/clear</command-name>\n<command-args></command-args>";
    assert.deepEqual(parseTaggedContent(raw), [
      { kind: "tag", tagName: "command-name", value: "/clear" },
      { kind: "text", value: "\n" },
      { kind: "tag", tagName: "command-args", value: "" },
    ]);
  });

  it("returns a single text segment for plain text with no tags", () => {
    assert.deepEqual(parseTaggedContent("just a normal prompt"), [
      { kind: "text", value: "just a normal prompt" },
    ]);
  });

  it("treats an unmatched opening tag as plain text", () => {
    const raw = "hello <command-na";
    assert.deepEqual(parseTaggedContent(raw), [{ kind: "text", value: raw }]);
  });

  it("keeps leading/trailing plain text around a tag", () => {
    const raw = "before <tag>content</tag> after";
    assert.deepEqual(parseTaggedContent(raw), [
      { kind: "text", value: "before " },
      { kind: "tag", tagName: "tag", value: "content" },
      { kind: "text", value: " after" },
    ]);
  });
});

describe("truncateTaggedContent", () => {
  it("returns text under the limit unchanged", () => {
    assert.equal(truncateTaggedContent("short", 160), "short");
  });

  it("never leaves a tag without its closing bracket", () => {
    const raw = `<task-notification>${"x".repeat(200)}</task-notification>`;
    const result = truncateTaggedContent(raw, 40);
    assert.match(result, /^<task-notification>x+<\/task-notification>…$/);
  });

  it("drops a tag segment entirely when even its wrapper can't fit", () => {
    const raw = `hello <a-very-long-tag-name-indeed>${"x".repeat(50)}</a-very-long-tag-name-indeed>`;
    const result = truncateTaggedContent(raw, 6);
    assert.equal(result, "hello…");
  });

  it("truncates a trailing plain-text segment with an ellipsis", () => {
    const raw = "<tag>hi</tag> and then a lot more plain text after it";
    const result = truncateTaggedContent(raw, 20);
    assert.equal(result.endsWith("…"), true);
    assert.doesNotMatch(result, /<[a-z-]+>[^<]*$/);
  });
});
