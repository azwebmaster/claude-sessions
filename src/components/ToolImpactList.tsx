import { useEffect, useState } from "react";
import { useTheme } from "@mui/material/styles";
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
import {
  alertSurface,
  focusHighlight,
  schemeAlpha,
  schemePalette,
} from "../theme";
import { EmptyState, ExpandableRow } from "./ui";

interface Props {
  rows: ToolImpactRow[];
  focusedToolUseId?: string | null;
  onSelectCall?: (toolUseId: string) => void;
}

function sharePercent(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}

function callHeadline(call: ToolImpactCall): string {
  return (
    call.inputPreview ??
    call.resultPreview ??
    `Call ${shortId(call.toolUseId)}`
  );
}

function CallDetail({
  call,
  selected,
  onSelect,
}: {
  call: ToolImpactCall;
  selected: boolean;
  onSelect?: (toolUseId: string) => void;
}) {
  const theme = useTheme();
  const highlight = focusHighlight(theme);
  const headline = call.inputPreview;
  const supporting = call.resultPreview;
  const selectable = Boolean(onSelect);

  return (
    <Box
      component={selectable ? "button" : "div"}
      type={selectable ? "button" : undefined}
      onClick={
        selectable
          ? () => {
              onSelect?.(call.toolUseId);
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
        gap: { xs: 0.75, sm: 1 },
        px: { xs: 1, sm: 1.25 },
        py: 1,
        borderRadius: 1,
        bgcolor: selected ? highlight.bgcolor : "background.paper",
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
                ? schemeAlpha(theme, schemePalette(theme).warning.main, 0.14)
                : "action.hover",
            }
          : undefined,
        "&:focus-visible": selectable
          ? {
              outline: `2px solid ${schemePalette(theme).warning.main}`,
              outlineOffset: 2,
            }
          : undefined,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", mb: 0.25, flexWrap: "wrap" }}>
          <Typography variant="mono" color="text.secondary" sx={{ fontSize: "0.72rem" }}>
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
        <Typography variant="subtitle2" sx={{ fontSize: "0.85rem", wordBreak: "break-word" }}>
          {headline ?? "No input captured"}
        </Typography>
        {supporting ? (
          <Typography color="text.secondary" sx={{ mt: 0.35, fontSize: "0.78rem", lineHeight: 1.35, wordBreak: "break-word" }}>
            {supporting}
          </Typography>
        ) : (
          <Typography color="text.secondary" sx={{ mt: 0.35, fontSize: "0.78rem", fontStyle: "italic" }}>
            No result text captured for this call.
          </Typography>
        )}
        {call.timestamp ? (
          <Typography variant="mono" color="text.secondary" sx={{ mt: 0.5, fontSize: "0.68rem" }}>
            {formatDate(call.timestamp)}
          </Typography>
        ) : null}
      </Box>
      <Box
        sx={{
          textAlign: { xs: "left", sm: "right" },
          whiteSpace: "nowrap",
          display: "flex",
          flexDirection: { xs: "row", sm: "column" },
          flexWrap: "wrap",
          alignItems: { xs: "baseline", sm: "flex-end" },
          gap: { xs: 1, sm: 0 },
        }}
      >
        <Box>
          <Typography variant="mono" sx={{ fontSize: "0.85rem" }}>
            {formatTokens(call.resultTokens)}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: { xs: "inline", sm: "block" }, ml: { xs: 0.5, sm: 0 } }}>
            result
          </Typography>
        </Box>
        {call.contextGrowthAttributed > 0 ? (
          <Typography color="error.main" sx={{ fontSize: "0.72rem", mt: { sm: 0.5 } }}>
            +{formatTokens(call.contextGrowthAttributed)} ctx
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}

function TopCallPreview({ calls }: { calls: ToolImpactCall[] }) {
  const top = calls.slice(0, 3);
  if (top.length === 0) {
    return (
      <Typography color="text.secondary" sx={{ mt: 0.5, fontSize: "0.75rem", fontStyle: "italic" }}>
        No per-call details available
      </Typography>
    );
  }

  return (
    <Stack spacing={0.35} sx={{ mt: 0.65 }}>
      {top.map((call) => (
        <Typography key={call.toolUseId} color="text.secondary" sx={{ fontSize: "0.75rem", lineHeight: 1.35, wordBreak: "break-word" }}>
          <Box component="span" sx={{ color: "text.primary", fontWeight: 600 }}>
            {formatTokens(call.resultTokens)}
          </Box>
          {" · "}
          {callHeadline(call)}
        </Typography>
      ))}
      {calls.length > top.length ? (
        <Typography variant="mono" color="text.secondary" sx={{ fontSize: "0.72rem" }}>
          +{calls.length - top.length} more call
          {calls.length - top.length === 1 ? "" : "s"}
        </Typography>
      ) : null}
    </Stack>
  );
}

export function ToolImpactList({
  rows,
  focusedToolUseId = null,
  onSelectCall,
}: Props) {
  const theme = useTheme();
  const [selected, setSelected] = useState<string | null>(
    rows[0]?.toolName ?? null,
  );

  useEffect(() => {
    setSelected(rows[0]?.toolName ?? null);
  }, [rows]);

  useEffect(() => {
    if (!focusedToolUseId) return;
    const owner = rows.find((row) =>
      row.calls.some((call) => call.toolUseId === focusedToolUseId),
    );
    if (owner) setSelected(owner.toolName);
  }, [focusedToolUseId, rows]);

  if (rows.length === 0) {
    return <EmptyState>No tool calls recorded.</EmptyState>;
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
  const errorSurface = alertSurface(theme, "error");

  const focusCall = (toolUseId: string) => {
    onSelectCall?.(toolUseId);
  };

  return (
    <Stack spacing={1.25}>
      {totalGrowth > 0 ? (
        <Box
          sx={{
            px: 1.25,
            py: 1,
            borderRadius: 1,
            border: 1,
            ...errorSurface,
          }}
        >
          <Typography variant="subtitle2" sx={{ fontSize: "0.9rem" }}>
            {top.toolName} adds the most context
          </Typography>
          <Typography variant="mono" color="text.secondary" sx={{ mt: 0.25, fontSize: "0.78rem" }}>
            +{formatTokens(top.contextGrowthAttributed)} attributed
            {topShare > 0 ? ` · ${topShare}% of tool-driven growth` : ""}
          </Typography>
          {top.calls[0] ? (
            <Typography sx={{ mt: 0.5, fontSize: "0.8rem", wordBreak: "break-word" }}>
              Heaviest call: {callHeadline(top.calls[0])}
            </Typography>
          ) : null}
        </Box>
      ) : (
        <Typography color="text.secondary" sx={{ fontSize: "0.78rem", px: 0.25 }}>
          Ranked by estimated result size. Top calls are listed under each tool.
        </Typography>
      )}

      {rows.map((row, index) => {
        const calls = row.calls ?? [];
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
        const heaviestCall = calls[0];

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
                  ? schemeAlpha(theme, schemePalette(theme).error.main, 0.04)
                  : "action.hover",
              transition: "border-color 150ms ease, background 150ms ease",
            }}
          >
            <ExpandableRow
              expanded={open}
              onActivate={() => {
                setSelected((cur) =>
                  cur === row.toolName ? null : row.toolName,
                );
                if (heaviestCall) focusCall(heaviestCall.toolUseId);
              }}
              leading={
                <Chip
                  size="small"
                  label={`#${index + 1}`}
                  sx={{
                    height: 22,
                    fontFamily: theme.typography.mono?.fontFamily,
                    fontSize: "0.68rem",
                    bgcolor: isTop
                      ? schemeAlpha(theme, schemePalette(theme).error.main, 0.12)
                      : "action.selected",
                    color: isTop ? "error.main" : "text.secondary",
                    borderRadius: 0.75,
                    "& .MuiChip-label": { px: 0.75 },
                  }}
                />
              }
              body={
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="subtitle2">
                    {open ? "▾ " : "▸ "}
                    {row.toolName}
                  </Typography>
                  <Typography
                    variant="mono"
                    color="text.secondary"
                    sx={{ fontSize: "0.75rem", wordBreak: "break-word", lineHeight: 1.35 }}
                  >
                    {row.callCount} calls · avg {formatTokens(row.avgResultTokens)} ·
                    max {formatTokens(row.maxResultTokens)}
                    {growthShare > 0 ? ` · ${growthShare}% growth` : ""}
                  </Typography>
                  <LinearProgress
                    variant="determinate"
                    color={isTop ? "error" : "primary"}
                    value={barValue}
                    sx={{ mt: 0.75, height: 6 }}
                  />
                  {!open ? <TopCallPreview calls={calls} /> : null}
                </Box>
              }
              trailing={
                <Box sx={{ textAlign: { xs: "left", sm: "right" } }}>
                  {row.contextGrowthAttributed > 0 ? (
                    <>
                      <Typography
                        variant="mono"
                        sx={{
                          color: isTop ? "error.main" : "primary.main",
                          fontWeight: 600,
                        }}
                      >
                        +{formatTokens(row.contextGrowthAttributed)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        ctx growth
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.35 }}>
                        {formatTokens(row.totalResultTokens)} result
                      </Typography>
                    </>
                  ) : (
                    <>
                      <Typography variant="mono">
                        {formatTokens(row.totalResultTokens)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        ≈ result size
                      </Typography>
                    </>
                  )}
                </Box>
              }
            />

            <Collapse in={open}>
              <Stack spacing={0.75} sx={{ px: 1.25, pb: 1.25, pt: 0.25 }}>
                <Typography
                  variant="overline"
                  color="text.secondary"
                  sx={{ fontSize: "0.72rem", letterSpacing: "0.04em" }}
                >
                  {calls.length} call
                  {calls.length === 1 ? "" : "s"} · heaviest first
                </Typography>
                {calls.length === 0 ? (
                  <Typography color="text.secondary" sx={{ fontSize: "0.8rem" }}>
                    This tool is ranked from aggregate stats, but no individual
                    call payloads were found in the transcript.
                  </Typography>
                ) : (
                  calls.map((call) => (
                    <CallDetail
                      key={call.toolUseId}
                      call={call}
                      selected={focusedToolUseId === call.toolUseId}
                      onSelect={onSelectCall ? focusCall : undefined}
                    />
                  ))
                )}
              </Stack>
            </Collapse>
          </Box>
        );
      })}
    </Stack>
  );
}
