import { Box, Tooltip, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { formatTokens } from "@shared/types";
import { buildStepBars, type ModelCall, type StepBar } from "../../lib/turnSteps";
import { chartBarColors, schemeAlpha, schemePalette } from "../../theme";
import { TaggedText } from "../ui";

interface Props {
  calls: ModelCall[];
  selectedStepId?: string | null;
  onSelectStep?: (nodeId: string | null) => void;
}

function BarTooltipContent({ bar }: { bar: StepBar }) {
  return (
    <Box sx={{ maxWidth: 240, fontSize: "0.72rem" }}>
      <Typography sx={{ fontSize: "0.75rem", fontWeight: 600 }}>
        {bar.step.toolName}
      </Typography>
      {bar.step.inputPreview ? (
        <Typography color="text.secondary" sx={{ fontSize: "0.68rem", mb: 0.5 }}>
          <TaggedText value={bar.step.inputPreview} />
        </Typography>
      ) : null}
      <Typography variant="mono" color="text.secondary" sx={{ fontSize: "0.66rem" }}>
        ctx {formatTokens(bar.contextAfter)}
        {bar.groupSize > 1
          ? ` · ${bar.groupIndex + 1} of ${bar.groupSize} parallel calls`
          : ""}
      </Typography>
    </Box>
  );
}

/** One call's bars, grouped tightly together — the chart-bar counterpart to
 *  `ModelCallGroup`'s "⚡ N parallel" bracket in `StepList`. */
interface BarGroup {
  key: string;
  bars: StepBar[];
}

function groupBars(bars: StepBar[]): BarGroup[] {
  const groups: BarGroup[] = [];
  for (const bar of bars) {
    const last = groups[groups.length - 1];
    if (last && last.key === bar.groupKey) last.bars.push(bar);
    else groups.push({ key: bar.groupKey, bars: [bar] });
  }
  return groups;
}

/**
 * Context bar chart over the steps of one turn, paired above `StepList` the
 * way `ContextChart` pairs above `TurnRail`'s turn list. One bar per step, but
 * every step of the same model call shares that call's `contextAfter` and is
 * drawn as a tight cluster — context is measured per call, not per step.
 */
export function TurnStepChart({ calls, selectedStepId, onSelectStep }: Props) {
  const theme = useTheme();
  const bars = chartBarColors(theme);
  const accent = schemePalette(theme).info.main;

  const stepBars = buildStepBars(calls);
  if (stepBars.length === 0) return null;

  const groups = groupBars(stepBars);
  const max = Math.max(...stepBars.map((b) => b.contextAfter), 1);
  const selectable = Boolean(onSelectStep);
  const parallelGroupCount = groups.filter((g) => g.bars[0]!.groupSize > 1).length;

  return (
    <Box sx={{ minWidth: 0, maxWidth: "100%", mb: 1.5 }}>
      <Box
        sx={{
          overflowX: "auto",
          overflowY: "hidden",
          WebkitOverflowScrolling: "touch",
          overscrollBehaviorX: "contain",
        }}
      >
        <Box
          role="listbox"
          aria-label="Context size by step"
          sx={{
            display: "flex",
            alignItems: "flex-end",
            gap: { xs: 0.35, sm: 0.5 },
            minHeight: { xs: 90, sm: 110 },
            pt: 2.5,
            px: 0.5,
            pb: 0.5,
            width: "100%",
          }}
        >
          {groups.map((group) => {
            const isParallel = group.bars[0]!.groupSize > 1;
            return (
              <Box
                key={group.key}
                sx={{
                  position: "relative",
                  display: "flex",
                  alignItems: "flex-end",
                  gap: "2px",
                  ...(isParallel
                    ? {
                        borderBottom: `2px solid ${schemeAlpha(theme, accent, 0.6)}`,
                        pb: 0.4,
                      }
                    : null),
                }}
              >
                {isParallel ? (
                  <Typography
                    variant="mono"
                    sx={{
                      position: "absolute",
                      top: -16,
                      left: 0,
                      fontSize: "0.6rem",
                      fontWeight: 650,
                      color: accent,
                      whiteSpace: "nowrap",
                    }}
                  >
                    ⚡{group.bars.length}
                  </Typography>
                ) : null}
                {group.bars.map((bar) => {
                  const selected = bar.step.nodeId === selectedStepId;
                  const [top, bottom] = selected ? bars.selected : bars.stable;
                  return (
                    <Tooltip
                      key={bar.step.nodeId}
                      title={<BarTooltipContent bar={bar} />}
                      arrow
                      enterDelay={200}
                      enterTouchDelay={0}
                    >
                      <Box
                        role="option"
                        aria-selected={selected}
                        onClick={() =>
                          onSelectStep?.(selected ? null : bar.step.nodeId)
                        }
                        onKeyDown={(e) => {
                          if (!onSelectStep) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onSelectStep(selected ? null : bar.step.nodeId);
                          }
                        }}
                        tabIndex={selectable ? 0 : undefined}
                        sx={{
                          width: 18,
                          height: Math.max(8, (bar.contextAfter / max) * 100),
                          borderRadius: "4px 4px 1px 1px",
                          background: `linear-gradient(180deg, ${top}, ${bottom})`,
                          outline: selected
                            ? `2px solid ${schemePalette(theme).warning.main}`
                            : "2px solid transparent",
                          outlineOffset: 2,
                          transition:
                            "transform 160ms ease, filter 160ms ease, outline-color 160ms ease",
                          cursor: selectable ? "pointer" : "default",
                          touchAction: "manipulation",
                          "&:hover": {
                            transform: "translateY(-3px)",
                            filter: "brightness(1.05)",
                          },
                          "&:focus-visible": {
                            outline: `2px solid ${bars.focusOutline}`,
                            outlineOffset: 2,
                          },
                        }}
                      />
                    </Tooltip>
                  );
                })}
              </Box>
            );
          })}
        </Box>
      </Box>
      <Typography
        variant="mono"
        color="text.secondary"
        sx={{ mt: 1, fontSize: { xs: "0.68rem", sm: "0.72rem" }, lineHeight: 1.4 }}
      >
        {stepBars.length} step{stepBars.length === 1 ? "" : "s"} · peak{" "}
        {formatTokens(max)}
        {parallelGroupCount > 0 ? ` · ${parallelGroupCount} parallel` : ""}
      </Typography>
    </Box>
  );
}
