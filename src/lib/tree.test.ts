import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ContextTimelinePoint, TreeNode } from "@shared/types";
import {
  collectExpandableIds,
  collectExpandableIdsBelowDepth,
  collectSteps,
  findAncestorIds,
  findNodePath,
  findOwningAgentId,
  findTimelineIndexForNode,
} from "./tree";

function node(
  partial: Pick<TreeNode, "id" | "kind"> &
    Partial<Omit<TreeNode, "id" | "kind" | "children">> & {
      children?: TreeNode[];
    },
): TreeNode {
  return {
    id: partial.id,
    kind: partial.kind,
    label: partial.label ?? partial.id,
    timestamp: partial.timestamp ?? null,
    model: partial.model ?? null,
    usage: partial.usage ?? null,
    context: partial.context ?? null,
    preview: partial.preview ?? null,
    log: partial.log ?? null,
    agentId: partial.agentId,
    toolUseId: partial.toolUseId,
    toolName: partial.toolName,
    children: partial.children ?? [],
  };
}

const tree = node({
  id: "session-1",
  kind: "root_agent",
  agentId: "session-1",
  children: [
    node({
      id: "turn-1",
      kind: "assistant_message",
      children: [
        node({
          id: "tool-1",
          kind: "tool_call",
          toolUseId: "tool-use-1",
          toolName: "Task",
          children: [
            node({
              id: "sub-a",
              kind: "subagent",
              agentId: "sub-a",
              children: [
                node({
                  id: "sub-turn",
                  kind: "assistant_message",
                  children: [
                    node({
                      id: "tool-2",
                      kind: "tool_call",
                      toolUseId: "tool-use-2",
                      toolName: "Read",
                    }),
                    node({
                      id: "tool-3",
                      kind: "tool_call",
                      toolUseId: "tool-use-3",
                      toolName: "Task",
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
        node({
          id: "tool-root-read",
          kind: "tool_call",
          toolUseId: "tool-use-root-read",
          toolName: "Read",
        }),
      ],
    }),
  ],
});

describe("tree helpers", () => {
  it("finds ancestors", () => {
    assert.deepEqual(findAncestorIds(tree, "sub-turn"), [
      "session-1",
      "turn-1",
      "tool-1",
      "sub-a",
    ]);
  });

  it("returns the inclusive path to a node", () => {
    assert.deepEqual(
      findNodePath(tree, "sub-a")?.map((n) => n.id),
      ["session-1", "turn-1", "tool-1", "sub-a"],
    );
  });

  it("resolves owning agent ids for nested focus", () => {
    assert.equal(findOwningAgentId(tree, "session-1"), "session-1");
    assert.equal(findOwningAgentId(tree, "turn-1"), "session-1");
    assert.equal(findOwningAgentId(tree, "tool-1"), "session-1");
    assert.equal(findOwningAgentId(tree, "sub-a"), "sub-a");
    assert.equal(findOwningAgentId(tree, "sub-turn"), "sub-a");
    assert.equal(findOwningAgentId(tree, "missing"), null);
  });

  it("collects expandable node ids and level-1 defaults", () => {
    assert.deepEqual(collectExpandableIds(tree), [
      "session-1",
      "turn-1",
      "tool-1",
      "sub-a",
      "sub-turn",
    ]);
    assert.deepEqual(collectExpandableIdsBelowDepth(tree, 1), ["session-1"]);
  });

  it("collects every tool_call across a root-only tree", () => {
    const rootOnly = node({
      id: "root",
      kind: "root_agent",
      agentId: "root",
      label: "Root agent",
      children: [
        node({
          id: "turn-a",
          kind: "assistant_message",
          children: [
            node({
              id: "call-a",
              kind: "tool_call",
              toolUseId: "use-a",
              toolName: "Read",
              preview: "reading file",
              timestamp: "2024-01-01T00:00:00Z",
              log: { filePath: "a.jsonl", line: 3, raw: "" },
              context: { addedTokens: 42, contextAfter: null, contextDelta: null },
              children: [
                node({
                  id: "call-a-result",
                  kind: "tool_result",
                  toolUseId: "use-a",
                  preview: "file contents",
                  log: { filePath: "a.jsonl", line: 4, raw: "{}" },
                }),
              ],
            }),
          ],
        }),
      ],
    });

    assert.deepEqual(collectSteps(rootOnly), [
      {
        nodeId: "call-a",
        toolName: "Read",
        agentId: "root",
        agentLabel: "Root agent",
        turnNodeId: "turn-a",
        timestamp: "2024-01-01T00:00:00Z",
        preview: "reading file",
        log: { filePath: "a.jsonl", line: 3, raw: "" },
        addedTokens: 42,
        toolUseId: "use-a",
        resultLog: { filePath: "a.jsonl", line: 4, raw: "{}" },
        resultNodePreview: "file contents",
        subagentId: null,
      },
    ]);
  });

  it("leaves toolUseId null for a synthesized tool_call node id", () => {
    const synthesized = node({
      id: "root",
      kind: "root_agent",
      agentId: "root",
      children: [
        node({
          id: "turn-a",
          kind: "assistant_message",
          children: [
            node({
              id: "turn-a-tool-1",
              kind: "tool_call",
              toolName: "Bash",
            }),
          ],
        }),
      ],
    });

    const [step] = collectSteps(synthesized);
    assert.equal(step!.nodeId, "turn-a-tool-1");
    assert.equal(step!.toolUseId, null);
    assert.equal(step!.resultLog, null);
    assert.equal(step!.resultNodePreview, null);
  });

  it("attributes subagent tool calls to the subagent and its own turns", () => {
    const steps = collectSteps(tree);
    assert.deepEqual(
      steps.map((s) => s.nodeId),
      ["tool-1", "tool-2", "tool-3", "tool-root-read"],
    );

    const [toolOne, toolTwo, toolThree, toolRootRead] = steps;
    assert.equal(toolOne!.agentId, "session-1");
    assert.equal(toolOne!.turnNodeId, "turn-1");
    assert.equal(toolRootRead!.agentId, "session-1");
    assert.equal(toolRootRead!.turnNodeId, "turn-1");

    assert.equal(toolTwo!.agentId, "sub-a");
    assert.equal(toolTwo!.turnNodeId, "sub-turn");
    assert.equal(toolThree!.agentId, "sub-a");
    assert.equal(toolThree!.turnNodeId, "sub-turn");

    // The launching call exposes the subagent it spawned; a plain call does not.
    assert.equal(toolOne!.subagentId, "sub-a");
    assert.equal(toolOne!.toolUseId, "tool-use-1");
    assert.equal(toolRootRead!.subagentId, null);
    assert.equal(toolThree!.subagentId, null);
  });

  it("gives all three tool_call children of one assistant_message the same turnNodeId", () => {
    // The parser now merges every JSONL line of one API response into a
    // single `assistant_message` node keyed by `message.id`, so a real
    // parallel batch is one node with several `tool_call` children — not
    // several one-tool-call assistant nodes.
    const parallelRoot = node({
      id: "root",
      kind: "root_agent",
      agentId: "root",
      label: "Root agent",
      children: [
        node({
          id: "ag1",
          kind: "assistant_message",
          children: [
            node({ id: "call-p1", kind: "tool_call", toolUseId: "use-p1", toolName: "Read" }),
            node({ id: "call-p2", kind: "tool_call", toolUseId: "use-p2", toolName: "Read" }),
            node({ id: "call-p3", kind: "tool_call", toolUseId: "use-p3", toolName: "Read" }),
          ],
        }),
      ],
    });

    const steps = collectSteps(parallelRoot);
    assert.deepEqual(
      steps.map((s) => s.nodeId),
      ["call-p1", "call-p2", "call-p3"],
    );
    assert.deepEqual(steps.map((s) => s.turnNodeId), ["ag1", "ag1", "ag1"]);
  });

  it("returns an empty list when the tree has no tool calls", () => {
    const noTools = node({
      id: "root",
      kind: "root_agent",
      agentId: "root",
      children: [node({ id: "turn-a", kind: "assistant_message" })],
    });
    assert.deepEqual(collectSteps(noTools), []);
  });

  it("resolves a Step's node id to its owning turn's timeline index", () => {
    const steps = collectSteps(tree);
    const points = [
      { nodeId: "turn-1", memberNodeIds: ["turn-1"] },
    ] as ContextTimelinePoint[];

    // A root-level step resolves via its turnNodeId.
    assert.equal(findTimelineIndexForNode(points, steps, "tool-1"), 0);
    // A turn's own node id matches directly, without needing `steps`.
    assert.equal(findTimelineIndexForNode(points, steps, "turn-1"), 0);
    // A node with no matching timeline point (e.g. a subagent's own turn).
    assert.equal(findTimelineIndexForNode(points, steps, "tool-2"), -1);
    assert.equal(findTimelineIndexForNode(points, steps, "missing"), -1);
  });
});
