import { useEffect, useState } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";
import {
  Box,
  Link,
  Paper,
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
import { HierarchyTree } from "../components/HierarchyTree";
import { ContextChart } from "../components/ContextChart";
import { ToolImpactList } from "../components/ToolImpactList";
import { AgentBreakdown } from "../components/AgentBreakdown";

const mono = '"IBM Plex Mono", ui-monospace, monospace';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Box
      sx={{
        bgcolor: "action.hover",
        border: 1,
        borderColor: "divider",
        borderRadius: 1.5,
        px: 1.5,
        py: 1.25,
      }}
    >
      <Typography
        color="text.secondary"
        sx={{
          fontSize: "0.68rem",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </Typography>
      <Typography
        sx={{
          mt: 0.25,
          fontFamily: mono,
          fontSize: "1.05rem",
          fontWeight: 600,
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

export function SessionDetailPage() {
  const { id } = useParams();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setDetail(null);
    setError(null);
    api<SessionDetail>(`/api/sessions/${id}`)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

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
        <Paper sx={{ p: 2.5 }}>
          <Typography color="error">Failed to load session: {error}</Typography>
        </Paper>
      </Box>
    );
  }

  if (!detail) {
    return (
      <Box>
        {backLink}
        <Paper sx={{ p: 2.5 }}>
          <Typography color="text.secondary" align="center">
            Building session profile…
          </Typography>
        </Paper>
      </Box>
    );
  }

  const { meta } = detail;

  return (
    <Box>
      {backLink}

      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={2}
        sx={{
          justifyContent: "space-between",
          mb: 2,
          animation: "rise 400ms ease both",
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
          <Typography
            color="text.secondary"
            sx={{
              mt: 0.5,
              fontFamily: mono,
              fontSize: "0.78rem",
            }}
          >
            {meta.projectPath}
            {meta.gitBranch ? ` · ${meta.gitBranch}` : ""}
            {" · "}
            {formatDate(meta.startedAt)} → {formatDate(meta.updatedAt)}
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
          <Stat label="Total tokens" value={formatTokens(totalTokens(meta.usage))} />
          <Stat label="Peak context" value={formatTokens(meta.peakContextTokens)} />
          <Stat
            label="Cache read"
            value={formatTokens(meta.usage.cacheReadInputTokens)}
          />
          <Stat label="Tool calls" value={String(meta.toolCallCount)} />
        </Box>
      </Stack>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "1.15fr 0.85fr" },
          gap: 2,
          animation: "rise 450ms ease both",
        }}
      >
        <Paper sx={{ p: 2.5 }}>
          <Typography variant="h2" sx={{ mb: 1.5, fontSize: "1.1rem" }}>
            Agent & tool hierarchy
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0, mb: 1.5 }}>
            Root agent → tool calls → results / subagents. Token chips show
            usage; result nodes estimate how much each tool added to context.
          </Typography>
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
            <HierarchyTree node={detail.tree} defaultOpen />
          </Box>
        </Paper>

        <Stack spacing={2}>
          <Paper sx={{ p: 2.5 }}>
            <Typography variant="h2" sx={{ mb: 1.5, fontSize: "1.1rem" }}>
              Context size over turns
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0, mb: 1.5 }}>
              Each bar is an assistant turn&apos;s context occupancy (
              {formatTokens(contextSize(meta.usage))} cumulative input+cache).
            </Typography>
            <ContextChart points={detail.timeline} />
          </Paper>

          <Paper sx={{ p: 2.5 }}>
            <Typography variant="h2" sx={{ mb: 1.5, fontSize: "1.1rem" }}>
              Agents
            </Typography>
            <AgentBreakdown rows={detail.agentBreakdown} />
          </Paper>

          <Paper sx={{ p: 2.5 }}>
            <Typography variant="h2" sx={{ mb: 1.5, fontSize: "1.1rem" }}>
              Tool impact on context
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0, mb: 1.5 }}>
              Tools ranked by attributed context growth. Click any tool to
              inspect individual calls, inputs, and result sizes.
            </Typography>
            <ToolImpactList rows={detail.toolImpact} />
          </Paper>
        </Stack>
      </Box>
    </Box>
  );
}
