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
  root_agent: { bg: "rgba(31, 122, 92, 0.15)", color: "#1f7a5c" },
  subagent: { bg: "rgba(107, 63, 160, 0.12)", color: "#6b3fa0" },
  tool_call: { bg: "rgba(43, 95, 138, 0.12)", color: "#2b5f8a" },
  tool_result: { bg: "rgba(183, 121, 31, 0.12)", color: "#b7791f" },
  assistant_message: { bg: "rgba(196, 92, 38, 0.12)", color: "#c45c26" },
  user_message: { bg: "rgba(16, 32, 24, 0.08)", color: "#3d5a4c" },
  thinking: { bg: "rgba(16, 32, 24, 0.08)", color: "#3d5a4c" },
  system: { bg: "rgba(16, 32, 24, 0.08)", color: "#3d5a4c" },
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
        borderRadius: 1.25,
        bgcolor: open ? "rgba(255, 255, 255, 0.72)" : "rgba(255, 255, 255, 0.45)",
        transition: "border-color 150ms ease, background 150ms ease",
        "&:hover": {
          borderColor: "rgba(196, 92, 38, 0.25)",
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
              sx={{ color: delta && delta > 0 ? "primary.main" : "secondary.main" }}
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
            borderLeft: "2px solid rgba(16, 32, 24, 0.1)",
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
