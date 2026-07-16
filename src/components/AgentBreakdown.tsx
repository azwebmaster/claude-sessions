import { Box, Chip, LinearProgress, Stack, Typography } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import type { AgentBreakdownRow } from "@shared/types";
import { formatTokens, totalTokens } from "@shared/types";
import { focusHighlight, usagePartColors } from "../theme";
import { EmptyState } from "./ui";

interface Props {
  rows: AgentBreakdownRow[];
  selectedAgentId?: string | null;
  onSelectAgent?: (agentId: string) => void;
}

const TOP_TOOLS = 5;

function MetricBar({
  label,
  valueLabel,
  percent,
  color,
}: {
  label: string;
  valueLabel: string;
  percent: number;
  color: string;
}) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          gap: 1,
          mb: 0.35,
          alignItems: "baseline",
        }}
      >
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Typography
          variant="mono"
          sx={{ fontSize: "0.72rem", color: "text.secondary" }}
        >
          {valueLabel}
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={Math.max(2, Math.min(100, percent))}
        aria-label={`${label}: ${valueLabel}`}
        sx={{
          height: 7,
          borderRadius: 1,
          bgcolor: alpha(color, 0.14),
          "& .MuiLinearProgress-bar": {
            borderRadius: 1,
            bgcolor: color,
            transition: "transform 220ms ease",
          },
        }}
      />
    </Box>
  );
}

export function AgentBreakdown({
  rows,
  selectedAgentId = null,
  onSelectAgent,
}: Props) {
  const theme = useTheme();
  const highlight = focusHighlight(theme);
  const parts = usagePartColors(theme);
  const selectable = Boolean(onSelectAgent);

  if (rows.length === 0) {
    return <EmptyState>No agents found.</EmptyState>;
  }

  const maxPeak = Math.max(...rows.map((r) => r.peakContextTokens), 1);
  const maxTools = Math.max(...rows.map((r) => r.toolCallCount), 1);
  const maxTurns = Math.max(...rows.map((r) => r.turnCount), 1);
  const totalTools = rows.reduce((sum, r) => sum + r.toolCallCount, 0);
  const totalTurns = rows.reduce((sum, r) => sum + r.turnCount, 0);
  const subagentTurns = rows
    .filter((r) => r.kind === "subagent")
    .reduce((sum, r) => sum + r.turnCount, 0);
  const totalTokensAll = rows.reduce((sum, r) => sum + totalTokens(r.usage), 0);
  const peakOverall = Math.max(...rows.map((r) => r.peakContextTokens), 0);

  const toolTotals = new Map<string, number>();
  for (const row of rows) {
    for (const tool of row.tools ?? []) {
      toolTotals.set(
        tool.toolName,
        (toolTotals.get(tool.toolName) ?? 0) + tool.callCount,
      );
    }
  }
  const topSessionTools = [...toolTotals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_TOOLS);

  return (
    <Stack spacing={1.5}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "repeat(2, minmax(0, 1fr))",
            sm: "repeat(3, minmax(0, 1fr))",
            md: "repeat(5, minmax(0, 1fr))",
          },
          gap: 0.75,
        }}
      >
        {[
          { label: "Agents", value: String(rows.length) },
          {
            label: "Turns",
            value:
              subagentTurns > 0
                ? `${totalTurns} · ${subagentTurns} sub`
                : String(totalTurns),
          },
          { label: "Tool calls", value: String(totalTools) },
          { label: "Peak context", value: formatTokens(peakOverall) },
          { label: "Token usage", value: formatTokens(totalTokensAll) },
        ].map((stat) => (
          <Box
            key={stat.label}
            sx={{
              px: 1,
              py: 0.85,
              borderRadius: 1,
              border: 1,
              borderColor: "divider",
              bgcolor: "action.hover",
              minWidth: 0,
            }}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", lineHeight: 1.2 }}
            >
              {stat.label}
            </Typography>
            <Typography variant="mono" sx={{ fontSize: "0.9rem" }}>
              {stat.value}
            </Typography>
          </Box>
        ))}
      </Box>

      {topSessionTools.length > 0 ? (
        <Box sx={{ minWidth: 0 }}>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mb: 0.6 }}
          >
            Top tools across agents
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            {topSessionTools.map(([name, count]) => (
              <Chip
                key={name}
                size="small"
                label={`${name} · ${count}`}
                variant="outlined"
                sx={{
                  height: 24,
                  fontFamily: theme.typography.mono?.fontFamily,
                  fontSize: "0.7rem",
                }}
              />
            ))}
          </Box>
        </Box>
      ) : null}

      <Stack spacing={1} role="list" aria-label="Agent usage diagram">
        {rows.map((row) => {
          const selected = selectedAgentId === row.agentId;
          const tools = row.tools ?? [];
          const visibleTools = tools.slice(0, TOP_TOOLS);
          const hiddenToolCount = Math.max(0, tools.length - visibleTools.length);

          return (
            <Box
              key={row.agentId}
              component={selectable ? "button" : "div"}
              type={selectable ? "button" : undefined}
              role="listitem"
              onClick={
                selectable
                  ? () => {
                      onSelectAgent?.(row.agentId);
                    }
                  : undefined
              }
              aria-pressed={selectable ? selected : undefined}
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: 1,
                px: { xs: 1, sm: 1.25 },
                py: 1.1,
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
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: {
                    xs: "minmax(0, 1fr)",
                    sm: "minmax(0, 1fr) auto",
                  },
                  gap: { xs: 0.35, sm: 1 },
                  alignItems: "baseline",
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    variant="subtitle2"
                    sx={{ wordBreak: "break-word" }}
                  >
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
                    {row.turnCount} turns
                    {" · "}
                    {row.messageCount} msgs
                  </Typography>
                </Box>
                <Typography
                  variant="mono"
                  color="text.secondary"
                  sx={{ fontSize: "0.75rem" }}
                >
                  {formatTokens(totalTokens(row.usage))} tokens
                </Typography>
              </Box>

              <Stack spacing={0.85}>
                <MetricBar
                  label="Peak context"
                  valueLabel={formatTokens(row.peakContextTokens)}
                  percent={(row.peakContextTokens / maxPeak) * 100}
                  color={parts.cacheRead}
                />
                <MetricBar
                  label="Turns"
                  valueLabel={String(row.turnCount)}
                  percent={(row.turnCount / maxTurns) * 100}
                  color={parts.output}
                />
                <MetricBar
                  label="Tool calls"
                  valueLabel={String(row.toolCallCount)}
                  percent={(row.toolCallCount / maxTools) * 100}
                  color={parts.input}
                />
              </Stack>

              {visibleTools.length > 0 ? (
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                  {visibleTools.map((tool) => (
                    <Chip
                      key={tool.toolName}
                      size="small"
                      label={`${tool.toolName} · ${tool.callCount}`}
                      sx={{
                        height: 22,
                        fontFamily: theme.typography.mono?.fontFamily,
                        fontSize: "0.68rem",
                        bgcolor: alpha(theme.palette.info.main, 0.1),
                        color: "text.primary",
                        border: 0,
                      }}
                    />
                  ))}
                  {hiddenToolCount > 0 ? (
                    <Chip
                      size="small"
                      label={`+${hiddenToolCount} more`}
                      variant="outlined"
                      sx={{
                        height: 22,
                        fontSize: "0.68rem",
                      }}
                    />
                  ) : null}
                </Box>
              ) : (
                <Typography variant="caption" color="text.secondary">
                  No tool calls
                </Typography>
              )}
            </Box>
          );
        })}
      </Stack>
    </Stack>
  );
}
