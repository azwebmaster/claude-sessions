import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import type { SessionListItem } from "@shared/types";
import { formatTokens, totalTokens } from "@shared/types";
import { api, formatDate } from "../lib/api";

interface SessionsResponse {
  sessions: SessionListItem[];
  roots: string[];
  count: number;
}

const mono = '"IBM Plex Mono", ui-monospace, monospace';

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
      <Paper sx={{ p: 2.5 }}>
        <Typography color="error">Failed to load sessions: {error}</Typography>
      </Paper>
    );
  }

  if (!data) {
    return (
      <Paper sx={{ p: 2.5 }}>
        <Typography color="text.secondary" align="center">
          Scanning session files…
        </Typography>
      </Paper>
    );
  }

  return (
    <Box sx={{ animation: "rise 600ms ease both" }}>
      <Paper sx={{ p: 2.5 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          sx={{
            alignItems: { sm: "center" },
            justifyContent: "space-between",
            mb: 2,
          }}
        >
          <Typography>
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
            sx={{
              flex: "1 1 240px",
              minWidth: { xs: "100%", sm: 200 },
              maxWidth: 420,
            }}
          />
        </Stack>

        {filtered.length === 0 ? (
          <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
            No sessions matched. Claude Code stores transcripts under{" "}
            <Box component="span" sx={{ fontFamily: mono }}>
              ~/.claude/projects
            </Box>
            . Demo fixtures are included so you can explore the UI immediately.
          </Typography>
        ) : (
          <Table>
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
                  <TableCell>
                    <Typography sx={{ fontWeight: 600, letterSpacing: "-0.01em" }}>
                      {s.summary ?? "Untitled session"}
                    </Typography>
                    <Typography
                      sx={{
                        mt: 0.25,
                        fontFamily: mono,
                        fontSize: "0.75rem",
                        color: "text.secondary",
                      }}
                    >
                      {s.projectPath}
                    </Typography>
                    <Stack
                      direction="row"
                      spacing={0.75}
                      useFlexGap
                      sx={{ mt: 0.75, flexWrap: "wrap" }}
                    >
                      <Chip
                        size="small"
                        label={s.source}
                        color={s.source === "fixture" ? "info" : "success"}
                        variant="outlined"
                      />
                      {s.gitBranch ? (
                        <Chip size="small" label={s.gitBranch} variant="outlined" />
                      ) : null}
                      {s.model ? (
                        <Chip
                          size="small"
                          label={s.model.replace(/^claude-/, "")}
                          variant="outlined"
                        />
                      ) : null}
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ fontFamily: mono, fontSize: "0.85rem" }}>
                    {formatDate(s.updatedAt)}
                  </TableCell>
                  <TableCell sx={{ fontFamily: mono, fontSize: "0.85rem" }}>
                    {formatTokens(totalTokens(s.usage))}
                  </TableCell>
                  <TableCell sx={{ fontFamily: mono, fontSize: "0.85rem" }}>
                    {formatTokens(s.peakContextTokens)}
                  </TableCell>
                  <TableCell sx={{ fontFamily: mono, fontSize: "0.85rem" }}>
                    {s.toolCallCount}
                  </TableCell>
                  <TableCell sx={{ fontFamily: mono, fontSize: "0.85rem" }}>
                    {1 + s.subagentCount}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>
    </Box>
  );
}
