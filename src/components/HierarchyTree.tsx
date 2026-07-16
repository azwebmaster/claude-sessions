import { useEffect, useMemo, useState } from "react";
import { alpha, useTheme } from "@mui/material/styles";
import { Box, Button, Chip, Collapse, Stack, Typography } from "@mui/material";
import UnfoldLessIcon from "@mui/icons-material/UnfoldLess";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import type { TokenUsage, TreeNode } from "@shared/types";
import { formatTokens, totalTokens } from "@shared/types";
import { kindLabel } from "../lib/api";
import {
  collectExpandableIds,
  collectExpandableIdsBelowDepth,
} from "../lib/tree";
import { focusHighlight, nodeKindStyle } from "../theme";
import { ExpandableRow } from "./ui";

/** Open only the root by default (collapse everything below level 1). */
const DEFAULT_OPEN_MAX_DEPTH = 1;

interface Props {
  node: TreeNode;
  focusedNodeId?: string | null;
  forceOpenIds?: ReadonlySet<string>;
  /** When true, scroll the focused node into view after expand/focus updates. */
  scrollFocusedIntoView?: boolean;
  onFocusNode?: (nodeId: string) => void;
  onViewLog?: (node: TreeNode) => void;
}

interface NodeProps {
  node: TreeNode;
  openIds: ReadonlySet<string>;
  onToggleOpen: (nodeId: string) => void;
  focusedNodeId: string | null;
  onFocusNode?: (nodeId: string) => void;
  onViewLog?: (node: TreeNode) => void;
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

function HierarchyTreeNode({
  node,
  openIds,
  onToggleOpen,
  focusedNodeId,
  onFocusNode,
  onViewLog,
}: NodeProps) {
  const theme = useTheme();
  const hasChildren = node.children.length > 0;
  const isFocused = focusedNodeId === node.id;
  const open = hasChildren && openIds.has(node.id);

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
                onToggleOpen(node.id);
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
      {isFocused && node.log && onViewLog ? (
        <Box
          sx={{
            display: "flex",
            justifyContent: "flex-start",
            pl: hasChildren ? { xs: 4.25, sm: 4.75 } : { xs: 1, sm: 1.25 },
            pr: { xs: 0.5, sm: 0.75 },
            pb: 0.75,
          }}
        >
          <Button
            size="small"
            variant="outlined"
            onClick={() => {
              onViewLog(node);
            }}
            sx={{ fontSize: "0.72rem", py: 0.15, px: 1 }}
          >
            View transcript line
          </Button>
        </Box>
      ) : null}
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
            <HierarchyTreeNode
              key={child.id}
              node={child}
              openIds={openIds}
              onToggleOpen={onToggleOpen}
              focusedNodeId={focusedNodeId}
              onFocusNode={onFocusNode}
              onViewLog={onViewLog}
            />
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}

export function HierarchyTree({
  node,
  focusedNodeId = null,
  forceOpenIds,
  scrollFocusedIntoView = false,
  onFocusNode,
  onViewLog,
}: Props) {
  const allExpandableIds = useMemo(() => collectExpandableIds(node), [node]);
  const defaultOpenIds = useMemo(
    () => collectExpandableIdsBelowDepth(node, DEFAULT_OPEN_MAX_DEPTH),
    [node],
  );
  const [openIds, setOpenIds] = useState(() => new Set(defaultOpenIds));

  useEffect(() => {
    setOpenIds(new Set(defaultOpenIds));
  }, [defaultOpenIds]);

  useEffect(() => {
    if (!forceOpenIds || forceOpenIds.size === 0) return;
    setOpenIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of forceOpenIds) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [forceOpenIds, focusedNodeId]);

  useEffect(() => {
    if (!scrollFocusedIntoView || !focusedNodeId) return;
    const frame = window.requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-node-id="${CSS.escape(focusedNodeId)}"]`,
      );
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedNodeId, forceOpenIds, scrollFocusedIntoView]);

  const expandAll = () => {
    setOpenIds(new Set(allExpandableIds));
  };

  const collapseAll = () => {
    setOpenIds(new Set());
  };

  const toggleOpen = (nodeId: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, minWidth: 0 }}>
      <Stack
        direction="row"
        spacing={0.5}
        sx={{
          justifyContent: "flex-end",
          flexWrap: "wrap",
          rowGap: 0.5,
        }}
      >
        <Button
          size="small"
          color="inherit"
          aria-label="Expand all hierarchy nodes"
          onClick={expandAll}
          startIcon={<UnfoldMoreIcon fontSize="small" />}
          sx={{
            textTransform: "none",
            fontSize: "0.72rem",
            px: 1,
            minWidth: 0,
            color: "text.secondary",
          }}
        >
          Expand all
        </Button>
        <Button
          size="small"
          color="inherit"
          aria-label="Collapse all hierarchy nodes"
          onClick={collapseAll}
          startIcon={<UnfoldLessIcon fontSize="small" />}
          sx={{
            textTransform: "none",
            fontSize: "0.72rem",
            px: 1,
            minWidth: 0,
            color: "text.secondary",
          }}
        >
          Collapse all
        </Button>
      </Stack>
      <HierarchyTreeNode
        node={node}
        openIds={openIds}
        onToggleOpen={toggleOpen}
        focusedNodeId={focusedNodeId}
        onFocusNode={onFocusNode}
        onViewLog={onViewLog}
      />
    </Box>
  );
}
