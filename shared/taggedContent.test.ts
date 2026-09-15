import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTaggedContent, truncateTaggedContent } from "./taggedContent.js";

describe("parseTaggedContent", () => {
  it("parses sibling tags with a text gap between them", () => {
    const raw = "<command-name>/clear</command-name>\n<command-args></command-args>";
    assert.deepEqual(parseTaggedContent(raw), [
      { kind: "tag", tagName: "command-name", value: "/clear", children: [] },
      { kind: "text", value: "\n" },
      { kind: "tag", tagName: "command-args", value: "", children: [] },
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
      { kind: "tag", tagName: "tag", value: "content", children: [] },
      { kind: "text", value: " after" },
    ]);
  });

  it("recursively parses a tag whose value contains further tags", () => {
    const raw =
      "<task-notification><task-id>abc</task-id><tool-use-id>def</tool-use-id></task-notification>";
    const result = parseTaggedContent(raw);
    assert.equal(result.length, 1);
    const [outer] = result;
    assert.equal(outer.kind, "tag");
    assert.ok(outer.kind === "tag");
    assert.equal(outer.tagName, "task-notification");
    assert.equal(
      outer.value,
      "<task-id>abc</task-id><tool-use-id>def</tool-use-id>",
    );
    assert.deepEqual(outer.children, [
      { kind: "tag", tagName: "task-id", value: "abc", children: [] },
      { kind: "tag", tagName: "tool-use-id", value: "def", children: [] },
    ]);
  });

  it("recurses through multiple levels of nesting", () => {
    const raw = "<a><b><c>leaf</c></b></a>";
    const result = parseTaggedContent(raw);
    assert.equal(result.length, 1);
    const [a] = result;
    assert.ok(a.kind === "tag");
    assert.equal(a.children.length, 1);
    const [b] = a.children;
    assert.ok(b.kind === "tag");
    assert.equal(b.tagName, "b");
    assert.deepEqual(b.children, [
      { kind: "tag", tagName: "c", value: "leaf", children: [] },
    ]);
  });

  it("leaves a leaf tag's children empty when its value has no nested tags", () => {
    const raw = "<task-id>abc</task-id>";
    const [segment] = parseTaggedContent(raw);
    assert.ok(segment.kind === "tag");
    assert.deepEqual(segment.children, []);
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
