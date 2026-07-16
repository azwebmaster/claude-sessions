import { Box, Stack, Typography } from "@mui/material";
import type { AgentBreakdownRow } from "@shared/types";
import { formatTokens, totalTokens } from "@shared/types";
import { EmptyState } from "./ui";

interface Props {
  rows: AgentBreakdownRow[];
}

export function AgentBreakdown({ rows }: Props) {
  if (rows.length === 0) {
    return <EmptyState>No agents found.</EmptyState>;
  }

  return (
    <Stack spacing={1}>
      {rows.map((row) => (
        <Box
          key={row.agentId}
          sx={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: 1,
            px: 1.25,
            py: 1,
            borderRadius: 1,
            bgcolor: "action.hover",
            border: 1,
            borderColor: "divider",
          }}
        >
          <Box>
            <Typography variant="subtitle2">{row.label}</Typography>
            <Typography variant="mono" color="text.secondary" sx={{ fontSize: "0.75rem" }}>
              {row.kind.replace("_", " ")}
              {row.model ? ` · ${row.model.replace(/^claude-/, "")}` : ""}
              {" · "}
              {row.toolCallCount} tools · {row.messageCount} msgs
            </Typography>
          </Box>
          <Box sx={{ textAlign: "right" }}>
            <Typography variant="mono">{formatTokens(totalTokens(row.usage))}</Typography>
            <Typography variant="caption" color="text.secondary">
              peak {formatTokens(row.peakContextTokens)}
            </Typography>
          </Box>
        </Box>
      ))}
    </Stack>
  );
}
