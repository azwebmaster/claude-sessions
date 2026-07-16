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
            gridTemplateColumns: {
              xs: "minmax(0, 1fr)",
              sm: "minmax(0, 1fr) auto",
            },
            gap: { xs: 0.5, sm: 1 },
            px: { xs: 1, sm: 1.25 },
            py: 1,
            borderRadius: 1,
            bgcolor: "action.hover",
            border: 1,
            borderColor: "divider",
            minWidth: 0,
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ wordBreak: "break-word" }}>
              {row.label}
            </Typography>
            <Typography
              variant="mono"
              color="text.secondary"
              sx={{ fontSize: "0.75rem", wordBreak: "break-word", lineHeight: 1.35 }}
            >
              {row.kind.replace("_", " ")}
              {row.model ? ` · ${row.model.replace(/^claude-/, "")}` : ""}
              {" · "}
              {row.toolCallCount} tools · {row.messageCount} msgs
            </Typography>
          </Box>
          <Box
            sx={{
              textAlign: { xs: "left", sm: "right" },
              display: "flex",
              flexDirection: { xs: "row", sm: "column" },
              flexWrap: "wrap",
              alignItems: { xs: "baseline", sm: "flex-end" },
              gap: { xs: 1, sm: 0 },
            }}
          >
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
