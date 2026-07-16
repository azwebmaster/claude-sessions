import type { TreeNode } from "@shared/types";

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
