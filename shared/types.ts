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
  /** Per-turn inventory of what makes up Claude's context window */
  loadedContext: TurnLoadedContext[];
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
  timestamp: string | null;
  label: string;
  contextTokens: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  toolName: string | null;
  /** Source JSONL line for this assistant turn */
  log: LogLineRef;
}

/** One tool invocation contributing to context growth */
export interface ToolImpactCall {
  toolUseId: string;
  timestamp: string | null;
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
