import { useEffect, useRef, useState } from "react";
import { alpha, useTheme } from "@mui/material/styles";
import { Box, Chip, Collapse, Typography } from "@mui/material";
import type { TokenUsage, TreeNode } from "@shared/types";
import { formatTokens, totalTokens } from "@shared/types";
import { kindLabel } from "../lib/api";
import { focusHighlight, nodeKindStyle } from "../theme";
import { ExpandableRow } from "./ui";

interface Props {
  node: TreeNode;
  depth?: number;
  defaultOpen?: boolean;
  focusedNodeId?: string | null;
  forceOpenIds?: ReadonlySet<string>;
  onFocusNode?: (nodeId: string) => void;
}

function usageParts(u: TokenUsage): string | null {
  const parts: string[] = [];
  if (u.inputTokens > 0) parts.push(`in ${formatTokens(u.inputTokens)}`);
  if (u.cacheCreationInputTokens > 0) {
    parts.push(`cache+ ${formatTokens(u.cacheCreationInputTokens)}`);
  }
  if (u.cacheReadInputTokens > 0) {
    parts.push(`cache ${formatTokens(u.cacheReadInputTokens)}`);
  }
  if (u.outputTokens > 0) parts.push(`out ${formatTokens(u.outputTokens)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function metricsTitle(node: TreeNode): string | undefined {
  if (node.usage && totalTokens(node.usage) > 0) {
    const parts = usageParts(node.usage);
    return [
      "API usage for this turn (not a sum of child +N chips).",
      "ctx = window occupancy from input + cache tokens.",
      "Child +N values are estimated tool I/O sizes only.",
      parts ? `Breakdown: ${parts}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (node.context && node.context.addedTokens > 0 && node.context.contextAfter == null) {
    return "Estimated tokens for this tool input/result (~4 chars per token). Not the same as assistant ctx occupancy.";
  }
  return undefined;
}

export function HierarchyTree({
  node,
  depth = 0,
  defaultOpen,
  focusedNodeId = null,
  forceOpenIds,
  onFocusNode,
}: Props) {
  const theme = useTheme();
  const hasChildren = node.children.length > 0;
  const isFocused = focusedNodeId === node.id;
  const mustOpen = Boolean(forceOpenIds?.has(node.id));
  const [open, setOpen] = useState(
    defaultOpen ??
      (mustOpen ||
        depth < 2 ||
        node.kind === "subagent" ||
        node.kind === "tool_call"),
  );
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mustOpen && hasChildren) setOpen(true);
  }, [mustOpen, hasChildren, focusedNodeId]);

  useEffect(() => {
    if (!isFocused || !rowRef.current) return;
    rowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [isFocused, focusedNodeId]);

  const hasUsage = Boolean(node.usage && totalTokens(node.usage) > 0);
  const usageLabel = hasUsage
    ? `${formatTokens(totalTokens(node.usage!))} tok`
    : null;
  const breakdownLabel =
    hasUsage && node.usage ? usageParts(node.usage) : null;

  const contextLabel = node.context
    ? node.context.contextAfter != null
      ? node.kind === "assistant_message" &&
        node.context.contextDelta == null
        ? `ctx ${formatTokens(node.context.contextAfter)} baseline`
        : `ctx ${formatTokens(node.context.contextAfter)}`
      : node.context.addedTokens > 0
        ? `+${formatTokens(node.context.addedTokens)} est`
        : null
    : null;

  const delta = node.context?.contextDelta;
  const deltaLabel =
    delta == null || delta === 0
      ? null
      : delta > 0
        ? `↑${formatTokens(delta)} vs prior`
        : `↓${formatTokens(Math.abs(delta))} vs prior`;

  const kindStyle = nodeKindStyle(theme, node.kind);
  const highlight = focusHighlight(theme);
  const title = metricsTitle(node);

  return (
    <Box
      ref={rowRef}
      data-node-id={node.id}
      sx={{
        border: isFocused ? "1px solid" : "1px solid transparent",
        borderColor: isFocused ? highlight.borderColor : "transparent",
        borderRadius: 1,
        bgcolor: isFocused
          ? highlight.bgcolor
          : open
            ? "action.selected"
            : "transparent",
        boxShadow: isFocused ? highlight.boxShadow : "none",
        transition: "border-color 150ms ease, background 150ms ease, box-shadow 150ms ease",
        minWidth: 0,
        maxWidth: "100%",
        "&:hover": {
          borderColor: isFocused ? highlight.borderColor : "divider",
          bgcolor: isFocused
            ? alpha(theme.palette.warning.main, 0.14)
            : "action.hover",
        },
      }}
    >
      <ExpandableRow
        expanded={hasChildren ? open : undefined}
        focused={isFocused}
        onActivate={() => {
          onFocusNode?.(node.id);
        }}
        onToggleExpand={
          hasChildren
            ? () => {
                setOpen((v) => !v);
              }
            : undefined
        }
        leading={
          <Chip
            size="small"
            label={kindLabel(node.kind)}
            sx={{
              height: 22,
              fontSize: "0.65rem",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              bgcolor: kindStyle.bg,
              color: kindStyle.color,
              borderRadius: 0.75,
              "& .MuiChip-label": { px: 0.75 },
            }}
          />
        }
        body={
          <Box>
            <Typography variant="subtitle2" sx={{ fontSize: { xs: "0.85rem", sm: "0.9rem" }, wordBreak: "break-word" }}>
              {node.label}
            </Typography>
            {node.preview ? (
              <Typography
                color="text.secondary"
                sx={{
                  mt: 0.25,
                  fontSize: "0.78rem",
                  lineHeight: 1.35,
                  wordBreak: "break-word",
                  display: "-webkit-box",
                  WebkitLineClamp: { xs: 3, sm: 4 },
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {node.preview}
              </Typography>
            ) : null}
          </Box>
        }
        trailing={
          <Box
            title={title}
            sx={{
              fontFamily: theme.typography.mono?.fontFamily,
              fontSize: "0.72rem",
              color: "text.secondary",
              textAlign: { xs: "left", sm: "right" },
              whiteSpace: { xs: "normal", sm: "nowrap" },
              maxWidth: { xs: "100%", sm: "14rem" },
            }}
          >
            {usageLabel ? <div>{usageLabel}</div> : null}
            {breakdownLabel ? (
              <Box
                component="div"
                sx={{
                  color: "text.disabled",
                  fontSize: "0.65rem",
                  whiteSpace: "normal",
                  lineHeight: 1.3,
                }}
              >
                {breakdownLabel}
              </Box>
            ) : null}
            {contextLabel ? <div>{contextLabel}</div> : null}
            {deltaLabel ? (
              <Box
                component="div"
                sx={{ color: delta && delta > 0 ? "error.main" : "success.main" }}
              >
                {deltaLabel}
              </Box>
            ) : null}
          </Box>
        }
        sx={{ "&:hover": { bgcolor: "transparent" } }}
      />
      <Collapse in={open && hasChildren}>
        <Box
          sx={{
            mx: { xs: 0.25, sm: 0.75 },
            mb: 0.75,
            ml: { xs: 0.75, sm: 2 },
            pl: { xs: 0.75, sm: 1.25 },
            borderLeft: 2,
            borderColor: "divider",
            display: "flex",
            flexDirection: "column",
            gap: 0.5,
            minWidth: 0,
          }}
        >
          {node.children.map((child) => (
            <HierarchyTree
              key={child.id}
              node={child}
              depth={depth + 1}
              focusedNodeId={focusedNodeId}
              forceOpenIds={forceOpenIds}
              onFocusNode={onFocusNode}
            />
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}
