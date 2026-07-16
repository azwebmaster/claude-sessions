import { useEffect, useMemo, useState } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";
import {
  Alert,
  Box,
  CircularProgress,
  Link,
  Stack,
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
  findNode,
  findOwningAgentId,
  findToolCallNodeId,
} from "../lib/tree";
import { HierarchyTree } from "../components/HierarchyTree";
import { ContextChart } from "../components/ContextChart";
import { ToolImpactList } from "../components/ToolImpactList";
import { AgentBreakdown } from "../components/AgentBreakdown";
import { TurnDetailPanel } from "../components/TurnDetailPanel";
import { LoadedContextPanel } from "../components/LoadedContextPanel";
import { LogLinePanel } from "../components/LogLinePanel";
import { SectionPaper, StatCard } from "../components/ui";
import { layout, motion } from "../theme";

export function SessionDetailPage() {
  const { id } = useParams();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
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

  const focusToolCall = (toolUseId: string) => {
    if (!detail) return;
    const nodeId = findToolCallNodeId(detail.tree, toolUseId) ?? toolUseId;
    setFocusedNodeId(nodeId);
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
        <Box sx={{ minWidth: 0, flex: "1 1 auto" }}>
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
            variant="mono"
            color="text.secondary"
            sx={{
              mt: 0.5,
              fontSize: { xs: "0.7rem", sm: "0.78rem" },
              wordBreak: "break-word",
              lineHeight: 1.4,
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
              wordBreak: "break-all",
            }}
          >
            <Box
              component="span"
              sx={{
                color: "text.disabled",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                fontSize: "0.65rem",
                mr: 0.75,
              }}
            >
              Log
            </Box>
            {meta.filePath}
          </Typography>
        </Box>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "repeat(2, minmax(0, 1fr))",
              sm: "repeat(4, minmax(0, 1fr))",
              lg: "repeat(2, minmax(0, 1fr))",
              xl: "repeat(4, minmax(0, 1fr))",
            },
            gap: 0.75,
            flex: { lg: "0 1 22rem", xl: "0 1 28rem" },
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

      <SectionPaper
        title="Context growth"
        description={`Context occupancy across assistant turns (${formatTokens(contextSize(meta.usage))} cumulative input+cache). Click a turn to inspect token composition and what was loaded into Claude's context at that moment.`}
        sx={{ mb: layout.sectionGap, animation: motion.riseMedium }}
      >
        <ContextChart
          points={detail.timeline}
          selectedNodeId={focusedNodeId}
          onSelect={(point) => setFocusedNodeId(point.nodeId)}
        />
        {focusedTurn ? (
          <TurnDetailPanel
            point={focusedTurn}
            previous={previousTurn}
            onViewLog={(point) => openLogModal(point.log)}
          />
        ) : null}
        <LoadedContextPanel
          snapshot={focusedLoadedContext}
          onSelectEvidence={(item) => {
            if (item.evidence) openLogModal(item.evidence);
          }}
        />
      </SectionPaper>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "1.15fr 0.85fr" },
          gap: layout.sectionGap,
          animation: motion.rise,
          minWidth: 0,
          alignItems: "start",
        }}
      >
        <SectionPaper
          title="Agent & tool hierarchy"
          description={`Root agent → tool calls → results / subagents. Click a node to highlight it; use the chevron to expand or collapse; use View transcript line to open the JSONL source. Assistant chips show that turn's API usage and window occupancy (ctx) — usually mostly cache/input from the prompt, not a sum of child tools. Tool +N nest chips are estimated I/O sizes only.${focusedNodeId ? " Highlighted node matches the selected timeline turn, Agents row, or Tool impact call." : ""}`}
        >
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              gap: 0.5,
              maxHeight: { xs: "55vh", sm: "65vh", md: "70vh" },
              overflow: "auto",
              overscrollBehavior: "contain",
              WebkitOverflowScrolling: "touch",
              pr: 0.5,
              minWidth: 0,
            }}
          >
            <HierarchyTree
              node={detail.tree}
              defaultOpen
              focusedNodeId={focusedNodeId}
              forceOpenIds={forceOpenIds}
              onFocusNode={(nodeId) => {
                setFocusedNodeId(nodeId);
              }}
              onViewLog={(node) => {
                if (node.log) openLogModal(node.log);
              }}
            />
          </Box>
        </SectionPaper>

        <Stack spacing={layout.sectionGap} sx={{ minWidth: 0 }}>
          <SectionPaper
            title="Agents"
            description="Usage diagram per agent: peak context size and tool-call volume (bars scaled within the session), plus a summary of the tools each agent used. Click an agent to highlight it in the hierarchy. Selecting a tool call highlights the agent that ran it."
          >
            <AgentBreakdown
              rows={detail.agentBreakdown}
              selectedAgentId={selectedAgentId}
              onSelectAgent={(agentId) => setFocusedNodeId(agentId)}
            />
          </SectionPaper>

          <SectionPaper
            title="Tool impact on context"
            description="Tools ranked by attributed context growth. Click a tool or call to highlight it in the hierarchy and the agent that ran it."
          >
            <ToolImpactList
              rows={detail.toolImpact}
              focusedToolUseId={focusedToolUseId}
              onSelectCall={focusToolCall}
            />
          </SectionPaper>
        </Stack>
      </Box>

      <LogLinePanel
        log={modalLog}
        open={logModalOpen}
        onClose={closeLogModal}
      />
    </Box>
  );
}
