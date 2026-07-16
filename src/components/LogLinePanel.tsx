import { Box, Typography } from "@mui/material";
import type { LogLineRef } from "@shared/types";

const mono = '"IBM Plex Mono", ui-monospace, monospace';

interface Props {
  log: LogLineRef | null | undefined;
}

function prettyRaw(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function LogLinePanel({ log }: Props) {
  if (!log) {
    return (
      <Box
        sx={{
          mt: 2,
          p: 1.5,
          borderRadius: 1.5,
          border: 1,
          borderColor: "divider",
          bgcolor: "action.hover",
        }}
      >
        <Typography color="text.secondary" sx={{ fontSize: "0.85rem" }}>
          No JSONL source line for this selection.
        </Typography>
      </Box>
    );
  }

  const pretty = prettyRaw(log.raw);

  return (
    <Box
      sx={{
        mt: 2,
        borderRadius: 1.5,
        border: 1,
        borderColor: "divider",
        overflow: "hidden",
        bgcolor: "background.paper",
      }}
    >
      <Box
        sx={{
          px: 1.5,
          py: 1,
          borderBottom: 1,
          borderColor: "divider",
          bgcolor: "action.hover",
          display: "flex",
          flexDirection: "column",
          gap: 0.35,
        }}
      >
        <Typography sx={{ fontWeight: 650, fontSize: "0.85rem" }}>
          Transcript log line
        </Typography>
        <Typography
          sx={{
            fontFamily: mono,
            fontSize: "0.72rem",
            color: "text.secondary",
            wordBreak: "break-all",
            lineHeight: 1.35,
          }}
          title={`${log.filePath}:${log.line}`}
        >
          {log.filePath}:{log.line}
        </Typography>
      </Box>
      <Box
        component="pre"
        sx={{
          m: 0,
          px: 1.5,
          py: 1.25,
          maxHeight: 320,
          overflow: "auto",
          fontFamily: mono,
          fontSize: "0.72rem",
          lineHeight: 1.45,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          color: "text.primary",
        }}
      >
        {pretty}
      </Box>
    </Box>
  );
}
