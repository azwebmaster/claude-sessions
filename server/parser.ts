import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type {
  AgentBreakdownRow,
  AgentToolSummary,
  ContextCategorySummary,
  ContextGrowthCause,
  ContextTimelinePoint,
  LoadedContextItem,
  LoadedContextKind,
  LogLineRef,
  SessionAgent,
  SessionDetail,
  SessionListItem,
  SubagentLaunchSummary,
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
  logLineKey,
  TOOL_RESULT_PREVIEW_CAP,
  totalTokens,
} from "../shared/types.js";
import {
  decodeProjectPath,
  type DiscoveredSessionFile,
} from "./sessions.js";
import { truncateTaggedContent } from "../shared/taggedContent.js";

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
    /**
     * Claude Code writes one JSONL line per content block, so every line of
     * one API response repeats this id — it is the real grouping key for
     * collapsing those lines back into one response (`computeResponseGroups`).
     */
    id?: string;
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

/**
 * Contents of a subagent transcript's `.meta.json` sidecar, written next to
 * the `.jsonl` by Claude Code. Every field is optional and the whole sidecar
 * may be missing: older Claude Code versions wrote none, so every consumer
 * must survive `null`.
 */
export interface SubagentMeta {
  agentType?: string | null;
  description?: string | null;
  /** id of the Task/Agent `tool_use` block that launched this subagent. */
  toolUseId?: string | null;
  /** agentId of the launching subagent when `spawnDepth >= 2`. */
  parentAgentId?: string | null;
  spawnDepth?: number | null;
}

export interface SubagentFile {
  agentId: string;
  filePath: string;
  entries: SourcedEntry[];
  /** `null` when the sidecar is absent, unreadable, or not a JSON object. */
  meta: SubagentMeta | null;
}

export interface RawSessionParse {
  summary: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  messageCount: number;
  turnCount: number;
  subagentTurnCount: number;
  toolCallCount: number;
  subagentCount: number;
  model: string | null;
  gitBranch: string | null;
  cwd: string | null;
  usage: TokenUsage;
  peakContextTokens: number;
  entries: SourcedEntry[];
  subagentFiles: SubagentFile[];
}

/** Assistant entries that appear as turns on the context timeline. */
function isTimelineAssistantTurn(entry: RawEntry): boolean {
  if (entry.type !== "assistant") return false;
  const u = toUsage(entry.message?.usage);
  return totalTokens(u) > 0 || contextSize(u) > 0;
}

/** A `user`-type entry whose blocks are all `tool_result` (not a real prompt). */
function isToolResultOnlyUserEntry(entry: RawEntry): boolean {
  if (entry.type !== "user") return false;
  const blocks = asBlocks(entry.message?.content);
  return blocks.length > 0 && blocks.every((b) => b.type === "tool_result");
}

/** True for a `user` entry that represents an actual prompt from the user
 * (as opposed to a synthetic entry carrying only tool results). */
function isRealUserPrompt(entry: RawEntry): boolean {
  return entry.type === "user" && !isToolResultOnlyUserEntry(entry);
}

/** One real turn: everything from a real user prompt up to (but not
 * including) the next real user prompt, or EOF. */
interface TimelineTurnGroup {
  /** The subset of entries in this turn that pass `isTimelineAssistantTurn`. */
  qualifyingAssistantEntries: SourcedEntry[];
  /** True only if this group was opened by an actual `isRealUserPrompt`
   * entry. A group seeded by the `!current` fallback (leading entries that
   * appear before the first real user prompt in the stream, e.g. a
   * resumed/continued session file that starts mid-conversation) collects
   * those entries, but every consumer — `countRealTurns` and `buildTimeline`
   * — skips it, so they are not counted and get no timeline point. */
  openedByRealPrompt: boolean;
  /** The real user prompt entry this group was opened by — the text the rail
   * shows as `promptPreview`. Null for a `!current` fallback group. */
  openingPrompt: SourcedEntry | null;
  startedAt: string | null;
  endedAt: string | null;
}

/** Groups a flat entry stream into one `TimelineTurnGroup` per real user
 * prompt — the entire span between a user submitting a prompt and the next
 * real prompt (or EOF), including every tool call/result/attachment the
 * agent produced while working on it.
 *
 * Memoized per `sourcedEntries` array: `buildSessionDetail` / `parseSessionFile`
 * call this (directly or via `countRealTurns`) several times over the same
 * entries array (turn counting, timeline building, tree building), so caching
 * by array identity avoids re-walking and re-allocating identical groups. */
const turnGroupsCache = new WeakMap<SourcedEntry[], TimelineTurnGroup[]>();

function groupIntoTurns(sourcedEntries: SourcedEntry[]): TimelineTurnGroup[] {
  const cached = turnGroupsCache.get(sourcedEntries);
  if (cached) return cached;

  const groups: TimelineTurnGroup[] = [];
  let current: TimelineTurnGroup | null = null;

  for (const sourced of sourcedEntries) {
    const entry = sourced.entry;
    const startsRealPrompt = isRealUserPrompt(entry);
    if (startsRealPrompt || !current) {
      current = {
        qualifyingAssistantEntries: [],
        openedByRealPrompt: startsRealPrompt,
        openingPrompt: startsRealPrompt ? sourced : null,
        startedAt: null,
        endedAt: null,
      };
      groups.push(current);
    }
    if (isTimelineAssistantTurn(entry)) {
      current.qualifyingAssistantEntries.push(sourced);
    }
    if (entry.timestamp) {
      if (!current.startedAt || entry.timestamp < current.startedAt) {
        current.startedAt = entry.timestamp;
      }
      if (!current.endedAt || entry.timestamp > current.endedAt) {
        current.endedAt = entry.timestamp;
      }
    }
  }

  turnGroupsCache.set(sourcedEntries, groups);
  return groups;
}

/** Number of real turns — groups opened by an actual user prompt that
 * produced at least one qualifying assistant entry. */
function countRealTurns(sourcedEntries: SourcedEntry[]): number {
  return groupIntoTurns(sourcedEntries).filter(
    (g) => g.openedByRealPrompt && g.qualifyingAssistantEntries.length > 0,
  ).length;
}

function toLogRef(source: SourcedEntry): LogLineRef {
  return {
    filePath: source.filePath,
    line: source.line,
    raw: source.raw,
  };
}

const SUBAGENT_LAUNCH_TOOL_NAMES = new Set(["Task", "Agent", "TaskCreate"]);

/** True for tool names that launch a subagent (Task/Agent/TaskCreate). */
function isSubagentLaunchTool(name: string | null | undefined): boolean {
  return name != null && SUBAGENT_LAUNCH_TOOL_NAMES.has(name);
}

/** One API response, reassembled from every JSONL line that shares its
 * `message.id` (Claude Code writes one line per content block). */
interface ResponseGroup {
  members: SourcedEntry[];
  /** The FIRST member's uuid (or the counter-fallback), so a single-line
   *  response keeps the id `computeAssistantNodeIds` minted before response
   *  grouping existed. */
  nodeId: string;
  /** Merged usage for the whole response: input/cache taken once (from the
   *  first member — 0 real groups were observed to differ), `outputTokens`
   *  the max across members (a partial streaming value; the final value
   *  lands on the last member) — never summed, or totals inflate 2-4x. */
  usage: TokenUsage;
}

/** Memoized per `sourcedEntries` array, matching `turnGroupsCache`'s
 * convention: several consumers (tree, timeline, tool-impact, session
 * totals) walk the same entries array per session/subagent transcript. */
const responseGroupsCache = new WeakMap<
  SourcedEntry[],
  { groups: ResponseGroup[]; byEntry: Map<SourcedEntry, ResponseGroup> }
>();

/**
 * Groups assistant JSONL lines that belong to one API response, keyed by
 * `message.id` — not adjacency: `tool_result` lines interleave between a
 * response's own lines, and a later member's `parentUuid` may chain off an
 * earlier member's tool_result rather than off the previous member itself.
 *
 * Walks in file order with a map of currently-open groups keyed by
 * `message.id`. A real user prompt (`isRealUserPrompt`) closes every open
 * group first: a response cannot span a user prompt, so a reused id in a
 * later turn can never merge across the boundary (protects
 * `buildTurnNodeIndex`'s invariant that a call's steps share one turn).
 */
function computeResponseGroups(sourcedEntries: SourcedEntry[]): {
  groups: ResponseGroup[];
  byEntry: Map<SourcedEntry, ResponseGroup>;
} {
  const cached = responseGroupsCache.get(sourcedEntries);
  if (cached) return cached;

  const groups: ResponseGroup[] = [];
  const byEntry = new Map<SourcedEntry, ResponseGroup>();
  const open = new Map<string, ResponseGroup>();
  let assistantIndex = 0;

  for (const sourced of sourcedEntries) {
    const entry = sourced.entry;
    if (isRealUserPrompt(entry)) {
      open.clear();
      continue;
    }
    if (entry.type !== "assistant") continue;

    // Any non-empty string is an opaque grouping key — do not validate a
    // `msg_` prefix (a handful of real transcripts carry UUID-shaped ids).
    const rawId = entry.message?.id;
    const key = typeof rawId === "string" && rawId.length > 0 ? rawId : null;
    let group = key != null ? open.get(key) : undefined;
    if (!group) {
      // A null key, or no open group for this key, starts a new group.
      // Preserve the pre-grouping counter-fallback semantics exactly: the
      // fallback path (no `message.id` anywhere) makes every line its own
      // group, so this must produce identical ids to the old per-line loop.
      group = {
        members: [],
        nodeId: entry.uuid ?? `assistant-${assistantIndex}`,
        usage: emptyUsage(),
      };
      groups.push(group);
      if (key != null) open.set(key, group);
    }
    assistantIndex += 1;

    group.members.push(sourced);
    byEntry.set(sourced, group);

    const u = toUsage(entry.message?.usage);
    if (group.members.length === 1) {
      group.usage = u;
    } else {
      // Output is billed per line and accumulates (streamed ramp), so it's
      // always the max across every member. Input/cache tokens describe the
      // API call's context, not this line — normally identical on every
      // member, so the first member's value is used. But if that first
      // member's own usage is zero/absent (e.g. a leading `thinking`-only
      // line before usage is attached) while a later member carries the
      // real nonzero values, fall forward to the first member that actually
      // has nonzero input/cache usage instead of permanently reporting zero.
      const hasInputOrCache = (usage: TokenUsage) =>
        usage.inputTokens > 0 ||
        usage.cacheCreationInputTokens > 0 ||
        usage.cacheReadInputTokens > 0;
      const preferThisMember = !hasInputOrCache(group.usage) && hasInputOrCache(u);
      group.usage = {
        inputTokens: preferThisMember ? u.inputTokens : group.usage.inputTokens,
        cacheCreationInputTokens: preferThisMember
          ? u.cacheCreationInputTokens
          : group.usage.cacheCreationInputTokens,
        cacheReadInputTokens: preferThisMember
          ? u.cacheReadInputTokens
          : group.usage.cacheReadInputTokens,
        outputTokens: Math.max(group.usage.outputTokens, u.outputTokens),
      };
    }
  }

  const result = { groups, byEntry };
  responseGroupsCache.set(sourcedEntries, result);
  return result;
}

/**
 * Stable per-turn identifier used to correlate the context timeline with
 * tool-impact attribution (`causedBy`) and subagent launches. Computed once
 * so both joins key off the same entry->nodeId mapping instead of each
 * re-deriving `entry.uuid ?? assistant-${assistantIndex}` independently,
 * which could silently desync if only one of them changed its iteration.
 *
 * A thin projection of `computeResponseGroups`: every member of a response
 * group shares that group's `nodeId`, so the N JSONL lines Claude Code wrote
 * for one API response collapse onto a single id here.
 */
function computeAssistantNodeIds(
  sourcedEntries: SourcedEntry[],
): Map<SourcedEntry, string> {
  const { byEntry } = computeResponseGroups(sourcedEntries);
  const nodeIds = new Map<SourcedEntry, string>();
  for (const [sourced, group] of byEntry) {
    nodeIds.set(sourced, group.nodeId);
  }
  return nodeIds;
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
  // Tag-aware: a naive char slice can cut a `<tag>` in half before its
  // closing bracket, leaving it undetected as markup by client-side
  // rendering, which then shows the raw angle brackets instead of a chip.
  return truncateTaggedContent(cleaned, max);
}

/** Drops `<system-reminder>…</system-reminder>` blocks that Claude Code
 * injects into user message text, leaving what the user actually typed. */
function stripSystemReminders(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "");
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
  return previewText(stringifyContent(content), TOOL_RESULT_PREVIEW_CAP);
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
    // "A result arrived" is its own bit: a result entry with no timestamp still
    // leaves completedAt null, and the UI must not read that as in flight.
    meta.call.resultApplied = true;
    // Only backfill completedAt here — meta.call.timestamp reflects when the
    // tool_use was invoked (or is null if unknown) and must never be set from
    // the result's own timestamp, or durationMs would compute as 0 instead of
    // staying unknown.
    if (!meta.call.completedAt && opts.timestamp) {
      meta.call.completedAt = opts.timestamp;
    }
    if (meta.call.timestamp && meta.call.completedAt) {
      const durationMs =
        Date.parse(meta.call.completedAt) - Date.parse(meta.call.timestamp);
      meta.call.durationMs =
        Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null;
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
    resultApplied: true,
    completedAt: opts.timestamp,
    durationMs: null,
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

function countTimelineTurns(entries: SourcedEntry[]): number {
  return countRealTurns(entries);
}

/** Read `<transcript>.meta.json`; `null` on any read or parse failure. */
async function readSubagentMeta(
  transcriptPath: string,
): Promise<SubagentMeta | null> {
  const metaPath = transcriptPath.replace(/\.jsonl$/, ".meta.json");
  let text: string;
  try {
    text = await readFile(metaPath, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as SubagentMeta;
  } catch {
    return null;
  }
}

/**
 * Sort key for parent-first ordering. A missing or non-numeric `spawnDepth`
 * counts as 1 (launched from the root transcript), so sidecar-less subagents
 * keep the timestamp-only order they had before sidecars were read.
 */
function spawnDepthOf(meta: SubagentMeta | null): number {
  const depth = meta?.spawnDepth;
  return typeof depth === "number" && Number.isFinite(depth) ? depth : 1;
}

async function loadSubagents(
  sessionFilePath: string,
): Promise<SubagentFile[]> {
  const results: SubagentFile[] = [];
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
      const meta = await readSubagentMeta(filePath);
      results.push({ agentId, filePath, entries, meta });
    }
  }

  // `readdir()` order is filesystem-dependent, not launch order. Sort
  // parent-first (`spawnDepth` ascending) so a nested subagent's parent tree
  // is already built when the child attaches to it, then by each subagent's
  // earliest transcript timestamp so positional pairing with Task tool-call
  // nodes (visited in chronological transcript order) is deterministic
  // instead of depending on directory listing order.
  results.sort((a, b) => {
    const depthDelta = spawnDepthOf(a.meta) - spawnDepthOf(b.meta);
    if (depthDelta !== 0) return depthDelta;
    const at = a.entries[0]?.entry.timestamp ?? "";
    const bt = b.entries[0]?.entry.timestamp ?? "";
    return at.localeCompare(bt);
  });

  return results;
}

export async function parseSessionFile(
  filePath: string,
  options: { lightweight?: boolean; sessionId?: string } = {},
): Promise<RawSessionParse> {
  const entries = await readEntries(filePath);
  // Always scan subagent JSONL so list view can report subagent turn counts;
  // discard entry payloads afterward when lightweight.
  const subagentFiles = await loadSubagents(filePath);
  const subagentFileCount = subagentFiles.length;
  const subagentTurnCount = subagentFiles.reduce(
    (n, sub) => n + countTimelineTurns(sub.entries),
    0,
  );

  let summary: string | null = null;
  let firstUserText: string | null = null;
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
  const { byEntry: responseGroupByEntry } = computeResponseGroups(entries);

  const consider = (sourced: SourcedEntry) => {
    const entry = sourced.entry;
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
      if (!isToolResultOnlyUserEntry(entry)) {
        const blocks = asBlocks(entry.message?.content);
        messageCount += 1;
        if (firstUserText === null) {
          const text = blocks
            .filter((b) => b.type === "text")
            .map((b) => b.text ?? "")
            .join(" ")
            .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "")
            .trim();
          if (text) firstUserText = text;
        }
      }
    }

    if (entry.type === "assistant") {
      if (entry.message?.model) model = entry.message.model;
      // One response is N JSONL lines repeating the same usage payload;
      // fold it in once, at the group's first member, using the merged
      // (input/cache-once, output-max) usage — summing every line inflates
      // totals 2-4x.
      const group = responseGroupByEntry.get(sourced)!;
      if (sourced === group.members[0]) {
        const u = group.usage;
        usage = addUsage(usage, u);
        peakContextTokens = Math.max(peakContextTokens, contextSize(u));
      }
      // Blocks are per line, so the total is unchanged by grouping — count
      // every member's tool_use blocks.
      for (const block of asBlocks(entry.message?.content)) {
        if (block.type === "tool_use") toolCallCount += 1;
      }
    }
  };

  for (const sourced of entries) consider(sourced);
  const turnCount = countRealTurns(entries);

  // Fall back to a title derived from the first user message when the
  // transcript has no explicit `type:"summary"` entry.
  if (summary === null && firstUserText) {
    summary = previewText(firstUserText);
  }

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
      if (isSubagentLaunchTool(name)) {
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
        (b) => b.type === "tool_use" && isSubagentLaunchTool(b.name),
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
    subagentTurnCount,
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
): { rows: ToolImpactRow[]; byTurn: Map<string, ContextGrowthCause[]> } {
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
  const byTurn = new Map<string, ContextGrowthCause[]>();
  let lastContext: number | null = null;
  let pending: { toolName: string; call: ToolImpactCall }[] = [];
  const { byEntry: responseGroupByEntry } = computeResponseGroups(sourcedEntries);

  for (const sourced of sourcedEntries) {
    const { entry } = sourced;
    if (entry.type === "assistant") {
      const group = responseGroupByEntry.get(sourced)!;

      // Blocks live on their own line, so register every member's tool_use.
      for (const block of asBlocks(entry.message?.content)) {
        if (block.type === "tool_use" && block.id && block.name) {
          const row = ensureToolRow(byTool, block.name);
          row.callCount += 1;
          const call: ToolImpactCall = {
            toolUseId: block.id,
            timestamp: entry.timestamp ?? null,
            resultApplied: false,
            completedAt: null,
            durationMs: null,
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

      // The growth/pro-rata attribution flush runs once per response, at
      // its first member, using the group's merged usage. Members 2..N of a
      // group repeat the same usage line — flushing on every member would
      // report zero growth for them and discard every tool result queued
      // up in `pending` since the previous flush, leaving only a batch's
      // last call ever attributed.
      if (sourced === group.members[0]) {
        const u = group.usage;
        if (totalTokens(u) > 0) {
          const ctx = contextSize(u);
          const growth = lastContext == null ? 0 : Math.max(0, ctx - lastContext);
          if (growth > 0 && pending.length > 0) {
            const weightSum =
              pending.reduce((s, p) => s + p.call.resultTokens, 0) || 1;
            const causes: ContextGrowthCause[] = [];
            for (const item of pending) {
              const share = (item.call.resultTokens / weightSum) * growth;
              item.call.contextGrowthAttributed += share;
              const row = byTool.get(item.toolName);
              if (row) row.contextGrowthAttributed += share;
              causes.push({
                toolUseId: item.call.toolUseId,
                contextGrowthAttributed: Math.round(share),
                inputPreview: item.call.inputPreview,
              });
            }
            causes.sort((a, b) => b.contextGrowthAttributed - a.contextGrowthAttributed);
            byTurn.set(group.nodeId, causes);
          }
          lastContext = ctx;
          pending = [];
        }
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

  const rows = [...byTool.entries()]
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

  return { rows, byTurn };
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

/** Stash a log ref's raw JSONL text once in the shared `logLines` dictionary
 * and return the ref with `raw` emptied, so the same line text isn't
 * re-embedded by every holder of a ref to it. */
function stashLogLine(
  ref: LogLineRef,
  logLines: Record<string, string>,
): LogLineRef {
  const key = logLineKey(ref);
  if (!(key in logLines)) logLines[key] = ref.raw;
  return { ...ref, raw: "" };
}

function snapshotInventory(
  inventory: Map<string, LoadedContextItem>,
  point: ContextTimelinePoint,
  logLines: Record<string, string>,
): TurnLoadedContext {
  // `upsertItem` never prunes the running inventory, so each turn re-embeds
  // every item accumulated so far. Strip each item's raw JSONL text down to
  // "" here (once per item, as the snapshot is first built) and stash it
  // once per unique (filePath, line) in the shared `logLines` dictionary
  // instead of duplicating it across every snapshot.
  const items = [...inventory.values()]
    .sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a.kind);
      const bi = CATEGORY_ORDER.indexOf(b.kind);
      if (ai !== bi) return ai - bi;
      return (b.estimatedTokens ?? 0) - (a.estimatedTokens ?? 0);
    })
    .map((item) => {
      if (!item.evidence) return item;
      const key = logLineKey(item.evidence);
      if (!(key in logLines)) logLines[key] = item.evidence.raw;
      return { ...item, evidence: { ...item.evidence, raw: "" } };
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
  nodeIds: Map<SourcedEntry, string>,
): { loadedContext: TurnLoadedContext[]; logLines: Record<string, string> } {
  if (timeline.length === 0) return { loadedContext: [], logLines: {} };

  const inventory = new Map<string, LoadedContextItem>();
  const snapshots = new Map<string, TurnLoadedContext>();
  const logLines: Record<string, string> = {};
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
      const nodeId = nodeIds.get(sourced)!;
      // Use the response group's merged usage, not this line's own raw
      // usage: a response split across N JSONL lines can carry usage on
      // more than one line, and per-line usage would otherwise miss a
      // member whose own usage is zero/absent while the group's usage
      // (folded by `computeResponseGroups`) is not. Restricting the
      // snapshot recompute below to the group's true final member (instead
      // of every member that happens to pass the usage check) keeps the
      // O(inventory) `snapshotInventory` call to once per response instead
      // of once per qualifying member.
      const { byEntry: loadedContextGroupByEntry } = computeResponseGroups(sourcedEntries);
      const group = loadedContextGroupByEntry.get(sourced)!;
      const u = group.usage;
      const isGroupFinalMember = group.members[group.members.length - 1] === sourced;
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
            // Keyed on this line's own uuid, not the shared group nodeId:
            // two text-bearing members of one response would otherwise
            // collide here, and `upsertItem`'s max-token merge would
            // silently overwrite one member's preview and inflate
            // `estimatedTokens`.
            id: `assistant-text:${entry.uuid ?? nodeId}`,
            kind: "assistant_message",
            label: `Assistant reply ${assistantMessageCount}`,
            detail: previewText(text, 160),
            sourcePath: null,
            estimatedTokens: estimateTokensFromText(text),
            provenance: "inferred",
            evidence: log,
          });
        }

        // Recompute the snapshot only once per response, at its true final
        // member, so it reflects every member's contributions instead of
        // being redone (and overwritten) once per qualifying member.
        if (isGroupFinalMember) {
          const point = timeline.find((p) => p.nodeId === nodeId);
          if (point) {
            snapshots.set(nodeId, snapshotInventory(inventory, point, logLines));
          }
        }
      }
    }
  }

  const loadedContext = timeline.map(
    (point) =>
      snapshots.get(point.nodeId) ??
      snapshotInventory(inventory, point, logLines),
  );
  return { loadedContext, logLines };
}

function buildTimeline(
  sourcedEntries: SourcedEntry[],
  nodeIds: Map<SourcedEntry, string>,
): { points: ContextTimelinePoint[]; subagentToolUseIds: Map<string, string[]> } {
  const points: ContextTimelinePoint[] = [];
  const subagentToolUseIds = new Map<string, string[]>();
  const { byEntry: responseGroupByEntry } = computeResponseGroups(sourcedEntries);
  let turn = 0;
  for (const group of groupIntoTurns(sourcedEntries)) {
    const qualifying = group.qualifyingAssistantEntries;
    if (!group.openedByRealPrompt || qualifying.length === 0) continue;
    turn += 1;

    const last = qualifying[qualifying.length - 1];
    const nodeId = nodeIds.get(last)!;
    const lastGroup = responseGroupByEntry.get(last)!;
    // The group's true last member in file order — not necessarily `last`:
    // `last` is picked from the usage-filtered `qualifying` list, so if the
    // group's actual final line fails that filter (zero/missing own usage)
    // while an earlier member passes, `last` resolves to that earlier
    // member. `nodeId` is unaffected (every member of a group shares it),
    // but anything that should point at the specific JSONL line the group
    // ended on — the transcript-line link — must use this instead of `last`.
    const trueLastMember = lastGroup.members[lastGroup.members.length - 1];

    // Output is billed per model call, so it accumulates over the turn. The
    // context parts are not: every call in a turn re-sends the same prefix, so
    // summing them would count one cached prefix once per call and disagree
    // with `contextTokens`. They come from `lastUsage` below instead.
    let outputTokens = 0;
    const memberNodeIds: string[] = [];
    // A turn can absorb several response groups; each group's members all
    // map to the same node id, so this must dedupe or every downstream
    // `causedBy` join (`memberNodeIds.flatMap(...)`) duplicates its results.
    const seenGroupNodeIds = new Set<string>();
    const launchIds: string[] = [];

    for (const sourced of qualifying) {
      const memberNodeId = nodeIds.get(sourced)!;
      if (!seenGroupNodeIds.has(memberNodeId)) {
        seenGroupNodeIds.add(memberNodeId);
        memberNodeIds.push(memberNodeId);
        outputTokens += responseGroupByEntry.get(sourced)!.usage.outputTokens;
      }
      for (const block of asBlocks(sourced.entry.message?.content)) {
        if (block.type === "tool_use" && isSubagentLaunchTool(block.name) && block.id) {
          launchIds.push(block.id);
        }
      }
    }
    if (launchIds.length > 0) subagentToolUseIds.set(nodeId, launchIds);

    // The merged group usage, not `last`'s own raw usage: same reasoning as
    // `computeResponseGroups`'s fold — a single member's own usage can be
    // zero/absent while the group's merged usage (input/cache falling
    // forward to the first member that has it, output as the max) is not.
    const lastUsage = lastGroup.usage;
    // Derived from every line of the turn's last response, not just its
    // last line: a real response's first line often carries only
    // `thinking`, so the actual tool calls / reply text live on later
    // members of the same group.
    const lastGroupBlocks = lastGroup.members.flatMap((m) =>
      asBlocks(m.entry.message?.content),
    );
    const tools = lastGroupBlocks
      .filter((b) => b.type === "tool_use")
      .map((b) => b.name)
      .filter(Boolean);
    const text = lastGroupBlocks
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join(" ");
    const opening = group.openingPrompt;
    const promptText = opening
      ? asBlocks(opening.entry.message?.content)
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join(" ")
      : "";
    points.push({
      turn,
      nodeId,
      label: previewText(text, 80) ?? (tools[0] ? `→ ${tools.join(", ")}` : `Turn ${turn}`),
      contextTokens: contextSize(lastUsage),
      inputTokens: lastUsage.inputTokens,
      cacheReadTokens: lastUsage.cacheReadInputTokens,
      cacheCreationTokens: lastUsage.cacheCreationInputTokens,
      outputTokens,
      toolName: tools[0] ?? null,
      log: toLogRef(trueLastMember),
      causedBy: [],
      subagentLaunches: [],
      memberNodeIds,
      promptPreview: previewText(stripSystemReminders(promptText)),
      promptLog: opening ? toLogRef(opening) : null,
      startedAt: group.startedAt,
      endedAt: group.endedAt,
    });
  }
  return { points, subagentToolUseIds };
}

/** Resolves each point's `subagentToolUseIds` into launch summaries. Runs for
 *  the root timeline and for every subagent timeline that launched a further
 *  subagent, so nesting reads the same as a top-level launch. */
function fillSubagentLaunches(
  points: ContextTimelinePoint[],
  launchIdsByNodeId: Map<string, string[]>,
  rowByToolUseId: Map<string, AgentBreakdownRow>,
): void {
  for (const point of points) {
    const launchIds = launchIdsByNodeId.get(point.nodeId);
    if (!launchIds) continue;
    point.subagentLaunches = launchIds
      .map((toolUseId) => {
        const row = rowByToolUseId.get(toolUseId);
        if (!row) return null;
        return {
          agentId: row.agentId,
          label: row.label,
          toolUseId,
          peakContextTokens: row.peakContextTokens,
          turnCount: row.turnCount,
          toolCallCount: row.toolCallCount,
        };
      })
      .filter((launch): launch is SubagentLaunchSummary => launch != null);
  }
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
  turns: number;
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
  let lastContext: number | null = null;
  const { byEntry: responseGroupByEntry } = computeResponseGroups(sourcedEntries);

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
      const group = responseGroupByEntry.get(sourced)!;
      // The group is materialized once, at its first member — the other
      // members were already folded in below when we hit that first line.
      if (sourced !== group.members[0]) continue;

      const u = group.usage;
      usage = addUsage(usage, u);
      const ctx = contextSize(u);
      peak = Math.max(peak, ctx);
      const delta =
        lastContext == null || totalTokens(u) === 0 ? null : ctx - lastContext;
      if (totalTokens(u) > 0) lastContext = ctx;

      // model: the first member of the group that actually carries one.
      let groupModel: string | null = null;
      for (const member of group.members) {
        if (member.entry.message?.model) {
          groupModel = member.entry.message.model;
          break;
        }
      }
      if (groupModel) root.model = groupModel;

      // Merge every member's blocks in member order: a real response's
      // first line often carries only `thinking`, so the reply text lives
      // on a later line of the same group.
      let thinking = "";
      let text = "";
      const thinkingLog: { log: LogLineRef; timestamp: string | null } = {
        log,
        timestamp: entry.timestamp ?? null,
      };
      let sawThinking = false;
      const tools: { member: SourcedEntry; block: ContentBlock }[] = [];
      for (const member of group.members) {
        const memberLog = toLogRef(member);
        for (const block of asBlocks(member.entry.message?.content)) {
          if (block.type === "thinking") {
            const piece = block.thinking ?? block.text ?? "";
            thinking = thinking ? `${thinking}\n${piece}` : piece;
            if (!sawThinking) {
              sawThinking = true;
              thinkingLog.log = memberLog;
              thinkingLog.timestamp = member.entry.timestamp ?? null;
            }
          } else if (block.type === "text") {
            text = text ? `${text}\n${(block.text ?? "")}` : block.text ?? "";
          } else if (block.type === "tool_use") {
            tools.push({ member, block });
          }
        }
      }

      const assistantNode: TreeNode = {
        id: group.nodeId,
        kind: "assistant_message",
        label: tools.length
          ? `Assistant · ${tools.map(({ block }) => block.name).join(", ")}`
          : "Assistant",
        timestamp: entry.timestamp ?? null,
        model: groupModel,
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

      if (thinking) {
        assistantNode.children.push({
          id: `${assistantNode.id}-thinking`,
          kind: "thinking",
          label: "Thinking",
          timestamp: thinkingLog.timestamp,
          model: null,
          usage: null,
          context: null,
          preview: previewText(thinking, 200),
          log: thinkingLog.log,
          children: [],
        });
      }

      for (const { member, block: tool } of tools) {
        toolCalls += 1;
        const name = tool.name ?? "tool";
        toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1);
        const summary = toolInputPreview(name, tool.input);
        const inputPreview =
          summary ?? previewText(stringifyContent(tool.input), 160);
        const isSubagent = isSubagentLaunchTool(tool.name);
        const toolNode: TreeNode = {
          id: tool.id ?? `${assistantNode.id}-tool-${toolCalls}`,
          kind: "tool_call",
          label: summary
            ? `${tool.name ?? "tool"} · ${summary}`
            : (tool.name ?? "tool"),
          // Per-call, not per-group: calls in one batch can differ by
          // seconds, and "View transcript line" needs the line the call
          // actually appears on.
          timestamp: member.entry.timestamp ?? null,
          model: null,
          usage: null,
          context: {
            addedTokens: estimateTokensFromText(stringifyContent(tool.input)),
            contextAfter: null,
            contextDelta: null,
          },
          preview: inputPreview,
          log: toLogRef(member),
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
  const turns = countRealTurns(sourcedEntries);
  return { tree: root, usage, peak, toolCalls, messages, turns, tools: toolCounts };
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

/**
 * Human label for a subagent. Prefers the sidecar's `agentType` /
 * `description` (e.g. `Explore · Scan token call sites`) and falls back to
 * the opaque agentId when there is no sidecar.
 */
function subagentLabel(agentId: string, meta: SubagentMeta | null): string {
  const agentType =
    typeof meta?.agentType === "string" ? meta.agentType.trim() : "";
  const description =
    typeof meta?.description === "string" ? meta.description.trim() : "";
  if (agentType && description) return `${agentType} · ${description}`;
  if (agentType) return agentType;
  if (description) return description;
  return `Subagent · ${agentId}`;
}

/** Depth-first search for the subagent-launch tool node carrying this id. */
function findSubagentLaunchNode(
  node: TreeNode,
  toolUseId: string,
): TreeNode | undefined {
  if (
    node.kind === "tool_call" &&
    isSubagentLaunchTool(node.toolName) &&
    node.toolUseId === toolUseId
  ) {
    return node;
  }
  for (const child of node.children) {
    const hit = findSubagentLaunchNode(child, toolUseId);
    if (hit) return hit;
  }
  return undefined;
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
    subagentTurnCount: parsed.subagentTurnCount,
    toolCallCount: parsed.toolCallCount,
    subagentCount: parsed.subagentCount,
    model: parsed.model,
    gitBranch: parsed.gitBranch,
    usage: parsed.usage,
    peakContextTokens: parsed.peakContextTokens,
    source: file.source,
  };

  const nodeIds = computeAssistantNodeIds(parsed.entries);
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
      turnCount: rootBuild.turns,
      tools: agentToolSummaries(rootBuild.tools),
    },
  ];

  // Attach subagent transcripts under matching Task tool calls when possible
  const taskToolNodes: TreeNode[] = [];
  const walk = (n: TreeNode) => {
    if (n.kind === "tool_call" && isSubagentLaunchTool(n.toolName)) {
      taskToolNodes.push(n);
    }
    for (const c of n.children) walk(c);
  };
  walk(rootBuild.tree);

  const subagentByToolUseId = new Map<string, AgentBreakdownRow>();
  // Subagent timelines whose points launched a further subagent, filled in
  // after the loop below has registered every subagent's row.
  const deferredLaunchFills: {
    points: ContextTimelinePoint[];
    launchIds: Map<string, string[]>;
  }[] = [];
  // One `SessionAgent` per subagent transcript, in `loadSubagents` order
  // (parent-first), appended after the root agent's entry below.
  const subagentAgents: SessionAgent[] = [];
  // Subtrees of subagents already attached this pass, so a `spawnDepth >= 2`
  // subagent can find the Task node inside its parent. `loadSubagents` sorts
  // parent-first, so the parent is always present by the time a child looks.
  const subagentTreeByAgentId = new Map<string, TreeNode>();
  // Task nodes already handed to a subagent, plus the ids some sidecar names.
  // The positional fallback must skip both, or a sidecar-less subagent would
  // land on a node a sidecar claims — both subtrees under one node, and the
  // second row overwriting the first in `subagentByToolUseId`. Sidecar claims
  // are collected up front because file order decides nothing here: the
  // sidecar-less subagent may well be visited first.
  const consumedTaskNodes = new Set<TreeNode>();
  const sidecarClaimedToolUseIds = new Set<string>();
  for (const sub of parsed.subagentFiles) {
    if (typeof sub.meta?.toolUseId === "string" && sub.meta.toolUseId) {
      sidecarClaimedToolUseIds.add(sub.meta.toolUseId);
    }
  }
  // Advances only when a subagent actually falls back to positional pairing,
  // so sidecar-matched subagents don't consume a slot.
  let positionalIndex = 0;

  for (const sub of parsed.subagentFiles) {
    const subModel =
      [...sub.entries]
        .reverse()
        .find((s) => s.entry.type === "assistant" && s.entry.message?.model)
        ?.entry.message?.model ?? null;
    const label = subagentLabel(sub.agentId, sub.meta);
    const subNodeIds = computeAssistantNodeIds(sub.entries);
    const built = buildAgentTreeFromEntries(sub.entries, {
      id: sub.agentId,
      label,
      kind: "subagent",
      model: subModel,
    });
    // Per-agent turns and tool attribution, scoped to this transcript only:
    // a subagent's tool calls are absent from the root `toolImpact`, which is
    // built from `parsed.entries` alone. `groupIntoTurns` is already memoized
    // for `sub.entries` (the tree build above walked them), so the timeline
    // costs no extra grouping pass.
    const { points: subTimeline, subagentToolUseIds: subLaunchIds } =
      buildTimeline(sub.entries, subNodeIds);
    const { rows: subToolImpact, byTurn: subByTurn } = buildToolImpact(sub.entries);
    for (const point of subTimeline) {
      point.causedBy = point.memberNodeIds.flatMap(
        (id) => subByTurn.get(id) ?? [],
      );
    }
    // A nested subagent's own row is only registered later in this loop, so
    // its parent's launch summaries have to wait until every row exists.
    if (subLaunchIds.size > 0) {
      deferredLaunchFills.push({ points: subTimeline, launchIds: subLaunchIds });
    }

    const row: AgentBreakdownRow = {
      agentId: sub.agentId,
      label,
      kind: "subagent",
      model: subModel,
      usage: built.usage,
      peakContextTokens: built.peak,
      toolCallCount: built.toolCalls,
      messageCount: built.messages,
      turnCount: built.turns,
      tools: agentToolSummaries(built.tools),
    };
    agentBreakdown.push(row);
    subagentTreeByAgentId.set(sub.agentId, built.tree);

    const metaToolUseId =
      typeof sub.meta?.toolUseId === "string" && sub.meta.toolUseId
        ? sub.meta.toolUseId
        : null;
    const metaParentAgentId =
      typeof sub.meta?.parentAgentId === "string" && sub.meta.parentAgentId
        ? sub.meta.parentAgentId
        : null;
    const metaAgentType =
      typeof sub.meta?.agentType === "string" && sub.meta.agentType.trim()
        ? sub.meta.agentType.trim()
        : null;
    const metaDescription =
      typeof sub.meta?.description === "string" && sub.meta.description.trim()
        ? sub.meta.description.trim()
        : null;

    subagentAgents.push({
      agentId: sub.agentId,
      kind: "subagent",
      label,
      agentType: metaAgentType,
      description: metaDescription,
      parentAgentId: metaParentAgentId,
      launchToolUseId: metaToolUseId,
      spawnDepth: spawnDepthOf(sub.meta),
      timeline: subTimeline,
      toolImpact: subToolImpact,
    });

    // 1. Exact sidecar join: the Task call this subagent was launched from.
    let target = metaToolUseId
      ? taskToolNodes.find((n) => n.toolUseId === metaToolUseId)
      : undefined;

    // 2. Nested subagent: its launching Task node lives in the parent
    //    subagent's subtree, not in the root transcript.
    if (!target && metaParentAgentId) {
      const parentTree = subagentTreeByAgentId.get(metaParentAgentId);
      if (parentTree) {
        target =
          (metaToolUseId
            ? findSubagentLaunchNode(parentTree, metaToolUseId)
            : undefined) ?? parentTree;
      }
    }

    // 3. Positional fallback for transcripts written without sidecars.
    if (!target) {
      while (positionalIndex < taskToolNodes.length) {
        const candidate = taskToolNodes[positionalIndex]!;
        const claimed =
          consumedTaskNodes.has(candidate) ||
          (candidate.toolUseId != null &&
            sidecarClaimedToolUseIds.has(candidate.toolUseId));
        if (!claimed) break;
        positionalIndex += 1;
      }
      target = taskToolNodes[positionalIndex];
      if (target) positionalIndex += 1;
    }

    if (target) {
      consumedTaskNodes.add(target);
      target.children.push(built.tree);
      if (target.toolUseId) subagentByToolUseId.set(target.toolUseId, row);
    } else {
      // 4. No Task node to hang it on at all.
      rootBuild.tree.children.push(built.tree);
    }
  }

  // Inline Task launches without separate files still show as tool nodes;
  // synthesize lightweight subagent placeholders from tool input
  for (const node of taskToolNodes) {
    if (node.children.some((c) => c.kind === "subagent")) continue;
    // look at preview / leave as tool with results only
  }

  const { points: timeline, subagentToolUseIds } = buildTimeline(
    parsed.entries,
    nodeIds,
  );
  const { rows: toolImpact, byTurn } = buildToolImpact(parsed.entries);

  for (const point of timeline) {
    point.causedBy = point.memberNodeIds.flatMap((id) => byTurn.get(id) ?? []);
  }
  fillSubagentLaunches(timeline, subagentToolUseIds, subagentByToolUseId);
  for (const fill of deferredLaunchFills) {
    fillSubagentLaunches(fill.points, fill.launchIds, subagentByToolUseId);
  }

  const { loadedContext, logLines } = buildLoadedContext(
    parsed.entries,
    timeline,
    nodeIds,
  );

  const agents: SessionAgent[] = [
    {
      agentId: file.id,
      kind: "root_agent",
      label: "Root agent",
      agentType: null,
      description: null,
      parentAgentId: null,
      launchToolUseId: null,
      spawnDepth: 0,
      timeline,
      toolImpact,
    },
    ...subagentAgents,
  ];

  // Each timeline point embeds the full JSONL line of its last assistant
  // entry (and of its opening prompt). Root points keep it — `detail.timeline`
  // is the same array — but on subagent points, of which there can be dozens
  // per session, move the text into the shared `logLines` dictionary instead,
  // the same convention `snapshotInventory` uses for loadedContext evidence.
  for (const agent of agents) {
    if (agent.kind === "root_agent") continue;
    for (const point of agent.timeline) {
      point.log = stashLogLine(point.log, logLines);
      if (point.promptLog) {
        point.promptLog = stashLogLine(point.promptLog, logLines);
      }
    }
  }

  return {
    meta,
    tree: rootBuild.tree,
    timeline,
    toolImpact,
    agentBreakdown,
    agents,
    loadedContext,
    logLines,
  };
}

export function projectPathFromEncoded(encoded: string): string {
  return decodeProjectPath(encoded);
}
