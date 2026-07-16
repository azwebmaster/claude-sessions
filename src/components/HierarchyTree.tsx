import { useState } from "react";
import { Box, Chip, Collapse, Typography } from "@mui/material";
import type { TreeNode, TreeNodeKind } from "@shared/types";
import { formatTokens, totalTokens } from "@shared/types";
import { kindLabel } from "../lib/api";

interface Props {
  node: TreeNode;
  depth?: number;
  defaultOpen?: boolean;
}

const kindColors: Record<TreeNodeKind, { bg: string; color: string }> = {
  root_agent: { bg: "rgba(25, 118, 210, 0.12)", color: "#1565c0" },
  subagent: { bg: "rgba(156, 39, 176, 0.12)", color: "#7b1fa2" },
  tool_call: { bg: "rgba(2, 136, 209, 0.12)", color: "#0277bd" },
  tool_result: { bg: "rgba(237, 108, 2, 0.12)", color: "#ef6c00" },
  assistant_message: { bg: "rgba(25, 118, 210, 0.12)", color: "#1976d2" },
  user_message: { bg: "rgba(0, 0, 0, 0.06)", color: "#616161" },
  thinking: { bg: "rgba(0, 0, 0, 0.06)", color: "#616161" },
  system: { bg: "rgba(0, 0, 0, 0.06)", color: "#616161" },
};

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

  const kindStyle = kindColors[node.kind] ?? kindColors.system;

  return (
    <Box
      sx={{
        border: "1px solid transparent",
        borderRadius: 1,
        bgcolor: open ? "action.selected" : "transparent",
        transition: "border-color 150ms ease, background 150ms ease",
        "&:hover": {
          borderColor: "divider",
          bgcolor: "action.hover",
        },
      }}
    >
      <Box
        component="button"
        type="button"
        onClick={() => hasChildren && setOpen((v) => !v)}
        aria-expanded={hasChildren ? open : undefined}
        sx={{
          display: "grid",
          gridTemplateColumns: "auto 1fr auto",
          gap: 1,
          alignItems: "start",
          width: "100%",
          border: 0,
          bgcolor: "transparent",
          textAlign: "left",
          px: 1.25,
          py: 1,
          cursor: hasChildren ? "pointer" : "default",
          color: "inherit",
          font: "inherit",
        }}
      >
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
        <Box>
          <Typography sx={{ fontWeight: 600, fontSize: "0.9rem" }}>
            {hasChildren ? (open ? "▾ " : "▸ ") : ""}
            {node.label}
          </Typography>
          {node.preview ? (
            <Typography
              sx={{
                mt: 0.25,
                color: "text.secondary",
                fontSize: "0.78rem",
                lineHeight: 1.35,
              }}
            >
              {node.preview}
            </Typography>
          ) : null}
        </Box>
        <Box
          sx={{
            fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
            fontSize: "0.72rem",
            color: "text.secondary",
            textAlign: "right",
            whiteSpace: "nowrap",
          }}
        >
          {usageLabel ? <div>{usageLabel} tok</div> : null}
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
      </Box>
      <Collapse in={open && hasChildren}>
        <Box
          sx={{
            mx: 0.75,
            mb: 0.75,
            ml: 2,
            pl: 1.25,
            borderLeft: 2,
            borderColor: "divider",
            display: "flex",
            flexDirection: "column",
            gap: 0.5,
          }}
        >
          {node.children.map((child) => (
            <HierarchyTree key={child.id} node={child} depth={depth + 1} />
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}
