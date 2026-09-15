import { Alert, Box, Typography } from "@mui/material";
import { Navigate } from "react-router-dom";
import { formatTokens } from "@shared/types";
import { stepCountsByTurn } from "../../lib/turnSteps";
import { useSessionSelection } from "../../lib/useSessionSelection";
import { useSessionWorkspace } from "../SessionWorkspace";
import { TurnRail } from "../../components/session/TurnRail";
import { TurnDetailPane } from "../../components/session/TurnDetailPane";
import { EmptyState, SectionPaper } from "../../components/ui";
import { layout } from "../../theme";

/** Master/detail turn view: the rail is the one scroll region, the pane drills in. */
export function TurnsView() {
  const { index } = useSessionWorkspace();
  const { selection, goToTurn, goToStep, setTab, enterSubagent } =
    useSessionSelection();

  if (selection.scopeStatus === "unknown-agent") {
    return (
      <SectionPaper>
        <Alert severity="error">
          No agent{" "}
          <Typography component="span" variant="mono">
            {selection.scopeId}
          </Typography>{" "}
          in this session — the link may be stale.
        </Alert>
      </SectionPaper>
    );
  }

  if (selection.redirectTo) {
    return <Navigate to={selection.redirectTo} replace />;
  }

  const scope = index.scopes.get(selection.scopeId);

  if (!selection.turn || selection.turnNumber == null || !scope) {
    return (
      <SectionPaper>
        <EmptyState>No assistant turns recorded for this agent.</EmptyState>
      </SectionPaper>
    );
  }

  const { turn, turnNumber } = selection;
  // Counted off `modelCalls`, the same partition `TurnDetailPane` renders: a
  // `stepsByTurn` count would omit the turnless steps turn 1 lists.
  const stepCountByTurn = stepCountsByTurn(scope.modelCalls);
  const stepCount = stepCountByTurn.get(turnNumber) ?? 0;
  // A single-turn scope (the usual shape of a subagent) has nothing to navigate
  // between, so the rail collapses to a summary strip and the pane takes the
  // full width. Presentation only — turn numbering is unchanged.
  const collapsed = scope.timeline.length === 1;

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: collapsed
          ? "minmax(0, 1fr)"
          : { xs: "minmax(0, 1fr)", md: "22rem minmax(0, 1fr)" },
        gap: layout.sectionGap,
        alignItems: "start",
        minWidth: 0,
      }}
    >
      {collapsed ? (
        <SectionPaper sx={{ p: { xs: 1, sm: 1.25 } }}>
          <Typography
            variant="mono"
            color="text.secondary"
            sx={{ fontSize: "0.72rem" }}
          >
            1 turn · {formatTokens(turn.contextTokens)} context ·{" "}
            {stepCount} step{stepCount === 1 ? "" : "s"}
          </Typography>
        </SectionPaper>
      ) : (
        <TurnRail
          points={scope.timeline}
          stepCountByTurn={stepCountByTurn}
          activeTurn={turnNumber}
          onSelectTurn={goToTurn}
        />
      )}

      <TurnDetailPane
        previousTurn={scope.timeline[turnNumber - 2] ?? null}
        selection={selection}
        goToTurn={goToTurn}
        goToStep={goToStep}
        setTab={setTab}
        enterSubagent={enterSubagent}
      />
    </Box>
  );
}
