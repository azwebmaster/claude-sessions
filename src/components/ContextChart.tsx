import { Box, Typography } from "@mui/material";
import type { ContextTimelinePoint } from "@shared/types";
import { formatTokens } from "@shared/types";

interface Props {
  points: ContextTimelinePoint[];
}

export function ContextChart({ points }: Props) {
  if (points.length === 0) {
    return (
      <Typography color="text.secondary" align="center" sx={{ py: 2 }}>
        No assistant usage records in this session.
      </Typography>
    );
  }

  const max = Math.max(...points.map((p) => p.contextTokens), 1);

  return (
    <Box>
      <Box
        role="img"
        aria-label="Context size by turn"
        sx={{
          display: "flex",
          alignItems: "flex-end",
          gap: 0.5,
          minHeight: 140,
          pt: 1,
          px: 0.5,
        }}
      >
        {points.map((p) => (
          <Box
            key={p.turn}
            title={`Turn ${p.turn}: ${formatTokens(p.contextTokens)} context\n${p.label}`}
            sx={{
              flex: 1,
              minWidth: 10,
              height: Math.max(8, (p.contextTokens / max) * 120),
              borderRadius: "6px 6px 2px 2px",
              background: "linear-gradient(180deg, #e07a45, #1f7a5c)",
              position: "relative",
              transition: "transform 160ms ease, filter 160ms ease",
              cursor: "default",
              "&:hover": {
                transform: "translateY(-3px)",
                filter: "brightness(1.05)",
                "& span": { opacity: 1 },
              },
              "& span": {
                position: "absolute",
                inset: "auto 0 100% 0",
                transform: "translateY(-4px)",
                fontSize: "0.62rem",
                fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
                color: "text.secondary",
                textAlign: "center",
                opacity: 0,
                transition: "opacity 120ms ease",
                pointerEvents: "none",
              },
            }}
          >
            <span>{formatTokens(p.contextTokens)}</span>
          </Box>
        ))}
      </Box>
      <Typography
        sx={{
          mt: 1,
          fontSize: "0.72rem",
          color: "text.secondary",
          fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
        }}
      >
        {points.length} turns · peak {formatTokens(max)}
      </Typography>
    </Box>
  );
}
