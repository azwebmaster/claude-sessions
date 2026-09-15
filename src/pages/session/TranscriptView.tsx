import { Box } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { HierarchyAgentMap } from "../../components/HierarchyAgentMap";
import { HierarchyTree } from "../../components/HierarchyTree";
import { SectionPaper } from "../../components/ui";
import { sessionTurnPath } from "../../lib/sessionSelection";
import { findOwningAgentId, findTimelineIndexForNode } from "../../lib/tree";
import { useSessionWorkspace } from "../SessionWorkspace";

/**
 * Escape hatch: the raw node hierarchy, with the agent map as its skinny nav.
 * Neither is a second "you are here" — a click resolves the node to a scope and
 * a turn and navigates out into the turn rail.
 */
export function TranscriptView() {
  const { detail, index, openLog, watch } = useSessionWorkspace();
  const navigate = useNavigate();
  const sessionId = detail.meta.id;

  const goToAgentTurn = (agentId: string, turn: number, step?: string) => {
    navigate(
      sessionTurnPath(sessionId, {
        agentId: agentId === index.rootAgentId ? null : agentId,
        turn,
        step: step ?? null,
        watch,
      }),
    );
  };

  const focusNode = (nodeId: string) => {
    // A tool_call node already has its scope and turn resolved in the index, and
    // its own id is a valid `?step=`.
    const step = index.stepByNodeId.get(nodeId);
    if (step && step.turn != null) {
      goToAgentTurn(step.agentId, step.turn, nodeId);
      return;
    }

    const agentId = findOwningAgentId(detail.tree, nodeId) ?? index.rootAgentId;
    const scope = index.scopes.get(agentId);
    if (!scope) return;
    // Steps are already handled above, so no `StepEntry` list is needed here to
    // map a node onto its turn.
    const timelineIndex = findTimelineIndexForNode(scope.timeline, [], nodeId);
    const turn = scope.timeline[timelineIndex]?.turn ?? 1;
    goToAgentTurn(agentId, turn);
  };

  return (
    <SectionPaper
      title="Raw transcript"
      description="Every transcript node as recorded. Selecting a node opens the turn it belongs to."
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "minmax(0, 1fr)",
            md: "minmax(0, 1fr) 11.5rem",
          },
          gap: { xs: 1.5, md: 2 },
          alignItems: "start",
          minWidth: 0,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <HierarchyTree
            node={detail.tree}
            onFocusNode={focusNode}
            onViewLog={(node) => {
              if (node.log) openLog(node.log);
            }}
          />
        </Box>
        <Box
          sx={{
            order: { xs: -1, md: 0 },
            position: { md: "sticky" },
            top: { md: 12 },
            alignSelf: "start",
            minWidth: 0,
            pl: { md: 1.5 },
            borderLeft: { md: 1 },
            borderColor: { md: "divider" },
            pb: { xs: 0.5, md: 0 },
            mb: { xs: 0.25, md: 0 },
            borderBottom: { xs: 1, md: 0 },
            borderBottomColor: { xs: "divider", md: "transparent" },
          }}
        >
          <HierarchyAgentMap
            rows={detail.agentBreakdown}
            onSelectAgent={(agentId) => {
              goToAgentTurn(agentId, 1);
            }}
          />
        </Box>
      </Box>
    </SectionPaper>
  );
}
