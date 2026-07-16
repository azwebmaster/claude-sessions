import { Box, Stack, Typography } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import type { AgentBreakdownRow } from "@shared/types";
import { formatTokens, totalTokens } from "@shared/types";
import { focusHighlight } from "../theme";
import { EmptyState } from "./ui";

interface Props {
  rows: AgentBreakdownRow[];
  selectedAgentId?: string | null;
  onSelectAgent?: (agentId: string) => void;
}

export function AgentBreakdown({
  rows,
  selectedAgentId = null,
  onSelectAgent,
}: Props) {
  const theme = useTheme();
  const highlight = focusHighlight(theme);
  const selectable = Boolean(onSelectAgent);

  if (rows.length === 0) {
    return <EmptyState>No agents found.</EmptyState>;
  }

  return (
    <Stack spacing={1}>
      {rows.map((row) => {
        const selected = selectedAgentId === row.agentId;
        return (
          <Box
            key={row.agentId}
            component={selectable ? "button" : "div"}
            type={selectable ? "button" : undefined}
            onClick={
              selectable
                ? () => {
                    onSelectAgent?.(row.agentId);
                  }
                : undefined
            }
            aria-pressed={selectable ? selected : undefined}
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
              bgcolor: selected ? highlight.bgcolor : "action.hover",
              border: 1,
              borderColor: selected ? highlight.borderColor : "divider",
              boxShadow: selected ? highlight.boxShadow : "none",
              minWidth: 0,
              width: "100%",
              textAlign: "left",
              font: "inherit",
              color: "inherit",
              cursor: selectable ? "pointer" : "default",
              transition:
                "border-color 150ms ease, background 150ms ease, box-shadow 150ms ease",
              "&:hover": selectable
                ? {
                    borderColor: selected
                      ? highlight.borderColor
                      : "text.secondary",
                    bgcolor: selected
                      ? alpha(theme.palette.warning.main, 0.14)
                      : "action.selected",
                  }
                : undefined,
              "&:focus-visible": selectable
                ? {
                    outline: `2px solid ${theme.palette.warning.main}`,
                    outlineOffset: 2,
                  }
                : undefined,
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ wordBreak: "break-word" }}>
                {row.label}
              </Typography>
              <Typography
                variant="mono"
                color="text.secondary"
                sx={{
                  fontSize: "0.75rem",
                  wordBreak: "break-word",
                  lineHeight: 1.35,
                }}
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
              <Typography variant="mono">
                {formatTokens(totalTokens(row.usage))}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                peak {formatTokens(row.peakContextTokens)}
              </Typography>
            </Box>
          </Box>
        );
      })}
    </Stack>
  );
}
