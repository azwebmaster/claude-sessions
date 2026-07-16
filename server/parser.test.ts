import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { parseSessionFile, buildSessionDetail } from "./parser.js";
import { decodeProjectPath, fixtureRoot } from "./sessions.js";
import { contextSize, totalTokens } from "../shared/types.js";

describe("decodeProjectPath", () => {
  it("restores a leading slash path", () => {
    assert.equal(
      decodeProjectPath("-Users-dan-code-app"),
      "/Users/dan/code/app",
    );
  });
});

describe("fixture session parse", () => {
  it("parses hierarchy, usage, and tool impact", async () => {
    const filePath = path.join(
      fixtureRoot(),
      "-workspace-demo",
      "11111111-1111-1111-1111-111111111111.jsonl",
    );
    const parsed = await parseSessionFile(filePath, {
      lightweight: false,
      sessionId: "11111111-1111-1111-1111-111111111111",
    });

    assert.ok(parsed.messageCount >= 1);
    assert.ok(parsed.toolCallCount >= 2);
    assert.ok(totalTokens(parsed.usage) > 0);
    assert.ok(parsed.peakContextTokens > 0);
    assert.ok(parsed.subagentFiles.length >= 1);

    const detail = buildSessionDetail(
      {
        id: "11111111-1111-1111-1111-111111111111",
        projectEncoded: "-workspace-demo",
        projectPath: "/workspace/demo",
        filePath,
        source: "fixture",
        mtimeMs: Date.now(),
        size: 1,
      },
      parsed,
    );

    assert.equal(detail.tree.kind, "root_agent");
    assert.ok(detail.timeline.length >= 1);
    const readImpact = detail.toolImpact.find((t) => t.toolName === "Read");
    assert.ok(readImpact);
    assert.ok(readImpact.callCount >= 1);
    assert.ok(readImpact.calls.length >= 1);
    assert.ok(
      readImpact.calls.every(
        (c) => typeof c.toolUseId === "string" && c.toolUseId.length > 0,
      ),
    );
    assert.ok(
      readImpact.calls.every(
        (c) =>
          (c.inputPreview && c.inputPreview.length > 0) ||
          (c.resultPreview && c.resultPreview.length > 0),
      ),
      "each Read call should expose input or result detail",
    );
    assert.ok(
      readImpact.calls.some((c) => c.inputPreview?.includes("token.ts")),
    );
    assert.ok(
      readImpact.calls.some((c) => (c.resultPreview?.length ?? 0) > 0),
    );

    const bashOrGlob = detail.toolImpact.find(
      (t) => t.toolName === "Glob" || t.toolName === "Bash",
    );
    assert.ok(bashOrGlob);
    assert.ok(bashOrGlob.calls[0]?.inputPreview);

    // Hierarchy tool nodes should carry the detail in the label, not just a bare name.
    const toolLabels: string[] = [];
    const walk = (n: typeof detail.tree) => {
      if (n.kind === "tool_call") toolLabels.push(n.label);
      for (const c of n.children) walk(c);
    };
    walk(detail.tree);
    assert.ok(toolLabels.some((l) => l.includes(" · ")));
    assert.ok(
      detail.toolImpact[0].contextGrowthAttributed >=
        detail.toolImpact[detail.toolImpact.length - 1]
          .contextGrowthAttributed ||
        detail.toolImpact.every((t) => t.contextGrowthAttributed === 0),
    );
    assert.ok(detail.agentBreakdown.some((a) => a.kind === "subagent"));
    assert.ok(contextSize(detail.meta.usage) > 0);
  });
});
