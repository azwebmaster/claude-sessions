import { Box } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { AgentBreakdown } from "../../components/AgentBreakdown";
import { ToolLeaderboard } from "../../components/session/ToolLeaderboard";
import { SectionPaper } from "../../components/ui";
import { sessionTurnPath } from "../../lib/sessionSelection";
import { layout } from "../../theme";
import { useSessionWorkspace } from "../SessionWorkspace";

export function ToolsView() {
  const { detail, index, watch } = useSessionWorkspace();
  const navigate = useNavigate();
  const sessionId = detail.meta.id;

  return (
    <Box
      sx={{ display: "flex", flexDirection: "column", gap: layout.sectionGap }}
    >
      <SectionPaper
        title="Tool leaderboard"
        description="Tools ranked by the context growth attributed to their results. Expand one to jump to the turn that issued its heaviest calls."
      >
        <ToolLeaderboard
          rows={detail.toolImpact}
          index={index}
          sessionId={sessionId}
          watch={watch}
        />
      </SectionPaper>

      <SectionPaper
        title="Agents"
        description="Per-agent usage and tool counts. Selecting an agent opens its first turn."
      >
        <AgentBreakdown
          rows={detail.agentBreakdown}
          onSelectAgent={(agentId) => {
            navigate(
              sessionTurnPath(sessionId, {
                agentId: agentId === index.rootAgentId ? null : agentId,
                turn: 1,
                watch,
              }),
            );
          }}
        />
      </SectionPaper>
    </Box>
  );
}
