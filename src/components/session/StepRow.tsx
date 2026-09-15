import { useState, type ReactNode } from "react";
import { Box, Button, Chip, Collapse, Stack, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import type { LogLineRef } from "@shared/types";
import { formatTokens, TOOL_RESULT_PREVIEW_CAP } from "@shared/types";
import { formatDurationMs } from "../../lib/contextUsageParts";
import type { EnrichedStep } from "../../lib/turnSteps";
import {
  alertSurface,
  focusHighlight,
  nodeKindStyle,
  schemePalette,
} from "../../theme";
import { ExpandableRow, TaggedText } from "../ui";

/** No `toolImpact` call joined and the tree holds no result line either, so
 *  nothing at all is known about this call's result. */
const NO_RESULT = "No tool result recorded (in flight or not captured)";

/** No `toolImpact` call joined, but the tree did attach a result line: the
 *  result exists and "Full result" opens it — only its measurements are
 *  missing, so the row must not claim there is no result. */
const UNJOINED_RESULT = "Result recorded but not joined to this call";

interface Props {
  step: EnrichedStep;
  /** True when `?step=` names this row. Always false for a nested row: `?step=`
   *  resolves against the current scope's current turn only. */
  selected: boolean;
  /** Omitted by a nested list, where there is no URL-backed selection to write:
   *  the body click then falls back to expanding this row. */
  onSelect?: () => void;
  onOpenLog: (log: LogLineRef) => void;
  onEnterSubagent: (agentId: string) => void;
  /**
   * True when `step.subagentId` names an agent that is not in `index.scopes`.
   * Navigating there would land on an empty view, so "Open subagent →" is
   * suppressed and `nested` explains instead.
   */
  subagentMissing?: boolean;
  /** Rendered at the end of the expanded body — the subagent this step
   *  launched, unfolded in place. */
  nested?: ReactNode;
  /** Context window occupancy estimated right after this step: the call's
   *  measured baseline plus the cumulative `contextGrowthAttributed` of this
   *  call's steps up to and including this one (`buildStepRunningContext`). */
  runningContext: number;
}

/**
 * One tool call. `ExpandableRow` runs in split mode: the body activates the row
 * (writing `?step=`) while ▾ opens the result, so selecting a step never
 * collapses what the reader opened. With no `onSelect` — a nested list, where
 * `?step=` cannot resolve — the body click expands instead, so the row is never
 * inert. Expansion is seeded from `selected` at
 * mount, which lands a `?step=` deep link expanded on load and on a move to
 * another turn (that remounts the whole `key={step.nodeId}` list). Moving
 * `?step=` within one turn does not remount, so the newly selected row keeps
 * whatever expansion state the reader left it in — deliberate: no effect
 * stomping manual state.
 */
export function StepRow({
  step,
  selected,
  onSelect,
  onOpenLog,
  onEnterSubagent,
  subagentMissing = false,
  nested,
  runningContext,
}: Props) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(selected);
  const toggleExpanded = () => setExpanded((prev) => !prev);
  const kindStyle = nodeKindStyle(theme, "tool_call");
  const highlight = focusHighlight(theme);
  const errorSurface = alertSurface(theme, "error");
  const truncated = step.resultPreview?.endsWith("…") ?? false;

  // `buildToolImpact` registers a call at its `tool_use`, so a matched call with
  // no result applied is one whose result never arrived: it has no token count
  // to report, only a pending state. A recorded result with a null `durationMs`
  // is one whose timestamps did not yield a usable delta.
  const inFlight = step.matched && !step.resultApplied;

  // `matched` and `resultLog` come from different sources and can disagree:
  // `buildToolImpact` registers a call only for a `tool_use` block carrying both
  // an id and a name (`server/parser.ts:805`), while the tree attaches a
  // `tool_result` to any `tool_use` with an id, defaulting the name
  // (`server/parser.ts:2054-2091`, `tree.ts:147`). Where the line exists,
  // "no result recorded" would contradict the "Full result" button below.
  const unmatchedNote = step.resultLog ? UNJOINED_RESULT : NO_RESULT;

  // `<context attribution> · <duration> · <running context size>` — every
  // step shows this triplet, matched or not: an unmatched/pending step still
  // has a (zero) attribution and a running total, just no measured duration.
  const attribution =
    step.contextGrowthAttributed > 0
      ? `+${formatTokens(step.contextGrowthAttributed)}`
      : "0";
  const duration =
    step.durationMs != null ? formatDurationMs(step.durationMs) : "—";
  const contextLine = `${attribution} · ${duration} · ctx ${formatTokens(runningContext)}`;

  return (
    <Box
      data-step-id={step.nodeId}
      sx={{
        border: "1px solid",
        borderRadius: 1,
        minWidth: 0,
        ...(selected
          ? {
              borderColor: highlight.borderColor,
              bgcolor: highlight.bgcolor,
              boxShadow: highlight.boxShadow,
            }
          : step.isError
            ? errorSurface
            : { borderColor: "divider", bgcolor: "transparent" }),
      }}
    >
      <ExpandableRow
        expanded={expanded}
        focused={selected}
        onActivate={onSelect ?? toggleExpanded}
        onToggleExpand={toggleExpanded}
        // Compact: half the vertical padding of the default row, on the wrapper
        // and on both of its grid children (the ▾ control keeps its fixed 28px
        // box, so only the content padding actually shrinks).
        sx={{ py: 0.25, "& > button": { py: 0.25 } }}
        leading={
          <Chip
            size="small"
            label={step.toolName}
            sx={{
              height: 18,
              mt: 0.15,
              fontFamily: theme.typography.mono?.fontFamily,
              fontSize: "0.68rem",
              bgcolor: kindStyle.bg,
              color: kindStyle.color,
              borderRadius: 0.75,
              "& .MuiChip-label": { px: 0.75 },
            }}
          />
        }
        body={
          <Typography
            color="text.secondary"
            sx={{
              fontSize: "0.75rem",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              mt: 0.25,
            }}
          >
            {step.inputPreview ? (
              <TaggedText value={step.inputPreview} />
            ) : (
              step.toolName
            )}
          </Typography>
        }
        trailing={
          step.matched ? (
            <Stack
              direction="row"
              spacing={0.75}
              sx={{ alignItems: "center", whiteSpace: "nowrap", mt: 0.25 }}
            >
              {step.isError ? (
                <Box
                  title="Tool reported an error"
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    bgcolor: schemePalette(theme).error.main,
                    flexShrink: 0,
                  }}
                />
              ) : null}
              {inFlight ? (
                <Typography
                  variant="mono"
                  color="text.secondary"
                  sx={{ fontSize: "0.72rem" }}
                  title="Result has not arrived yet — nothing about it is measured"
                >
                  pending · {contextLine}
                </Typography>
              ) : (
                <Typography
                  variant="mono"
                  color="text.secondary"
                  sx={{ fontSize: "0.72rem" }}
                  title={
                    step.durationMs == null
                      ? "Result recorded, but its timestamps did not yield a usable duration"
                      : undefined
                  }
                >
                  {contextLine}
                </Typography>
              )}
            </Stack>
          ) : (
            <Typography
              color="text.secondary"
              sx={{
                fontSize: "0.68rem",
                maxWidth: "14rem",
                textAlign: { xs: "left", sm: "right" },
              }}
            >
              {unmatchedNote} · {contextLine}
            </Typography>
          )
        }
      />

      <Collapse in={expanded} unmountOnExit>
        <Box sx={{ px: { xs: 1, sm: 1.25 }, pb: 1, pt: 0.25, minWidth: 0 }}>
          {step.matched ? (
            step.resultPreview ? (
              <>
                <Typography
                  variant="mono"
                  component="pre"
                  sx={{
                    m: 0,
                    p: 1,
                    borderRadius: 1,
                    bgcolor: "action.hover",
                    fontSize: "0.72rem",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  <TaggedText value={step.resultPreview} />
                </Typography>
                {truncated ? (
                  <Typography
                    color="text.secondary"
                    sx={{ fontSize: "0.68rem", mt: 0.4 }}
                  >
                    Preview capped at {TOOL_RESULT_PREVIEW_CAP} characters — “Full
                    result” opens the complete transcript line.
                  </Typography>
                ) : null}
              </>
            ) : (
              <Typography color="text.secondary" sx={{ fontSize: "0.75rem" }}>
                {inFlight
                  ? "No result yet — this call is still in flight."
                  : "Result recorded with no text to preview."}
              </Typography>
            )
          ) : (
            <Typography color="text.secondary" sx={{ fontSize: "0.75rem" }}>
              {unmatchedNote}
            </Typography>
          )}

          <Stack
            direction="row"
            spacing={0.75}
            sx={{ mt: 1, flexWrap: "wrap", rowGap: 0.75, alignItems: "center" }}
          >
            {step.resultLog ? (
              <Button
                size="small"
                variant="outlined"
                onClick={() => onOpenLog(step.resultLog!)}
                sx={{ fontSize: "0.72rem", py: 0.15, px: 1 }}
              >
                Full result
              </Button>
            ) : null}
            {step.log ? (
              <Button
                size="small"
                variant="text"
                onClick={() => onOpenLog(step.log!)}
                sx={{ fontSize: "0.72rem", py: 0.15, px: 1 }}
              >
                View call line
              </Button>
            ) : null}
            {step.contextGrowthAttributed > 0 ? (
              <Chip
                size="small"
                variant="outlined"
                label={`+${formatTokens(step.contextGrowthAttributed)} ctx attributed`}
                sx={{
                  height: 20,
                  fontFamily: theme.typography.mono?.fontFamily,
                  fontSize: "0.66rem",
                }}
              />
            ) : null}
          </Stack>

          {step.subagentId && !subagentMissing ? (
            <Button
              size="small"
              variant="contained"
              onClick={() => onEnterSubagent(step.subagentId!)}
              sx={{ mt: 1, fontSize: "0.75rem", py: 0.3, px: 1.25 }}
            >
              Open subagent →
            </Button>
          ) : null}

          {nested}
        </Box>
      </Collapse>
    </Box>
  );
}
