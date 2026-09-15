import type { ContextTimelinePoint, SessionDetail } from "@shared/types";
import type { SessionWorkspaceIndex } from "./turnSteps";

/** Top-level section of the session workspace, each its own route. */
export type WorkspaceTab = "turns" | "tools" | "analysis" | "transcript";

/** Sub-tab of the turn detail pane, carried as `?tab=`. */
export type TurnDetailTab = "steps" | "context" | "loaded";

const TURN_DETAIL_TABS: readonly TurnDetailTab[] = ["steps", "context", "loaded"];

export interface ResolvedSelection {
  /** agentId of the scope in view; the root agent's id when the URL names none. */
  scopeId: string;
  scopeStatus: "ok" | "unknown-agent";
  turn: ContextTimelinePoint | null;
  turnNumber: number | null;
  turnStatus: "ok" | "out-of-range" | "invalid" | "empty";
  prevTurn: number | null;
  nextTurn: number | null;
  turnCount: number;
  /** `?step=` only when it names a step of *this* turn. */
  stepId: string | null;
  tab: TurnDetailTab;
  /** Explicit `?watch=` choice; null when the URL leaves it to the heuristic. */
  watch: boolean | null;
  /** Canonical path to replace the current URL with, or null when it is canonical. */
  redirectTo: string | null;
}

function resolveTab(raw: string | null | undefined): TurnDetailTab {
  return TURN_DETAIL_TABS.find((tab) => tab === raw) ?? "steps";
}

/**
 * `?watch=` is tri-state: `1` and `0` are an explicit user choice that a link
 * carries and a reload restores; anything else (including no param at all)
 * resolves to null, leaving the choice to the caller's live-session default.
 */
export function resolveWatchParam(
  raw: string | null | undefined,
): boolean | null {
  if (raw === "1") return true;
  if (raw === "0") return false;
  return null;
}

/**
 * Resolves the URL (route params + query) into everything the workspace
 * renders. A bad `agentId` reports `unknown-agent` without a redirect, so a
 * stale shared link can say what went wrong; a bad turn number is clamped and
 * redirected to the canonical path.
 */
export function resolveSessionSelection(
  detail: SessionDetail,
  index: SessionWorkspaceIndex,
  input: {
    agentId?: string;
    turn?: string;
    step?: string | null;
    tab?: string | null;
    watch?: string | null;
  },
): ResolvedSelection {
  const tab = resolveTab(input.tab);
  const watch = resolveWatchParam(input.watch);
  const scopeId = input.agentId ?? index.rootAgentId;
  const scope = index.scopes.get(scopeId);

  if (!scope) {
    return {
      scopeId,
      scopeStatus: "unknown-agent",
      turn: null,
      turnNumber: null,
      turnStatus: "empty",
      prevTurn: null,
      nextTurn: null,
      turnCount: 0,
      stepId: null,
      tab,
      watch,
      redirectTo: null,
    };
  }

  const points = scope.timeline;
  const turnCount = points.length;
  const base = {
    scopeId,
    scopeStatus: "ok" as const,
    turnCount,
    tab,
    watch,
  };

  if (turnCount === 0) {
    return {
      ...base,
      turn: null,
      turnNumber: null,
      turnStatus: "empty",
      prevTurn: null,
      nextTurn: null,
      stepId: null,
      redirectTo: null,
    };
  }

  const parsed = /^\d+$/.test(input.turn ?? "") ? Number(input.turn) : null;
  const turnNumber =
    parsed === null ? 1 : Math.min(Math.max(parsed, 1), turnCount);
  const turnStatus =
    parsed === null ? "invalid" : parsed === turnNumber ? "ok" : "out-of-range";

  // `buildTimeline` numbers emitted turns 1..N in order, so the point for turn
  // `n` is `points[n - 1]`.
  const turn = points[turnNumber - 1]!;
  const steps = scope.stepsByTurn.get(turnNumber);
  const stepId =
    input.step && steps?.some((step) => step.nodeId === input.step)
      ? input.step
      : null;

  return {
    ...base,
    turn,
    turnNumber,
    turnStatus,
    prevTurn: turnNumber > 1 ? turnNumber - 1 : null,
    nextTurn: turnNumber < turnCount ? turnNumber + 1 : null,
    stepId,
    redirectTo:
      turnStatus === "ok"
        ? null
        : sessionTurnPath(detail.meta.id, {
            agentId: scope.kind === "subagent" ? scopeId : null,
            turn: turnNumber,
            step: stepId,
            tab,
            watch,
          }),
  };
}

/** The only writer of turn URLs. `?tab=steps` is the default, so it is omitted. */
export function sessionTurnPath(
  sessionId: string,
  opts: {
    agentId?: string | null;
    turn: number;
    step?: string | null;
    tab?: TurnDetailTab | null;
    watch?: boolean | null;
  },
): string {
  const scope = opts.agentId
    ? `/agents/${encodeURIComponent(opts.agentId)}`
    : "";
  const path = `/sessions/${sessionId}${scope}/turns/${opts.turn}`;
  const params = new URLSearchParams();
  if (opts.step) params.set("step", opts.step);
  if (opts.tab && opts.tab !== "steps") params.set("tab", opts.tab);
  if (opts.watch != null) params.set("watch", opts.watch ? "1" : "0");
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/**
 * Path of one workspace tab. `"turns"` is the index route (`/sessions/:id`,
 * which redirects to the first turn), not a `/turns` segment — the turn routes
 * are `turns/:turn`.
 */
export function sessionTabPath(
  sessionId: string,
  tab: WorkspaceTab,
  opts?: { watch?: boolean | null },
): string {
  const path =
    tab === "turns" ? `/sessions/${sessionId}` : `/sessions/${sessionId}/${tab}`;
  return opts?.watch == null ? path : `${path}?watch=${opts.watch ? "1" : "0"}`;
}
