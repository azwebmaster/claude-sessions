import { useMemo, useState } from "react";
import { Box, Collapse, Stack, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import type { ContextTimelinePoint } from "@shared/types";
import { formatTokens, totalTokens } from "@shared/types";
import { formatTurnSpan, metricsTitle } from "../../lib/contextUsageParts";
import {
  buildStepRunningContext,
  resolveSubagentInlineView,
  turnDurationMs,
  type ModelCall,
} from "../../lib/turnSteps";
import {
  chartBarColors,
  nodeKindStyle,
  schemeAlpha,
  schemePalette,
} from "../../theme";
import { useSessionWorkspace } from "../../pages/SessionWorkspace";
import { ExpandableRow, TaggedText } from "../ui";
import { StepRow } from "./StepRow";

/** Default for `ancestorAgentIds` — module-level so it is not a new object on
 *  every render. */
const NO_ANCESTORS: ReadonlySet<string> = new Set();

/** Row gap inside every list at every depth: a model call's line and its step
 *  rows read as one block rather than as floating boxes. */
const ROW_GAP = 0.25;

/** Indent of a nested bracket. Flat on `xs` so accumulated depth still fits a
 *  400px viewport. */
const NEST_INDENT = { xs: 0.75, sm: 1 } as const;

/** Default for a turn row's calls — module-level so a turn with no call of its
 *  own is not a new array on every render. */
const NO_CALLS: ModelCall[] = [];

interface StepListProps {
  calls: ModelCall[];
  /**
   * URL-backed selection, omitted when nested: `resolveSessionSelection` only
   * accepts a `?step=` that names a step of the current scope's current turn
   * (`sessionSelection.ts:119-123`), so a nested id would resolve to null and
   * only litter the URL.
   */
  selectedStepId?: string | null;
  /** Also withheld, per call, from the rows of a turnless call — see the map
   *  body below. */
  onSelectStep?: (nodeId: string | null) => void;
  onEnterSubagent: (agentId: string) => void;
  /** Agents already on screen above this list — the cycle guard. */
  ancestorAgentIds?: ReadonlySet<string>;
}

/**
 * The steps of one turn, grouped by model call. Built from `ModelCall`s rather
 * than from `EnrichedStep`s, so a call that emitted no `tool_use` block is a
 * visible row instead of nothing at all even though it billed tokens.
 *
 * This module owns the whole recursion — `StepList` → `SubagentTurns` →
 * `SubagentTurnRow` → `StepList` — so the cycle stays inside one file and the
 * import of `StepRow` is one-way.
 */
export function StepList({
  calls,
  selectedStepId = null,
  onSelectStep,
  onEnterSubagent,
  ancestorAgentIds = NO_ANCESTORS,
}: StepListProps) {
  // Scoped to this `calls` array, same as `enrichSteps` — a subagent's steps
  // never share a running total with the scope that launched it.
  const runningContext = useMemo(() => buildStepRunningContext(calls), [calls]);
  return (
    <Stack spacing={ROW_GAP} sx={{ minWidth: 0 }}>
      {calls.map((call, i) => (
        <ModelCallGroup
          key={call.assistantNodeId ?? `unattributed-${i}`}
          call={call}
          selectedStepId={selectedStepId}
          // A turnless call's steps are turnless too (`enrichSteps` reads both
          // `turn` and `assistantNodeId` off the same node), so `groupStepsByTurn`
          // files them under `unassigned` and no `stepsByTurn` bucket can ever
          // hold them. Handing those rows `onSelectStep` would write a `?step=`
          // that `resolveSessionSelection` resolves to null: no highlight, and a
          // dead query param. Without it the body click expands instead.
          onSelectStep={call.turn == null ? undefined : onSelectStep}
          onEnterSubagent={onEnterSubagent}
          ancestorAgentIds={ancestorAgentIds}
          runningContext={runningContext}
        />
      ))}
    </Stack>
  );
}

/**
 * One model call's tool calls, with a compact metrics line above them when
 * they went out in parallel. A call with no steps renders nothing — this tab
 * is for tool calls, and a text-only turn has no chip to anchor a line to.
 *
 * Only a call that names an assistant message can take the parallel bracket:
 * the synthetic `assistantNodeId: null` row holds steps that share *no* model
 * call, so bracketing them as "these went out together" would deny the one
 * thing that row exists to say.
 */
function ModelCallGroup({
  call,
  selectedStepId,
  onSelectStep,
  onEnterSubagent,
  ancestorAgentIds,
  runningContext,
}: {
  call: ModelCall;
  selectedStepId: string | null;
  onSelectStep?: (nodeId: string | null) => void;
  onEnterSubagent: (agentId: string) => void;
  ancestorAgentIds: ReadonlySet<string>;
  runningContext: Map<string, number>;
}) {
  const theme = useTheme();
  const { index, openLog } = useSessionWorkspace();
  // `info` is the tool_call accent, so the bracket reads as being about calls.
  const accent = schemePalette(theme).info.main;
  // Gated on provenance, not on step count alone: `buildModelCalls` appends one
  // `assistantNodeId: null` row for the steps that came from no model call at
  // all, and two of those did not go out together. `assistantNodeId` is one
  // `assistant_message` node — the parser's merge of every JSONL line sharing
  // one API response's `message.id` — so `steps.length > 1` here means real
  // parallel tool calls, not just multiple lines of the same response.
  const parallel = call.assistantNodeId != null && call.steps.length > 1;

  // A call with no tool use has no chip to anchor a line to, and this tab is
  // for tool calls — its metrics (and any text preview) only duplicate what
  // the neighboring call's row and the Context tab already show, so it's
  // dropped rather than given a line of its own.
  if (call.steps.length === 0) return null;

  const line = metricsLine(call, parallel);
  // The one-step, non-parallel case is the common one: the call's own metrics
  // line and its single tool row describe the same event, and the row already
  // carries its own attribution/duration/running-context figures, so this
  // line would only repeat them under different numbers. A parallel call
  // keeps the line above, since its steps' own figures don't cover the call's
  // total usage.
  const singleStep = !parallel && call.steps.length === 1;

  // Deliberately unmemoized: every `ModelCall` is rebuilt whenever `index` is,
  // and `index` is rebuilt whenever `detail` changes — under a watch, on each
  // poll tick that finds the transcript grown (a tick whose size/mtime match
  // returns without touching state, `SessionWorkspace.tsx:175`, so it re-renders
  // nothing). A `call`-keyed `useMemo` would miss on exactly the renders that
  // happen, while still costing a cache slot. The work is one element per step
  // of one call — unlike `SubagentTurns`, whose memo guards a reduce over a
  // whole timeline.
  const rows = call.steps.map((step) => {
    const subagentId = step.subagentId;
    // O(1) `Map.has`, unlike `resolveSubagentInlineView`, which also reduces
    // over the subagent's timeline — that one is deferred to `SubagentTurns`,
    // which does not mount until the row is opened.
    const missing = subagentId != null && !index.scopes.has(subagentId);
    return (
      <StepRow
        key={step.nodeId}
        step={step}
        selected={step.nodeId === selectedStepId}
        onSelect={
          onSelectStep
            ? () => {
                onSelectStep(
                  step.nodeId === selectedStepId ? null : step.nodeId,
                );
              }
            : undefined
        }
        onOpenLog={openLog}
        onEnterSubagent={onEnterSubagent}
        subagentMissing={missing}
        runningContext={runningContext.get(step.nodeId) ?? 0}
        nested={
          subagentId == null ? undefined : ancestorAgentIds.has(subagentId) ? (
            <Typography
              color="text.secondary"
              sx={{ fontSize: "0.7rem", mt: 1, display: "block" }}
            >
              This subagent is already shown above — open it to avoid repeating
              the same transcript here.
            </Typography>
          ) : (
            <SubagentTurns
              subagentId={subagentId}
              onEnterSubagent={onEnterSubagent}
              ancestorAgentIds={ancestorAgentIds}
            />
          )
        }
      />
    );
  });

  const body = (
    <>
      {singleStep ? null : (
        <Typography
          variant="mono"
          sx={{
            display: "block",
            fontSize: "0.7rem",
            lineHeight: 1.35,
            fontWeight: parallel ? 650 : 400,
            color: parallel ? accent : "text.secondary",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          // The same hover explanation the hierarchy tree puts on an assistant
          // node's metrics, but worded for one model call rather than a whole
          // turn — a turn absorbs several of these rows, each with its own
          // numbers. `undefined` when there is nothing to explain.
          title={metricsTitle(call, "model call")}
        >
          {line}
        </Typography>
      )}
      {rows.length > 0 ? (
        <Stack
          spacing={ROW_GAP}
          sx={{ mt: singleStep ? 0 : ROW_GAP, minWidth: 0 }}
        >
          {rows}
        </Stack>
      ) : null}
    </>
  );

  if (!parallel) return <Box sx={{ minWidth: 0 }}>{body}</Box>;

  return (
    <Box
      role="group"
      aria-label={`${call.steps.length} parallel tool calls`}
      sx={{
        minWidth: 0,
        pl: NEST_INDENT,
        borderLeft: "2px solid",
        borderColor: schemeAlpha(theme, accent, 0.45),
      }}
    >
      {body}
    </Box>
  );
}

/**
 * The one compact line for a model call: `⚡ N parallel` when the call fanned
 * out, then the token metrics in the idiom the hierarchy tree established —
 * `… tok` from `totalTokens(usage)`, `ctx …` from `context.contextAfter`
 * (`baseline` when there is no prior context to compare against), `↑/↓… vs
 * prior` from `contextDelta`.
 *
 * `usage` and `context` are both null when the entry billed no input or cache
 * tokens, so the fallback says so rather than printing a zero. The synthetic
 * row that holds steps with no model call reaches that fallback whatever its
 * step count, because `parallel` is false there: its label — the only text
 * explaining the absent metrics — is never crowded out by a `⚡` part.
 */
function metricsLine(call: ModelCall, parallel: boolean): string {
  const parts: string[] = [];
  if (parallel) parts.push(`⚡ ${call.steps.length} parallel`);

  const tokens = call.usage ? totalTokens(call.usage) : 0;
  if (tokens > 0) parts.push(`${formatTokens(tokens)} tok`);

  const context = call.context;
  if (context && context.contextAfter != null) {
    parts.push(
      context.contextDelta == null
        ? `ctx ${formatTokens(context.contextAfter)} baseline`
        : `ctx ${formatTokens(context.contextAfter)}`,
    );
  }

  const delta = context?.contextDelta;
  if (delta != null && delta !== 0) {
    parts.push(
      delta > 0
        ? `↑${formatTokens(delta)} vs prior`
        : `↓${formatTokens(Math.abs(delta))} vs prior`,
    );
  }

  if (parts.length > 0) return parts.join(" · ");
  return call.assistantNodeId == null ? call.label : "no usage recorded";
}

/**
 * A subagent's transcript, inline under the step that launched it.
 * `resolveSubagentInlineView` runs in a `useMemo` here rather than in
 * `StepList`'s map body: a watched session re-renders every time the poll finds
 * the transcript grown (`SessionWorkspace.tsx:175`), and this component does not
 * even mount until the launching row is opened, so a collapsed Task row costs
 * nothing at all.
 */
function SubagentTurns({
  subagentId,
  onEnterSubagent,
  ancestorAgentIds,
}: {
  subagentId: string;
  onEnterSubagent: (agentId: string) => void;
  ancestorAgentIds: ReadonlySet<string>;
}) {
  const theme = useTheme();
  const { index } = useSessionWorkspace();
  const view = useMemo(
    () => resolveSubagentInlineView(index, subagentId),
    [index, subagentId],
  );
  const nestedAncestors = useMemo(
    () => new Set([...ancestorAgentIds, subagentId]),
    [ancestorAgentIds, subagentId],
  );
  // One pass for the whole turn list. Every non-orphan call matches exactly one
  // turn row, so bucketing by `turn` partitions `modelCalls` across the rows
  // without duplicating any — and doing it here is O(calls) instead of the
  // O(points × calls) a per-row filter would cost on every re-render.
  const callsByTurn = useMemo(() => {
    const byTurn = new Map<number, ModelCall[]>();
    if (view.kind !== "turns") return byTurn;
    for (const call of view.scope.modelCalls) {
      if (call.turn == null) continue;
      const bucket = byTurn.get(call.turn);
      if (bucket) bucket.push(call);
      else byTurn.set(call.turn, [call]);
    }
    return byTurn;
  }, [view]);

  if (view.kind === "missing") {
    return (
      <Typography
        color="text.secondary"
        sx={{ fontSize: "0.7rem", mt: 1, display: "block" }}
      >
        Subagent transcript not available — its entries are not in this
        session's tree.
      </Typography>
    );
  }

  const { scope } = view;
  const turnCount = scope.timeline.length;
  // Reduced from 0, not read off `view.maxContextTokens`: that one is floored at
  // 1 to be a bar denominator, and printing the floor would show `1 peak ctx`
  // for a subagent whose every point reports 0. The bar keeps the floored value.
  const peakContextTokens = scope.timeline.reduce(
    (max, p) => (p.contextTokens > max ? p.contextTokens : max),
    0,
  );
  const header = [
    scope.label,
    `${turnCount} turn${turnCount === 1 ? "" : "s"}`,
    peakContextTokens > 0 ? `${formatTokens(peakContextTokens)} peak ctx` : null,
  ]
    .filter((part): part is string => part != null)
    .join(" · ");

  return (
    <Box
      role="group"
      aria-label={`subagent ${scope.label}`}
      sx={{
        minWidth: 0,
        mt: 1,
        pl: NEST_INDENT,
        borderLeft: "2px solid",
        // The subagent accent, so this bracket is distinguishable from the
        // tool_call-tinted parallel bracket.
        borderColor: schemeAlpha(
          theme,
          nodeKindStyle(theme, "subagent").color,
          0.45,
        ),
      }}
    >
      <Typography
        variant="mono"
        color="text.secondary"
        sx={{
          display: "block",
          fontSize: "0.7rem",
          lineHeight: 1.35,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {header}
      </Typography>

      {view.kind === "flat" ? (
        view.calls.length > 0 ? (
          <StepList
            calls={view.calls}
            onEnterSubagent={onEnterSubagent}
            ancestorAgentIds={nestedAncestors}
          />
        ) : (
          <Typography color="text.secondary" sx={{ fontSize: "0.7rem" }}>
            No model calls recorded for this subagent.
          </Typography>
        )
      ) : (
        <Stack spacing={ROW_GAP} sx={{ minWidth: 0 }}>
          {view.orphanCalls.length > 0 ? (
            <StepList
              calls={view.orphanCalls}
              onEnterSubagent={onEnterSubagent}
              ancestorAgentIds={nestedAncestors}
            />
          ) : null}
          {view.points.map((point) => (
            <SubagentTurnRow
              key={point.nodeId}
              calls={callsByTurn.get(point.turn) ?? NO_CALLS}
              point={point}
              maxContextTokens={view.maxContextTokens}
              onEnterSubagent={onEnterSubagent}
              ancestorAgentIds={nestedAncestors}
            />
          ))}
        </Stack>
      )}
    </Box>
  );
}

/**
 * One turn of a nested subagent. Deliberately not `TurnRailRow`: that row feeds
 * `active` into `ExpandableRow`'s `focused`, which emits `aria-current="true"`
 * (`ExpandableRow.tsx:159`) and paints the selection highlight, so an expanded
 * nested row would claim to be the current `?step=` selection. Open state is
 * local, so expanding here never touches the URL.
 */
function SubagentTurnRow({
  calls,
  point,
  maxContextTokens,
  onEnterSubagent,
  ancestorAgentIds,
}: {
  /** This turn's own model calls, bucketed once by `SubagentTurns`. */
  calls: ModelCall[];
  point: ContextTimelinePoint;
  maxContextTokens: number;
  onEnterSubagent: (agentId: string) => void;
  ancestorAgentIds: ReadonlySet<string>;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const bars = chartBarColors(theme);
  const stepCount = calls.reduce((sum, call) => sum + call.steps.length, 0);
  const durationMs = turnDurationMs(point);
  const toggle = () => setOpen((prev) => !prev);

  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        minWidth: 0,
      }}
    >
      <ExpandableRow
        expanded={open}
        focused={false}
        onActivate={toggle}
        onToggleExpand={toggle}
        sx={{ py: 0.25 }}
        leading={
          <Typography
            variant="mono"
            sx={{ fontSize: "0.72rem", fontWeight: 700, mt: 0.3 }}
          >
            {point.turn}
          </Typography>
        }
        body={
          <Typography
            sx={{
              fontSize: "0.75rem",
              mt: 0.3,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              ...(point.promptPreview ? null : { color: "text.secondary" }),
            }}
          >
            {point.promptPreview ? (
              <TaggedText value={point.promptPreview} />
            ) : (
              "No prompt text recorded"
            )}
          </Typography>
        }
        trailing={
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ alignItems: "center", whiteSpace: "nowrap", mt: 0.3 }}
          >
            <Typography
              variant="mono"
              color="text.secondary"
              sx={{ fontSize: "0.68rem" }}
            >
              {stepCount} step{stepCount === 1 ? "" : "s"}
              {durationMs != null ? ` · ${formatTurnSpan(durationMs)}` : ""} ·{" "}
              {formatTokens(point.contextTokens)}
            </Typography>
            <Box
              aria-hidden
              title={`ctx ${formatTokens(point.contextTokens)} of this subagent's peak ${formatTokens(maxContextTokens)}`}
              sx={{
                width: "2.5rem",
                height: 4,
                borderRadius: 2,
                bgcolor: "action.selected",
                overflow: "hidden",
                flexShrink: 0,
              }}
            >
              <Box
                sx={{
                  height: "100%",
                  width: `${
                    (point.contextTokens / Math.max(maxContextTokens, 1)) * 100
                  }%`,
                  bgcolor: bars.stable[1],
                }}
              />
            </Box>
          </Stack>
        }
      />

      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: { xs: 0.5, sm: 0.75 }, pb: 0.5, pt: 0.25, minWidth: 0 }}>
          {calls.length > 0 ? (
            <StepList
              calls={calls}
              onEnterSubagent={onEnterSubagent}
              ancestorAgentIds={ancestorAgentIds}
            />
          ) : (
            <Typography color="text.secondary" sx={{ fontSize: "0.7rem" }}>
              No model calls recorded for this turn.
            </Typography>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}
