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
