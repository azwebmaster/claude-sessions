import { useState } from "react";
import type { TreeNode } from "@shared/types";
import { formatTokens, totalTokens } from "@shared/types";
import { kindLabel } from "../lib/api";

interface Props {
  node: TreeNode;
  depth?: number;
  defaultOpen?: boolean;
}

export function HierarchyTree({ node, depth = 0, defaultOpen }: Props) {
  const hasChildren = node.children.length > 0;
  const [open, setOpen] = useState(
    defaultOpen ?? (depth < 2 || node.kind === "subagent" || node.kind === "tool_call"),
  );

  const usageLabel =
    node.usage && totalTokens(node.usage) > 0
      ? formatTokens(totalTokens(node.usage))
      : null;

  const contextLabel = node.context
    ? node.context.contextAfter != null
      ? `ctx ${formatTokens(node.context.contextAfter)}`
      : node.context.addedTokens > 0
        ? `+${formatTokens(node.context.addedTokens)}`
        : null
    : null;

  const delta = node.context?.contextDelta;
  const deltaLabel =
    delta == null || delta === 0
      ? null
      : delta > 0
        ? `↑${formatTokens(delta)}`
        : `↓${formatTokens(Math.abs(delta))}`;

  return (
    <div className={`tree-node ${open ? "is-open" : ""}`}>
      <button
        type="button"
        className="tree-row"
        onClick={() => hasChildren && setOpen((v) => !v)}
        aria-expanded={hasChildren ? open : undefined}
      >
        <span className={`kind-badge ${node.kind}`}>{kindLabel(node.kind)}</span>
        <span>
          <div className="tree-label">
            {hasChildren ? (open ? "▾ " : "▸ ") : ""}
            {node.label}
          </div>
          {node.preview ? <div className="tree-preview">{node.preview}</div> : null}
        </span>
        <span className="tree-meta">
          {usageLabel ? <div>{usageLabel} tok</div> : null}
          {contextLabel ? <div>{contextLabel}</div> : null}
          {deltaLabel ? (
            <div className={delta && delta > 0 ? "delta-up" : "delta-down"}>
              {deltaLabel}
            </div>
          ) : null}
        </span>
      </button>
      {open && hasChildren ? (
        <div className="tree-children">
          {node.children.map((child) => (
            <HierarchyTree key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
