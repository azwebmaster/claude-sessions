import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentBreakdownRow, TokenUsage } from "@shared/types";
import {
  arrangeRadialPositions,
  buildAgentToolDiagramModel,
  radiusForTokenValue,
  radiusFromWeight,
  selectVisibleToolLinks,
  toolNodeId,
  type DiagramLink,
} from "./AgentToolDiagram";

function usage(partial: Partial<TokenUsage> = {}): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    ...partial,
  };
}

function agent(
  partial: Pick<AgentBreakdownRow, "agentId" | "kind" | "tools"> &
    Partial<AgentBreakdownRow>,
): AgentBreakdownRow {
  const toolCallCount = partial.tools.reduce((s, t) => s + t.callCount, 0);
  return {
    agentId: partial.agentId,
    label: partial.label ?? partial.agentId,
    kind: partial.kind,
    model: partial.model ?? null,
    usage: partial.usage ?? usage({ inputTokens: 10_000 }),
    peakContextTokens: partial.peakContextTokens ?? 50_000,
    toolCallCount: partial.toolCallCount ?? toolCallCount,
    messageCount: partial.messageCount ?? 1,
    turnCount: partial.turnCount ?? 1,
    tools: partial.tools,
  };
}

describe("radiusForTokenValue", () => {
  it("maps the largest labeled value to the max radius", () => {
    assert.equal(radiusForTokenValue(2_500_000, 2_500_000, 22, 64), 64);
  });

  it("keeps smaller labeled values smaller on the shared scale", () => {
    const agentR = radiusForTokenValue(2_500_000, 2_500_000, 22, 64);
    const toolR = radiusForTokenValue(45_000, 2_500_000, 22, 64);
    assert.ok(agentR > toolR);
    // Area scales with the token ratio (sqrt weight), not a separate agent/tool range.
    const expectedTool = radiusFromWeight(45_000 / 2_500_000, 22, 64);
    assert.equal(toolR, expectedTool);
  });

  it("changes agent radii when the metric max changes (peak ctx → tokens)", () => {
    const peakMax = 120_000;
    const tokenMax = 2_500_000;
    const subagentPeak = 80_000;
    const subagentTokens = 90_000;

    const peakRadius = radiusForTokenValue(subagentPeak, peakMax, 22, 64);
    const tokenRadius = radiusForTokenValue(subagentTokens, tokenMax, 22, 64);

    // Same node can show a similar absolute count but a much smaller share of
    // the max after switching to total tokens — radius must follow that share.
    assert.ok(tokenRadius < peakRadius);
  });

  it("gives equal radii for equal numbers regardless of node kind", () => {
    const max = 100_000;
    assert.equal(
      radiusForTokenValue(50_000, max, 22, 64),
      radiusForTokenValue(50_000, max, 22, 64),
    );
  });
});

describe("buildAgentToolDiagramModel", () => {
  const rows = [
    agent({
      agentId: "root",
      kind: "root_agent",
      label: "Root agent",
      tools: [
        { toolName: "Read", callCount: 8 },
        { toolName: "Edit", callCount: 3 },
        { toolName: "Bash", callCount: 2 },
      ],
    }),
    agent({
      agentId: "sub-a",
      kind: "subagent",
      label: "Subagent · sub-a",
      tools: [
        { toolName: "Read", callCount: 4 },
        { toolName: "Grep", callCount: 1 },
      ],
    }),
  ];

  it("links every visible tool use to its owning agent (1:1)", () => {
    const model = buildAgentToolDiagramModel(
      rows,
      new Map(),
      true,
      "peakContext",
    );

    assert.equal(model.toolNodes.length, 5);
    assert.equal(model.links.length, model.toolNodes.length);

    for (const tool of model.toolNodes) {
      const link = model.links.find(
        (l) => toolNodeId(l.agentId, l.toolName) === tool.id,
      );
      assert.ok(link, `missing link for tool node ${tool.id}`);
      assert.equal(link.agentId, tool.ownerAgentId);
      assert.equal(link.toolName, tool.toolName);
    }
  });

  it("scopes the same tool name per calling agent", () => {
    const model = buildAgentToolDiagramModel(
      rows,
      new Map([["Read", 1000]]),
      true,
      "peakContext",
    );
    const readNodes = model.toolNodes.filter((t) => t.toolName === "Read");
    assert.equal(readNodes.length, 2);
    assert.deepEqual(
      readNodes.map((t) => t.id).sort(),
      ["tool:root:Read", "tool:sub-a:Read"].sort(),
    );
    assert.equal(
      model.links.filter((l) => l.toolName === "Read").length,
      2,
    );
  });

  it("lays out a position for every linked endpoint", () => {
    const model = buildAgentToolDiagramModel(
      rows,
      new Map(),
      true,
      "peakContext",
    );
    const positions = arrangeRadialPositions(
      model.agentNodes,
      model.toolNodes,
      model.world,
      model.links,
    );

    for (const agentNode of model.agentNodes) {
      assert.ok(positions[agentNode.id], `missing agent pos ${agentNode.id}`);
    }
    for (const link of model.links) {
      const toolId = toolNodeId(link.agentId, link.toolName);
      assert.ok(positions[link.agentId], `missing link from ${link.agentId}`);
      assert.ok(positions[toolId], `missing link to ${toolId}`);
    }
  });
});

describe("selectVisibleToolLinks", () => {
  it("keeps at least one tool use link per agent when collapsing", () => {
    const ranked: DiagramLink[] = [
      { agentId: "root", toolName: "A", callCount: 20 },
      { agentId: "root", toolName: "B", callCount: 19 },
      { agentId: "root", toolName: "C", callCount: 18 },
      { agentId: "root", toolName: "D", callCount: 17 },
      { agentId: "root", toolName: "E", callCount: 16 },
      { agentId: "root", toolName: "F", callCount: 15 },
      { agentId: "sub", toolName: "Read", callCount: 1 },
    ];

    const visible = selectVisibleToolLinks(ranked, 5);
    assert.ok(visible.length <= 6); // may exceed cap by sole-agent coverage
    assert.ok(
      visible.some((l) => l.agentId === "sub" && l.toolName === "Read"),
      "subagent tool use must stay linked when collapsing",
    );
    assert.ok(visible.some((l) => l.agentId === "root"));
  });
});
