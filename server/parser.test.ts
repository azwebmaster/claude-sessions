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
    assert.ok(detail.timeline.every((p) => typeof p.nodeId === "string" && p.nodeId.length > 0));
    const timelineIds = new Set(detail.timeline.map((p) => p.nodeId));
    const walk = (node: typeof detail.tree): string[] => [
      node.id,
      ...node.children.flatMap(walk),
    ];
    const treeIds = new Set(walk(detail.tree));
    for (const id of timelineIds) {
      assert.ok(treeIds.has(id), `timeline nodeId ${id} missing from hierarchy`);
    }
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
    const collectToolLabels = (n: typeof detail.tree) => {
      if (n.kind === "tool_call") toolLabels.push(n.label);
      for (const c of n.children) collectToolLabels(c);
    };
    collectToolLabels(detail.tree);
    assert.ok(toolLabels.some((l) => l.includes(" · ")));
    assert.ok(
      detail.toolImpact[0].contextGrowthAttributed >=
        detail.toolImpact[detail.toolImpact.length - 1]
          .contextGrowthAttributed ||
        detail.toolImpact.every((t) => t.contextGrowthAttributed === 0),
    );
    assert.ok(detail.agentBreakdown.some((a) => a.kind === "subagent"));
    assert.ok(contextSize(detail.meta.usage) > 0);
    assert.ok(
      detail.meta.filePath.includes("11111111-1111-1111-1111-111111111111.jsonl"),
      "session detail should expose the full transcript log path",
    );
    assert.ok(detail.timeline.every((p) => p.log?.raw && p.log.line > 0));
    assert.ok(
      detail.timeline[0].log.raw.includes('"type":"assistant"') ||
        detail.timeline[0].log.raw.includes('"type": "assistant"'),
    );
    assert.equal(detail.timeline[0].log.filePath, detail.meta.filePath);
    const firstAssistant = detail.tree.children.find(
      (n) => n.kind === "assistant_message",
    );
    assert.ok(firstAssistant?.log?.raw);
    assert.equal(firstAssistant?.log?.line, detail.timeline[0].log.line);

    const assistants = detail.tree.children.filter(
      (n) => n.kind === "assistant_message" && n.usage,
    );
    assert.ok(assistants.length >= 2);
    // First billed turn is baseline occupancy (prompt/cache), not a vs-prior delta.
    assert.equal(assistants[0].context?.contextDelta, null);
    assert.ok((assistants[0].context?.contextAfter ?? 0) > 0);
    assert.ok(
      (assistants[0].usage?.cacheCreationInputTokens ?? 0) +
        (assistants[0].usage?.inputTokens ?? 0) >
        (assistants[0].usage?.outputTokens ?? 0),
      "first-turn ctx is dominated by input/cache, not output or tool +N chips",
    );
    // Later turns report growth vs prior context.
    assert.ok(
      assistants.slice(1).some((a) => (a.context?.contextDelta ?? 0) !== 0),
    );

    assert.ok(detail.loadedContext.length >= 1);
    assert.equal(detail.loadedContext.length, detail.timeline.length);
    const firstLoaded = detail.loadedContext[0];
    assert.equal(firstLoaded.nodeId, detail.timeline[0].nodeId);
    const kinds = new Set(firstLoaded.items.map((i) => i.kind));
    assert.ok(kinds.has("system_prompt"), "baseline system prompt layer");
    assert.ok(kinds.has("instruction"), "CLAUDE.md / instructions");
    assert.ok(kinds.has("mcp"), "MCP servers from attachments");
    assert.ok(kinds.has("skill"), "skill listing attachment");
    assert.ok(kinds.has("deferred_tools"), "deferred tool names");
    assert.ok(kinds.has("memory"), "memory attachment");
    assert.ok(
      firstLoaded.categories.some((c) => c.kind === "mcp" && c.itemCount >= 1),
    );

    const later = detail.loadedContext[detail.loadedContext.length - 1];
    assert.ok(
      later.items.some((i) => i.kind === "file"),
      "later turns should include files read into context",
    );
    assert.ok(
      later.items.some(
        (i) => i.kind === "skill" && i.skillName === "security-audit",
      ),
      "invoked skill should appear in loaded context",
    );
    assert.ok(
      later.items.some((i) => i.kind === "tool_schema"),
      "ToolSearch-loaded schemas should appear",
    );
  });
});
