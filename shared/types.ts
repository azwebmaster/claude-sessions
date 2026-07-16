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
  messageCount: number;
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
