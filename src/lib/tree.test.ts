import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TreeNode } from "@shared/types";
import {
  findAncestorIds,
  findNode,
  findNodePath,
  findOwningAgentId,
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
    timestamp: null,
    model: null,
    usage: null,
    context: null,
    preview: null,
    log: null,
    agentId: partial.agentId,
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
          children: [
            node({
              id: "sub-a",
              kind: "subagent",
              agentId: "sub-a",
              children: [
                node({ id: "sub-turn", kind: "assistant_message" }),
              ],
            }),
          ],
        }),
      ],
    }),
  ],
});

describe("tree helpers", () => {
  it("finds ancestors and nodes", () => {
    assert.deepEqual(findAncestorIds(tree, "sub-turn"), [
      "session-1",
      "turn-1",
      "tool-1",
      "sub-a",
    ]);
    assert.equal(findNode(tree, "tool-1")?.kind, "tool_call");
    assert.equal(findNode(tree, "missing"), null);
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
    assert.equal(findOwningAgentId(tree, "sub-a"), "sub-a");
    assert.equal(findOwningAgentId(tree, "sub-turn"), "sub-a");
    assert.equal(findOwningAgentId(tree, "missing"), null);
  });
});
