import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Typography,
} from "@mui/material";
import type { SessionListItem } from "@shared/types";
import { formatTokens, totalTokens } from "@shared/types";
import { EmptyState, SectionPaper } from "../components/ui";
import { api, formatDate } from "../lib/api";
import {
  AGE_PRESETS,
  boundsFromInputs,
  hasActiveMetricFilters,
  matchesSessionFilters,
  type SessionListFilters,
} from "../lib/sessionFilters";
import {
  DEFAULT_SESSION_SORT,
  nextSessionSort,
  SESSION_SORT_OPTIONS,
  sortSessions,
  type SessionListSort,
  type SessionSortKey,
} from "../lib/sessionSort";
import { layout, monoFontFamily, motion } from "../theme";

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

function MetricRangeFields({
  label,
  min,
  max,
  onMinChange,
  onMaxChange,
  minPlaceholder = "Min",
  maxPlaceholder = "Max",
}: {
  label: string;
  min: string;
  max: string;
  onMinChange: (value: string) => void;
  onMaxChange: (value: string) => void;
  minPlaceholder?: string;
  maxPlaceholder?: string;
}) {
  const fieldSx = {
    width: { xs: "100%", sm: 88 },
    minWidth: 0,
    "& .MuiInputBase-input": {
      fontFamily: monoFontFamily,
      fontSize: "0.8rem",
    },
  } as const;

  return (
    <Stack
      direction="row"
      spacing={0.75}
      useFlexGap
      sx={{ alignItems: "center", flexWrap: "wrap", minWidth: 0 }}
    >
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ minWidth: { sm: 64 }, flexShrink: 0 }}
      >
        {label}
      </Typography>
      <TextField
        size="small"
        label={minPlaceholder}
        value={min}
        onChange={(e) => onMinChange(e.target.value)}
        aria-label={`${label} minimum`}
        sx={fieldSx}
      />
      <Typography variant="caption" color="text.secondary" aria-hidden>
        –
      </Typography>
      <TextField
        size="small"
        label={maxPlaceholder}
        value={max}
        onChange={(e) => onMaxChange(e.target.value)}
        aria-label={`${label} maximum`}
        sx={fieldSx}
      />
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
            ["Turns", String(session.turnCount)],
            [
              "Tools / agents",
              `${session.toolCallCount} / ${1 + session.subagentCount}`,
            ],
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
  const [tokensMin, setTokensMin] = useState("");
  const [tokensMax, setTokensMax] = useState("");
  const [peakCtxMin, setPeakCtxMin] = useState("");
  const [peakCtxMax, setPeakCtxMax] = useState("");
  const [turnsMin, setTurnsMin] = useState("");
  const [turnsMax, setTurnsMax] = useState("");
  const [maxAgeMs, setMaxAgeMs] = useState<number | null>(null);
  const [sort, setSort] = useState<SessionListSort>(DEFAULT_SESSION_SORT);

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

  const filters: SessionListFilters = useMemo(
    () => ({
      query,
      tokens: boundsFromInputs(tokensMin, tokensMax),
      peakCtx: boundsFromInputs(peakCtxMin, peakCtxMax),
      turns: boundsFromInputs(turnsMin, turnsMax),
      maxAgeMs,
    }),
    [
      query,
      tokensMin,
      tokensMax,
      peakCtxMin,
      peakCtxMax,
      turnsMin,
      turnsMax,
      maxAgeMs,
    ],
  );

  const filtered = useMemo(() => {
    if (!data) return [];
    const nowMs = Date.now();
    const matched = data.sessions.filter((s) =>
      matchesSessionFilters(s, filters, nowMs),
    );
    return sortSessions(matched, sort);
  }, [data, filters, sort]);

  const metricsActive = hasActiveMetricFilters(filters);
  const textActive = query.trim().length > 0;
  const anyFilterActive = metricsActive || textActive;
  const sortActive =
    sort.key !== DEFAULT_SESSION_SORT.key ||
    sort.direction !== DEFAULT_SESSION_SORT.direction;

  const handleSortClick = (key: SessionSortKey) => {
    setSort((current) => nextSessionSort(current, key));
  };

  const sortHeader = (key: SessionSortKey, label: string) => (
    <TableSortLabel
      active={sort.key === key}
      direction={sort.key === key ? sort.direction : "asc"}
      onClick={() => handleSortClick(key)}
    >
      {label}
    </TableSortLabel>
  );

  const clearMetricFilters = () => {
    setTokensMin("");
    setTokensMax("");
    setPeakCtxMin("");
    setPeakCtxMax("");
    setTurnsMin("");
    setTurnsMax("");
    setMaxAgeMs(null);
  };

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
            mb: 1.5,
          }}
        >
          <Typography sx={{ fontSize: { xs: "0.9rem", sm: "1rem" } }}>
            <Box component="strong">
              {anyFilterActive ? `${filtered.length} / ${data.count}` : data.count}
            </Box>{" "}
            <Box component="span" sx={{ color: "text.secondary" }}>
              {anyFilterActive ? "sessions match" : "sessions on this system"}
            </Box>
          </Typography>
          <TextField
            size="small"
            placeholder="Filter by project, summary, model, branch…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter sessions by text"
            fullWidth
            sx={{
              flex: { sm: "1 1 240px" },
              minWidth: 0,
              maxWidth: { sm: 420 },
              alignSelf: { sm: "stretch" },
            }}
          />
        </Stack>

        <Stack
          direction="row"
          spacing={1.5}
          useFlexGap
          sx={{
            alignItems: "center",
            flexWrap: "wrap",
            mb: 2,
            rowGap: 1.25,
          }}
        >
          <MetricRangeFields
            label="Tokens"
            min={tokensMin}
            max={tokensMax}
            onMinChange={setTokensMin}
            onMaxChange={setTokensMax}
            minPlaceholder="Min"
            maxPlaceholder="Max"
          />
          <MetricRangeFields
            label="Peak ctx"
            min={peakCtxMin}
            max={peakCtxMax}
            onMinChange={setPeakCtxMin}
            onMaxChange={setPeakCtxMax}
          />
          <MetricRangeFields
            label="Turns"
            min={turnsMin}
            max={turnsMax}
            onMinChange={setTurnsMin}
            onMaxChange={setTurnsMax}
          />
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel id="session-age-filter-label">Age</InputLabel>
            <Select
              labelId="session-age-filter-label"
              label="Age"
              value={maxAgeMs == null ? "" : String(maxAgeMs)}
              onChange={(e) => {
                const v = e.target.value;
                setMaxAgeMs(v === "" ? null : Number(v));
              }}
              aria-label="Filter sessions by age"
            >
              {AGE_PRESETS.map((preset) => (
                <MenuItem
                  key={preset.label}
                  value={preset.maxAgeMs == null ? "" : String(preset.maxAgeMs)}
                >
                  {preset.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Stack
            direction="row"
            spacing={0.5}
            useFlexGap
            sx={{
              alignItems: "center",
              display: { xs: "flex", [layout.tableMinBreakpoint]: "none" },
            }}
          >
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel id="session-sort-label">Sort</InputLabel>
              <Select
                labelId="session-sort-label"
                label="Sort"
                value={sort.key}
                onChange={(e) => {
                  const key = e.target.value as SessionSortKey;
                  setSort((current) =>
                    current.key === key
                      ? current
                      : nextSessionSort(current, key),
                  );
                }}
                aria-label="Sort sessions by"
              >
                {SESSION_SORT_OPTIONS.map((option) => (
                  <MenuItem key={option.key} value={option.key}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <IconButton
              size="small"
              onClick={() =>
                setSort((current) => ({
                  ...current,
                  direction: current.direction === "asc" ? "desc" : "asc",
                }))
              }
              aria-label={
                sort.direction === "asc"
                  ? "Sort ascending; click for descending"
                  : "Sort descending; click for ascending"
              }
              sx={{ flexShrink: 0 }}
            >
              {sort.direction === "asc" ? (
                <ArrowUpwardIcon fontSize="small" />
              ) : (
                <ArrowDownwardIcon fontSize="small" />
              )}
            </IconButton>
          </Stack>
          {metricsActive ? (
            <Button size="small" onClick={clearMetricFilters} sx={{ flexShrink: 0 }}>
              Clear metrics
            </Button>
          ) : null}
          {sortActive ? (
            <Button
              size="small"
              onClick={() => setSort(DEFAULT_SESSION_SORT)}
              sx={{ flexShrink: 0 }}
            >
              Reset sort
            </Button>
          ) : null}
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
                    <TableCell sortDirection={sort.key === "summary" ? sort.direction : false}>
                      {sortHeader("summary", "Session")}
                    </TableCell>
                    <TableCell sortDirection={sort.key === "updatedAt" ? sort.direction : false}>
                      {sortHeader("updatedAt", "Updated")}
                    </TableCell>
                    <TableCell sortDirection={sort.key === "tokens" ? sort.direction : false}>
                      {sortHeader("tokens", "Tokens")}
                    </TableCell>
                    <TableCell sortDirection={sort.key === "peakCtx" ? sort.direction : false}>
                      {sortHeader("peakCtx", "Peak ctx")}
                    </TableCell>
                    <TableCell sortDirection={sort.key === "turns" ? sort.direction : false}>
                      {sortHeader("turns", "Turns")}
                    </TableCell>
                    <TableCell sortDirection={sort.key === "tools" ? sort.direction : false}>
                      {sortHeader("tools", "Tools")}
                    </TableCell>
                    <TableCell sortDirection={sort.key === "agents" ? sort.direction : false}>
                      {sortHeader("agents", "Agents")}
                    </TableCell>
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
                          {s.turnCount}
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
