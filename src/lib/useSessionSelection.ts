import { useCallback, useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useSessionWorkspace } from "../pages/SessionWorkspace";
import {
  resolveSessionSelection,
  sessionTurnPath,
  type ResolvedSelection,
  type TurnDetailTab,
} from "./sessionSelection";

export interface SessionSelection {
  selection: ResolvedSelection;
  /** Pushes, so back walks turn history. */
  goToTurn: (turn: number) => void;
  /** Replaces: selecting a step inside a turn must not fill the back stack. */
  goToStep: (nodeId: string | null) => void;
  /** Replaces, for the same reason as `goToStep`. */
  setTab: (tab: TurnDetailTab) => void;
  /** Pushes exactly one entry, so one Back leaves the subagent. */
  enterSubagent: (agentId: string) => void;
}

/**
 * Thin wrapper over the URL: route params + query are resolved by the pure
 * `resolveSessionSelection`, and the writers below are the only way this app
 * changes the selection. Callers render `selection.redirectTo` as a
 * `<Navigate replace>` and `scopeStatus === "unknown-agent"` as an error.
 */
export function useSessionSelection(): SessionSelection {
  const { detail, index } = useSessionWorkspace();
  const { agentId, turn } = useParams();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();

  const step = search.get("step");
  const tabParam = search.get("tab");
  const watchParam = search.get("watch");

  const selection = useMemo(
    () =>
      resolveSessionSelection(detail, index, {
        agentId,
        turn,
        step,
        tab: tabParam,
        watch: watchParam,
      }),
    [detail, index, agentId, turn, step, tabParam, watchParam],
  );

  const sessionId = detail.meta.id;
  const scopeAgentId = agentId ?? null;
  const tab = selection.tab;
  const watch = selection.watch;

  // Keeps the sub-tab and the explicit watch choice, drops `?step=` — a step id
  // belongs to one turn only.
  const goToTurn = useCallback(
    (next: number) => {
      navigate(
        sessionTurnPath(sessionId, {
          agentId: scopeAgentId,
          turn: next,
          tab,
          watch,
        }),
      );
    },
    [navigate, sessionId, scopeAgentId, tab, watch],
  );

  const goToStep = useCallback(
    (nodeId: string | null) => {
      const next = new URLSearchParams(search);
      if (nodeId) next.set("step", nodeId);
      else next.delete("step");
      setSearch(next, { replace: true });
    },
    [search, setSearch],
  );

  const setTab = useCallback(
    (nextTab: TurnDetailTab) => {
      const next = new URLSearchParams(search);
      // `steps` is the default `sessionTurnPath` omits — keep URLs canonical.
      if (nextTab === "steps") next.delete("tab");
      else next.set("tab", nextTab);
      setSearch(next, { replace: true });
    },
    [search, setSearch],
  );

  // Turn 1 always resolves canonically, so nothing follows this with a
  // `<Navigate replace>` — the drill-in costs one history entry, and `Back`
  // returns to the turn the Task step was read from.
  const enterSubagent = useCallback(
    (nextAgentId: string) => {
      navigate(
        sessionTurnPath(sessionId, {
          agentId: nextAgentId,
          turn: 1,
          watch,
        }),
      );
    },
    [navigate, sessionId, watch],
  );

  return { selection, goToTurn, goToStep, setTab, enterSubagent };
}
