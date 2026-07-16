import { useEffect, useState } from "react";
import {
  Box,
  Chip,
  Collapse,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import type { ToolImpactCall, ToolImpactRow } from "@shared/types";
import { formatTokens } from "@shared/types";
import { formatDate, shortId } from "../lib/api";

interface Props {
  rows: ToolImpactRow[];
}

const mono = '"IBM Plex Mono", ui-monospace, monospace';

function sharePercent(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}

function CallDetail({ call }: { call: ToolImpactCall }) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 1,
        px: 1.25,
        py: 1,
        borderRadius: 1,
        bgcolor: "background.paper",
        border: 1,
        borderColor: "divider",
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", mb: 0.25 }}>
          <Typography
            sx={{
              fontFamily: mono,
              fontSize: "0.72rem",
              color: "text.secondary",
            }}
          >
            {shortId(call.toolUseId)}
          </Typography>
          {call.isError ? (
            <Chip
              size="small"
              label="error"
              color="error"
              variant="outlined"
              sx={{ height: 20, fontSize: "0.65rem" }}
            />
          ) : null}
        </Stack>
        <Typography
          sx={{
            fontWeight: 600,
            fontSize: "0.85rem",
            wordBreak: "break-word",
          }}
        >
          {call.inputPreview ?? "No input preview"}
        </Typography>
        {call.resultPreview ? (
          <Typography
            sx={{
              mt: 0.35,
              color: "text.secondary",
              fontSize: "0.78rem",
              lineHeight: 1.35,
              wordBreak: "break-word",
            }}
          >
            {call.resultPreview}
          </Typography>
        ) : null}
        {call.timestamp ? (
          <Typography
            sx={{
              mt: 0.5,
              color: "text.secondary",
              fontFamily: mono,
              fontSize: "0.68rem",
            }}
          >
            {formatDate(call.timestamp)}
          </Typography>
        ) : null}
      </Box>
      <Box sx={{ fontFamily: mono, textAlign: "right", whiteSpace: "nowrap" }}>
        <Typography sx={{ fontFamily: "inherit", fontSize: "0.85rem" }}>
          {formatTokens(call.resultTokens)}
        </Typography>
        <Typography sx={{ color: "text.secondary", fontSize: "0.68rem" }}>
          result
        </Typography>
        {call.contextGrowthAttributed > 0 ? (
          <Typography
            sx={{ color: "error.main", fontSize: "0.72rem", mt: 0.5 }}
          >
            +{formatTokens(call.contextGrowthAttributed)} ctx
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}

export function ToolImpactList({ rows }: Props) {
  const [selected, setSelected] = useState<string | null>(
    rows[0]?.toolName ?? null,
  );

  useEffect(() => {
    setSelected(rows[0]?.toolName ?? null);
  }, [rows]);

  if (rows.length === 0) {
    return (
      <Typography color="text.secondary" align="center" sx={{ py: 2 }}>
        No tool calls recorded.
      </Typography>
    );
  }

  const totalGrowth = rows.reduce(
    (sum, row) => sum + row.contextGrowthAttributed,
    0,
  );
  const maxMetric = Math.max(
    ...rows.map((r) =>
      Math.max(r.contextGrowthAttributed, r.totalResultTokens),
    ),
    1,
  );
  const top = rows[0];
  const topShare = sharePercent(top.contextGrowthAttributed, totalGrowth);

  return (
    <Stack spacing={1.25}>
      {totalGrowth > 0 ? (
        <Box
          sx={{
            px: 1.25,
            py: 1,
            borderRadius: 1,
            bgcolor: "rgba(211, 47, 47, 0.06)",
            border: 1,
            borderColor: "rgba(211, 47, 47, 0.18)",
          }}
        >
          <Typography sx={{ fontWeight: 600, fontSize: "0.9rem" }}>
            {top.toolName} adds the most context
          </Typography>
          <Typography
            sx={{
              mt: 0.25,
              color: "text.secondary",
              fontSize: "0.78rem",
              fontFamily: mono,
            }}
          >
            +{formatTokens(top.contextGrowthAttributed)} attributed
            {topShare > 0 ? ` · ${topShare}% of tool-driven growth` : ""}
            {" · "}
            click a tool for call-level detail
          </Typography>
        </Box>
      ) : (
        <Typography color="text.secondary" sx={{ fontSize: "0.78rem", px: 0.25 }}>
          Ranked by estimated result size. Click a tool for call-level detail.
        </Typography>
      )}

      {rows.map((row, index) => {
        const open = selected === row.toolName;
        const growthShare = sharePercent(
          row.contextGrowthAttributed,
          totalGrowth,
        );
        const barValue =
          (Math.max(row.contextGrowthAttributed, row.totalResultTokens) /
            maxMetric) *
          100;
        const isTop = index === 0 && row.contextGrowthAttributed > 0;

        return (
          <Box
            key={row.toolName}
            sx={{
              borderRadius: 1,
              border: 1,
              borderColor: open
                ? "primary.main"
                : isTop
                  ? "error.light"
                  : "divider",
              bgcolor: open
                ? "action.selected"
                : isTop
                  ? "rgba(211, 47, 47, 0.04)"
                  : "action.hover",
              transition: "border-color 150ms ease, background 150ms ease",
            }}
          >
            <Box
              component="button"
              type="button"
              onClick={() =>
                setSelected((cur) =>
                  cur === row.toolName ? null : row.toolName,
                )
              }
              aria-expanded={open}
              sx={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                gap: 1,
                width: "100%",
                border: 0,
                bgcolor: "transparent",
                textAlign: "left",
                px: 1.25,
                py: 1,
                cursor: "pointer",
                color: "inherit",
                font: "inherit",
                borderRadius: 1,
                "&:hover": { bgcolor: "action.hover" },
              }}
            >
              <Chip
                size="small"
                label={`#${index + 1}`}
                sx={{
                  height: 22,
                  fontFamily: mono,
                  fontSize: "0.68rem",
                  bgcolor: isTop
                    ? "rgba(211, 47, 47, 0.12)"
                    : "action.selected",
                  color: isTop ? "error.dark" : "text.secondary",
                  borderRadius: 0.75,
                  "& .MuiChip-label": { px: 0.75 },
                }}
              />
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 600 }}>
                  {open ? "▾ " : "▸ "}
                  {row.toolName}
                </Typography>
                <Typography
                  sx={{
                    color: "text.secondary",
                    fontFamily: mono,
                    fontSize: "0.75rem",
                  }}
                >
                  {row.callCount} calls · avg {formatTokens(row.avgResultTokens)} ·
                  max {formatTokens(row.maxResultTokens)}
                  {growthShare > 0 ? ` · ${growthShare}% growth` : ""}
                </Typography>
                <LinearProgress
                  variant="determinate"
                  color={isTop ? "error" : "primary"}
                  value={barValue}
                  sx={{
                    mt: 0.75,
                    height: 6,
                    borderRadius: 1,
                  }}
                />
              </Box>
              <Box sx={{ fontFamily: mono, textAlign: "right" }}>
                {row.contextGrowthAttributed > 0 ? (
                  <>
                    <Typography
                      sx={{
                        fontFamily: "inherit",
                        color: isTop ? "error.main" : "primary.main",
                        fontWeight: 600,
                      }}
                    >
                      +{formatTokens(row.contextGrowthAttributed)}
                    </Typography>
                    <Typography
                      sx={{ color: "text.secondary", fontSize: "0.72rem" }}
                    >
                      ctx growth
                    </Typography>
                    <Typography
                      sx={{
                        color: "text.secondary",
                        fontSize: "0.68rem",
                        mt: 0.35,
                      }}
                    >
                      {formatTokens(row.totalResultTokens)} result
                    </Typography>
                  </>
                ) : (
                  <>
                    <Typography sx={{ fontFamily: "inherit" }}>
                      {formatTokens(row.totalResultTokens)}
                    </Typography>
                    <Typography
                      sx={{ color: "text.secondary", fontSize: "0.72rem" }}
                    >
                      ≈ result size
                    </Typography>
                  </>
                )}
              </Box>
            </Box>

            <Collapse in={open}>
              <Stack spacing={0.75} sx={{ px: 1.25, pb: 1.25, pt: 0.25 }}>
                <Typography
                  sx={{
                    color: "text.secondary",
                    fontSize: "0.72rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  {row.calls.length} call
                  {row.calls.length === 1 ? "" : "s"} · heaviest first
                </Typography>
                {row.calls.map((call) => (
                  <CallDetail key={call.toolUseId} call={call} />
                ))}
              </Stack>
            </Collapse>
          </Box>
        );
      })}
    </Stack>
  );
}
