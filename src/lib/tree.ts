import type { TreeNode } from "@shared/types";

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

export function findNode(
  root: TreeNode,
  targetId: string,
): TreeNode | null {
  if (root.id === targetId) return root;
  for (const child of root.children) {
    const found = findNode(child, targetId);
    if (found) return found;
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

/**
 * Hierarchy node id for a tool invocation, matching `toolUseId` or the node id
 * itself when they coincide.
 */
export function findToolCallNodeId(
  root: TreeNode,
  toolUseId: string,
): string | null {
  if (
    root.kind === "tool_call" &&
    (root.toolUseId === toolUseId || root.id === toolUseId)
  ) {
    return root.id;
  }
  for (const child of root.children) {
    const found = findToolCallNodeId(child, toolUseId);
    if (found) return found;
  }
  return null;
}

/**
 * First tool_call node id whose `toolName` matches.
 * When `agentId` is set, search only that agent's own turns — nested
 * subagent trees are skipped so parent agents are not attributed child tools.
 */
export function findFirstToolCallByName(
  root: TreeNode,
  toolName: string,
  agentId?: string | null,
): string | null {
  if (agentId != null && agentId !== "") {
    const scope = findAgentSubtree(root, agentId);
    if (!scope) return null;
    return findFirstToolCallByNameIn(scope, toolName, true);
  }
  return findFirstToolCallByNameIn(root, toolName, false);
}

function findAgentSubtree(
  root: TreeNode,
  agentId: string,
): TreeNode | null {
  if (
    (root.kind === "root_agent" || root.kind === "subagent") &&
    (root.agentId === agentId || root.id === agentId)
  ) {
    return root;
  }
  for (const child of root.children) {
    const found = findAgentSubtree(child, agentId);
    if (found) return found;
  }
  return null;
}

function findFirstToolCallByNameIn(
  root: TreeNode,
  toolName: string,
  skipNestedAgents: boolean,
): string | null {
  if (root.kind === "tool_call" && root.toolName === toolName) {
    return root.id;
  }
  for (const child of root.children) {
    if (
      skipNestedAgents &&
      (child.kind === "subagent" || child.kind === "root_agent")
    ) {
      continue;
    }
    const found = findFirstToolCallByNameIn(
      child,
      toolName,
      skipNestedAgents,
    );
    if (found) return found;
  }
  return null;
}
