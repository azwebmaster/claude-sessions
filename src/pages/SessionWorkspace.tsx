import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Link as RouterLink,
  Navigate,
  Outlet,
  useMatch,
  useOutletContext,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  Alert,
  Box,
  CircularProgress,
  Link,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import type { LogLineRef, SessionDetail } from "@shared/types";
import { logLineKey } from "@shared/types";
import { api, apiSessionRaw } from "../lib/api";
import { isSessionActive } from "../lib/sessionActivity";
import {
  resolveWatchParam,
  sessionTabPath,
  sessionTurnPath,
  type WorkspaceTab,
} from "../lib/sessionSelection";
import {
  buildSessionWorkspaceIndex,
  resolveLogLine,
  type SessionWorkspaceIndex,
} from "../lib/turnSteps";
import { LogLinePanel } from "../components/LogLinePanel";
import { SessionHeader } from "../components/session/SessionHeader";
import { SubagentBreadcrumb } from "../components/session/SubagentBreadcrumb";
import { EmptyState, SectionPaper } from "../components/ui";
import { layout } from "../theme";

/** Poll interval for the raw-info stat check while watching a live session. */
const WATCH_POLL_INTERVAL_MS = 3000;

export interface SessionWorkspaceContext {
  detail: SessionDetail;
  index: SessionWorkspaceIndex;
  watching: boolean;
  setWatching: (on: boolean) => void;
  /** Explicit `?watch=` choice; pass it to every in-workspace path builder so
   *  the choice survives navigation. Null when the URL leaves it to the
   *  live-session default. */
  watch: boolean | null;
  openLog: (log: LogLineRef) => void;
}

export function useSessionWorkspace(): SessionWorkspaceContext {
  return useOutletContext<SessionWorkspaceContext>();
}

/** Full path of the subagent-scoped turn route, matched here to read `agentId`:
 *  `useParams` in a layout route only sees the params its own path declares. */
const SUBAGENT_ROUTE = "/sessions/:id/agents/:agentId/turns/:turn";

/**
 * Layout route for `/sessions/:id`. Owns the session fetch, the watch poll and
 * the workspace index; the child routes render inside `<Outlet/>`, so switching
 * turns or tabs swaps only the child and never re-runs the effects below (both
 * key on `id` alone).
 */
export function SessionWorkspace() {
  const { id } = useParams();
  const subagentRoute = useMatch(SUBAGENT_ROUTE);
  // Route matching, not `pathname.endsWith`, for the same reason the subagent
  // scope is read with `useMatch`: the pattern is the source of truth.
  const toolsRoute = useMatch("/sessions/:id/tools");
  const analysisRoute = useMatch("/sessions/:id/analysis");
  const transcriptRoute = useMatch("/sessions/:id/transcript");
  const tab: WorkspaceTab = toolsRoute
    ? "tools"
    : analysisRoute
      ? "analysis"
      : transcriptRoute
        ? "transcript"
        : "turns";
  const [search, setSearch] = useSearchParams();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveSeed, setLiveSeed] = useState(false);
  const lastRawInfoRef = useRef<{ size: number; mtimeMs: number } | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);

  const logKey = search.get("log");
  const watchParam = resolveWatchParam(search.get("watch"));
  // The URL owns the watch position; `liveSeed` is only the fallback for a URL
  // that names no choice, captured once per session from the fetched meta.
  const watching = watchParam ?? liveSeed;

  // Pushes, so Back closes the modal and the raw line is a shareable position.
  const openLog = useCallback(
    (log: LogLineRef) => {
      setSearch((prev) => {
        const next = new URLSearchParams(prev);
        next.set("log", logLineKey(log));
        return next;
      });
    },
    [setSearch],
  );

  const closeLogModal = useCallback(() => {
    setSearch(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("log");
        return next;
      },
      { replace: true },
    );
  }, [setSearch]);

  // Replaces: toggling the watch switch is not a position to walk back through.
  const setWatching = useCallback(
    (on: boolean) => {
      setSearch(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("watch", on ? "1" : "0");
          return next;
        },
        { replace: true },
      );
    },
    [setSearch],
  );

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setDetail(null);
    setError(null);
    lastRawInfoRef.current = null;
    api<SessionDetail>(`/api/sessions/${id}`)
      .then((res) => {
        if (cancelled) return;
        setDetail(res);
        setLiveSeed(isSessionActive(res.meta.updatedAt));
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // While watching, poll the cheap stat-only /raw endpoint; only re-fetch the
  // full session detail when size/mtimeMs actually changed since last tick.
  useEffect(() => {
    if (!id || !watching) return;
    let cancelled = false;

    const tick = async () => {
      pollAbortRef.current?.abort();
      const controller = new AbortController();
      pollAbortRef.current = controller;
      try {
        const raw = await apiSessionRaw(id, { signal: controller.signal });
        if (cancelled || controller.signal.aborted) return;
        const prev = lastRawInfoRef.current;
        const next = { size: raw.size, mtimeMs: raw.mtimeMs };
        if (!prev) {
          lastRawInfoRef.current = next; // baseline, right after initial load
          return;
        }
        if (prev.size === next.size && prev.mtimeMs === next.mtimeMs) return;
        const fresh = await api<SessionDetail>(`/api/sessions/${id}`, {
          signal: controller.signal,
        });
        if (cancelled || controller.signal.aborted) return;
        setDetail(fresh);
        // Only now: a detail fetch aborted by the next tick must leave the
        // baseline behind, or the change it was fetching is never picked up.
        lastRawInfoRef.current = next;
      } catch {
        // Transient poll error — next tick retries.
      }
    };

    const timer = window.setInterval(() => {
      void tick();
    }, WATCH_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      pollAbortRef.current?.abort();
      pollAbortRef.current = null;
    };
  }, [id, watching]);

  const index = useMemo(
    () => (detail ? buildSessionWorkspaceIndex(detail) : null),
    [detail],
  );

  const modalLog = useMemo(
    () => (logKey && detail ? resolveLogLine(detail, logKey) : null),
    [logKey, detail],
  );

  const ctx = useMemo<SessionWorkspaceContext | null>(
    () =>
      detail && index
        ? {
            detail,
            index,
            watching,
            setWatching,
            watch: watchParam,
            openLog,
          }
        : null,
    [detail, index, watching, setWatching, watchParam, openLog],
  );

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

  if (!detail || !index || !ctx) {
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

  const sessionId = detail.meta.id;

  return (
    <Box sx={{ minWidth: 0, maxWidth: "100%" }}>
      {backLink}

      <SessionHeader
        meta={detail.meta}
        watching={watching}
        onWatchingChange={setWatching}
      />

      {subagentRoute?.params.agentId ? (
        <SubagentBreadcrumb
          sessionId={sessionId}
          index={index}
          scopeId={subagentRoute.params.agentId}
          watch={watchParam}
        />
      ) : null}

      <Box
        sx={{
          borderBottom: 1,
          borderColor: "divider",
          mb: layout.sectionGap,
          minWidth: 0,
        }}
      >
        <Tabs
          value={tab}
          aria-label="Session workspace sections"
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab
            value="turns"
            label="Turns"
            component={RouterLink}
            to={sessionTabPath(sessionId, "turns", { watch: watchParam })}
          />
          <Tab
            value="tools"
            label="Tools"
            component={RouterLink}
            to={sessionTabPath(sessionId, "tools", { watch: watchParam })}
          />
          <Tab
            value="analysis"
            label="Analysis"
            component={RouterLink}
            to={sessionTabPath(sessionId, "analysis", { watch: watchParam })}
          />
          <Tab
            value="transcript"
            label="Raw transcript"
            component={RouterLink}
            to={sessionTabPath(sessionId, "transcript", { watch: watchParam })}
          />
        </Tabs>
      </Box>

      <Outlet context={ctx} />

      <LogLinePanel
        log={modalLog}
        open={logKey != null}
        onClose={closeLogModal}
      />
    </Box>
  );
}

/**
 * Index route for `/sessions/:id`. The first turn number is unknown until the
 * fetch resolves, so this only renders once the layout route has put `detail`
 * on the outlet context — the loading state above stands in until then.
 */
export function SessionIndexRedirect() {
  const { detail, index, watch } = useSessionWorkspace();
  const first = index.scopes.get(index.rootAgentId)?.timeline[0];

  if (!first) {
    return (
      <SectionPaper>
        <EmptyState>No assistant turns recorded in this session.</EmptyState>
      </SectionPaper>
    );
  }

  return (
    <Navigate
      to={sessionTurnPath(detail.meta.id, { turn: first.turn, watch })}
      replace
    />
  );
}
