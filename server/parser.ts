import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type {
  AgentBreakdownRow,
  ContextTimelinePoint,
  LogLineRef,
  SessionDetail,
  SessionListItem,
  TokenUsage,
  ToolImpactCall,
  ToolImpactRow,
  TreeNode,
} from "../shared/types.js";
import {
  addUsage,
  contextSize,
  emptyUsage,
  totalTokens,
} from "../shared/types.js";
import {
  decodeProjectPath,
  type DiscoveredSessionFile,
} from "./sessions.js";

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface ContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

interface RawEntry {
  type?: string;
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  summary?: string;
  isSidechain?: boolean;
  agentId?: string;
  slug?: string;
  message?: {
    role?: string;
    model?: string;
    content?: string | ContentBlock[];
    usage?: RawUsage;
  };
  toolUseResult?: unknown;
  [key: string]: unknown;
}

/** Parsed JSONL row with source location for click-through */
interface SourcedEntry {
  entry: RawEntry;
  filePath: string;
  line: number;
  raw: string;
}

export interface RawSessionParse {
  summary: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  messageCount: number;
  toolCallCount: number;
  subagentCount: number;
  model: string | null;
  gitBranch: string | null;
  cwd: string | null;
  usage: TokenUsage;
  peakContextTokens: number;
  entries: SourcedEntry[];
  subagentFiles: { agentId: string; filePath: string; entries: SourcedEntry[] }[];
}

function toLogRef(source: SourcedEntry): LogLineRef {
  return {
    filePath: source.filePath,
    line: source.line,
    raw: source.raw,
  };
}

function toUsage(raw?: RawUsage | null): TokenUsage {
  if (!raw) return emptyUsage();
  return {
    inputTokens: raw.input_tokens ?? 0,
    outputTokens: raw.output_tokens ?? 0,
    cacheCreationInputTokens: raw.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: raw.cache_read_input_tokens ?? 0,
  };
}

function asBlocks(content: string | ContentBlock[] | undefined): ContentBlock[] {
  if (!content) return [];
  if (typeof content === "string") return [{ type: "text", text: content }];
  return content;
}

function previewText(text: string | null | undefined, max = 160): string | null {
  if (!text) return null;
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

function estimateTokensFromText(text: string): number {
  // Rough heuristic: ~4 chars per token for English/code mix
  return Math.max(1, Math.ceil(text.length / 4));
}

function stringifyContent(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function estimateResultTokens(block: ContentBlock): number {
  return estimateTokensFromText(stringifyContent(block.content));
}

function asInputRecord(
  input: unknown,
): Record<string, unknown> | null {
  if (!input) return null;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return { value: trimmed };
    }
    return { value: trimmed };
  }
  if (typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return null;
}

function toolInputPreview(
  name: string,
  input?: unknown,
): string | null {
  const record = asInputRecord(input);
  if (!record) return null;

  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return previewText(value, 140);
      }
      if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
      }
    }
    return null;
  };

  const specific = (() => {
    switch (name) {
      case "Read":
      case "Write":
      case "Edit":
      case "NotebookEdit":
        return pick("file_path", "path", "notebook_path");
      case "Bash":
      case "Shell":
        return pick("command", "description");
      case "Grep":
      case "Glob":
        return pick("pattern", "glob_pattern", "glob", "path", "query");
      case "WebSearch":
      case "WebFetch":
        return pick("search_term", "query", "url", "explanation");
      case "Task":
      case "Agent":
      case "TaskCreate":
        return pick("description", "prompt", "subagent_type");
      default:
        return pick(
          "file_path",
          "path",
          "command",
          "pattern",
          "query",
          "url",
          "description",
          "prompt",
          "value",
        );
    }
  })();

  return specific ?? previewText(stringifyContent(record), 140);
}

function toolResultPreview(content: unknown): string | null {
  return previewText(stringifyContent(content), 220);
}

/** Attach a tool result onto the matching impact call / pending attribution. */
function applyToolResult(opts: {
  toolUseId: string;
  content: unknown;
  isError: boolean;
  timestamp: string | null;
  byTool: Map<
    string,
    {
      callCount: number;
      totalResultTokens: number;
      maxResultTokens: number;
      contextGrowthAttributed: number;
      calls: ToolImpactCall[];
    }
  >;
  callMeta: Map<string, { toolName: string; call: ToolImpactCall }>;
  pending: { toolName: string; call: ToolImpactCall }[];
}): void {
  const resultTokens = estimateTokensFromText(stringifyContent(opts.content));
  const resultPreview = toolResultPreview(opts.content);
  const meta = opts.callMeta.get(opts.toolUseId);
  if (meta) {
    // Prefer the richest preview if multiple result payloads arrive.
    if (
      !meta.call.resultPreview ||
      (resultPreview &&
        resultPreview.length > (meta.call.resultPreview?.length ?? 0))
    ) {
      meta.call.resultPreview = resultPreview;
    }
    meta.call.resultTokens = Math.max(meta.call.resultTokens, resultTokens);
    meta.call.isError = meta.call.isError || opts.isError;
    if (!meta.call.timestamp && opts.timestamp) {
      meta.call.timestamp = opts.timestamp;
    }
    const row = opts.byTool.get(meta.toolName);
    if (row) {
      // Recompute totals from calls at the end; bump max here for streaming feel.
      row.maxResultTokens = Math.max(row.maxResultTokens, meta.call.resultTokens);
    }
    if (!opts.pending.some((p) => p.call.toolUseId === meta.call.toolUseId)) {
      opts.pending.push(meta);
    }
    return;
  }

  const toolName = "unknown";
  const row = ensureToolRow(opts.byTool, toolName);
  row.callCount += 1;
  const call: ToolImpactCall = {
    toolUseId: opts.toolUseId,
    timestamp: opts.timestamp,
    inputPreview: null,
    resultPreview,
    resultTokens,
    contextGrowthAttributed: 0,
    isError: opts.isError,
  };
  row.calls.push(call);
  opts.pending.push({ toolName, call });
}

async function readEntries(filePath: string): Promise<SourcedEntry[]> {
  const text = await readFile(filePath, "utf8");
  const entries: SourcedEntry[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      entries.push({
        entry: JSON.parse(trimmed) as RawEntry,
        filePath,
        line: i + 1,
        raw: trimmed,
      });
    } catch {
      // ignore corrupt lines
    }
  }
  return entries;
}

export function subagentDirsForSession(sessionFilePath: string): string[] {
  const sessionDir = path.dirname(sessionFilePath);
  const sessionId = path.basename(sessionFilePath, ".jsonl");
  return [
    path.join(sessionDir, sessionId, "subagents"),
    path.join(sessionDir, "subagents", sessionId),
    path.join(sessionDir, `${sessionId}-subagents`),
  ];
}

export async function countSubagentFiles(
  sessionFilePath: string,
): Promise<number> {
  let count = 0;
  for (const dir of subagentDirsForSession(sessionFilePath)) {
    let files: string[] = [];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    count += files.filter((f) => f.endsWith(".jsonl")).length;
  }
  return count;
}

async function loadSubagents(
  sessionFilePath: string,
): Promise<{ agentId: string; filePath: string; entries: SourcedEntry[] }[]> {
  const results: { agentId: string; filePath: string; entries: SourcedEntry[] }[] =
    [];
  const seen = new Set<string>();

  for (const dir of subagentDirsForSession(sessionFilePath)) {
    let st;
    try {
      st = await stat(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;

    let files: string[] = [];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const filePath = path.join(dir, file);
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      const agentId = file.replace(/\.jsonl$/, "").replace(/^agent-/, "");
      const entries = await readEntries(filePath);
      results.push({ agentId, filePath, entries });
    }
  }

  return results;
}

export async function parseSessionFile(
  filePath: string,
  options: { lightweight?: boolean; sessionId?: string } = {},
): Promise<RawSessionParse> {
  const entries = await readEntries(filePath);
  const subagentFiles = options.lightweight
    ? []
    : await loadSubagents(filePath);
  const subagentFileCount = options.lightweight
    ? await countSubagentFiles(filePath)
    : subagentFiles.length;

  let summary: string | null = null;
  let startedAt: string | null = null;
  let updatedAt: string | null = null;
  let messageCount = 0;
  let toolCallCount = 0;
  let model: string | null = null;
  let gitBranch: string | null = null;
  let cwd: string | null = null;
  let usage = emptyUsage();
  let peakContextTokens = 0;

  const agentIds = new Set<string>();

  const consider = (entry: RawEntry) => {
    if (entry.timestamp) {
      if (!startedAt || entry.timestamp < startedAt) startedAt = entry.timestamp;
      if (!updatedAt || entry.timestamp > updatedAt) updatedAt = entry.timestamp;
    }
    if (entry.cwd && !cwd) cwd = entry.cwd;
    if (entry.gitBranch && !gitBranch) gitBranch = entry.gitBranch;
    if (entry.type === "summary" && typeof entry.summary === "string") {
      summary = entry.summary;
    }
    if (entry.agentId) agentIds.add(String(entry.agentId));

    if (entry.type === "user") {
      const blocks = asBlocks(entry.message?.content);
      const isToolResultOnly =
        blocks.length > 0 && blocks.every((b) => b.type === "tool_result");
      if (!isToolResultOnly) messageCount += 1;
    }

    if (entry.type === "assistant") {
      if (entry.message?.model) model = entry.message.model;
      const u = toUsage(entry.message?.usage);
      usage = addUsage(usage, u);
      peakContextTokens = Math.max(peakContextTokens, contextSize(u));
      for (const block of asBlocks(entry.message?.content)) {
        if (block.type === "tool_use") toolCallCount += 1;
      }
    }
  };

  for (const sourced of entries) consider(sourced.entry);

  // Subagent transcripts contribute agent identity / counts, but their token
  // usage is reported separately in the agent breakdown (not double-counted
  // into the root session totals).
  for (const sub of subagentFiles) {
    agentIds.add(sub.agentId);
  }

  // Also detect Task/Agent tool launches as subagents even without files
  for (const sourced of entries) {
    const entry = sourced.entry;
    if (entry.type !== "assistant") continue;
    for (const block of asBlocks(entry.message?.content)) {
      if (block.type !== "tool_use") continue;
      const name = block.name ?? "";
      if (name === "Task" || name === "Agent" || name === "TaskCreate") {
        const input = block.input ?? {};
        const subId =
          (input.agent_id as string) ||
          (input.agentId as string) ||
          block.id ||
          `task-${toolCallCount}`;
        agentIds.add(String(subId));
      }
    }
  }

  const taskLaunches = entries.reduce((n, sourced) => {
    const entry = sourced.entry;
    if (entry.type !== "assistant") return n;
    return (
      n +
      asBlocks(entry.message?.content).filter(
        (b) =>
          b.type === "tool_use" &&
          (b.name === "Task" || b.name === "Agent" || b.name === "TaskCreate"),
      ).length
    );
  }, 0);

  const subagentCount = Math.max(
    subagentFileCount,
    taskLaunches,
    [...agentIds].filter((id) => id && id !== options.sessionId).length,
  );

  // Lightweight pass: don't keep full entries in memory for list view
  return {
    summary,
    startedAt,
    updatedAt,
    messageCount,
    toolCallCount,
    subagentCount,
    model,
    gitBranch,
    cwd,
    usage,
    peakContextTokens,
    entries: options.lightweight ? [] : entries,
    subagentFiles: options.lightweight ? [] : subagentFiles,
  };
}

function ensureToolRow(
  byTool: Map<
    string,
    {
      callCount: number;
      totalResultTokens: number;
      maxResultTokens: number;
      contextGrowthAttributed: number;
      calls: ToolImpactCall[];
    }
  >,
  toolName: string,
) {
  const existing = byTool.get(toolName);
  if (existing) return existing;
  const created = {
    callCount: 0,
    totalResultTokens: 0,
    maxResultTokens: 0,
    contextGrowthAttributed: 0,
    calls: [] as ToolImpactCall[],
  };
  byTool.set(toolName, created);
  return created;
}

function buildToolImpact(
  sourcedEntries: SourcedEntry[],
): ToolImpactRow[] {
  const byTool = new Map<
    string,
    {
      callCount: number;
      totalResultTokens: number;
      maxResultTokens: number;
      contextGrowthAttributed: number;
      calls: ToolImpactCall[];
    }
  >();

  const callMeta = new Map<
    string,
    { toolName: string; call: ToolImpactCall }
  >();
  let lastContext: number | null = null;
  let pending: { toolName: string; call: ToolImpactCall }[] = [];

  for (const { entry } of sourcedEntries) {
    if (entry.type === "assistant") {
      for (const block of asBlocks(entry.message?.content)) {
        if (block.type === "tool_use" && block.id && block.name) {
          const row = ensureToolRow(byTool, block.name);
          row.callCount += 1;
          const call: ToolImpactCall = {
            toolUseId: block.id,
            timestamp: entry.timestamp ?? null,
            inputPreview: toolInputPreview(block.name, block.input),
            resultPreview: null,
            resultTokens: 0,
            contextGrowthAttributed: 0,
            isError: false,
          };
          row.calls.push(call);
          callMeta.set(block.id, { toolName: block.name, call });
        }
      }

      const u = toUsage(entry.message?.usage);
      if (totalTokens(u) > 0) {
        const ctx = contextSize(u);
        const growth = lastContext == null ? 0 : Math.max(0, ctx - lastContext);
        if (growth > 0 && pending.length > 0) {
          const weightSum =
            pending.reduce((s, p) => s + p.call.resultTokens, 0) || 1;
          for (const item of pending) {
            const share = (item.call.resultTokens / weightSum) * growth;
            item.call.contextGrowthAttributed += share;
            const row = byTool.get(item.toolName);
            if (row) row.contextGrowthAttributed += share;
          }
        }
        lastContext = ctx;
        pending = [];
      }
    }

    if (entry.type === "user") {
      for (const block of asBlocks(entry.message?.content)) {
        if (block.type !== "tool_result" || !block.tool_use_id) continue;
        applyToolResult({
          toolUseId: block.tool_use_id,
          content: block.content,
          isError: Boolean(block.is_error),
          timestamp: entry.timestamp ?? null,
          byTool,
          callMeta,
          pending,
        });
      }
      // Some Claude Code builds also stash the structured result on the entry.
      const sourceId =
        (typeof entry.sourceToolUseID === "string" && entry.sourceToolUseID) ||
        (typeof (entry as { toolUseId?: unknown }).toolUseId === "string"
          ? (entry as { toolUseId: string }).toolUseId
          : null);
      if (sourceId && entry.toolUseResult != null) {
        applyToolResult({
          toolUseId: sourceId,
          content: entry.toolUseResult,
          isError: false,
          timestamp: entry.timestamp ?? null,
          byTool,
          callMeta,
          pending,
        });
      }
    }

    // Older / alternate transcripts emit top-level tool_result rows.
    if (entry.type === "tool_result") {
      const toolUseId =
        (typeof entry.tool_use_id === "string" && entry.tool_use_id) ||
        (typeof (entry as { toolUseId?: unknown }).toolUseId === "string"
          ? (entry as { toolUseId: string }).toolUseId
          : null);
      if (toolUseId) {
        const content =
          (entry as { content?: unknown }).content ??
          entry.toolUseResult ??
          (entry as { result?: unknown }).result;
        applyToolResult({
          toolUseId,
          content,
          isError: Boolean((entry as { is_error?: boolean }).is_error),
          timestamp: entry.timestamp ?? null,
          byTool,
          callMeta,
          pending,
        });
      }
    }
  }

  return [...byTool.entries()]
    .map(([toolName, row]) => {
      const totalResultTokens = row.calls.reduce(
        (sum, call) => sum + call.resultTokens,
        0,
      );
      const maxResultTokens = row.calls.reduce(
        (max, call) => Math.max(max, call.resultTokens),
        0,
      );
      return {
        toolName,
        callCount: row.callCount,
        totalResultTokens,
        avgResultTokens:
          row.callCount > 0 ? Math.round(totalResultTokens / row.callCount) : 0,
        maxResultTokens,
        contextGrowthAttributed: Math.round(row.contextGrowthAttributed),
        calls: row.calls
          .map((c) => ({
            ...c,
            contextGrowthAttributed: Math.round(c.contextGrowthAttributed),
          }))
          .sort(
            (a, b) =>
              b.contextGrowthAttributed - a.contextGrowthAttributed ||
              b.resultTokens - a.resultTokens,
          ),
      };
    })
    .sort(
      (a, b) =>
        b.contextGrowthAttributed - a.contextGrowthAttributed ||
        b.totalResultTokens - a.totalResultTokens,
    );
}

function buildTimeline(sourcedEntries: SourcedEntry[]): ContextTimelinePoint[] {
  const points: ContextTimelinePoint[] = [];
  let turn = 0;
  let assistantIndex = 0;
  for (const sourced of sourcedEntries) {
    const entry = sourced.entry;
    if (entry.type !== "assistant") continue;
    const nodeId = entry.uuid ?? `assistant-${assistantIndex}`;
    assistantIndex += 1;
    const u = toUsage(entry.message?.usage);
    if (totalTokens(u) === 0 && contextSize(u) === 0) continue;
    turn += 1;
    const tools = asBlocks(entry.message?.content)
      .filter((b) => b.type === "tool_use")
      .map((b) => b.name)
      .filter(Boolean);
    const text = asBlocks(entry.message?.content)
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join(" ");
    points.push({
      turn,
      nodeId,
      timestamp: entry.timestamp ?? null,
      label: previewText(text, 80) ?? (tools[0] ? `→ ${tools.join(", ")}` : `Turn ${turn}`),
      contextTokens: contextSize(u),
      inputTokens: u.inputTokens,
      cacheReadTokens: u.cacheReadInputTokens,
      cacheCreationTokens: u.cacheCreationInputTokens,
      outputTokens: u.outputTokens,
      toolName: tools[0] ?? null,
      log: toLogRef(sourced),
    });
  }
  return points;
}

function buildAgentTreeFromEntries(
  sourcedEntries: SourcedEntry[],
  opts: {
    id: string;
    label: string;
    kind: "root_agent" | "subagent";
    model: string | null;
  },
): { tree: TreeNode; usage: TokenUsage; peak: number; toolCalls: number; messages: number } {
  const root: TreeNode = {
    id: opts.id,
    kind: opts.kind,
    label: opts.label,
    timestamp: sourcedEntries[0]?.entry.timestamp ?? null,
    model: opts.model,
    usage: emptyUsage(),
    context: null,
    preview: null,
    log: null,
    agentId: opts.id,
    children: [],
  };

  const toolNodes = new Map<string, TreeNode>();
  let usage = emptyUsage();
  let peak = 0;
  let toolCalls = 0;
  let messages = 0;
  let assistantIndex = 0;
  let lastContext: number | null = null;

  for (const sourced of sourcedEntries) {
    const entry = sourced.entry;
    const log = toLogRef(sourced);

    if (entry.type === "user") {
      const blocks = asBlocks(entry.message?.content);
      const toolResults = blocks.filter((b) => b.type === "tool_result");
      const textBlocks = blocks.filter((b) => b.type === "text" || !b.type);

      if (toolResults.length > 0) {
        for (const block of toolResults) {
          const parent = block.tool_use_id
            ? toolNodes.get(block.tool_use_id)
            : undefined;
          const resultTokens = estimateResultTokens(block);
          const node: TreeNode = {
            id: `${entry.uuid ?? block.tool_use_id}-result`,
            kind: "tool_result",
            label: block.is_error ? "Tool error" : "Tool result",
            timestamp: entry.timestamp ?? null,
            model: null,
            usage: null,
            context: {
              addedTokens: resultTokens,
              contextAfter: null,
              contextDelta: null,
            },
            preview: previewText(stringifyContent(block.content), 200),
            log,
            toolUseId: block.tool_use_id,
            children: [],
          };
          if (parent) parent.children.push(node);
          else root.children.push(node);
        }
      }

      const prompt = textBlocks
        .map((b) => b.text ?? stringifyContent(b.content))
        .join("\n")
        .trim();
      if (prompt) {
        messages += 1;
        root.children.push({
          id: entry.uuid ?? `user-${messages}`,
          kind: "user_message",
          label: "User",
          timestamp: entry.timestamp ?? null,
          model: null,
          usage: null,
          context: {
            addedTokens: estimateTokensFromText(prompt),
            contextAfter: null,
            contextDelta: null,
          },
          preview: previewText(prompt, 200),
          log,
          children: [],
        });
      }
    }

    if (entry.type === "assistant") {
      const u = toUsage(entry.message?.usage);
      usage = addUsage(usage, u);
      const ctx = contextSize(u);
      peak = Math.max(peak, ctx);
      const delta =
        lastContext == null || totalTokens(u) === 0 ? null : ctx - lastContext;
      if (totalTokens(u) > 0) lastContext = ctx;
      if (entry.message?.model) root.model = entry.message.model;

      const blocks = asBlocks(entry.message?.content);
      const thinking = blocks
        .filter((b) => b.type === "thinking")
        .map((b) => b.thinking ?? b.text ?? "")
        .join("\n");
      const text = blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("\n");
      const tools = blocks.filter((b) => b.type === "tool_use");

      const assistantNode: TreeNode = {
        id: entry.uuid ?? `assistant-${assistantIndex}`,
        kind: "assistant_message",
        label: tools.length ? `Assistant · ${tools.map((t) => t.name).join(", ")}` : "Assistant",
        timestamp: entry.timestamp ?? null,
        model: entry.message?.model ?? null,
        usage: totalTokens(u) > 0 ? u : null,
        context:
          totalTokens(u) > 0
            ? {
                addedTokens: u.outputTokens,
                contextAfter: ctx,
                contextDelta: delta,
              }
            : null,
        preview: previewText(text || thinking, 200),
        log,
        children: [],
      };
      assistantIndex += 1;

      if (thinking) {
        assistantNode.children.push({
          id: `${assistantNode.id}-thinking`,
          kind: "thinking",
          label: "Thinking",
          timestamp: entry.timestamp ?? null,
          model: null,
          usage: null,
          context: null,
          preview: previewText(thinking, 200),
          log,
          children: [],
        });
      }

      for (const tool of tools) {
        toolCalls += 1;
        const summary = toolInputPreview(tool.name ?? "tool", tool.input);
        const inputPreview =
          summary ?? previewText(stringifyContent(tool.input), 160);
        const isSubagent =
          tool.name === "Task" ||
          tool.name === "Agent" ||
          tool.name === "TaskCreate";
        const toolNode: TreeNode = {
          id: tool.id ?? `${assistantNode.id}-tool-${toolCalls}`,
          kind: "tool_call",
          label: summary
            ? `${tool.name ?? "tool"} · ${summary}`
            : (tool.name ?? "tool"),
          timestamp: entry.timestamp ?? null,
          model: null,
          usage: null,
          context: {
            addedTokens: estimateTokensFromText(stringifyContent(tool.input)),
            contextAfter: null,
            contextDelta: null,
          },
          preview: inputPreview,
          // Tool calls live inside the assistant JSONL row.
          log,
          toolName: tool.name,
          toolUseId: tool.id,
          agentId: isSubagent
            ? String(
                (tool.input?.description as string) ||
                  (tool.input?.subagent_type as string) ||
                  tool.id,
              )
            : undefined,
          children: [],
        };
        toolNodes.set(tool.id ?? toolNode.id, toolNode);
        assistantNode.children.push(toolNode);
      }

      root.children.push(assistantNode);
    }

    if (entry.type === "system") {
      root.children.push({
        id: entry.uuid ?? `system-${root.children.length}`,
        kind: "system",
        label: "System",
        timestamp: entry.timestamp ?? null,
        model: null,
        usage: null,
        context: null,
        preview: previewText(stringifyContent(entry.message?.content ?? entry), 160),
        log,
        children: [],
      });
    }

    if (entry.type === "tool_result") {
      const toolUseId =
        (typeof entry.tool_use_id === "string" && entry.tool_use_id) ||
        (typeof (entry as { toolUseId?: unknown }).toolUseId === "string"
          ? (entry as { toolUseId: string }).toolUseId
          : null);
      if (!toolUseId) continue;
      const content =
        (entry as { content?: unknown }).content ??
        entry.toolUseResult ??
        (entry as { result?: unknown }).result;
      const parent = toolNodes.get(toolUseId);
      const resultTokens = estimateTokensFromText(stringifyContent(content));
      const node: TreeNode = {
        id: `${entry.uuid ?? toolUseId}-result`,
        kind: "tool_result",
        label: (entry as { is_error?: boolean }).is_error
          ? "Tool error"
          : "Tool result",
        timestamp: entry.timestamp ?? null,
        model: null,
        usage: null,
        context: {
          addedTokens: resultTokens,
          contextAfter: null,
          contextDelta: null,
        },
        preview: toolResultPreview(content),
        log,
        toolUseId,
        children: [],
      };
      if (parent) {
        if (!parent.children.some((c) => c.kind === "tool_result")) {
          parent.children.push(node);
        }
      } else {
        root.children.push(node);
      }
    }
  }

  root.usage = usage;
  root.context = {
    addedTokens: 0,
    contextAfter: peak || null,
    contextDelta: null,
  };
  return { tree: root, usage, peak, toolCalls, messages };
}

export function buildSessionDetail(
  file: DiscoveredSessionFile,
  parsed: RawSessionParse,
): SessionDetail {
  const meta: SessionListItem = {
    id: file.id,
    projectPath: parsed.cwd ?? file.projectPath,
    projectEncoded: file.projectEncoded,
    filePath: file.filePath,
    summary: parsed.summary,
    startedAt: parsed.startedAt,
    updatedAt: parsed.updatedAt,
    messageCount: parsed.messageCount,
    toolCallCount: parsed.toolCallCount,
    subagentCount: parsed.subagentCount,
    model: parsed.model,
    gitBranch: parsed.gitBranch,
    usage: parsed.usage,
    peakContextTokens: parsed.peakContextTokens,
    source: file.source,
  };

  const rootBuild = buildAgentTreeFromEntries(parsed.entries, {
    id: file.id,
    label: "Root agent",
    kind: "root_agent",
    model: parsed.model,
  });

  const agentBreakdown: AgentBreakdownRow[] = [
    {
      agentId: file.id,
      label: "Root agent",
      kind: "root_agent",
      model: rootBuild.tree.model,
      usage: rootBuild.usage,
      peakContextTokens: rootBuild.peak,
      toolCallCount: rootBuild.toolCalls,
      messageCount: rootBuild.messages,
    },
  ];

  // Attach subagent transcripts under matching Task tool calls when possible
  const taskToolNodes: TreeNode[] = [];
  const walk = (n: TreeNode) => {
    if (
      n.kind === "tool_call" &&
      (n.toolName === "Task" || n.toolName === "Agent" || n.toolName === "TaskCreate")
    ) {
      taskToolNodes.push(n);
    }
    for (const c of n.children) walk(c);
  };
  walk(rootBuild.tree);

  for (const [index, sub] of parsed.subagentFiles.entries()) {
    const subModel =
      [...sub.entries]
        .reverse()
        .find((s) => s.entry.type === "assistant" && s.entry.message?.model)
        ?.entry.message?.model ?? null;
    const built = buildAgentTreeFromEntries(sub.entries, {
      id: sub.agentId,
      label: `Subagent · ${sub.agentId}`,
      kind: "subagent",
      model: subModel,
    });

    agentBreakdown.push({
      agentId: sub.agentId,
      label: `Subagent · ${sub.agentId}`,
      kind: "subagent",
      model: subModel,
      usage: built.usage,
      peakContextTokens: built.peak,
      toolCallCount: built.toolCalls,
      messageCount: built.messages,
    });

    const target = taskToolNodes[index];
    if (target) {
      target.children.push(built.tree);
    } else {
      rootBuild.tree.children.push(built.tree);
    }
  }

  // Inline Task launches without separate files still show as tool nodes;
  // synthesize lightweight subagent placeholders from tool input
  for (const node of taskToolNodes) {
    if (node.children.some((c) => c.kind === "subagent")) continue;
    // look at preview / leave as tool with results only
  }

  return {
    meta,
    tree: rootBuild.tree,
    timeline: buildTimeline(parsed.entries),
    toolImpact: buildToolImpact(parsed.entries),
    agentBreakdown,
  };
}

export function projectPathFromEncoded(encoded: string): string {
  return decodeProjectPath(encoded);
}
