import { Box, Tooltip, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import type { ContextTimelinePoint } from "@shared/types";
import { formatTokens } from "@shared/types";
import { chartBarColors, nodeKindStyle, schemePalette, usagePartColors } from "../theme";
import { buildUsageParts } from "../lib/contextUsageParts";
import { EmptyState, TaggedText } from "./ui";

interface Props {
  points: ContextTimelinePoint[];
  selectedNodeId?: string | null;
  onSelect?: (point: ContextTimelinePoint) => void;
}

function BarTooltipContent({
  point,
  prevTokens,
  turnIndex,
  colors,
  subagentColor,
  selectable,
}: {
  point: ContextTimelinePoint;
  prevTokens: number;
  turnIndex: number;
  colors: ReturnType<typeof usagePartColors>;
  subagentColor: string;
  selectable: boolean;
}) {
  const delta = point.contextTokens - prevTokens;
  const parts = buildUsageParts(point, colors).filter((p) => p.value > 0);
  const partsTotal = Math.max(
    parts.reduce((sum, p) => sum + p.value, 0),
    1,
  );

  return (
    <Box sx={{ maxWidth: 260, fontSize: "0.72rem" }}>
      <Typography sx={{ fontSize: "0.75rem", fontWeight: 600 }}>
        Turn {point.turn}: {formatTokens(point.contextTokens)} context
      </Typography>
      <Typography color="text.secondary" sx={{ fontSize: "0.68rem", mb: 0.75 }}>
        {turnIndex > 0
          ? delta === 0
            ? "no change vs prior turn"
            : `${delta > 0 ? "+" : ""}${formatTokens(delta)} vs prior turn`
          : "first turn baseline (prompt + cache)"}
      </Typography>

      {parts.length > 0 ? (
        <Box
          sx={{
            display: "flex",
            height: 6,
            borderRadius: 0.5,
            overflow: "hidden",
            mb: 0.75,
          }}
        >
          {parts.map((p) => (
            <Box
              key={p.key}
              sx={{ width: `${(p.value / partsTotal) * 100}%`, bgcolor: p.color }}
            />
          ))}
        </Box>
      ) : null}

      {point.causedBy.length > 0 ? (
        <Box sx={{ mb: 0.75 }}>
          <Typography sx={{ fontSize: "0.68rem", fontWeight: 600 }}>
            Caused by
          </Typography>
          {point.causedBy.slice(0, 3).map((call) => (
            <Typography key={call.toolUseId} sx={{ fontSize: "0.66rem" }}>
              +{formatTokens(call.contextGrowthAttributed)} ·{" "}
              {call.inputPreview ? (
                <TaggedText value={call.inputPreview} />
              ) : (
                "tool result"
              )}
            </Typography>
          ))}
        </Box>
      ) : null}

      {point.subagentLaunches.length > 0 ? (
        <Box sx={{ mb: 0.75 }}>
          <Typography sx={{ fontSize: "0.68rem", fontWeight: 600 }}>
            Launched subagent
          </Typography>
          {point.subagentLaunches.map((launch) => (
            <Box
              key={launch.toolUseId}
              sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
            >
              <Box
                sx={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  bgcolor: subagentColor,
                  flexShrink: 0,
                }}
              />
              <Typography sx={{ fontSize: "0.66rem" }}>
                {launch.label} · peak {formatTokens(launch.peakContextTokens)} ·{" "}
                {launch.turnCount} turns
              </Typography>
            </Box>
          ))}
        </Box>
      ) : null}

      <Typography color="text.secondary" sx={{ fontSize: "0.64rem" }}>
        {point.label}
        {selectable ? " · click to focus hierarchy" : ""}
      </Typography>
    </Box>
  );
}

export function ContextChart({ points, selectedNodeId, onSelect }: Props) {
  const theme = useTheme();
  const bars = chartBarColors(theme);
  const usageColors = usagePartColors(theme);
  const subagentColor = nodeKindStyle(theme, "subagent").color;

  if (points.length === 0) {
    return <EmptyState>No assistant usage records in this session.</EmptyState>;
  }

  const max = Math.max(...points.map((p) => p.contextTokens), 1);
  const selectable = Boolean(onSelect);
  const subagentTurnCount = points.filter((p) => p.subagentLaunches.length > 0).length;

  // Keep bars tappable on phones; scroll horizontally when there are many turns.
  const barMinWidth = points.length > 24 ? 14 : points.length > 12 ? 18 : 24;

  return (
    <Box sx={{ minWidth: 0, maxWidth: "100%" }}>
      <Box
        sx={{
          overflowX: "auto",
          overflowY: "hidden",
          WebkitOverflowScrolling: "touch",
          overscrollBehaviorX: "contain",
          mx: { xs: -0.5, sm: 0 },
          px: { xs: 0.5, sm: 0 },
        }}
      >
        <Box
          role="listbox"
          aria-label="Context size by turn"
          sx={{
            display: "flex",
            alignItems: "flex-end",
            gap: { xs: 0.35, sm: 0.5 },
            minHeight: { xs: 120, sm: 140 },
            pt: 2.5,
            px: 0.5,
            pb: 0.5,
            width: "100%",
            minWidth: points.length * (barMinWidth + 4),
          }}
        >
          {points.map((p, i) => {
            const prev = i > 0 ? points[i - 1].contextTokens : p.contextTokens;
            const grew = p.contextTokens > prev;
            const selected = selectedNodeId === p.nodeId;
            const launchedSubagent = p.subagentLaunches.length > 0;
            const [top, bottom] = selected
              ? bars.selected
              : grew
                ? bars.grown
                : bars.stable;

            return (
              <Tooltip
                key={p.nodeId}
                title={
                  <BarTooltipContent
                    point={p}
                    prevTokens={prev}
                    turnIndex={i}
                    colors={usageColors}
                    subagentColor={subagentColor}
                    selectable={selectable}
                  />
                }
                arrow
                enterDelay={200}
                enterTouchDelay={0}
              >
                <Box
                  role="option"
                  aria-selected={selected}
                  onClick={() => onSelect?.(p)}
                  onKeyDown={(e) => {
                    if (!onSelect) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(p);
                    }
                  }}
                  tabIndex={selectable ? 0 : undefined}
                  sx={{
                    flex: "1 1 0",
                    minWidth: barMinWidth,
                    height: Math.max(8, (p.contextTokens / max) * 120),
                    borderRadius: "6px 6px 2px 2px",
                    background: `linear-gradient(180deg, ${top}, ${bottom})`,
                    outline: selected
                      ? `2px solid ${schemePalette(theme).warning.main}`
                      : "2px solid transparent",
                    outlineOffset: 2,
                    position: "relative",
                    transition:
                      "transform 160ms ease, filter 160ms ease, outline-color 160ms ease",
                    cursor: selectable ? "pointer" : "default",
                    touchAction: "manipulation",
                    "&:hover": {
                      transform: "translateY(-3px)",
                      filter: "brightness(1.05)",
                      "& span": { opacity: 1 },
                    },
                    "&:focus-visible": {
                      outline: `2px solid ${bars.focusOutline}`,
                      outlineOffset: 2,
                    },
                    "& span": {
                      position: "absolute",
                      inset: "auto 0 100% 0",
                      transform: "translateY(-4px)",
                      fontSize: "0.62rem",
                      fontFamily: theme.typography.mono?.fontFamily,
                      color: "text.secondary",
                      textAlign: "center",
                      opacity: selected ? 1 : 0,
                      transition: "opacity 120ms ease",
                      pointerEvents: "none",
                      whiteSpace: "nowrap",
                    },
                  }}
                >
                  {launchedSubagent ? (
                    <Box
                      aria-hidden
                      sx={{
                        position: "absolute",
                        top: 3,
                        left: "50%",
                        transform: "translateX(-50%)",
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        bgcolor: subagentColor,
                        boxShadow: `0 0 0 1px ${theme.palette.background.paper}`,
                        pointerEvents: "none",
                      }}
                    />
                  ) : null}
                  <span>{formatTokens(p.contextTokens)}</span>
                </Box>
              </Tooltip>
            );
          })}
        </Box>
      </Box>
      <Typography
        variant="mono"
        color="text.secondary"
        sx={{ mt: 1, fontSize: { xs: "0.68rem", sm: "0.72rem" }, lineHeight: 1.4 }}
      >
        {points.length} turns · peak {formatTokens(max)}
        {subagentTurnCount > 0
          ? ` · ${subagentTurnCount} launched a subagent (● dot)`
          : ""}
        {selectable ? " · click a turn to focus the hierarchy" : ""}
        {points.length > 12 ? " · scroll sideways for more turns" : ""}
      </Typography>
    </Box>
  );
}
