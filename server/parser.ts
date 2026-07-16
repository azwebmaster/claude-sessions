import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type {
  AgentBreakdownRow,
  AgentToolSummary,
  ContextCategorySummary,
  ContextTimelinePoint,
  LoadedContextItem,
  LoadedContextKind,
  LogLineRef,
  SessionDetail,
  SessionListItem,
  TokenUsage,
  ToolImpactCall,
  ToolImpactRow,
  TreeNode,
  TurnLoadedContext,
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
  subtype?: string;
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
  /** Claude Code context-injection events (skills, MCP, deferred tools, …) */
  attachment?: {
    type?: string;
    subtype?: string;
    [key: string]: unknown;
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
  turnCount: number;
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

/** Assistant entries that appear as turns on the context timeline. */
function isTimelineAssistantTurn(entry: RawEntry): boolean {
  if (entry.type !== "assistant") return false;
  const u = toUsage(entry.message?.usage);
  return totalTokens(u) > 0 || contextSize(u) > 0;
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
  let turnCount = 0;
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
      if (isTimelineAssistantTurn(entry)) turnCount += 1;
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
    turnCount,
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

const CATEGORY_LABELS: Record<LoadedContextKind, string> = {
  system_prompt: "System prompt",
  instruction: "Instructions",
  memory: "Memory",
  mcp: "MCPs",
  skill: "Skills",
  deferred_tools: "Deferred tools",
  tool_schema: "Tool schemas",
  user_message: "User messages",
  assistant_message: "Assistant replies",
  file: "Files",
  tool_result: "Tool results",
  attachment: "Attachments",
  other: "Other",
};

const CATEGORY_ORDER: LoadedContextKind[] = [
  "system_prompt",
  "instruction",
  "memory",
  "mcp",
  "skill",
  "deferred_tools",
  "tool_schema",
  "user_message",
  "assistant_message",
  "file",
  "tool_result",
  "attachment",
  "other",
];

function attachmentType(entry: RawEntry): string | null {
  const fromAttachment =
    (typeof entry.attachment?.type === "string" && entry.attachment.type) ||
    (typeof entry.attachment?.subtype === "string" && entry.attachment.subtype);
  if (fromAttachment) return fromAttachment;
  if (typeof entry.subtype === "string" && entry.subtype) return entry.subtype;
  if (typeof entry.type === "string" && entry.type !== "attachment") {
    return entry.type;
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        for (const key of ["name", "path", "id", "server", "title"]) {
          if (typeof record[key] === "string" && record[key]) {
            return String(record[key]);
          }
        }
      }
      return null;
    })
    .filter((v): v is string => Boolean(v));
}

function mcpServerFromToolName(toolName: string): string | null {
  if (!toolName.startsWith("mcp__")) return null;
  const parts = toolName.split("__");
  return parts.length >= 2 ? parts[1] : null;
}

function looksLikeInstructionPath(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  if (
    base === "claude.md" ||
    base === "agents.md" ||
    base === "memory.md" ||
    base.endsWith(".mdc")
  ) {
    return true;
  }
  return (
    filePath.includes("/.claude/rules/") ||
    filePath.includes("/.cursor/rules/") ||
    filePath.includes("/.claude/skills/") ||
    /\/skills?\/.+\/skill\.md$/i.test(filePath)
  );
}

function instructionKindForPath(filePath: string): LoadedContextKind {
  const base = path.basename(filePath).toLowerCase();
  if (base === "memory.md" || filePath.includes("/memory/")) return "memory";
  if (
    filePath.includes("/.claude/skills/") ||
    /\/skills?\/.+\/skill\.md$/i.test(filePath)
  ) {
    return "skill";
  }
  return "instruction";
}

function extractSystemReminderBlocks(text: string): string[] {
  const blocks: string[] = [];
  const re =
    /<system-reminder>([\s\S]*?)<\/system-reminder>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) != null) {
    blocks.push(match[1].trim());
  }
  return blocks;
}

function upsertItem(
  map: Map<string, LoadedContextItem>,
  item: LoadedContextItem,
): void {
  const existing = map.get(item.id);
  if (!existing) {
    map.set(item.id, item);
    return;
  }
  map.set(item.id, {
    ...existing,
    ...item,
    detail: item.detail ?? existing.detail,
    sourcePath: item.sourcePath ?? existing.sourcePath,
    estimatedTokens:
      item.estimatedTokens != null
        ? Math.max(existing.estimatedTokens ?? 0, item.estimatedTokens)
        : existing.estimatedTokens,
    evidence: item.evidence ?? existing.evidence,
    count: item.count ?? existing.count,
    mcpServer: item.mcpServer ?? existing.mcpServer,
    toolName: item.toolName ?? existing.toolName,
    skillName: item.skillName ?? existing.skillName,
  });
}

function summarizeCategories(
  items: LoadedContextItem[],
): ContextCategorySummary[] {
  const byKind = new Map<LoadedContextKind, LoadedContextItem[]>();
  for (const item of items) {
    const list = byKind.get(item.kind) ?? [];
    list.push(item);
    byKind.set(item.kind, list);
  }
  return CATEGORY_ORDER.filter((kind) => byKind.has(kind)).map((kind) => {
    const list = byKind.get(kind) ?? [];
    const tokenSum = list.reduce(
      (sum, item) => sum + (item.estimatedTokens ?? 0),
      0,
    );
    const anyTokens = list.some((item) => item.estimatedTokens != null);
    return {
      kind,
      label: CATEGORY_LABELS[kind],
      itemCount: list.length,
      estimatedTokens: anyTokens ? tokenSum : null,
    };
  });
}

function snapshotInventory(
  inventory: Map<string, LoadedContextItem>,
  point: ContextTimelinePoint,
): TurnLoadedContext {
  const items = [...inventory.values()].sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a.kind);
    const bi = CATEGORY_ORDER.indexOf(b.kind);
    if (ai !== bi) return ai - bi;
    return (b.estimatedTokens ?? 0) - (a.estimatedTokens ?? 0);
  });
  const categories = summarizeCategories(items);
  const attributed = categories.reduce(
    (sum, c) => sum + (c.estimatedTokens ?? 0),
    0,
  );
  const inferred = items.some(
    (item) =>
      item.provenance === "inferred" || item.provenance === "baseline",
  );
  const notes: string[] = [];
  if (inferred) {
    notes.push(
      "Some layers are reconstructed from transcript attachments, tool I/O, and usage — Claude Code does not always log full prompt bodies.",
    );
  }
  if (point.contextTokens > 0 && attributed > 0) {
    const coverage = Math.min(100, Math.round((attributed / point.contextTokens) * 100));
    notes.push(
      `Item estimates cover ~${coverage}% of measured ctx (${point.contextTokens.toLocaleString()} tokens); remainder is unparsed prompt/cache material.`,
    );
  } else if (point.contextTokens > 0 && attributed === 0) {
    notes.push(
      "No attachment inventory was found; showing conversation/tool accretion inferred from the transcript.",
    );
  }
  return {
    nodeId: point.nodeId,
    turn: point.turn,
    contextTokens: point.contextTokens,
    categories,
    items,
    inferred,
    notes,
  };
}

/**
 * Reconstruct, turn-by-turn, what appears to be loaded into Claude's context:
 * system/instruction baseline, MCP + skill attachments, deferred tools,
 * files read, and conversation/tool-result accretion.
 */
function buildLoadedContext(
  sourcedEntries: SourcedEntry[],
  timeline: ContextTimelinePoint[],
): TurnLoadedContext[] {
  if (timeline.length === 0) return [];

  const inventory = new Map<string, LoadedContextItem>();
  const snapshots = new Map<string, TurnLoadedContext>();
  let assistantIndex = 0;
  let sawBaseline = false;
  let userMessageCount = 0;
  let assistantMessageCount = 0;

  const pendingToolCalls = new Map<
    string,
    { name: string; input: Record<string, unknown> | null; log: LogLineRef }
  >();

  for (const sourced of sourcedEntries) {
    const entry = sourced.entry;
    const log = toLogRef(sourced);

    if (entry.type === "attachment" || entry.attachment) {
      const kindKey = (attachmentType(entry) ?? "attachment").toLowerCase();
      const payload = entry.attachment ?? entry;
      const payloadRecord = payload as Record<string, unknown>;

      if (
        kindKey.includes("deferred_tool") ||
        kindKey === "deferred_tools_delta"
      ) {
        const tools = asStringArray(
          payloadRecord.tools ??
            payloadRecord.addedTools ??
            payloadRecord.names ??
            payloadRecord.toolNames,
        );
        const mcpTools = tools.filter((t) => t.startsWith("mcp__"));
        const servers = [
          ...new Set(
            mcpTools
              .map((t) => mcpServerFromToolName(t))
              .filter((s): s is string => Boolean(s)),
          ),
        ];
        upsertItem(inventory, {
          id: "deferred-tools",
          kind: "deferred_tools",
          label:
            tools.length > 0
              ? `${tools.length} deferred tool names`
              : "Deferred tools",
          detail:
            tools.length > 0
              ? previewText(tools.slice(0, 12).join(", "), 180)
              : "Tool names registered without full schemas",
          sourcePath: null,
          estimatedTokens:
            tools.length > 0 ? Math.max(1, tools.length * 3) : null,
          provenance: "observed",
          evidence: log,
          count: tools.length || null,
        });
        if (servers.length > 0) {
          for (const server of servers) {
            const serverTools = mcpTools.filter(
              (t) => mcpServerFromToolName(t) === server,
            );
            upsertItem(inventory, {
              id: `mcp-server:${server}`,
              kind: "mcp",
              label: `MCP · ${server}`,
              detail: `${serverTools.length} tool name${serverTools.length === 1 ? "" : "s"} registered (schemas deferred)`,
              sourcePath: null,
              estimatedTokens: Math.max(1, serverTools.length * 3),
              provenance: "observed",
              evidence: log,
              mcpServer: server,
              count: serverTools.length,
            });
          }
        }
      } else if (
        kindKey.includes("mcp_instruction") ||
        kindKey.includes("mcp-instruction") ||
        kindKey === "mcp_instructions_delta"
      ) {
        const servers = asStringArray(
          payloadRecord.servers ??
            payloadRecord.mcpServers ??
            payloadRecord.names,
        );
        const instructions =
          typeof payloadRecord.instructions === "string"
            ? payloadRecord.instructions
            : typeof payloadRecord.content === "string"
              ? payloadRecord.content
              : stringifyContent(
                  payloadRecord.instructions ?? payloadRecord.content ?? "",
                );
        if (servers.length > 0) {
          for (const server of servers) {
            upsertItem(inventory, {
              id: `mcp-instructions:${server}`,
              kind: "mcp",
              label: `MCP instructions · ${server}`,
              detail: previewText(instructions, 180),
              sourcePath: null,
              estimatedTokens: instructions
                ? Math.max(
                    1,
                    Math.round(
                      estimateTokensFromText(instructions) /
                        Math.max(1, servers.length),
                    ),
                  )
                : null,
              provenance: "observed",
              evidence: log,
              mcpServer: server,
            });
          }
        } else {
          upsertItem(inventory, {
            id: `mcp-instructions:${sourced.line}`,
            kind: "mcp",
            label: "MCP instructions",
            detail: previewText(instructions, 180),
            sourcePath: null,
            estimatedTokens: instructions
              ? estimateTokensFromText(instructions)
              : null,
            provenance: "observed",
            evidence: log,
          });
        }
      } else if (
        kindKey.includes("skill_listing") ||
        kindKey.includes("skill-listing") ||
        kindKey === "available_skills"
      ) {
        const skills = asStringArray(
          payloadRecord.skills ??
            payloadRecord.names ??
            payloadRecord.availableSkills,
        );
        upsertItem(inventory, {
          id: "skill-listing",
          kind: "skill",
          label:
            skills.length > 0
              ? `${skills.length} skills listed`
              : "Skill listing",
          detail:
            skills.length > 0
              ? previewText(skills.slice(0, 16).join(", "), 200)
              : "Available skills injected into context",
          sourcePath: null,
          estimatedTokens:
            skills.length > 0
              ? Math.max(8, estimateTokensFromText(skills.join("\n")))
              : null,
          provenance: "observed",
          evidence: log,
          count: skills.length || null,
        });
      } else if (
        kindKey.includes("claude_md") ||
        kindKey.includes("claudemd") ||
        kindKey.includes("instruction") ||
        kindKey === "claude_md_bundle"
      ) {
        const files = asStringArray(
          payloadRecord.files ??
            payloadRecord.paths ??
            payloadRecord.claudeMdFiles,
        );
        const content =
          typeof payloadRecord.content === "string"
            ? payloadRecord.content
            : typeof payloadRecord.text === "string"
              ? payloadRecord.text
              : "";
        if (files.length > 0) {
          for (const filePath of files) {
            const kind = instructionKindForPath(filePath);
            upsertItem(inventory, {
              id: `${kind}:${filePath}`,
              kind,
              label: path.basename(filePath),
              detail: previewText(content, 160),
              sourcePath: filePath,
              estimatedTokens: content
                ? Math.max(
                    1,
                    Math.round(
                      estimateTokensFromText(content) / files.length,
                    ),
                  )
                : null,
              provenance: "observed",
              evidence: log,
              skillName: kind === "skill" ? path.basename(path.dirname(filePath)) : null,
            });
          }
        } else {
          upsertItem(inventory, {
            id: `instruction:attachment:${sourced.line}`,
            kind: "instruction",
            label: "Project instructions",
            detail: previewText(content || stringifyContent(payloadRecord), 180),
            sourcePath: null,
            estimatedTokens: content
              ? estimateTokensFromText(content)
              : estimateTokensFromText(stringifyContent(payloadRecord)),
            provenance: "observed",
            evidence: log,
          });
        }
      } else if (
        kindKey.includes("memory") ||
        kindKey === "memory_files"
      ) {
        const files = asStringArray(
          payloadRecord.files ?? payloadRecord.paths ?? payloadRecord.names,
        );
        const content =
          typeof payloadRecord.content === "string"
            ? payloadRecord.content
            : "";
        if (files.length > 0) {
          for (const filePath of files) {
            upsertItem(inventory, {
              id: `memory:${filePath}`,
              kind: "memory",
              label: path.basename(filePath),
              detail: previewText(content, 160),
              sourcePath: filePath,
              estimatedTokens: content
                ? Math.max(
                    1,
                    Math.round(
                      estimateTokensFromText(content) / files.length,
                    ),
                  )
                : null,
              provenance: "observed",
              evidence: log,
            });
          }
        } else {
          upsertItem(inventory, {
            id: `memory:attachment:${sourced.line}`,
            kind: "memory",
            label: "Memory",
            detail: previewText(content || stringifyContent(payloadRecord), 180),
            sourcePath: null,
            estimatedTokens: content
              ? estimateTokensFromText(content)
              : null,
            provenance: "observed",
            evidence: log,
          });
        }
      } else {
        const content = stringifyContent(payloadRecord);
        upsertItem(inventory, {
          id: `attachment:${kindKey}:${sourced.line}`,
          kind: "attachment",
          label: kindKey.replace(/_/g, " "),
          detail: previewText(content, 180),
          sourcePath: null,
          estimatedTokens: content ? estimateTokensFromText(content) : null,
          provenance: "observed",
          evidence: log,
        });
      }
    }

    if (entry.type === "user") {
      const blocks = asBlocks(entry.message?.content);
      const text = blocks
        .filter((b) => b.type === "text" || !b.type)
        .map((b) => b.text ?? stringifyContent(b.content))
        .join("\n")
        .trim();

      if (text) {
        const reminders = extractSystemReminderBlocks(text);
        for (const [idx, reminder] of reminders.entries()) {
          const lower = reminder.toLowerCase();
          if (
            lower.includes("claude.md") ||
            lower.includes("project instructions") ||
            lower.includes("# claude.md")
          ) {
            const pathMatch =
              reminder.match(
                /(?:^|\s)((?:\/|\.\/)?[\w./-]*(?:CLAUDE\.md|AGENTS\.md|\.mdc))/m,
              ) ?? null;
            const sourcePath = pathMatch?.[1] ?? "CLAUDE.md";
            upsertItem(inventory, {
              id: `instruction:${sourcePath}`,
              kind: "instruction",
              label: path.basename(sourcePath),
              detail: previewText(reminder, 180),
              sourcePath,
              estimatedTokens: estimateTokensFromText(reminder),
              provenance: "observed",
              evidence: log,
            });
          } else if (lower.includes("memory.md") || lower.includes("auto memory")) {
            upsertItem(inventory, {
              id: `memory:reminder:${sourced.line}:${idx}`,
              kind: "memory",
              label: "Memory",
              detail: previewText(reminder, 180),
              sourcePath: "MEMORY.md",
              estimatedTokens: estimateTokensFromText(reminder),
              provenance: "observed",
              evidence: log,
            });
          } else if (lower.includes("skill")) {
            upsertItem(inventory, {
              id: `skill:reminder:${sourced.line}:${idx}`,
              kind: "skill",
              label: "Skill reminder",
              detail: previewText(reminder, 180),
              sourcePath: null,
              estimatedTokens: estimateTokensFromText(reminder),
              provenance: "observed",
              evidence: log,
            });
          } else {
            upsertItem(inventory, {
              id: `attachment:reminder:${sourced.line}:${idx}`,
              kind: "attachment",
              label: "System reminder",
              detail: previewText(reminder, 180),
              sourcePath: null,
              estimatedTokens: estimateTokensFromText(reminder),
              provenance: "observed",
              evidence: log,
            });
          }
        }

        const userVisible = text
          .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "")
          .trim();
        if (userVisible) {
          userMessageCount += 1;
          upsertItem(inventory, {
            id: `user:${entry.uuid ?? userMessageCount}`,
            kind: "user_message",
            label: `User message ${userMessageCount}`,
            detail: previewText(userVisible, 180),
            sourcePath: null,
            estimatedTokens: estimateTokensFromText(userVisible),
            provenance: "inferred",
            evidence: log,
          });
        }
      }

      for (const block of blocks) {
        if (block.type !== "tool_result" || !block.tool_use_id) continue;
        const meta = pendingToolCalls.get(block.tool_use_id);
        const contentText = stringifyContent(block.content);
        const resultTokens = estimateTokensFromText(contentText);
        const toolName = meta?.name ?? "tool";

        if (toolName === "Read" || toolName === "Write" || toolName === "Edit") {
          const filePath =
            (typeof meta?.input?.file_path === "string" &&
              meta.input.file_path) ||
            (typeof meta?.input?.path === "string" && meta.input.path) ||
            null;
          if (filePath) {
            const kind = looksLikeInstructionPath(filePath)
              ? instructionKindForPath(filePath)
              : "file";
            upsertItem(inventory, {
              id: `${kind}:${filePath}`,
              kind,
              label: path.basename(filePath),
              detail: previewText(contentText, 180),
              sourcePath: filePath,
              estimatedTokens: resultTokens,
              provenance: "inferred",
              evidence: log,
              skillName:
                kind === "skill"
                  ? path.basename(path.dirname(filePath))
                  : null,
            });
          }
        }

        if (toolName === "ToolSearch") {
          const loaded = asStringArray(
            Array.isArray(block.content)
              ? block.content
              : typeof block.content === "string"
                ? block.content.split(/[\n,]/).map((s) => s.trim())
                : [],
          );
          const names =
            loaded.length > 0
              ? loaded
              : contentText
                  .split(/[\n,]/)
                  .map((s) => s.trim())
                  .filter((s) => s.startsWith("mcp__") || s.includes("__"));
          for (const name of names.slice(0, 40)) {
            const server = mcpServerFromToolName(name);
            upsertItem(inventory, {
              id: `tool-schema:${name}`,
              kind: "tool_schema",
              label: name,
              detail: "Schema loaded on demand via ToolSearch",
              sourcePath: null,
              estimatedTokens: Math.max(40, Math.round(resultTokens / Math.max(1, names.length))),
              provenance: "observed",
              evidence: log,
              toolName: name,
              mcpServer: server,
            });
            if (server) {
              upsertItem(inventory, {
                id: `mcp-server:${server}`,
                kind: "mcp",
                label: `MCP · ${server}`,
                detail: `Loaded schema for ${name}`,
                sourcePath: null,
                estimatedTokens: null,
                provenance: "observed",
                evidence: log,
                mcpServer: server,
              });
            }
          }
        }

        if (
          toolName === "Skill" ||
          toolName === "LoadSkill" ||
          toolName.toLowerCase() === "skills"
        ) {
          const skillName =
            (typeof meta?.input?.skill === "string" && meta.input.skill) ||
            (typeof meta?.input?.name === "string" && meta.input.name) ||
            (typeof meta?.input?.skill_name === "string" &&
              meta.input.skill_name) ||
            "skill";
          upsertItem(inventory, {
            id: `skill:${skillName}`,
            kind: "skill",
            label: skillName,
            detail: previewText(contentText, 180),
            sourcePath:
              typeof meta?.input?.path === "string" ? meta.input.path : null,
            estimatedTokens: resultTokens,
            provenance: "observed",
            evidence: log,
            skillName,
          });
        }

        // Generic tool result accretion (skip duplicates already classified as files)
        if (
          toolName !== "Read" &&
          toolName !== "Write" &&
          toolName !== "Edit" &&
          toolName !== "ToolSearch" &&
          toolName !== "Skill" &&
          toolName !== "LoadSkill"
        ) {
          upsertItem(inventory, {
            id: `tool-result:${block.tool_use_id}`,
            kind: "tool_result",
            label: `${toolName} result`,
            detail: previewText(contentText, 180),
            sourcePath:
              typeof meta?.input?.file_path === "string"
                ? meta.input.file_path
                : null,
            estimatedTokens: resultTokens,
            provenance: "inferred",
            evidence: log,
            toolName,
            mcpServer: mcpServerFromToolName(toolName),
          });
        }
      }
    }

    if (entry.type === "assistant") {
      const nodeId = entry.uuid ?? `assistant-${assistantIndex}`;
      assistantIndex += 1;
      const u = toUsage(entry.message?.usage);
      const blocks = asBlocks(entry.message?.content);
      const text = blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("\n")
        .trim();
      const tools = blocks.filter((b) => b.type === "tool_use");

      for (const tool of tools) {
        if (!tool.id || !tool.name) continue;
        pendingToolCalls.set(tool.id, {
          name: tool.name,
          input: asInputRecord(tool.input),
          log,
        });
        const server = mcpServerFromToolName(tool.name);
        if (server) {
          upsertItem(inventory, {
            id: `mcp-server:${server}`,
            kind: "mcp",
            label: `MCP · ${server}`,
            detail: `Invoked ${tool.name}`,
            sourcePath: null,
            estimatedTokens: null,
            provenance: "inferred",
            evidence: log,
            mcpServer: server,
            toolName: tool.name,
          });
          upsertItem(inventory, {
            id: `tool-schema:${tool.name}`,
            kind: "tool_schema",
            label: tool.name,
            detail: "MCP tool used this session",
            sourcePath: null,
            estimatedTokens: null,
            provenance: "inferred",
            evidence: log,
            toolName: tool.name,
            mcpServer: server,
          });
        }
      }

      if (totalTokens(u) > 0 || contextSize(u) > 0) {
        if (!sawBaseline) {
          sawBaseline = true;
          const baselineTokens = Math.max(
            0,
            u.cacheCreationInputTokens + u.cacheReadInputTokens + u.inputTokens,
          );
          // Reserve a share of first-turn cache for the opaque system prompt
          // when we have no richer attachment inventory yet.
          const hasObservedLayers = [...inventory.values()].some(
            (item) =>
              item.provenance === "observed" &&
              (item.kind === "instruction" ||
                item.kind === "mcp" ||
                item.kind === "skill" ||
                item.kind === "memory" ||
                item.kind === "deferred_tools"),
          );
          const systemShare = hasObservedLayers
            ? Math.round(baselineTokens * 0.35)
            : baselineTokens;
          upsertItem(inventory, {
            id: "system-prompt",
            kind: "system_prompt",
            label: "System prompt & harness",
            detail:
              "Identity, tool-use rules, safety, and environment metadata (cwd, git, model)",
            sourcePath: null,
            estimatedTokens: systemShare > 0 ? systemShare : null,
            provenance: "baseline",
            evidence: log,
          });
        }

        if (text) {
          assistantMessageCount += 1;
          upsertItem(inventory, {
            id: `assistant-text:${nodeId}`,
            kind: "assistant_message",
            label: `Assistant reply ${assistantMessageCount}`,
            detail: previewText(text, 160),
            sourcePath: null,
            estimatedTokens: estimateTokensFromText(text),
            provenance: "inferred",
            evidence: log,
          });
        }

        const point = timeline.find((p) => p.nodeId === nodeId);
        if (point) {
          snapshots.set(nodeId, snapshotInventory(inventory, point));
        }
      }
    }
  }

  return timeline.map(
    (point) =>
      snapshots.get(point.nodeId) ?? snapshotInventory(inventory, point),
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
    if (!isTimelineAssistantTurn(entry)) continue;
    const u = toUsage(entry.message?.usage);
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
): {
  tree: TreeNode;
  usage: TokenUsage;
  peak: number;
  toolCalls: number;
  messages: number;
  tools: Map<string, number>;
} {
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
  const toolCounts = new Map<string, number>();
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
        const name = tool.name ?? "tool";
        toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1);
        const summary = toolInputPreview(name, tool.input);
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
  return { tree: root, usage, peak, toolCalls, messages, tools: toolCounts };
}

function agentToolSummaries(
  toolCounts: Map<string, number>,
): AgentToolSummary[] {
  return [...toolCounts.entries()]
    .map(([toolName, callCount]) => ({ toolName, callCount }))
    .sort(
      (a, b) =>
        b.callCount - a.callCount || a.toolName.localeCompare(b.toolName),
    );
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
    turnCount: parsed.turnCount,
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
      tools: agentToolSummaries(rootBuild.tools),
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
      tools: agentToolSummaries(built.tools),
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

  const timeline = buildTimeline(parsed.entries);

  return {
    meta,
    tree: rootBuild.tree,
    timeline,
    toolImpact: buildToolImpact(parsed.entries),
    agentBreakdown,
    loadedContext: buildLoadedContext(parsed.entries, timeline),
  };
}

export function projectPathFromEncoded(encoded: string): string {
  return decodeProjectPath(encoded);
}
