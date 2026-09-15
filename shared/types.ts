export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

/** One raw JSONL transcript line, for click-through inspection */
export interface LogLineRef {
  filePath: string;
  /** 1-based line number in the JSONL file */
  line: number;
  /** Exact JSONL line text */
  raw: string;
}

/** Stable dictionary key for a JSONL line, shared by every place that looks
 * a stripped `LogLineRef.raw` back up via `SessionDetail.logLines`. */
export function logLineKey(ref: Pick<LogLineRef, "filePath" | "line">): string {
  return `${ref.filePath}:${ref.line}`;
}

/** Response shape for GET /api/sessions/:id/raw */
export interface SessionRawInfo {
  id: string;
  projectPath: string;
  filePath: string;
  source: "local" | "fixture";
  size: number;
  mtimeMs: number;
}

export interface SessionListItem {
  id: string;
  projectPath: string;
  projectEncoded: string;
  filePath: string;
  summary: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  /** User prompts (excludes tool-result-only user rows) */
  messageCount: number;
  /** Assistant turns with usage — matches detail timeline length (root only) */
  turnCount: number;
  /**
   * Assistant turns with usage across all subagent transcripts.
   * Not included in `turnCount` / the root context timeline.
   */
  subagentTurnCount: number;
  toolCallCount: number;
  subagentCount: number;
  model: string | null;
  gitBranch: string | null;
  usage: TokenUsage;
  /** Peak context size (input + cache tokens) observed across assistant turns */
  peakContextTokens: number;
  source: "local" | "fixture";
}

export type TreeNodeKind =
  | "root_agent"
  | "subagent"
  | "user_message"
  | "assistant_message"
  | "tool_call"
  | "tool_result"
  | "thinking"
  | "system";

export interface ContextDelta {
  /** Estimated tokens added by this node (e.g. tool result size) */
  addedTokens: number;
  /** Running context size after this event (from usage when available) */
  contextAfter: number | null;
  /** Delta vs previous known context size */
  contextDelta: number | null;
}

export interface TreeNode {
  id: string;
  kind: TreeNodeKind;
  label: string;
  timestamp: string | null;
  model: string | null;
  usage: TokenUsage | null;
  context: ContextDelta | null;
  /** Truncated preview text */
  preview: string | null;
  /** Source JSONL line when this node maps to a transcript entry */
  log: LogLineRef | null;
  /** Tool-specific metadata */
  toolName?: string;
  toolUseId?: string;
  agentId?: string;
  children: TreeNode[];
}

/**
 * What kind of material is present in Claude's context window.
 * Mirrors Claude Code harness layers + conversation accretion.
 */
export type LoadedContextKind =
  | "system_prompt"
  | "instruction"
  | "memory"
  | "mcp"
  | "skill"
  | "deferred_tools"
  | "tool_schema"
  | "user_message"
  | "assistant_message"
  | "file"
  | "tool_result"
  | "attachment"
  | "other";

export interface LoadedContextItem {
  id: string;
  kind: LoadedContextKind;
  label: string;
  detail: string | null;
  /** File / instruction path when known */
  sourcePath: string | null;
  /** Estimated tokens for this item (char/4 heuristic unless noted) */
  estimatedTokens: number | null;
  /**
   * baseline — inferred from first-turn cache / system occupancy
   * observed — explicit transcript attachment or tool payload
   * inferred — reconstructed from conversation/tool history
   */
  provenance: "baseline" | "observed" | "inferred";
  evidence: LogLineRef | null;
  mcpServer?: string | null;
  toolName?: string | null;
  skillName?: string | null;
  count?: number | null;
}

export interface ContextCategorySummary {
  kind: LoadedContextKind;
  label: string;
  itemCount: number;
  estimatedTokens: number | null;
}

/** Snapshot of everything known to be loaded at one assistant turn */
export interface TurnLoadedContext {
  nodeId: string;
  turn: number;
  contextTokens: number;
  categories: ContextCategorySummary[];
  items: LoadedContextItem[];
  /** True when some items are reconstructed rather than from attachments */
  inferred: boolean;
  notes: string[];
}

export interface SessionDetail {
  meta: SessionListItem;
  tree: TreeNode;
  timeline: ContextTimelinePoint[];
  toolImpact: ToolImpactRow[];
  agentBreakdown: AgentBreakdownRow[];
  /** Every agent scope in this session: root first, then parent-before-child */
  agents: SessionAgent[];
  /** Per-turn inventory of what makes up Claude's context window */
  loadedContext: TurnLoadedContext[];
  /**
   * Raw JSONL line text for stripped `LogLineRef`s, keyed by "filePath:line".
   * loadedContext items carry evidence.raw === "" and subagent timeline
   * points carry log.raw / promptLog.raw === "" — look up the real text here
   * to avoid re-embedding the same line text in every turn's snapshot and in
   * every agent's timeline.
   */
  logLines: Record<string, string>;
}

/** Severity for Agent SDK analysis findings */
export type AnalysisSeverity = "info" | "warning" | "critical";

export interface SessionAnalysisFinding {
  severity: AnalysisSeverity;
  title: string;
  detail: string;
  relatedTool?: string | null;
}

export interface SessionAnalysisRecommendation {
  title: string;
  detail: string;
  /** Expected payoff if the recommendation is applied */
  impact: string;
}

/**
 * Anthropic model aliases accepted by the Agent SDK analyze path.
 * Full model ids (e.g. `claude-haiku-4-5`) are rejected — use these only.
 */
export const ANALYZE_MODEL_ALIASES = ["opus", "sonnet", "haiku"] as const;
export type AnalyzeModelAlias = (typeof ANALYZE_MODEL_ALIASES)[number];
export const DEFAULT_ANALYZE_MODEL_ALIAS: AnalyzeModelAlias = "haiku";

export function isAnalyzeModelAlias(
  value: string,
): value is AnalyzeModelAlias {
  return (ANALYZE_MODEL_ALIASES as readonly string[]).includes(value);
}

/** Structured optimization report from the Claude Agent SDK */
export interface SessionAnalysis {
  sessionId: string;
  summary: string;
  findings: SessionAnalysisFinding[];
  recommendations: SessionAnalysisRecommendation[];
  model: string | null;
  durationMs: number;
  costUsd: number | null;
  /** True when SDK session metadata / messages were included in the brief */
  usedSdkSessionApi: boolean;
}

/** Stages emitted while Agent SDK analysis is running (NDJSON stream). */
export type AnalyzeProgressStage =
  | "starting"
  | "enriching"
  | "brief_ready"
  | "query_start"
  | "authenticating"
  | "sdk_ready"
  | "model_running"
  | "parsing"
  | "complete";

export interface AnalyzeProgressEvent {
  type: "progress";
  stage: AnalyzeProgressStage;
  message: string;
  /** Elapsed ms since analyze started */
  elapsedMs: number;
}

export interface AnalyzeResultEvent {
  type: "result";
  analysis: SessionAnalysis;
  /** True when the analysis was served from the server cache. */
  cached?: boolean;
}

export interface AnalyzeErrorEvent {
  type: "error";
  error: string;
  code:
    | "auth"
    | "sdk"
    | "parse"
    | "empty"
    | "budget"
    | "timeout"
    | "invalid"
    | "unknown";
}

/** One line of the analyze NDJSON stream */
export type AnalyzeStreamEvent =
  | AnalyzeProgressEvent
  | AnalyzeResultEvent
  | AnalyzeErrorEvent;

export interface ContextTimelinePoint {
  turn: number;
  /** Matches the assistant TreeNode.id for hierarchy focus */
  nodeId: string;
  label: string;
  /** Window occupancy at the end of the turn: the last model call's
   *  input + cache-creation + cache-read tokens. */
  contextTokens: number;
  /** The three fields below are the composition of `contextTokens` — read from
   *  the turn's *last* model call, so they sum to it exactly. Summing them
   *  across a multi-call turn would count the same cached prefix once per call. */
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Reply tokens across every model call in the turn: billed, but never part
   *  of `contextTokens`. */
  outputTokens: number;
  toolName: string | null;
  /** Source JSONL line for this assistant turn */
  log: LogLineRef;
  /** Tool call(s) whose results this turn's context growth is attributed to */
  causedBy: ContextGrowthCause[];
  /** Non-empty if this turn launched a subagent (Task/Agent/TaskCreate) */
  subagentLaunches: SubagentLaunchSummary[];
  /** Every qualifying assistant entry's nodeId absorbed into this turn, in order */
  memberNodeIds: string[];
  /**
   * Preview of the user prompt that opened this turn, with injected
   * `<system-reminder>` blocks stripped. Null when that prompt carried no
   * text blocks (or only system reminders).
   */
  promptPreview: string | null;
  /** Source JSONL line of the user prompt that opened this turn */
  promptLog: LogLineRef | null;
  startedAt: string | null;
  endedAt: string | null;
}

/** Lightweight reference to a tool call attributed to a turn's context
 * growth — just the fields the UI shows, not the full `ToolImpactCall`
 * (whose richer preview/timing data already lives in `ToolImpactRow.calls`). */
export interface ContextGrowthCause {
  toolUseId: string;
  /** Share of the next context jump attributed to this call */
  contextGrowthAttributed: number;
  /** Short summary of the tool input (path, command, query, …) */
  inputPreview: string | null;
}

/** One tool invocation contributing to context growth */
/** `toolResultPreview` caps a `ToolImpactCall.resultPreview` at this many
 *  characters; a preview at the cap ends in an ellipsis. */
export const TOOL_RESULT_PREVIEW_CAP = 220;

export interface ToolImpactCall {
  toolUseId: string;
  timestamp: string | null;
  /**
   * True once a `tool_result` for this call was recorded — the only signal for
   * "the result arrived". `completedAt` cannot stand in for it: a result entry
   * carrying no timestamp of its own leaves `completedAt` null.
   */
  resultApplied: boolean;
  /** Timestamp the tool_result carried; null when it had none, or no result arrived */
  completedAt: string | null;
  /** Elapsed ms between `timestamp` and `completedAt`; null when either is missing */
  durationMs: number | null;
  /** Short summary of the tool input (path, command, query, …) */
  inputPreview: string | null;
  /** Truncated tool result text */
  resultPreview: string | null;
  resultTokens: number;
  /** Share of the next context jump attributed to this call */
  contextGrowthAttributed: number;
  isError: boolean;
}

export interface ToolImpactRow {
  toolName: string;
  callCount: number;
  totalResultTokens: number;
  avgResultTokens: number;
  maxResultTokens: number;
  /** Sum of context jumps immediately after this tool's results */
  contextGrowthAttributed: number;
  /** Individual calls, largest result first */
  calls: ToolImpactCall[];
}

/** Tool call counts for one agent, largest first */
export interface AgentToolSummary {
  toolName: string;
  callCount: number;
}

export interface AgentBreakdownRow {
  agentId: string;
  label: string;
  kind: "root_agent" | "subagent";
  model: string | null;
  usage: TokenUsage;
  peakContextTokens: number;
  toolCallCount: number;
  messageCount: number;
  /** Assistant turns with usage in this agent's transcript */
  turnCount: number;
  /** Per-tool call counts within this agent's transcript */
  tools: AgentToolSummary[];
}

/**
 * One agent scope — the root transcript or a subagent — with its own turn
 * timeline and tool impact. `agentId` joins to `AgentBreakdownRow.agentId`.
 * Carries no `tree` (subagent subtrees are already nested in
 * `SessionDetail.tree`) and no `loadedContext`.
 */
export interface SessionAgent {
  agentId: string;
  kind: "root_agent" | "subagent";
  label: string;
  /** `agentType` from the subagent's `.meta.json` sidecar, e.g. "Explore";
   * null for the root agent and for subagents without a sidecar. */
  agentType: string | null;
  /** `description` from the sidecar, e.g. "Scan token call sites" */
  description: string | null;
  /** agentId of the launching subagent when the sidecar reports one
   * (`spawnDepth >= 2`); null for the root agent and for subagents launched
   * from the root transcript. */
  parentAgentId: string | null;
  /** The Task/Agent `tool_use` id that launched this agent; null for the root
   * agent and when no sidecar named it. */
  launchToolUseId: string | null;
  /** 0 for the root agent; 1 for a subagent whose sidecar reports no depth. */
  spawnDepth: number;
  /** This agent's own turns. Subagent points carry `log.raw === ""` — the
   * text lives in `SessionDetail.logLines`. */
  timeline: ContextTimelinePoint[];
  /** Tool impact scoped to this agent's transcript only */
  toolImpact: ToolImpactRow[];
}

/** Subagent launch surfaced on the context timeline point that issued it */
export interface SubagentLaunchSummary {
  agentId: string;
  label: string;
  toolUseId: string;
  peakContextTokens: number;
  turnCount: number;
  toolCallCount: number;
}

export function emptyUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationInputTokens:
      a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
  };
}

/** Total tokens billed / counted for a usage record */
export function totalTokens(u: TokenUsage): number {
  return (
    u.inputTokens +
    u.outputTokens +
    u.cacheCreationInputTokens +
    u.cacheReadInputTokens
  );
}

/** Approximate context window occupancy from an assistant usage record */
export function contextSize(u: TokenUsage): number {
  return u.inputTokens + u.cacheCreationInputTokens + u.cacheReadInputTokens;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
