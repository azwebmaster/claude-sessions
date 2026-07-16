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
import type { SessionDetail } from "@shared/types";
import {
  formatTokens,
  totalTokens,
  contextSize,
} from "@shared/types";
import { api, formatDate } from "../lib/api";
import { findAncestorIds, findNode } from "../lib/tree";
import { HierarchyTree } from "../components/HierarchyTree";
import { ContextChart } from "../components/ContextChart";
import { ToolImpactList } from "../components/ToolImpactList";
import { AgentBreakdown } from "../components/AgentBreakdown";
import { TurnDetailPanel } from "../components/TurnDetailPanel";
import { LogLinePanel } from "../components/LogLinePanel";
import { SectionPaper, StatCard } from "../components/ui";
import { layout, motion } from "../theme";

export function SessionDetailPage() {
  const { id } = useParams();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setDetail(null);
    setError(null);
    setFocusedNodeId(null);
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
  const focusedNode =
    detail && focusedNodeId ? findNode(detail.tree, focusedNodeId) : null;
  const focusedLog = focusedTurn?.log ?? focusedNode?.log ?? null;

  const forceOpenIds = useMemo(() => {
    if (!detail || !focusedNodeId) return undefined;
    const ancestors = findAncestorIds(detail.tree, focusedNodeId);
    if (!ancestors) return undefined;
    return new Set(ancestors);
  }, [detail, focusedNodeId]);

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
    <Box>
      {backLink}

      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={layout.sectionGap}
        sx={{
          justifyContent: "space-between",
          mb: layout.sectionGap,
          animation: motion.rise,
        }}
      >
        <Box>
          <Typography
            variant="h1"
            sx={{
              m: 0,
              fontSize: { xs: "1.35rem", md: "1.9rem" },
              maxWidth: "40rem",
            }}
          >
            {meta.summary ?? "Untitled session"}
          </Typography>
          <Typography variant="mono" color="text.secondary" sx={{ mt: 0.5, fontSize: "0.78rem" }}>
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
            },
            gap: 0.75,
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
        description={`Context occupancy across assistant turns (${formatTokens(contextSize(meta.usage))} cumulative input+cache). Click a turn to jump the hierarchy to that moment.`}
        sx={{ mb: layout.sectionGap, animation: motion.riseMedium }}
      >
        <ContextChart
          points={detail.timeline}
          selectedNodeId={focusedNodeId}
          onSelect={(point) => setFocusedNodeId(point.nodeId)}
        />
        {focusedTurn ? (
          <TurnDetailPanel point={focusedTurn} previous={previousTurn} />
        ) : null}
        <LogLinePanel log={focusedLog} />
      </SectionPaper>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "1.15fr 0.85fr" },
          gap: layout.sectionGap,
          animation: motion.rise,
        }}
      >
        <SectionPaper
          title="Agent & tool hierarchy"
          description={`Root agent → tool calls → results / subagents. Click a node to inspect its JSONL source line. Assistant chips show that turn's API usage and window occupancy (ctx) — usually mostly cache/input from the prompt, not a sum of child tools. Tool +N nest chips are estimated I/O sizes only.${focusedNodeId ? " Highlighted node matches the selected timeline turn." : ""}`}
        >
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              gap: 0.5,
              maxHeight: "70vh",
              overflow: "auto",
              pr: 0.5,
            }}
          >
            <HierarchyTree
              node={detail.tree}
              defaultOpen
              focusedNodeId={focusedNodeId}
              forceOpenIds={forceOpenIds}
              onFocusNode={setFocusedNodeId}
            />
          </Box>
        </SectionPaper>

        <Stack spacing={layout.sectionGap}>
          <SectionPaper title="Agents">
            <AgentBreakdown rows={detail.agentBreakdown} />
          </SectionPaper>

          <SectionPaper
            title="Tool impact on context"
            description="Tools ranked by attributed context growth. Each tool shows its heaviest calls up front; expand for the full per-call list."
          >
            <ToolImpactList rows={detail.toolImpact} />
          </SectionPaper>
        </Stack>
      </Box>
    </Box>
  );
}
