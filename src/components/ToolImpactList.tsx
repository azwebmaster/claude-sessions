import { Box, LinearProgress, Stack, Typography } from "@mui/material";
import type { ToolImpactRow } from "@shared/types";
import { formatTokens } from "@shared/types";

interface Props {
  rows: ToolImpactRow[];
}

const mono = '"IBM Plex Mono", ui-monospace, monospace';

export function ToolImpactList({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <Typography color="text.secondary" align="center" sx={{ py: 2 }}>
        No tool calls recorded.
      </Typography>
    );
  }

  const max = Math.max(...rows.map((r) => r.totalResultTokens), 1);

  return (
    <Stack spacing={1}>
      {rows.map((row) => (
        <Box
          key={row.toolName}
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
            <Typography sx={{ fontWeight: 600 }}>{row.toolName}</Typography>
            <Typography
              sx={{
                color: "text.secondary",
                fontFamily: mono,
                fontSize: "0.75rem",
              }}
            >
              {row.callCount} calls · avg result {formatTokens(row.avgResultTokens)} ·
              max {formatTokens(row.maxResultTokens)}
            </Typography>
            <LinearProgress
              variant="determinate"
              color="primary"
              value={(row.totalResultTokens / max) * 100}
              sx={{
                mt: 0.75,
                height: 6,
                borderRadius: 1,
              }}
            />
          </Box>
          <Box sx={{ fontFamily: mono, textAlign: "right" }}>
            <Typography sx={{ fontFamily: "inherit" }}>
              {formatTokens(row.totalResultTokens)}
            </Typography>
            <Typography sx={{ color: "text.secondary", fontSize: "0.72rem" }}>
              ≈ result size
            </Typography>
            {row.contextGrowthAttributed > 0 ? (
              <Typography
                sx={{ color: "primary.main", fontSize: "0.72rem", mt: 0.5 }}
              >
                +{formatTokens(row.contextGrowthAttributed)} ctx
              </Typography>
            ) : null}
          </Box>
        </Box>
      ))}
    </Stack>
  );
}
