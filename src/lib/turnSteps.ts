import type {
  ContextDelta,
  ContextTimelinePoint,
  LogLineRef,
  SessionDetail,
  TokenUsage,
  ToolImpactCall,
  ToolImpactRow,
  TreeNode,
} from "@shared/types";
import { logLineKey } from "@shared/types";
import { collectSteps, findNodePath, type StepEntry } from "./tree";

export interface ToolCallIndexEntry {
  toolName: string;
  call: ToolImpactCall;
}

/**
 * Every `ToolImpactCall` in `rows`, keyed by `toolUseId`. The first entry wins
 * on a duplicate id (`buildToolImpact` can add an "unknown" row for a
 * `tool_result` whose `tool_use` was never seen).
 */
export function indexToolImpact(
  rows: ToolImpactRow[],
): Map<string, ToolCallIndexEntry> {
  const index = new Map<string, ToolCallIndexEntry>();
  for (const row of rows) {
    for (const call of row.calls) {
      if (index.has(call.toolUseId)) continue;
      index.set(call.toolUseId, { toolName: row.toolName, call });
    }
  }
  return index;
}

/**
 * Every `assistant_message` node id under `root` → its 1-based turn number.
 * Direct hits come from `point.memberNodeIds`; a zero-usage assistant entry is
 * absent from those (it fails the server's `isTimelineAssistantTurn` check) and
 * inherits the nearest preceding member's turn, since it lies inside that
 * turn's span. An assistant node before the first member has no turn at all
 * and is left out of the map. Does not descend into `subagent` children —
 * their nodes belong to their own scope.
 */
export function buildTurnNodeIndex(
  root: TreeNode,
  points: ContextTimelinePoint[],
): Map<string, number> {
  const turnByMember = new Map<string, number>();
  for (const point of points) {
    for (const memberId of point.memberNodeIds) {
      turnByMember.set(memberId, point.turn);
    }
  }

  const index = new Map<string, number>();
  let current: number | null = null;

  function walk(node: TreeNode): void {
    if (node.kind === "assistant_message") {
      const direct = turnByMember.get(node.id);
      if (direct !== undefined) current = direct;
      if (current !== null) index.set(node.id, current);
    }
    for (const child of node.children) {
      if (child.kind === "subagent") continue;
      walk(child);
    }
  }

  walk(root);
  return index;
}

/**
 * Wall-clock span of a turn, or null when either end is missing or the delta is
 * not a finite non-negative number. The one definition the rail row and the
 * turn detail pane both read.
 */
export function turnDurationMs(point: ContextTimelinePoint): number | null {
  if (point.startedAt == null || point.endedAt == null) return null;
  const delta = Date.parse(point.endedAt) - Date.parse(point.startedAt);
  return Number.isFinite(delta) && delta >= 0 ? delta : null;
}

export interface EnrichedStep {
  nodeId: string;
  toolUseId: string | null;
  toolName: string;
  agentId: string;
  agentLabel: string;
  /**
   * Id of the enclosing `assistant_message` node — the one model call this
   * tool_use block came from. A node is now one API response, merged from
   * however many JSONL lines shared its `message.id` (`computeResponseGroups`
   * in `server/parser.ts`), so "calls sharing this id went out in parallel" is
   * finally true of real transcripts, not just hand-packed fixtures.
   * Distinct from `turn`, which absorbs several assistant messages.
   */
  assistantNodeId: string | null;
  turn: number | null;
  timestamp: string | null;
  inputPreview: string | null;
  addedTokens: number;
  log: LogLineRef | null;
  resultLog: LogLineRef | null;
  /**
   * True when this call's `toolUseId` was found in the scope's `toolImpact`.
   * When false every joined field below is empty rather than measured: the UI
   * must say "no result recorded", never "0 tokens".
   */
  matched: boolean;
  /**
   * True once a `tool_result` for this call was recorded. False means in flight
   * (or a truncated transcript) — the only state in which `resultTokens` and
   * `durationMs` are absent rather than measured.
   */
  resultApplied: boolean;
  resultTokens: number;
  resultPreview: string | null;
  /**
   * Null for two different reasons: with `resultApplied` false the result never
   * arrived (in flight / truncated transcript); with it true the timestamps did
   * not yield a finite non-negative delta.
   */
  durationMs: number | null;
  completedAt: string | null;
  isError: boolean;
  contextGrowthAttributed: number;
  subagentId: string | null;
}

/**
 * Joins one scope's steps against that scope's `toolImpact` and turn index.
 * Runs once per scope, never globally: a subagent's `toolUseId`s are absent
 * from the root's `toolImpact`, so a global pass would report them unmatched.
 */
export function enrichSteps(opts: {
  steps: StepEntry[];
  toolIndex: Map<string, ToolCallIndexEntry>;
  turnByAssistantNodeId: Map<string, number>;
}): EnrichedStep[] {
  return opts.steps.map((step) => {
    const call = step.toolUseId ? opts.toolIndex.get(step.toolUseId)?.call : undefined;
    const turn = step.turnNodeId
      ? opts.turnByAssistantNodeId.get(step.turnNodeId)
      : undefined;
    return {
      nodeId: step.nodeId,
      toolUseId: step.toolUseId,
      toolName: step.toolName,
      agentId: step.agentId,
      agentLabel: step.agentLabel,
      assistantNodeId: step.turnNodeId,
      turn: turn ?? null,
      timestamp: step.timestamp,
      inputPreview: step.preview,
      addedTokens: step.addedTokens,
      log: step.log,
      resultLog: step.resultLog,
      matched: call != null,
      resultApplied: call?.resultApplied ?? false,
      resultTokens: call?.resultTokens ?? 0,
      resultPreview: call?.resultPreview ?? null,
      durationMs: call?.durationMs ?? null,
      completedAt: call?.completedAt ?? null,
      isError: call?.isError ?? false,
      contextGrowthAttributed: call?.contextGrowthAttributed ?? 0,
      subagentId: step.subagentId,
    };
  });
}

/** Buckets steps by turn number; steps with no resolvable turn go to `unassigned`. */
export function groupStepsByTurn(steps: EnrichedStep[]): {
  byTurn: Map<number, EnrichedStep[]>;
  unassigned: EnrichedStep[];
} {
  const byTurn = new Map<number, EnrichedStep[]>();
  const unassigned: EnrichedStep[] = [];
  for (const step of steps) {
    if (step.turn == null) {
      unassigned.push(step);
      continue;
    }
    const bucket = byTurn.get(step.turn);
    if (bucket) bucket.push(step);
    else byTurn.set(step.turn, [step]);
  }
  return { byTurn, unassigned };
}

/**
 * One model call — a single `assistant_message` node — together with the tool
 * calls it emitted, which may be none. Built from the tree rather than from the
 * steps, so a call that emitted no `tool_use` block is still a row.
 */
export interface ModelCall {
  /** Null only for the synthetic row holding steps with no assistant message. */
  assistantNodeId: string | null;
  /** The node's own `label`: `"Assistant · Read, Grep"` when it emitted tool
   *  blocks, plain `"Assistant"` when it did not (`server/parser.ts:2198-2200`). */
  label: string;
  preview: string | null;
  /**
   * `usage`/`context` are the response's merged figures, not one JSONL line's:
   * input and cache tokens are taken once (they're replicated on every line of
   * a response), `outputTokens` is the final/max value across the response's
   * lines rather than a sum. Null when the response billed no input/cache
   * tokens: the parser writes `usage` and `context` only when
   * `totalTokens(usage) > 0` (`parser.ts:2203-2211`), so these two are absent
   * together.
   */
  usage: TokenUsage | null;
  context: ContextDelta | null;
  log: LogLineRef | null;
  turn: number | null;
  steps: EnrichedStep[];
}

/**
 * Every model call in one scope, in document order, each carrying the steps it
 * issued. Does not descend into `subagent` children — the same guard
 * `buildTurnNodeIndex` uses, since those nodes belong to their own scope.
 *
 * Two invariants, both asserted by the tests:
 *
 * - **No token-consuming model call is omitted.** An assistant node that
 *   emitted no `tool_use` block produces no `EnrichedStep`, so a step-driven
 *   list renders nothing for it even though it billed tokens; here it is a row
 *   with an empty `steps`.
 * - **No step is dropped.** A step whose `assistantNodeId` is null, or names a
 *   node outside `tree`, lands in a trailing `assistantNodeId: null` row.
 */
export function buildModelCalls(
  tree: TreeNode,
  steps: EnrichedStep[],
  turnByAssistantNodeId: Map<string, number>,
): ModelCall[] {
  const pending = new Map<string, EnrichedStep[]>();
  const unattributed: EnrichedStep[] = [];
  for (const step of steps) {
    if (step.assistantNodeId == null) {
      unattributed.push(step);
      continue;
    }
    const bucket = pending.get(step.assistantNodeId);
    if (bucket) bucket.push(step);
    else pending.set(step.assistantNodeId, [step]);
  }

  const calls: ModelCall[] = [];

  function walk(node: TreeNode): void {
    if (node.kind === "assistant_message") {
      calls.push({
        assistantNodeId: node.id,
        label: node.label,
        preview: node.preview,
        usage: node.usage,
        context: node.context,
        log: node.log,
        turn: turnByAssistantNodeId.get(node.id) ?? null,
        steps: pending.get(node.id) ?? [],
      });
      // Claimed by a real call: whatever is left in `pending` after the walk
      // named no node in this tree and would otherwise be lost.
      pending.delete(node.id);
    }
    for (const child of node.children) {
      if (child.kind === "subagent") continue;
      walk(child);
    }
  }

  walk(tree);

  for (const bucket of pending.values()) unattributed.push(...bucket);
  if (unattributed.length > 0) {
    calls.push({
      // `turn` is null, not borrowed from the steps: `enrichSteps` derives
      // `turn` from the same id as `assistantNodeId`, so a step with no
      // assistant message has no turn either, and a leftover row belongs to no
      // turn row — the per-turn path surfaces it as an orphan instead.
      assistantNodeId: null,
      label: "Tool calls with no model call recorded",
      preview: null,
      usage: null,
      context: null,
      log: null,
      turn: null,
      steps: unattributed,
    });
  }

  return calls;
}

/**
 * The turn a model call is rendered under. A `turn == null` call precedes its
 * scope's first timeline member (`buildTurnNodeIndex` leaves such a node out of
 * its map), so turn 1 is the only turn row it is reachable from. One definition
 * because three places must agree on it: the detail pane's list, the rail row's
 * step count, and the collapsed single-turn strip's step count.
 *
 * The nested subagent view deliberately does not use it — there the turnless
 * calls are their own block above the turn rows
 * (`resolveSubagentInlineView`'s `orphanCalls`), so counting them under turn 1
 * would count them twice.
 */
function renderedTurn(call: ModelCall): number {
  return call.turn ?? 1;
}

/** The model calls turn `turn` renders, in document order. */
export function callsForTurn(calls: ModelCall[], turn: number): ModelCall[] {
  return calls.filter((call) => renderedTurn(call) === turn);
}

/**
 * Tool-call count per turn over the same partition `callsForTurn` returns, in
 * one pass. `stepsByTurn` cannot be used for this: it drops the turnless steps
 * that turn 1 now renders, so a strip or rail row counted off it would label
 * fewer steps than the pane lists.
 */
export function stepCountsByTurn(calls: ModelCall[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const call of calls) {
    const turn = renderedTurn(call);
    counts.set(turn, (counts.get(turn) ?? 0) + call.steps.length);
  }
  return counts;
}

/**
 * One bar per step, for the per-step context chart. Context is measured per
 * model call, not per step (`ModelCall.context`), so every step of the same
 * call gets that call's resolved `contextAfter` and is tagged with a shared
 * `groupKey` — the chart draws them as a tight cluster instead of a smooth
 * per-step ramp. A call with no context (e.g. the synthetic "no model call
 * recorded" row) holds the chart at the last known level rather than
 * dropping to zero, so a gap in the data reads as flat, not as context loss.
 */
export interface StepBar {
  step: EnrichedStep;
  contextAfter: number;
  groupKey: string;
  groupSize: number;
  groupIndex: number;
}

export function buildStepBars(calls: ModelCall[]): StepBar[] {
  const bars: StepBar[] = [];
  let lastContext = 0;
  calls.forEach((call, i) => {
    if (call.steps.length === 0) return;
    if (call.context?.contextAfter != null) {
      lastContext = call.context.contextAfter;
    }
    const groupKey = call.assistantNodeId ?? `unattributed-${i}`;
    call.steps.forEach((step, groupIndex) => {
      bars.push({
        step,
        contextAfter: lastContext,
        groupKey,
        groupSize: call.steps.length,
        groupIndex,
      });
    });
  });
  return bars;
}

/**
 * Per-step running context size, for the step row's own trailing figure
 * (unlike `buildStepBars`, which intentionally shares one flat total across a
 * call's steps for the chart). Each call starts from its own measured
 * `context.contextAfter` — or, when the call carries none, the last measured
 * value — then climbs by that step's own `contextGrowthAttributed` in order,
 * so a parallel call's steps read as a ramp instead of a repeated figure.
 * `contextGrowthAttributed` is attributed at the *next* call's usage jump
 * (`server/parser.ts:945-971`), computed once per response from its merged
 * usage rather than per JSONL line, so this is an estimate of context state
 * mid-call, not a second measured source.
 */
export function buildStepRunningContext(calls: ModelCall[]): Map<string, number> {
  const running = new Map<string, number>();
  let lastKnown = 0;
  for (const call of calls) {
    let cumulative = call.context?.contextAfter ?? lastKnown;
    for (const step of call.steps) {
      cumulative += step.contextGrowthAttributed;
      running.set(step.nodeId, cumulative);
    }
    if (call.context?.contextAfter != null) lastKnown = call.context.contextAfter;
  }
  return running;
}

export interface AgentScope {
  agentId: string;
  kind: "root_agent" | "subagent";
  label: string;
  parentAgentId: string | null;
  launchToolUseId: string | null;
  spawnDepth: number;
  /** Resolved out of `detail.tree`; `SessionAgent` ships no tree of its own. */
  tree: TreeNode;
  timeline: ContextTimelinePoint[];
  toolImpact: ToolImpactRow[];
  stepsByTurn: Map<number, EnrichedStep[]>;
  allSteps: EnrichedStep[];
  /**
   * Every model call in this scope, in document order. Unlike `stepsByTurn`
   * this covers the whole scope: a step whose assistant message precedes the
   * first timeline member has `turn == null`, so `groupStepsByTurn` files it
   * under `unassigned`, which the builder below discards — through
   * `modelCalls` it stays reachable.
   */
  modelCalls: ModelCall[];
}

/** `filePath` and `line` recovered from a `logLineKey`. A JSONL path can
 *  itself contain a colon, so the line number is taken after the last one. */
function splitLogLineKey(
  key: string,
): { filePath: string; line: number } | null {
  const cut = key.lastIndexOf(":");
  if (cut <= 0) return null;
  const line = Number(key.slice(cut + 1));
  if (!Number.isInteger(line) || line <= 0) return null;
  return { filePath: key.slice(0, cut), line };
}

function findTreeLogLine(node: TreeNode, key: string): LogLineRef | null {
  if (node.log && logLineKey(node.log) === key) return node.log;
  for (const child of node.children) {
    const hit = findTreeLogLine(child, key);
    if (hit) return hit;
  }
  return null;
}

/**
 * Resolves a `?log=<filePath>:<line>` key back to the line it names, so that
 * position survives a reload or a shared link. `raw` lives in a different place
 * depending on the ref: `detail.logLines` holds it for the refs the server
 * stripped (loadedContext evidence, subagent timeline points), while tree nodes
 * and root timeline points still carry their own. Callers resolve lazily — the
 * tree walk only runs while `?log=` is actually set.
 */
export function resolveLogLine(
  detail: SessionDetail,
  key: string,
): LogLineRef | null {
  const stashed = detail.logLines[key];
  if (stashed !== undefined) {
    const parts = splitLogLineKey(key);
    return parts ? { ...parts, raw: stashed } : null;
  }

  const fromTree = findTreeLogLine(detail.tree, key);
  if (fromTree) return fromTree;

  for (const agent of detail.agents) {
    for (const point of agent.timeline) {
      if (point.log && logLineKey(point.log) === key) return point.log;
      if (point.promptLog && logLineKey(point.promptLog) === key) {
        return point.promptLog;
      }
    }
  }
  return null;
}

export interface SessionWorkspaceIndex {
  rootAgentId: string;
  scopes: Map<string, AgentScope>;
  stepByNodeId: Map<
    string,
    { agentId: string; turn: number | null; step: EnrichedStep }
  >;
  subagentByLaunchToolUseId: Map<string, string>;
}

/**
 * One `AgentScope` per `SessionAgent`, each with its own steps joined to its
 * own `toolImpact`. An agent whose subtree is missing from `detail.tree` is
 * skipped, so `scopes` only holds scopes that can actually be rendered.
 */
export function buildSessionWorkspaceIndex(
  detail: SessionDetail,
): SessionWorkspaceIndex {
  const scopes = new Map<string, AgentScope>();
  const stepByNodeId = new Map<
    string,
    { agentId: string; turn: number | null; step: EnrichedStep }
  >();
  const subagentByLaunchToolUseId = new Map<string, string>();

  for (const agent of detail.agents) {
    const path = findNodePath(detail.tree, agent.agentId);
    const tree = path?.[path.length - 1];
    if (!tree) continue;

    // `collectSteps` descends into nested subagents too, attributing each step
    // to its nearest enclosing agent — keep only this scope's own calls so
    // scopes stay disjoint and every id resolves against this agent's impact.
    const steps = collectSteps(tree).filter((s) => s.agentId === agent.agentId);
    const turnByAssistantNodeId = buildTurnNodeIndex(tree, agent.timeline);
    const allSteps = enrichSteps({
      steps,
      toolIndex: indexToolImpact(agent.toolImpact),
      turnByAssistantNodeId,
    });
    const { byTurn } = groupStepsByTurn(allSteps);

    scopes.set(agent.agentId, {
      agentId: agent.agentId,
      kind: agent.kind,
      label: agent.label,
      parentAgentId: agent.parentAgentId,
      launchToolUseId: agent.launchToolUseId,
      spawnDepth: agent.spawnDepth,
      tree,
      timeline: agent.timeline,
      toolImpact: agent.toolImpact,
      stepsByTurn: byTurn,
      allSteps,
      modelCalls: buildModelCalls(tree, allSteps, turnByAssistantNodeId),
    });

    for (const step of allSteps) {
      stepByNodeId.set(step.nodeId, {
        agentId: agent.agentId,
        turn: step.turn,
        step,
      });
    }
    if (agent.launchToolUseId) {
      subagentByLaunchToolUseId.set(agent.launchToolUseId, agent.agentId);
    }
  }

  return {
    rootAgentId: detail.agents[0]?.agentId ?? detail.meta.id,
    scopes,
    stepByNodeId,
    subagentByLaunchToolUseId,
  };
}

/**
 * How a subagent's transcript renders inline under the step that launched it.
 * A discriminated union so each decision is tested here rather than inlined in
 * markup.
 */
export type SubagentInlineView =
  /**
   * No scope for that id: the agent's subtree was absent from `detail.tree`, so
   * `buildSessionWorkspaceIndex` skipped it. The UI shows a muted note rather
   * than an empty box, and does not offer to navigate there.
   */
  | { kind: "missing" }
  /**
   * One turn, or none: render the calls directly, with no uninformative
   * "Turn 1" wrapper — the usual subagent shape. Absorbing the empty-timeline
   * case (live or truncated transcript) keeps those calls from being stranded
   * behind zero turn rows.
   */
  | { kind: "flat"; scope: AgentScope; calls: ModelCall[] }
  /**
   * Several turns. `orphanCalls` are the `turn == null` calls, which belong to
   * no turn row and are rendered above the first one so they stay reachable.
   * `maxContextTokens` is reduced over the subagent's *own* points with a floor
   * of 1, as `TurnRail` does for the rail, so nested bars are comparable within
   * that subagent.
   */
  | {
      kind: "turns";
      scope: AgentScope;
      points: ContextTimelinePoint[];
      orphanCalls: ModelCall[];
      maxContextTokens: number;
    };

export function resolveSubagentInlineView(
  index: SessionWorkspaceIndex,
  subagentId: string,
): SubagentInlineView {
  const scope = index.scopes.get(subagentId);
  if (!scope) return { kind: "missing" };
  if (scope.timeline.length <= 1) {
    return { kind: "flat", scope, calls: scope.modelCalls };
  }
  return {
    kind: "turns",
    scope,
    points: scope.timeline,
    orphanCalls: scope.modelCalls.filter((call) => call.turn == null),
    maxContextTokens: scope.timeline.reduce(
      (max, p) => (p.contextTokens > max ? p.contextTokens : max),
      1,
    ),
  };
}
