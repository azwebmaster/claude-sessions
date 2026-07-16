import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import type { SessionListItem } from "@shared/types";
import { formatTokens, totalTokens } from "@shared/types";
import { EmptyState, SectionPaper } from "../components/ui";
import { api, formatDate } from "../lib/api";
import { layout, motion } from "../theme";

interface SessionsResponse {
  sessions: SessionListItem[];
  roots: string[];
  count: number;
}

function SessionChips({ session }: { session: SessionListItem }) {
  return (
    <Stack direction="row" spacing={0.75} useFlexGap sx={{ mt: 0.75, flexWrap: "wrap" }}>
      <Chip
        size="small"
        label={session.source}
        color={session.source === "fixture" ? "info" : "success"}
        variant="outlined"
      />
      {session.gitBranch ? (
        <Chip size="small" label={session.gitBranch} variant="outlined" />
      ) : null}
      {session.model ? (
        <Chip
          size="small"
          label={session.model.replace(/^claude-/, "")}
          variant="outlined"
        />
      ) : null}
    </Stack>
  );
}

function SessionCard({
  session,
  onOpen,
}: {
  session: SessionListItem;
  onOpen: () => void;
}) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onOpen}
      sx={{
        display: "block",
        width: "100%",
        textAlign: "left",
        border: 1,
        borderColor: "divider",
        borderRadius: 1.5,
        bgcolor: "action.hover",
        px: 1.5,
        py: 1.25,
        cursor: "pointer",
        color: "inherit",
        font: "inherit",
        transition: "border-color 150ms ease, background 150ms ease",
        "&:hover": {
          borderColor: "primary.main",
          bgcolor: "action.selected",
        },
      }}
    >
      <Typography variant="subtitle2" sx={{ wordBreak: "break-word" }}>
        {session.summary ?? "Untitled session"}
      </Typography>
      <Typography
        variant="mono"
        color="text.secondary"
        sx={{
          mt: 0.25,
          fontSize: "0.72rem",
          wordBreak: "break-all",
          lineHeight: 1.35,
        }}
      >
        {session.projectPath}
      </Typography>
      <SessionChips session={session} />
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 0.75,
          mt: 1.25,
        }}
      >
        {(
          [
            ["Updated", formatDate(session.updatedAt)],
            ["Tokens", formatTokens(totalTokens(session.usage))],
            ["Peak ctx", formatTokens(session.peakContextTokens)],
            ["Tools / agents", `${session.toolCallCount} / ${1 + session.subagentCount}`],
          ] as const
        ).map(([label, value]) => (
          <Box key={label} sx={{ minWidth: 0 }}>
            <Typography
              component="div"
              variant="overline"
              color="text.secondary"
              sx={{ display: "block", fontSize: "0.62rem", lineHeight: 1.25 }}
            >
              {label}
            </Typography>
            <Typography
              component="div"
              variant="mono"
              title={value}
              sx={{
                display: "block",
                fontSize: "0.8rem",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {value}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export function SessionListPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<SessionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    api<SessionsResponse>("/api/sessions")
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.sessions;
    return data.sessions.filter((s) => {
      const hay = [
        s.summary ?? "",
        s.projectPath,
        s.id,
        s.model ?? "",
        s.gitBranch ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [data, query]);

  if (error) {
    return (
      <SectionPaper>
        <Alert severity="error">Failed to load sessions: {error}</Alert>
      </SectionPaper>
    );
  }

  if (!data) {
    return (
      <SectionPaper>
        <CircularProgress size={28} sx={{ display: "block", mx: "auto" }} />
        <Typography color="text.secondary" align="center" sx={{ mt: 1.5 }}>
          Scanning session files…
        </Typography>
      </SectionPaper>
    );
  }

  return (
    <Box sx={{ animation: motion.riseSlow, minWidth: 0 }}>
      <SectionPaper>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          sx={{
            alignItems: { sm: "center" },
            justifyContent: "space-between",
            mb: 2,
          }}
        >
          <Typography sx={{ fontSize: { xs: "0.9rem", sm: "1rem" } }}>
            <Box component="strong">{data.count}</Box>{" "}
            <Box component="span" sx={{ color: "text.secondary" }}>
              sessions on this system
            </Box>
          </Typography>
          <TextField
            size="small"
            placeholder="Filter by project, summary, model, branch…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter sessions"
            fullWidth
            sx={{
              flex: { sm: "1 1 240px" },
              minWidth: 0,
              maxWidth: { sm: 420 },
              alignSelf: { sm: "stretch" },
            }}
          />
        </Stack>

        {filtered.length === 0 ? (
          <EmptyState sx={{ py: 4 }}>
            No sessions matched. Claude Code stores transcripts under{" "}
            <Typography component="span" variant="mono" sx={{ fontSize: "inherit" }}>
              ~/.claude/projects
            </Typography>
            . Demo fixtures are included so you can explore the UI immediately.
          </EmptyState>
        ) : (
          <>
            {/* Stacked cards on phones / small tablets */}
            <Stack
              spacing={1}
              sx={{ display: { xs: "flex", [layout.tableMinBreakpoint]: "none" } }}
            >
              {filtered.map((s) => (
                <SessionCard
                  key={`${s.projectEncoded}-${s.id}`}
                  session={s}
                  onOpen={() => navigate(`/sessions/${s.id}`)}
                />
              ))}
            </Stack>

            {/* Full table from md up */}
            <TableContainer
              sx={{
                display: { xs: "none", [layout.tableMinBreakpoint]: "block" },
                overflowX: "auto",
                maxWidth: "100%",
              }}
            >
              <Table sx={{ minWidth: 720 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Session</TableCell>
                    <TableCell>Updated</TableCell>
                    <TableCell>Tokens</TableCell>
                    <TableCell>Peak ctx</TableCell>
                    <TableCell>Tools</TableCell>
                    <TableCell>Agents</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filtered.map((s) => (
                    <TableRow
                      key={`${s.projectEncoded}-${s.id}`}
                      hover
                      sx={{ cursor: "pointer" }}
                      onClick={() => navigate(`/sessions/${s.id}`)}
                    >
                      <TableCell sx={{ maxWidth: 420 }}>
                        <Typography variant="subtitle2">{s.summary ?? "Untitled session"}</Typography>
                        <Typography
                          variant="mono"
                          color="text.secondary"
                          sx={{
                            mt: 0.25,
                            fontSize: "0.75rem",
                            wordBreak: "break-all",
                          }}
                        >
                          {s.projectPath}
                        </Typography>
                        <SessionChips session={s} />
                      </TableCell>
                      <TableCell>
                        <Typography variant="mono" sx={{ fontSize: "0.85rem" }}>
                          {formatDate(s.updatedAt)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="mono" sx={{ fontSize: "0.85rem" }}>
                          {formatTokens(totalTokens(s.usage))}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="mono" sx={{ fontSize: "0.85rem" }}>
                          {formatTokens(s.peakContextTokens)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="mono" sx={{ fontSize: "0.85rem" }}>
                          {s.toolCallCount}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="mono" sx={{ fontSize: "0.85rem" }}>
                          {1 + s.subagentCount}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}
      </SectionPaper>
    </Box>
  );
}
