import { useEffect, useMemo } from "react";
import { Box, Button, Stack, Tab, Tabs, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import type {
  ContextTimelinePoint,
  LogLineRef,
  SessionDetail,
} from "@shared/types";
import { formatTokens } from "@shared/types";
import { buildUsageParts, formatTurnSpan } from "../../lib/contextUsageParts";
import type { ResolvedSelection, TurnDetailTab } from "../../lib/sessionSelection";
import { findAncestorIds } from "../../lib/tree";
import { callsForTurn, turnDurationMs } from "../../lib/turnSteps";
import { nodeKindStyle, usagePartColors } from "../../theme";
import { LoadedContextPanel } from "../LoadedContextPanel";
import { EmptyState, SectionPaper, TaggedText } from "../ui";
import { useSessionWorkspace } from "../../pages/SessionWorkspace";
import { StepList } from "./StepList";
import { TurnStepChart } from "./TurnStepChart";

function exact(n: number): string {
  return n.toLocaleString();
}

/**
 * Context composition for one turn — moved from `TurnDetailPanel`'s
 * `TurnDetailBody`. The "View transcript line" control it used to own now lives
 * in the pane header, so it takes no log callback.
 */
function TurnContextBody({
  point,
  previous,
}: {
  point: ContextTimelinePoint;
  previous: ContextTimelinePoint | null;
}) {
  const theme = useTheme();
  const colors = usagePartColors(theme);
  const subagentStyle = nodeKindStyle(theme, "subagent");

  const parts = buildUsageParts(point, colors);

  const contextParts = parts.filter((p) => p.inContext && p.value > 0);
  const contextTotal = Math.max(
    point.contextTokens,
    contextParts.reduce((sum, p) => sum + p.value, 0),
    1,
  );
  const delta =
    previous == null ? null : point.contextTokens - previous.contextTokens;
  const isBaseline = previous == null;
  const durationMs = turnDurationMs(point);
  const modelCallCount = point.memberNodeIds.length;

  return (
    <Box sx={{ pt: 0.25 }}>
      {durationMs != null || modelCallCount > 1 ? (
        <Typography color="text.secondary" sx={{ fontSize: "0.72rem", mb: 0.75 }}>
          {durationMs != null ? `Duration ${formatTurnSpan(durationMs)}` : null}
          {durationMs != null && modelCallCount > 1 ? " · " : null}
          {modelCallCount > 1 ? `${modelCallCount} model calls` : null}
        </Typography>
      ) : null}
      <Typography color="text.secondary" sx={{ fontSize: "0.82rem", mb: 1.5 }}>
        {isBaseline ? (
          <>
            <Typography component="span" variant="mono" sx={{ fontWeight: 600 }}>
              {formatTokens(point.contextTokens)}
            </Typography>{" "}
            ({exact(point.contextTokens)}) is the{" "}
            <Box component="span" sx={{ fontWeight: 650 }}>
              baseline context window
            </Box>{" "}
            for this API call — mostly system prompt, tool schemas, and cached
            conversation — not tokens added by the nested tool calls under this
            Assistant node.
          </>
        ) : (
          <>
            Context occupancy{" "}
            <Typography component="span" variant="mono" sx={{ fontWeight: 600 }}>
              {formatTokens(point.contextTokens)}
            </Typography>{" "}
            ({exact(point.contextTokens)})
            {delta != null && delta !== 0
              ? `, ${delta > 0 ? "+" : ""}${exact(delta)} vs prior turn`
              : ", unchanged vs prior turn"}
            . Nested tool <Typography component="span" variant="mono">+N est</Typography>{" "}
            chips are estimated I/O sizes only.
          </>
        )}
      </Typography>

      <Box
        sx={{
          display: "flex",
          height: 12,
          borderRadius: 1,
          overflow: "hidden",
          bgcolor: "action.selected",
          mb: 1.25,
        }}
        role="img"
        aria-label="Context composition bar"
      >
        {contextParts.map((p) => (
          <Box
            key={p.key}
            title={`${p.label}: ${exact(p.value)}`}
            sx={{
              width: `${(p.value / contextTotal) * 100}%`,
              minWidth: p.value > 0 ? 4 : 0,
              bgcolor: p.color,
            }}
          />
        ))}
      </Box>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, minmax(0, 1fr))",
          },
          gap: 0.75,
        }}
      >
        {parts.map((p) => (
          <Box
            key={p.key}
            sx={{
              display: "grid",
              gridTemplateColumns: "auto 1fr auto",
              gap: 1,
              alignItems: "start",
              px: 1,
              py: 0.85,
              borderRadius: 1,
              bgcolor: "background.paper",
              border: 1,
              borderColor: "divider",
              opacity: p.value === 0 ? 0.55 : 1,
            }}
          >
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: 0.5,
                bgcolor: p.color,
                mt: 0.55,
              }}
            />
            <Box>
              <Typography sx={{ fontSize: "0.8rem", fontWeight: 600 }}>
                {p.label}
                {!p.inContext ? " · billed only" : ""}
              </Typography>
              <Typography color="text.secondary" sx={{ fontSize: "0.72rem" }}>
                {p.hint}
              </Typography>
            </Box>
            <Typography
              variant="mono"
              sx={{
                fontSize: "0.78rem",
                fontWeight: 650,
                textAlign: "right",
                whiteSpace: "nowrap",
              }}
            >
              {formatTokens(p.value)}
              <Box
                component="div"
                sx={{
                  fontWeight: 400,
                  color: "text.secondary",
                  fontSize: "0.68rem",
                }}
              >
                {exact(p.value)}
              </Box>
            </Typography>
          </Box>
        ))}
      </Box>

      <Typography variant="mono" color="text.secondary" sx={{ mt: 1.25, fontSize: "0.72rem" }}>
        ctx (end-of-turn snapshot) = {exact(point.contextTokens)}
        {modelCallCount === 1 ? (
          <>
            {" · "}
            billed total (ctx + output) ={" "}
            {exact(point.contextTokens + point.outputTokens)}
          </>
        ) : null}
      </Typography>

      {point.causedBy.length > 0 ? (
        <Box sx={{ mt: 1.25 }}>
          <Typography sx={{ fontSize: "0.78rem", fontWeight: 600, mb: 0.5 }}>
            Caused by
          </Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.4 }}>
            {point.causedBy.map((call) => (
              <Typography
                key={call.toolUseId}
                variant="mono"
                color="text.secondary"
                sx={{ fontSize: "0.72rem" }}
              >
                +{formatTokens(call.contextGrowthAttributed)} from{" "}
                {call.inputPreview ? (
                  <TaggedText value={call.inputPreview} />
                ) : (
                  "tool result"
                )}
              </Typography>
            ))}
          </Box>
        </Box>
      ) : null}

      {point.subagentLaunches.length > 0 ? (
        <Box sx={{ mt: 1.25 }}>
          <Typography sx={{ fontSize: "0.78rem", fontWeight: 600, mb: 0.5 }}>
            Launched subagent
          </Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.4 }}>
            {point.subagentLaunches.map((launch) => (
              <Box
                key={launch.toolUseId}
                sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
              >
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    bgcolor: subagentStyle.color,
                  }}
                />
                <Typography variant="mono" sx={{ fontSize: "0.72rem" }}>
                  {launch.label} · peak {formatTokens(launch.peakContextTokens)} ·{" "}
                  {launch.turnCount} turns · {launch.toolCallCount} tool calls
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}

/**
 * Loaded-context inventory for the current position. Only mounted while the
 * Loaded tab is open, so the `findAncestorIds` tree walk stays off the path of
 * every turn change. Root scope only: `detail.loadedContext` is reconstructed
 * from the root transcript, so no subagent turn has a snapshot in it.
 */
function TurnLoadedBody({
  detail,
  focusNodeId,
  turnNodeId,
  onOpenLog,
}: {
  detail: SessionDetail;
  focusNodeId: string | null;
  turnNodeId: string;
  onOpenLog: (log: LogLineRef) => void;
}) {
  const snapshot = useMemo(() => {
    if (!detail.loadedContext.length) return null;
    if (focusNodeId) {
      const hit = detail.loadedContext.find((s) => s.nodeId === focusNodeId);
      if (hit) return hit;
      const ancestors = findAncestorIds(detail.tree, focusNodeId);
      if (ancestors) {
        for (let i = ancestors.length - 1; i >= 0; i -= 1) {
          const snap = detail.loadedContext.find(
            (s) => s.nodeId === ancestors[i],
          );
          if (snap) return snap;
        }
      }
    }
    // No `loadedContext[0]` fallback: a snapshot that is not this turn's would
    // read as this turn's inventory.
    return detail.loadedContext.find((s) => s.nodeId === turnNodeId) ?? null;
  }, [detail, focusNodeId, turnNodeId]);

  return (
    <LoadedContextPanel
      snapshot={snapshot}
      onSelectEvidence={(item) => {
        if (!item.evidence) return;
        onOpenLog(item.evidence);
      }}
    />
  );
}

interface Props {
  previousTurn: ContextTimelinePoint | null;
  selection: ResolvedSelection;
  goToTurn: (turn: number) => void;
  goToStep: (nodeId: string | null) => void;
  setTab: (tab: TurnDetailTab) => void;
  enterSubagent: (agentId: string) => void;
}

/** Turn → step → tool result, with the sub-tab bound to `?tab=`. */
export function TurnDetailPane({
  previousTurn,
  selection,
  goToTurn,
  goToStep,
  setTab,
  enterSubagent,
}: Props) {
  const { detail, index, openLog } = useSessionWorkspace();
  const { tab, stepId, turn, turnNumber } = selection;
  const isRootScope = selection.scopeId === index.rootAgentId;

  // The list is built from the scope's model calls, so a call that emitted no
  // tool_use block still gets a row. `callsForTurn` owns the rule that turn 1
  // absorbs the `turn == null` calls — which are in no `stepsByTurn` bucket and
  // would otherwise render nowhere — so the rail row and the collapsed strip
  // can count that same partition instead of re-deriving it.
  //
  // Kept unfiltered (unlike `visibleCalls` below) because this is also what
  // `TurnStepChart`/`StepList` render from, and `StepList`'s
  // `buildStepRunningContext` needs every call's `context.contextAfter` —
  // including a tool-less call's — to keep its running total from going
  // stale after a call this turn had no steps.
  const calls = useMemo(() => {
    const scope = index.scopes.get(selection.scopeId);
    if (!scope || turnNumber == null) return [];
    return callsForTurn(scope.modelCalls, turnNumber);
  }, [index, selection.scopeId, turnNumber]);

  // A `ModelCall` with no steps (a tool-less assistant response) renders
  // no row — `StepList`'s `ModelCallGroup` returns null for
  // `call.steps.length === 0`. This filtered view is only for the tab label
  // and the empty-state check, so `Calls (${visibleCalls.length})` cannot
  // disagree with the rows actually rendered below it, while `calls` itself
  // stays unfiltered for the chart/list that compute running totals from it.
  const visibleCalls = useMemo(
    () => calls.filter((call) => call.steps.length > 0),
    [calls],
  );

  // Scrolls the row a chart click just selected into view: `?step=` can land
  // on a row the list didn't have on screen. Document-wide, not scoped to a
  // ref, since the step list is not inside its own scroll container (compare
  // `TurnRail.tsx`, which scrolls within its own list box).
  useEffect(() => {
    if (!stepId) return;
    const frame = window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-step-id="${stepId}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [stepId]);

  // `TurnsView` renders this pane only once `selection` has resolved a turn.
  if (!turn || turnNumber == null) return null;

  return (
    <SectionPaper sx={{ minWidth: 0 }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", justifyContent: "space-between", mb: 1 }}
      >
        <Typography variant="mono" sx={{ fontSize: "0.9rem", fontWeight: 650 }}>
          Turn {turnNumber} of {selection.turnCount}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
          <Button
            size="small"
            variant="outlined"
            disabled={selection.prevTurn == null}
            onClick={() => goToTurn(selection.prevTurn!)}
          >
            ← Prev
          </Button>
          <Button
            size="small"
            variant="outlined"
            disabled={selection.nextTurn == null}
            onClick={() => goToTurn(selection.nextTurn!)}
          >
            Next →
          </Button>
        </Stack>
      </Stack>

      {turn.promptPreview ? (
        <Typography sx={{ fontSize: "0.88rem", whiteSpace: "pre-wrap", mb: 0.75 }}>
          <TaggedText value={turn.promptPreview} />
        </Typography>
      ) : (
        <Typography color="text.secondary" sx={{ fontSize: "0.85rem", mb: 0.75 }}>
          No prompt text recorded for this turn.
        </Typography>
      )}

      <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", rowGap: 0.75 }}>
        {turn.promptLog ? (
          <Button
            size="small"
            variant="outlined"
            onClick={() => openLog(turn.promptLog!)}
            sx={{ fontSize: "0.72rem", py: 0.15, px: 1 }}
          >
            View prompt line
          </Button>
        ) : null}
        <Button
          size="small"
          variant="text"
          onClick={() => openLog(turn.log)}
          sx={{ fontSize: "0.72rem", py: 0.15, px: 1 }}
        >
          View transcript line
        </Button>
      </Stack>

      <Box sx={{ borderBottom: 1, borderColor: "divider", mt: 1.25, mb: 1.25 }}>
        <Tabs
          value={tab}
          onChange={(_, next: TurnDetailTab) => setTab(next)}
          aria-label="Turn detail sections"
          variant="scrollable"
          scrollButtons="auto"
        >
          {/* Counted off `visibleCalls`, filtered to the same calls `StepList`
              actually renders a row for, so the label cannot disagree with
              the rows. `stepsByTurn` would undercount for a different reason:
              it holds no entry for a call that emitted no tool block, and
              drops turnless steps entirely. */}
          <Tab value="steps" label={`Calls (${visibleCalls.length})`} />
          <Tab value="context" label="Context" />
          <Tab value="loaded" label="Loaded" />
        </Tabs>
      </Box>

      {tab === "steps" ? (
        visibleCalls.length === 0 ? (
          <EmptyState>No model calls recorded for this turn.</EmptyState>
        ) : (
          <>
            <TurnStepChart
              calls={calls}
              selectedStepId={stepId}
              onSelectStep={goToStep}
            />
            <StepList
              calls={calls}
              selectedStepId={stepId}
              onSelectStep={goToStep}
              onEnterSubagent={enterSubagent}
            />
          </>
        )
      ) : null}

      {tab === "context" ? (
        <TurnContextBody point={turn} previous={previousTurn} />
      ) : null}

      {tab === "loaded" ? (
        isRootScope ? (
          <TurnLoadedBody
            detail={detail}
            focusNodeId={stepId}
            turnNodeId={turn.nodeId}
            onOpenLog={openLog}
          />
        ) : (
          <EmptyState>
            Loaded-context inventory is reconstructed from the root transcript
            only — it is not available inside a subagent scope.
          </EmptyState>
        )
      ) : null}
    </SectionPaper>
  );
}
