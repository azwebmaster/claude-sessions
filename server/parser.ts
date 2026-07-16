import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type {
  AgentBreakdownRow,
  ContextTimelinePoint,
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
  entries: RawEntry[];
  subagentFiles: { agentId: string; filePath: string; entries: RawEntry[] }[];
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

function toolInputPreview(
  name: string,
  input?: Record<string, unknown>,
): string | null {
  if (!input) return null;
  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = input[key];
      if (typeof value === "string" && value.trim()) {
        return previewText(value, 140);
      }
    }
    return null;
  };

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
      return (
        pick(
          "file_path",
          "path",
          "command",
          "pattern",
          "query",
          "url",
          "description",
          "prompt",
        ) ?? previewText(stringifyContent(input), 140)
      );
  }
}

async function readEntries(filePath: string): Promise<RawEntry[]> {
  const text = await readFile(filePath, "utf8");
  const entries: RawEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as RawEntry);
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
): Promise<{ agentId: string; filePath: string; entries: RawEntry[] }[]> {
  const results: { agentId: string; filePath: string; entries: RawEntry[] }[] =
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

  for (const entry of entries) consider(entry);

  // Subagent transcripts contribute agent identity / counts, but their token
  // usage is reported separately in the agent breakdown (not double-counted
  // into the root session totals).
  for (const sub of subagentFiles) {
    agentIds.add(sub.agentId);
  }

  // Also detect Task/Agent tool launches as subagents even without files
  for (const entry of entries) {
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

  const taskLaunches = entries.reduce((n, entry) => {
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
  entries: RawEntry[],
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

  for (const entry of entries) {
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
        const resultTokens = estimateResultTokens(block);
        const resultPreview = previewText(
          stringifyContent(block.content),
          220,
        );
        const meta = callMeta.get(block.tool_use_id);
        if (meta) {
          meta.call.resultTokens = resultTokens;
          meta.call.resultPreview = resultPreview;
          meta.call.isError = Boolean(block.is_error);
          if (!meta.call.timestamp && entry.timestamp) {
            meta.call.timestamp = entry.timestamp;
          }
          const row = byTool.get(meta.toolName);
          if (row) {
            row.totalResultTokens += resultTokens;
            row.maxResultTokens = Math.max(row.maxResultTokens, resultTokens);
          }
          pending.push(meta);
        } else {
          const toolName = "unknown";
          const row = ensureToolRow(byTool, toolName);
          row.callCount += 1;
          row.totalResultTokens += resultTokens;
          row.maxResultTokens = Math.max(row.maxResultTokens, resultTokens);
          const call: ToolImpactCall = {
            toolUseId: block.tool_use_id,
            timestamp: entry.timestamp ?? null,
            inputPreview: null,
            resultPreview,
            resultTokens,
            contextGrowthAttributed: 0,
            isError: Boolean(block.is_error),
          };
          row.calls.push(call);
          pending.push({ toolName, call });
        }
      }
    }
  }

  return [...byTool.entries()]
    .map(([toolName, row]) => ({
      toolName,
      callCount: row.callCount,
      totalResultTokens: row.totalResultTokens,
      avgResultTokens:
        row.callCount > 0
          ? Math.round(row.totalResultTokens / row.callCount)
          : 0,
      maxResultTokens: row.maxResultTokens,
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
    }))
    .sort(
      (a, b) =>
        b.contextGrowthAttributed - a.contextGrowthAttributed ||
        b.totalResultTokens - a.totalResultTokens,
    );
}

function buildTimeline(entries: RawEntry[]): ContextTimelinePoint[] {
  const points: ContextTimelinePoint[] = [];
  let turn = 0;
  let assistantIndex = 0;
  for (const entry of entries) {
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
    });
  }
  return points;
}

function buildAgentTreeFromEntries(
  entries: RawEntry[],
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
    timestamp: entries[0]?.timestamp ?? null,
    model: opts.model,
    usage: emptyUsage(),
    context: null,
    preview: null,
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

  for (const entry of entries) {
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
          children: [],
        });
      }

      for (const tool of tools) {
        toolCalls += 1;
        const inputPreview = previewText(stringifyContent(tool.input), 160);
        const isSubagent =
          tool.name === "Task" ||
          tool.name === "Agent" ||
          tool.name === "TaskCreate";
        const toolNode: TreeNode = {
          id: tool.id ?? `${assistantNode.id}-tool-${toolCalls}`,
          kind: "tool_call",
          label: tool.name ?? "tool",
          timestamp: entry.timestamp ?? null,
          model: null,
          usage: null,
          context: {
            addedTokens: estimateTokensFromText(stringifyContent(tool.input)),
            contextAfter: null,
            contextDelta: null,
          },
          preview: inputPreview,
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
        children: [],
      });
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
        .find((e) => e.type === "assistant" && e.message?.model)?.message
        ?.model ?? null;
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
