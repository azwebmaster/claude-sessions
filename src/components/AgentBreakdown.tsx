import { Box, Stack, Typography } from "@mui/material";
import type { AgentBreakdownRow } from "@shared/types";
import { formatTokens, totalTokens } from "@shared/types";

interface Props {
  rows: AgentBreakdownRow[];
}

const mono = '"IBM Plex Mono", ui-monospace, monospace';

export function AgentBreakdown({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <Typography color="text.secondary" align="center" sx={{ py: 2 }}>
        No agents found.
      </Typography>
    );
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
            <Typography sx={{ fontWeight: 600 }}>{row.label}</Typography>
            <Typography
              sx={{
                color: "text.secondary",
                fontFamily: mono,
                fontSize: "0.75rem",
              }}
            >
              {row.kind.replace("_", " ")}
              {row.model ? ` · ${row.model.replace(/^claude-/, "")}` : ""}
              {" · "}
              {row.toolCallCount} tools · {row.messageCount} msgs
            </Typography>
          </Box>
          <Box sx={{ fontFamily: mono, textAlign: "right" }}>
            <Typography sx={{ fontFamily: "inherit" }}>
              {formatTokens(totalTokens(row.usage))}
            </Typography>
            <Typography sx={{ color: "text.secondary", fontSize: "0.72rem" }}>
              peak {formatTokens(row.peakContextTokens)}
            </Typography>
          </Box>
        </Box>
      ))}
    </Stack>
  );
}
