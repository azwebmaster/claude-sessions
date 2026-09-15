import { useMemo, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { Box, Chip, Link, Stack, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import type { ToolImpactCall, ToolImpactRow } from "@shared/types";
import { formatTokens } from "@shared/types";
import { formatDurationMs } from "../../lib/contextUsageParts";
import { sessionTurnPath } from "../../lib/sessionSelection";
import type { SessionWorkspaceIndex } from "../../lib/turnSteps";
import { chartBarColors, schemeAlpha, schemePalette } from "../../theme";
import { EmptyState, ExpandableRow, TaggedText } from "../ui";

/** Calls listed per expanded tool. `row.calls` is sorted largest-growth-first. */
const CALLS_SHOWN = 10;

interface Props {
  rows: ToolImpactRow[];
  index: SessionWorkspaceIndex;
  sessionId: string;
  /** Explicit `?watch=` choice, carried into every call's link. */
  watch: boolean | null;
}

interface CallTarget {
  agentId: string;
  turn: number;
  nodeId: string;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: "baseline" }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="mono" sx={{ fontSize: "0.75rem" }}>
        {value}
      </Typography>
    </Stack>
  );
}

/**
 * A call is in flight (or its result was never captured) while `resultApplied`
 * is false — its `resultTokens`/`durationMs` are absent, not zero, so neither is
 * rendered as a measurement. A recorded result with a null `durationMs` means
 * the timestamps did not yield a usable delta.
 */
function CallMetrics({ call }: { call: ToolImpactCall }) {
  if (!call.resultApplied) {
    return (
      <Typography variant="caption" color="text.secondary">
        no result recorded (in flight or not captured)
      </Typography>
    );
  }
  return (
    <Stack
      direction="row"
      spacing={1}
      useFlexGap
      sx={{ flexWrap: "wrap", alignItems: "baseline" }}
    >
      <Typography variant="mono" sx={{ fontSize: "0.75rem" }}>
        {formatTokens(call.resultTokens)} tok
      </Typography>
      {call.durationMs == null ? (
        <Typography
          variant="mono"
          color="text.secondary"
          sx={{ fontSize: "0.75rem" }}
          title="Result arrived, but its timestamps did not yield a usable duration"
        >
          —
        </Typography>
      ) : (
        <Typography
          variant="mono"
          color="text.secondary"
          sx={{ fontSize: "0.75rem" }}
        >
          {formatDurationMs(call.durationMs)}
        </Typography>
      )}
      {call.contextGrowthAttributed > 0 ? (
        <Typography
          variant="mono"
          color="text.secondary"
          sx={{ fontSize: "0.75rem" }}
        >
          +{formatTokens(call.contextGrowthAttributed)} ctx
        </Typography>
      ) : null}
    </Stack>
  );
}

/**
 * Session-wide tool ranking that routes into the turn rail: expanding a tool
 * lists its heaviest calls, and each one links to the turn that issued it with
 * `?step=` pointing at that call's step. It deliberately shows no result text —
 * the step row in the rail is the one place a result is read.
 */
export function ToolLeaderboard({ rows, index, sessionId, watch }: Props) {
  const theme = useTheme();
  const [openTool, setOpenTool] = useState<string | null>(null);

  // One pass over the step index instead of a scan per rendered call.
  const targetByToolUseId = useMemo(() => {
    const map = new Map<string, CallTarget>();
    for (const [nodeId, entry] of index.stepByNodeId) {
      const toolUseId = entry.step.toolUseId;
      if (!toolUseId || entry.turn == null) continue;
      if (map.has(toolUseId)) continue;
      map.set(toolUseId, { agentId: entry.agentId, turn: entry.turn, nodeId });
    }
    return map;
  }, [index]);

  if (rows.length === 0) {
    return <EmptyState>No tool calls recorded in this session.</EmptyState>;
  }

  // Rows arrive sorted by `contextGrowthAttributed` descending, so the first
  // row is the scale for every share bar.
  const maxGrowth = Math.max(rows[0]!.contextGrowthAttributed, 1);
  const bars = chartBarColors(theme);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      {rows.map((row) => {
        const expanded = openTool === row.toolName;
        const percent = Math.min(
          100,
          Math.max(2, (row.contextGrowthAttributed / maxGrowth) * 100),
        );

        return (
          <Box key={row.toolName} sx={{ minWidth: 0 }}>
            <ExpandableRow
              expanded={expanded}
              onActivate={() => setOpenTool(expanded ? null : row.toolName)}
              leading={
                <Chip
                  size="small"
                  label={row.toolName}
                  sx={{ fontFamily: "inherit", maxWidth: "12rem" }}
                />
              }
              body={
                <Box sx={{ minWidth: 0 }}>
                  <Box
                    sx={{
                      height: 7,
                      borderRadius: 1,
                      bgcolor: schemeAlpha(
                        theme,
                        schemePalette(theme).primary.main,
                        0.14,
                      ),
                      overflow: "hidden",
                    }}
                  >
                    <Box
                      sx={{
                        width: `${percent}%`,
                        height: "100%",
                        borderRadius: 1,
                        background: `linear-gradient(90deg, ${bars.grown[0]}, ${bars.grown[1]})`,
                      }}
                    />
                  </Box>
                  <Typography
                    variant="mono"
                    color="text.secondary"
                    sx={{ display: "block", fontSize: "0.72rem", mt: 0.4 }}
                  >
                    +{formatTokens(row.contextGrowthAttributed)} ctx attributed
                  </Typography>
                </Box>
              }
              trailing={
                <Stack
                  direction="row"
                  spacing={1.25}
                  useFlexGap
                  sx={{ flexWrap: "wrap", justifyContent: "flex-end" }}
                >
                  <Metric label="calls" value={String(row.callCount)} />
                  <Metric
                    label="total"
                    value={formatTokens(row.totalResultTokens)}
                  />
                  <Metric
                    label="avg"
                    value={formatTokens(row.avgResultTokens)}
                  />
                  <Metric
                    label="max"
                    value={formatTokens(row.maxResultTokens)}
                  />
                </Stack>
              }
            />

            {expanded ? (
              <Stack
                spacing={0.5}
                sx={{
                  pl: { xs: 1, sm: 2 },
                  pb: 1,
                  borderLeft: 2,
                  borderColor: "divider",
                  ml: { xs: 1, sm: 1.5 },
                  minWidth: 0,
                }}
              >
                {row.calls.slice(0, CALLS_SHOWN).map((call) => {
                  const target = targetByToolUseId.get(call.toolUseId);
                  const preview = call.inputPreview ? (
                    <TaggedText value={call.inputPreview} />
                  ) : (
                    `call ${call.toolUseId}`
                  );
                  const label = (
                    <Typography
                      variant="mono"
                      sx={{
                        display: "block",
                        fontSize: "0.75rem",
                        wordBreak: "break-word",
                      }}
                    >
                      {preview}
                    </Typography>
                  );

                  return (
                    <Box key={call.toolUseId} sx={{ minWidth: 0, pt: 0.25 }}>
                      {target ? (
                        <Link
                          component={RouterLink}
                          to={sessionTurnPath(sessionId, {
                            agentId:
                              target.agentId === index.rootAgentId
                                ? null
                                : target.agentId,
                            turn: target.turn,
                            step: target.nodeId,
                            watch,
                          })}
                          underline="hover"
                          sx={{ display: "block", minWidth: 0 }}
                        >
                          {label}
                        </Link>
                      ) : (
                        label
                      )}
                      <Stack
                        direction="row"
                        spacing={1}
                        useFlexGap
                        sx={{ flexWrap: "wrap", alignItems: "baseline" }}
                      >
                        <CallMetrics call={call} />
                        {call.isError ? (
                          <Typography
                            variant="caption"
                            sx={{ color: schemePalette(theme).error.main }}
                          >
                            error
                          </Typography>
                        ) : null}
                        {target ? null : (
                          <Typography variant="caption" color="text.secondary">
                            no step to open
                          </Typography>
                        )}
                      </Stack>
                    </Box>
                  );
                })}
                {row.calls.length > CALLS_SHOWN ? (
                  <Typography variant="caption" color="text.secondary">
                    Showing the {CALLS_SHOWN} heaviest of {row.calls.length}{" "}
                    calls.
                  </Typography>
                ) : null}
              </Stack>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}
