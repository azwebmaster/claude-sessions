import { Box, Chip, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import type { ContextTimelinePoint } from "@shared/types";
import { formatTokens } from "@shared/types";
import { formatTurnSpan } from "../../lib/contextUsageParts";
import { turnDurationMs } from "../../lib/turnSteps";
import { chartBarColors, focusHighlight, nodeKindStyle } from "../../theme";
import { ExpandableRow, TaggedText } from "../ui";

interface Props {
  point: ContextTimelinePoint;
  stepCount: number;
  active: boolean;
  /** Largest `contextTokens` in the rail, so bars are comparable across rows. */
  maxContextTokens: number;
  onActivate: () => void;
}

/**
 * One rail row. The magnitude bar is scaled by `contextTokens` — window
 * occupancy, which is comparable across turns — not by a sum of usage parts.
 */
export function TurnRailRow({
  point,
  stepCount,
  active,
  maxContextTokens,
  onActivate,
}: Props) {
  const theme = useTheme();
  const bars = chartBarColors(theme);
  const highlight = focusHighlight(theme);
  const subagentStyle = nodeKindStyle(theme, "subagent");
  const durationMs = turnDurationMs(point);
  const launchCount = point.subagentLaunches.length;

  return (
    <Box
      data-rail-turn={point.turn}
      sx={{
        flex: { xs: "0 0 auto", md: "none" },
        minWidth: { xs: "13rem", md: 0 },
        border: "1px solid",
        borderRadius: 1,
        borderColor: active ? highlight.borderColor : "divider",
        bgcolor: active ? highlight.bgcolor : "transparent",
        boxShadow: active ? highlight.boxShadow : "none",
        transition:
          "border-color 150ms ease, background 150ms ease, box-shadow 150ms ease",
        "&:hover": {
          borderColor: active ? highlight.borderColor : "text.disabled",
        },
      }}
    >
      <ExpandableRow
        focused={active}
        onActivate={onActivate}
        leading={
          <Typography
            variant="mono"
            sx={{ fontSize: "0.75rem", fontWeight: 700, mt: 0.15 }}
          >
            {point.turn}
          </Typography>
        }
        body={
          <Box sx={{ minWidth: 0 }}>
            <Typography
              sx={{
                fontSize: "0.78rem",
                lineHeight: 1.35,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                wordBreak: "break-word",
                ...(point.promptPreview ? null : { color: "text.secondary" }),
              }}
            >
              {point.promptPreview ? (
                <TaggedText value={point.promptPreview} />
              ) : (
                "No prompt text recorded"
              )}
            </Typography>
            <Box
              aria-hidden
              sx={{
                mt: 0.6,
                height: 4,
                borderRadius: 2,
                bgcolor: "action.selected",
                overflow: "hidden",
              }}
            >
              <Box
                sx={{
                  height: "100%",
                  width: `${
                    (point.contextTokens / Math.max(maxContextTokens, 1)) * 100
                  }%`,
                  bgcolor: active ? bars.selected[1] : bars.stable[1],
                }}
              />
            </Box>
            {launchCount > 0 ? (
              <Chip
                size="small"
                label={
                  launchCount === 1 ? "subagent" : `${launchCount} subagents`
                }
                sx={{
                  mt: 0.6,
                  height: 18,
                  fontFamily: theme.typography.mono?.fontFamily,
                  fontSize: "0.62rem",
                  bgcolor: subagentStyle.bg,
                  color: subagentStyle.color,
                  borderRadius: 0.75,
                  "& .MuiChip-label": { px: 0.6 },
                }}
              />
            ) : null}
          </Box>
        }
        trailing={
          <Box
            sx={{
              textAlign: { xs: "left", sm: "right" },
              whiteSpace: "nowrap",
            }}
          >
            <Typography
              variant="mono"
              sx={{ fontSize: "0.72rem", fontWeight: 650, display: "block" }}
            >
              {formatTokens(point.contextTokens)}
            </Typography>
            <Typography
              variant="mono"
              color="text.secondary"
              sx={{ fontSize: "0.66rem", display: "block" }}
            >
              {stepCount} step{stepCount === 1 ? "" : "s"}
              {durationMs != null ? ` · ${formatTurnSpan(durationMs)}` : ""}
            </Typography>
          </Box>
        }
      />
    </Box>
  );
}
