import { useEffect, useMemo, useState, type ReactNode, type SyntheticEvent } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";
import {
  Alert,
  Box,
  CircularProgress,
  Link,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import type { LogLineRef, SessionDetail } from "@shared/types";
import {
  formatTokens,
  totalTokens,
  contextSize,
} from "@shared/types";
import { api, formatDate } from "../lib/api";
import {
  findAncestorIds,
  findFirstToolCallByName,
  findNode,
  findOwningAgentId,
  findToolCallNodeId,
} from "../lib/tree";
import { HierarchyTree } from "../components/HierarchyTree";
import { HierarchyAgentMap } from "../components/HierarchyAgentMap";
import { ContextChart } from "../components/ContextChart";
import { ToolImpactList } from "../components/ToolImpactList";
import { AgentBreakdown } from "../components/AgentBreakdown";
import { AgentToolDiagram } from "../components/AgentToolDiagram";
import { TurnDetailPanel } from "../components/TurnDetailPanel";
import { LoadedContextPanel } from "../components/LoadedContextPanel";
import { LogLinePanel } from "../components/LogLinePanel";
import { SessionAnalysisPanel } from "../components/SessionAnalysisPanel";
import { SectionPaper, StatCard } from "../components/ui";
import { layout, motion } from "../theme";

type DetailTab =
  | "analysis"
  | "context"
  | "diagram"
  | "hierarchy"
  | "agents"
  | "tool-impact";
type ContextDetailTab = "turn" | "loaded";

const DETAIL_TABS: { id: DetailTab; label: string }[] = [
  { id: "analysis", label: "Analysis" },
  { id: "context", label: "Context" },
  { id: "diagram", label: "Diagram" },
  { id: "hierarchy", label: "Hierarchy" },
  { id: "agents", label: "Agents" },
  { id: "tool-impact", label: "Tool impact" },
];

function TabPanel({
  id,
  active,
  children,
}: {
  id: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Box
      role="tabpanel"
      id={`${id}-panel`}
      aria-labelledby={`${id}-tab`}
      hidden={!active}
      sx={{
        display: active ? "block" : "none",
        minWidth: 0,
        animation: active ? motion.riseFast : undefined,
      }}
    >
      {children}
    </Box>
  );
}

export function SessionDetailPage() {
  const { id } = useParams();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>("context");
  const [contextDetailTab, setContextDetailTab] =
    useState<ContextDetailTab>("turn");
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [modalLog, setModalLog] = useState<LogLineRef | null>(null);

  const openLogModal = (log: LogLineRef | null | undefined) => {
    setModalLog(log ?? null);
    setLogModalOpen(true);
  };

  const closeLogModal = () => {
    setLogModalOpen(false);
  };

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setDetail(null);
    setError(null);
    setFocusedNodeId(null);
    setActiveTab("context");
    setContextDetailTab("turn");
    setLogModalOpen(false);
    setModalLog(null);
    api<SessionDetail>(`/api/sessions/${id}`)
      .then((res) => {
        if (cancelled) return;
        setDetail(res);
        if (res.timeline[0]) setFocusedNodeId(res.timeline[0].nodeId);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleDetailTabChange = (
    _event: SyntheticEvent,
    next: DetailTab,
  ) => {
    setActiveTab(next);
  };

  const handleContextDetailTabChange = (
    _event: SyntheticEvent,
    next: ContextDetailTab,
  ) => {
    setContextDetailTab(next);
  };

  const focusedTurnIndex = useMemo(() => {
    if (!detail || !focusedNodeId) return -1;
    return detail.timeline.findIndex((p) => p.nodeId === focusedNodeId);
  }, [detail, focusedNodeId]);

  const focusedTurn =
    detail && focusedTurnIndex >= 0
      ? detail.timeline[focusedTurnIndex]
      : null;
  const previousTurn =
    detail && focusedTurnIndex > 0
      ? detail.timeline[focusedTurnIndex - 1]
      : null;

  const forceOpenIds = useMemo(() => {
    if (!detail || !focusedNodeId) return undefined;
    const ancestors = findAncestorIds(detail.tree, focusedNodeId);
    if (!ancestors) return undefined;
    return new Set(ancestors);
  }, [detail, focusedNodeId]);

  const selectedAgentId = useMemo(() => {
    if (!detail || !focusedNodeId) return null;
    return findOwningAgentId(detail.tree, focusedNodeId);
  }, [detail, focusedNodeId]);

  const focusedToolUseId = useMemo(() => {
    if (!detail || !focusedNodeId) return null;
    const node = findNode(detail.tree, focusedNodeId);
    if (!node || node.kind !== "tool_call") return null;
    return node.toolUseId ?? node.id;
  }, [detail, focusedNodeId]);

  const focusedToolName = useMemo(() => {
    if (!detail || !focusedNodeId) return null;
    const node = findNode(detail.tree, focusedNodeId);
    if (!node || node.kind !== "tool_call") return null;
    return node.toolName ?? null;
  }, [detail, focusedNodeId]);

  const focusToolCall = (toolUseId: string) => {
    if (!detail) return;
    const nodeId = findToolCallNodeId(detail.tree, toolUseId) ?? toolUseId;
    setFocusedNodeId(nodeId);
  };

  const focusToolByName = (toolName: string, agentId?: string) => {
    if (!detail) return;
    const nodeId = findFirstToolCallByName(
      detail.tree,
      toolName,
      agentId ?? null,
    );
    if (nodeId) setFocusedNodeId(nodeId);
  };

  const focusedLoadedContext = useMemo(() => {
    if (!detail?.loadedContext?.length) return null;
    if (focusedNodeId) {
      const exact = detail.loadedContext.find(
        (s) => s.nodeId === focusedNodeId,
      );
      if (exact) return exact;
      const ancestors = findAncestorIds(detail.tree, focusedNodeId);
      if (ancestors) {
        for (let i = ancestors.length - 1; i >= 0; i -= 1) {
          const snap = detail.loadedContext.find(
            (s) => s.nodeId === ancestors[i],
          );
          if (snap) return snap;
        }
      }
    }
    return (
      detail.loadedContext.find((s) => s.nodeId === focusedTurn?.nodeId) ??
      detail.loadedContext[0] ??
      null
    );
  }, [detail, focusedNodeId, focusedTurn?.nodeId]);

  const backLink = (
    <Link
      component={RouterLink}
      to="/"
      underline="hover"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        mb: 1.5,
        fontSize: "0.9rem",
      }}
    >
      ← All sessions
    </Link>
  );

  if (error) {
    return (
      <Box>
        {backLink}
        <SectionPaper>
          <Alert severity="error">Failed to load session: {error}</Alert>
        </SectionPaper>
      </Box>
    );
  }

  if (!detail) {
    return (
      <Box>
        {backLink}
        <SectionPaper>
          <CircularProgress size={28} sx={{ display: "block", mx: "auto" }} />
          <Typography color="text.secondary" align="center" sx={{ mt: 1.5 }}>
            Building session profile…
          </Typography>
        </SectionPaper>
      </Box>
    );
  }

  const { meta } = detail;

  return (
    <Box sx={{ minWidth: 0, maxWidth: "100%" }}>
      {backLink}

      <Stack
        direction={{ xs: "column", lg: "row" }}
        spacing={layout.sectionGap}
        sx={{
          justifyContent: "space-between",
          mb: layout.sectionGap,
          animation: motion.rise,
          minWidth: 0,
        }}
      >
        <Box sx={{ minWidth: 0, flex: "1 1 auto", pr: { lg: 1 } }}>
          <Typography
            variant="h1"
            sx={{
              m: 0,
              fontSize: { xs: "1.2rem", sm: "1.45rem", md: "1.9rem" },
              maxWidth: "40rem",
              wordBreak: "break-word",
              lineHeight: 1.25,
            }}
          >
            {meta.summary ?? "Untitled session"}
          </Typography>
          <Typography
            component="div"
            variant="mono"
            color="text.secondary"
            title={[
              meta.projectPath,
              meta.gitBranch,
              `${formatDate(meta.startedAt)} → ${formatDate(meta.updatedAt)}`,
            ]
              .filter(Boolean)
              .join(" · ")}
            sx={{
              mt: 0.5,
              fontSize: { xs: "0.7rem", sm: "0.78rem" },
              lineHeight: 1.4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {meta.projectPath}
            {meta.gitBranch ? ` · ${meta.gitBranch}` : ""}
            {" · "}
            {formatDate(meta.startedAt)} → {formatDate(meta.updatedAt)}
          </Typography>
          <Typography
            component="div"
            variant="mono"
            color="text.secondary"
            title={meta.filePath}
            sx={{
              mt: 0.75,
              fontSize: "0.72rem",
              lineHeight: 1.4,
              display: "flex",
              alignItems: "baseline",
              gap: 0.75,
              minWidth: 0,
            }}
          >
            <Box
              component="span"
              sx={{
                color: "text.disabled",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                fontSize: "0.65rem",
                flexShrink: 0,
              }}
            >
              Log
            </Box>
            <Box
              component="span"
              sx={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
              }}
            >
              {meta.filePath}
            </Box>
          </Typography>
        </Box>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "repeat(2, minmax(0, 1fr))",
              sm: "repeat(4, minmax(7.5rem, 1fr))",
              lg: "repeat(2, minmax(7.5rem, 1fr))",
              xl: "repeat(4, minmax(7.5rem, 1fr))",
            },
            gap: 0.75,
            flex: { lg: "0 0 18rem", xl: "0 0 34rem" },
            width: { xs: "100%", lg: "auto" },
            minWidth: 0,
          }}
        >
          <StatCard label="Total tokens" value={formatTokens(totalTokens(meta.usage))} />
          <StatCard label="Peak context" value={formatTokens(meta.peakContextTokens)} />
          <StatCard
            label="Cache read"
            value={formatTokens(meta.usage.cacheReadInputTokens)}
          />
          <StatCard label="Tool calls" value={String(meta.toolCallCount)} />
        </Box>
      </Stack>

      <Box
        sx={{
          borderBottom: 1,
          borderColor: "divider",
          mb: layout.sectionGap,
          animation: motion.rise,
          minWidth: 0,
        }}
      >
        <Tabs
          value={activeTab}
          onChange={handleDetailTabChange}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          aria-label="Session detail panels"
        >
          {DETAIL_TABS.map((tab) => (
            <Tab
              key={tab.id}
              value={tab.id}
              label={tab.label}
              id={`${tab.id}-tab`}
              aria-controls={`${tab.id}-panel`}
            />
          ))}
        </Tabs>
      </Box>

      <TabPanel id="analysis" active={activeTab === "analysis"}>
        <SessionAnalysisPanel sessionId={meta.id} />
      </TabPanel>

      <TabPanel id="context" active={activeTab === "context"}>
        <SectionPaper
          title="Context growth"
          description={`Context occupancy across assistant turns (${formatTokens(contextSize(meta.usage))} cumulative input+cache). Click a turn to inspect token composition and what was loaded into Claude's context at that moment.`}
          sx={{ animation: motion.riseMedium }}
        >
          <ContextChart
            points={detail.timeline}
            selectedNodeId={focusedNodeId}
            onSelect={(point) => setFocusedNodeId(point.nodeId)}
          />
          <Box
            sx={{
              mt: 2,
              borderBottom: 1,
              borderColor: "divider",
              minWidth: 0,
            }}
          >
            <Tabs
              value={contextDetailTab}
              onChange={handleContextDetailTabChange}
              variant="scrollable"
              scrollButtons="auto"
              allowScrollButtonsMobile
              aria-label="Selected turn panels"
            >
              <Tab
                value="turn"
                label="Turn detail"
                id="turn-tab"
                aria-controls="turn-panel"
              />
              <Tab
                value="loaded"
                label="Loaded context"
                id="loaded-tab"
                aria-controls="loaded-panel"
              />
            </Tabs>
          </Box>
          <TabPanel id="turn" active={contextDetailTab === "turn"}>
            <TurnDetailPanel
              point={focusedTurn}
              previous={previousTurn}
              onViewLog={(point) => openLogModal(point.log)}
            />
          </TabPanel>
          <TabPanel id="loaded" active={contextDetailTab === "loaded"}>
            <LoadedContextPanel
              snapshot={focusedLoadedContext}
              onSelectEvidence={(item) => {
                if (item.evidence) openLogModal(item.evidence);
              }}
            />
          </TabPanel>
        </SectionPaper>
      </TabPanel>

      <TabPanel id="diagram" active={activeTab === "diagram"}>
        <SectionPaper
          title="Agent ↔ tool calls"
          description="Who called what: root agent at the center. Each tool use is shown as an agent-scoped node with a link back to its caller (shared tool names are not merged across agents). Toggle agent labels between peak context and total tokens; circle size always tracks the number shown (agents and tools share one scale). Tool labels use attributed growth. Link thickness scales with call volume. All tool uses are linked by default; optionally collapse to top pairs (still keeping at least one link per agent). Drag nodes to rearrange, use Arrange to auto-layout (tools cluster near their callers), scroll or use +/− to zoom, and click an agent, tool, or link to highlight the matching hierarchy node."
          sx={{ animation: motion.riseMedium }}
        >
          <AgentToolDiagram
            rows={detail.agentBreakdown}
            toolImpact={detail.toolImpact}
            selectedAgentId={selectedAgentId}
            selectedToolName={focusedToolName}
            onSelectAgent={(agentId) => setFocusedNodeId(agentId)}
            onSelectTool={focusToolByName}
          />
        </SectionPaper>
      </TabPanel>

      <TabPanel id="hierarchy" active={activeTab === "hierarchy"}>
        <SectionPaper
          title="Agent & tool hierarchy"
          description={`Root agent → tool calls → results / subagents. Starts collapsed below level 1; use Expand all / Collapse all or the chevron on a node. Use the agent map on the right for quick jumps. Click a node to highlight it; use View transcript line to open the JSONL source. Assistant chips show that turn's API usage and window occupancy (ctx) — usually mostly cache/input from the prompt, not a sum of child tools. Tool +N nest chips are estimated I/O sizes only.${focusedNodeId ? " Highlighted node matches the selected timeline turn, Agents row, or Tool impact call." : ""}`}
          sx={{ animation: motion.riseMedium }}
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
                focusedNodeId={focusedNodeId}
                forceOpenIds={forceOpenIds}
                scrollFocusedIntoView={activeTab === "hierarchy"}
                onFocusNode={(nodeId) => {
                  setFocusedNodeId(nodeId);
                }}
                onViewLog={(node) => {
                  if (node.log) openLogModal(node.log);
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
                selectedAgentId={selectedAgentId}
                onSelectAgent={(agentId) => setFocusedNodeId(agentId)}
              />
            </Box>
          </Box>
        </SectionPaper>
      </TabPanel>

      <TabPanel id="agents" active={activeTab === "agents"}>
        <SectionPaper
          title="Agents"
          description="Usage diagram per agent: peak context, assistant turn count (including subagent transcripts), and tool-call volume (bars scaled within the session), plus a summary of the tools each agent used. Click an agent to highlight it in the Hierarchy tab. Selecting a tool call highlights the agent that ran it."
          sx={{ animation: motion.riseMedium }}
        >
          <AgentBreakdown
            rows={detail.agentBreakdown}
            selectedAgentId={selectedAgentId}
            onSelectAgent={(agentId) => setFocusedNodeId(agentId)}
          />
        </SectionPaper>
      </TabPanel>

      <TabPanel id="tool-impact" active={activeTab === "tool-impact"}>
        <SectionPaper
          title="Tool impact on context"
          description="Tools ranked by attributed context growth. Click a tool or call to highlight it in the Hierarchy tab and the agent that ran it."
          sx={{ animation: motion.riseMedium }}
        >
          <ToolImpactList
            rows={detail.toolImpact}
            focusedToolUseId={focusedToolUseId}
            onSelectCall={focusToolCall}
          />
        </SectionPaper>
      </TabPanel>

      <LogLinePanel
        log={modalLog}
        open={logModalOpen}
        onClose={closeLogModal}
      />
    </Box>
  );
}
