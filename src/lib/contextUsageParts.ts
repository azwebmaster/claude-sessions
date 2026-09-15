import type { ContextTimelinePoint, TokenUsage, TreeNode } from "@shared/types";
import { formatTokens, totalTokens } from "@shared/types";
import type { UsagePartColors } from "../theme";

export interface UsagePart {
  key: string;
  label: string;
  hint: string;
  value: number;
  color: string;
  inContext: boolean;
}

/** Formats a millisecond duration as e.g. "1.2s" or "480ms". */
export function formatDurationMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

/** Formats a millisecond duration as e.g. "1h 2m 3s", "2m 3s", or "3s". */
export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * A turn's wall-clock span, wherever one is shown: the rail row, the turn
 * detail pane, and a nested subagent's turn row. Sub-minute spans keep
 * `formatDurationMs`'s precision; from a minute up they read as `12m 30s`
 * instead of the `750.0s` that formatter would print.
 */
export function formatTurnSpan(ms: number): string {
  return ms < 60_000 ? formatDurationMs(ms) : formatElapsed(ms);
}

/** Composition of a context timeline point's token usage, for the turn detail panel and bar hover. */
export function buildUsageParts(
  point: ContextTimelinePoint,
  colors: UsagePartColors,
): UsagePart[] {
  return [
    {
      key: "input",
      label: "Input (uncached)",
      hint: "Fresh prompt tokens not served from cache",
      value: point.inputTokens,
      color: colors.input,
      inContext: true,
    },
    {
      key: "cache+",
      label: "Cache write",
      hint: "Tokens written into prompt cache this turn (often the big first-turn number)",
      value: point.cacheCreationTokens,
      color: colors.cacheWrite,
      inContext: true,
    },
    {
      key: "cache",
      label: "Cache read",
      hint: "Tokens reused from prompt cache",
      value: point.cacheReadTokens,
      color: colors.cacheRead,
      inContext: true,
    },
    {
      key: "out",
      label: "Output",
      hint: "Model reply tokens (billed, but not part of ctx occupancy)",
      value: point.outputTokens,
      color: colors.output,
      inContext: false,
    },
  ];
}

/**
 * One-line breakdown of a usage record's non-zero fields, e.g.
 * `in 512 · cache 30.0k · out 1.2k`. Returns null when every field is zero.
 */
export function usageParts(u: TokenUsage): string | null {
  const parts: string[] = [];
  if (u.inputTokens > 0) parts.push(`in ${formatTokens(u.inputTokens)}`);
  if (u.cacheCreationInputTokens > 0) {
    parts.push(`cache+ ${formatTokens(u.cacheCreationInputTokens)}`);
  }
  if (u.cacheReadInputTokens > 0) {
    parts.push(`cache ${formatTokens(u.cacheReadInputTokens)}`);
  }
  if (u.outputTokens > 0) parts.push(`out ${formatTokens(u.outputTokens)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Hover text explaining a node's token metrics: the API-usage wording for a
 * node that billed tokens, the estimate wording for a node that only has an
 * estimated `addedTokens` size, and undefined when there is nothing to explain.
 * Takes only the two fields it reads, so a `ModelCall` — which carries an
 * assistant node's `usage` and `context` without being a `TreeNode` — can use
 * the same wording instead of duplicating it.
 */
export function metricsTitle(
  node: Pick<TreeNode, "usage" | "context">,
  /**
   * What the numbers belong to. A hierarchy-tree assistant node stands for a
   * whole turn, but a turn absorbs several assistant messages
   * (`EnrichedStep.assistantNodeId`), so a per-`ModelCall` row passes
   * `"model call"` rather than claiming to be the turn's total.
   */
  subject: "turn" | "model call" = "turn",
): string | undefined {
  if (node.usage && totalTokens(node.usage) > 0) {
    const parts = usageParts(node.usage);
    return [
      `API usage for this ${subject} (not a sum of child +N chips).`,
      "ctx = window occupancy from input + cache tokens.",
      "Child +N values are estimated tool I/O sizes only.",
      parts ? `Breakdown: ${parts}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (node.context && node.context.addedTokens > 0 && node.context.contextAfter == null) {
    return "Estimated tokens for this tool input/result (~4 chars per token). Not the same as assistant ctx occupancy.";
  }
  return undefined;
}
