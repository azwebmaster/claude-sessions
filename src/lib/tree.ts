import type { ContextTimelinePoint, LogLineRef, TreeNode } from "@shared/types";

/** Ids of nodes that have children (can expand/collapse), depth-first. */
export function collectExpandableIds(root: TreeNode): string[] {
  const ids: string[] = [];
  function walk(node: TreeNode): void {
    if (node.children.length === 0) return;
    ids.push(node.id);
    for (const child of node.children) walk(child);
  }
  walk(root);
  return ids;
}

/**
 * Expandable node ids at depth strictly less than `maxDepth`.
 * Depth 0 is the root. E.g. maxDepth 1 yields only the root when it has children.
 */
export function collectExpandableIdsBelowDepth(
  root: TreeNode,
  maxDepth: number,
): string[] {
  const ids: string[] = [];
  function walk(node: TreeNode, depth: number): void {
    if (node.children.length === 0) return;
    if (depth < maxDepth) ids.push(node.id);
    for (const child of node.children) walk(child, depth + 1);
  }
  walk(root, 0);
  return ids;
}

/** Ancestor ids from root down to (but not including) the target node. */
export function findAncestorIds(
  root: TreeNode,
  targetId: string,
): string[] | null {
  if (root.id === targetId) return [];
  for (const child of root.children) {
    const path = findAncestorIds(child, targetId);
    if (path) return [root.id, ...path];
  }
  return null;
}

/** Path from root to the target node (inclusive), or null if not found. */
export function findNodePath(
  root: TreeNode,
  targetId: string,
): TreeNode[] | null {
  if (root.id === targetId) return [root];
  for (const child of root.children) {
    const path = findNodePath(child, targetId);
    if (path) return [root, ...path];
  }
  return null;
}

/**
 * Nearest agent node id owning `nodeId` (the node itself when it is an agent,
 * otherwise the closest root_agent / subagent ancestor).
 */
export function findOwningAgentId(
  root: TreeNode,
  nodeId: string,
): string | null {
  const path = findNodePath(root, nodeId);
  if (!path) return null;
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const node = path[i]!;
    if (node.kind === "root_agent" || node.kind === "subagent") {
      return node.agentId ?? node.id;
    }
  }
  return null;
}

/** A single `tool_call` node flattened out of the tree, with its owning
 * agent/turn resolved during descent (see `collectSteps`). */
export interface StepEntry {
  nodeId: string;
  toolName: string;
  agentId: string;
  agentLabel: string;
  /** Id of the enclosing `assistant_message` (turn) node, for grouping. */
  turnNodeId: string | null;
  timestamp: string | null;
  preview: string | null;
  log: LogLineRef | null;
  addedTokens: number;
  /**
   * The `tool_use` block's own id, when the transcript supplied one. Null for
   * a synthesized `${assistant}-tool-N` node id; `nodeId` always exists, so
   * that is what URLs carry.
   */
  toolUseId: string | null;
  /**
   * JSONL line of this call's `tool_result` child — the user entry holding the
   * complete result text, not the `TOOL_RESULT_PREVIEW_CAP`-capped
   * `ToolImpactCall.resultPreview`.
   */
  resultLog: LogLineRef | null;
  /** The `tool_result` child node's own preview, independent of `toolImpact`. */
  resultNodePreview: string | null;
  /** agentId of a `subagent` child (a Task launch), for drill-in. */
  subagentId: string | null;
}

/**
 * Every `tool_call` node in the tree, depth-first, subagents included.
 * A subagent's own turns/steps are attributed to the subagent (not the
 * turn that launched it) — the owning turn resets on entering `subagent`.
 */
export function collectSteps(root: TreeNode): StepEntry[] {
  const steps: StepEntry[] = [];

  function walk(
    node: TreeNode,
    agentId: string,
    agentLabel: string,
    turnNodeId: string | null,
  ): void {
    let nextAgentId = agentId;
    let nextAgentLabel = agentLabel;
    let nextTurnNodeId = turnNodeId;

    if (node.kind === "root_agent" || node.kind === "subagent") {
      nextAgentId = node.agentId ?? node.id;
      nextAgentLabel = node.label;
      nextTurnNodeId = null;
    } else if (node.kind === "assistant_message") {
      nextTurnNodeId = node.id;
    } else if (node.kind === "tool_call") {
      const result = node.children.find((c) => c.kind === "tool_result");
      const subagent = node.children.find((c) => c.kind === "subagent");
      steps.push({
        nodeId: node.id,
        toolName: node.toolName ?? "tool",
        agentId,
        agentLabel,
        turnNodeId,
        timestamp: node.timestamp,
        preview: node.preview,
        log: node.log,
        addedTokens: node.context?.addedTokens ?? 0,
        toolUseId: node.toolUseId ?? null,
        resultLog: result?.log ?? null,
        resultNodePreview: result?.preview ?? null,
        subagentId: subagent ? (subagent.agentId ?? subagent.id) : null,
      });
    }

    for (const child of node.children) {
      walk(child, nextAgentId, nextAgentLabel, nextTurnNodeId);
    }
  }

  walk(root, "", "", null);
  return steps;
}

/**
 * Resolve a focused node id to its index in `points`. A Step's `tool_call`
 * node id never matches a timeline point directly — it's resolved to its
 * owning turn (via `steps`) first, so a Step click focuses the same turn as
 * clicking that turn directly.
 */
export function findTimelineIndexForNode(
  points: ContextTimelinePoint[],
  steps: StepEntry[],
  nodeId: string,
): number {
  const step = steps.find((s) => s.nodeId === nodeId);
  const turnNodeId = step?.turnNodeId ?? nodeId;
  return points.findIndex(
    (p) => p.nodeId === turnNodeId || p.memberNodeIds.includes(turnNodeId),
  );
}
