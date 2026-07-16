import {
  getSessionInfo,
  getSessionMessages,
  query,
  type Options,
  type SDKMessage,
  type SDKSessionInfo,
  type SessionMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { homedir } from "node:os";
import { z } from "zod";
import type {
  AnalyzeModelAlias,
  AnalyzeProgressEvent,
  AnalyzeProgressStage,
  SessionAnalysis,
  SessionDetail,
} from "../shared/types.js";
import {
  ANALYZE_MODEL_ALIASES,
  DEFAULT_ANALYZE_MODEL_ALIAS,
  formatTokens,
  isAnalyzeModelAlias,
  totalTokens,
} from "../shared/types.js";

/**
 * Resolve the analyze model to an Anthropic alias (`opus` | `sonnet` | `haiku`).
 * Full model names are not accepted — the API expects aliases only.
 */
export function resolveAnalyzeModel(
  requested?: string | null,
): AnalyzeModelAlias {
  const trimmed = requested?.trim().toLowerCase();
  if (trimmed) {
    if (isAnalyzeModelAlias(trimmed)) return trimmed;
    throw new AnalyzeSessionError(
      `Invalid model "${requested}". Use an alias: ${ANALYZE_MODEL_ALIASES.join(", ")}.`,
      "invalid",
    );
  }
  const fromEnv = process.env.CLAUDE_SESSIONS_ANALYZE_MODEL?.trim().toLowerCase();
  if (fromEnv && isAnalyzeModelAlias(fromEnv)) return fromEnv;
  return DEFAULT_ANALYZE_MODEL_ALIAS;
}

/**
 * Hard wall-clock cap for one analyze run (SDK spawn + model).
 * Activity (SDK messages / progress) can keep the run alive until this limit.
 */
const DEFAULT_ANALYZE_TIMEOUT_MS = Number(
  process.env.CLAUDE_SESSIONS_ANALYZE_TIMEOUT_MS ?? 300_000,
);

/**
 * Abort if no progress events / SDK messages arrive for this long.
 * Prevents silent hangs while still allowing slow-but-active model calls.
 */
const DEFAULT_ANALYZE_IDLE_TIMEOUT_MS = Number(
  process.env.CLAUDE_SESSIONS_ANALYZE_IDLE_TIMEOUT_MS ?? 90_000,
);

/** Cap how long SDK session-file APIs may block before we proceed profile-only. */
const SDK_EXTRAS_TIMEOUT_MS = 8_000;

/**
 * Prefer the session project path when it still exists; otherwise fall back so
 * the Agent SDK does not spawn with a missing cwd (which can hang or fail oddly).
 */
export function resolveAnalyzeCwd(projectPath: string | null | undefined): string {
  if (projectPath && existsSync(projectPath)) return projectPath;
  return process.cwd();
}

/**
 * Prefer a user-installed `claude` binary (same one as `claude auth login`)
 * over the SDK-bundled native binary when available. Override with
 * `$CLAUDE_SESSIONS_CLAUDE_PATH`.
 */
export function resolveClaudeExecutable(): string | undefined {
  const fromEnv = process.env.CLAUDE_SESSIONS_CLAUDE_PATH?.trim();
  if (fromEnv) {
    try {
      accessSync(fromEnv, constants.X_OK);
      return fromEnv;
    } catch {
      // fall through to PATH lookup
    }
  }

  try {
    const whichCmd = process.platform === "win32" ? "where" : "which";
    const found = execFileSync(whichCmd, ["claude"], {
      encoding: "utf8",
      timeout: 2_000,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (found) {
      accessSync(found, constants.X_OK);
      return found;
    }
  } catch {
    // Use the SDK-bundled binary.
  }
  return undefined;
}

/**
 * Environment for the Agent SDK CLI subprocess.
 *
 * Explicitly inherits the host process env (PATH, HOME, ANTHROPIC_*,
 * CLAUDE_*, cloud-provider creds) so system auth resolves the same way as
 * interactive `claude`. `options.env` replaces the subprocess env entirely.
 */
export function buildAnalyzeEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (typeof value === "string") env[key] = value;
  }
  // Keychain / ~/.claude credential lookup needs a stable home directory.
  if (!env.HOME?.trim()) env.HOME = homedir();
  if (process.platform === "win32" && !env.USERPROFILE?.trim()) {
    env.USERPROFILE = homedir();
  }
  if (!env.CLAUDE_AGENT_SDK_CLIENT_APP?.trim()) {
    env.CLAUDE_AGENT_SDK_CLIENT_APP = "claude-sessions";
  }
  // Single-turn analyze never reuses the prompt prefix, so cache writes only
  // raise input cost (cache_creation) with no later cache_read benefit.
  env.DISABLE_PROMPT_CACHING = "1";
  return env;
}

function positiveMs(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(new Error(`${label} aborted`));
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error(`${label} aborted`));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

export const analysisOutputSchema = z.object({
  summary: z.string(),
  findings: z.array(
    z.object({
      severity: z.enum(["info", "warning", "critical"]),
      title: z.string(),
      detail: z.string(),
      relatedTool: z.string().nullable().optional(),
    }),
  ),
  recommendations: z.array(
    z.object({
      title: z.string(),
      detail: z.string(),
      impact: z.string(),
    }),
  ),
});

export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;

export function analysisJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(analysisOutputSchema) as Record<
    string,
    unknown
  >;
  // Agent SDK expects a plain JSON Schema object.
  const rest = { ...schema };
  delete rest.$schema;
  return rest;
}

const ANALYZER_SYSTEM_PROMPT = `You are a Claude Code session profiler. Given a compact profile of one local agent session, identify context bloat, expensive tool patterns, and concrete ways to shrink token usage and peak context.

Be specific and practical. Prefer findings grounded in the provided metrics (tool impact, peak context, cache behavior, subagents). Do not invent file contents or tool results that are not in the brief.`;

export interface SdkSessionExtras {
  info: SDKSessionInfo | null;
  messages: SessionMessage[];
}

function extractMessageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: string; text?: string; name?: string };
    if (b.type === "text" && typeof b.text === "string") {
      parts.push(b.text);
    } else if (b.type === "tool_use" && typeof b.name === "string") {
      parts.push(`[tool_use:${b.name}]`);
    } else if (b.type === "tool_result") {
      parts.push("[tool_result]");
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** Load light metadata + recent turns via the Agent SDK session APIs. */
export async function loadSdkSessionExtras(
  sessionId: string,
  projectPath: string | null,
): Promise<SdkSessionExtras> {
  const dir = projectPath && !projectPath.includes("fixtures")
    ? projectPath
    : undefined;
  const opts = dir ? { dir } : undefined;

  let info: SDKSessionInfo | null = null;
  let messages: SessionMessage[] = [];

  try {
    info = (await getSessionInfo(sessionId, opts)) ?? null;
  } catch {
    info = null;
  }

  try {
    messages = await getSessionMessages(sessionId, {
      ...opts,
      limit: 16,
    });
  } catch {
    messages = [];
  }

  return { info, messages };
}

/** Build the compact brief the Agent SDK model will analyze. */
export function buildAnalysisBrief(
  detail: SessionDetail,
  extras?: SdkSessionExtras | null,
): string {
  const { meta, toolImpact, agentBreakdown, timeline } = detail;
  const topTools = toolImpact.slice(0, 8).map((t) => ({
    tool: t.toolName,
    calls: t.callCount,
    resultTokens: t.totalResultTokens,
    attributedGrowth: t.contextGrowthAttributed,
    heaviest: t.calls.slice(0, 2).map((c) => ({
      input: c.inputPreview,
      resultTokens: c.resultTokens,
      growth: c.contextGrowthAttributed,
      error: c.isError,
    })),
  }));

  const agents = agentBreakdown.map((a) => ({
    id: a.agentId,
    label: a.label,
    kind: a.kind,
    peakContext: a.peakContextTokens,
    tokens: totalTokens(a.usage),
    turns: a.turnCount,
    toolCalls: a.toolCallCount,
    tools: a.tools.slice(0, 6),
  }));

  const peakTurn = timeline.reduce(
    (best, p) => (p.contextTokens > (best?.contextTokens ?? -1) ? p : best),
    timeline[0] ?? null,
  );

  const sdkMeta = extras?.info
    ? {
        customTitle: extras.info.customTitle ?? null,
        tag: extras.info.tag ?? null,
        firstPrompt: extras.info.firstPrompt ?? null,
        summary: extras.info.summary,
        fileSize: extras.info.fileSize ?? null,
      }
    : null;

  const recentMessages = (extras?.messages ?? []).slice(-10).map((m) => ({
    role: m.type,
    text: extractMessageText(m.message).slice(0, 280),
  }));

  const payload = {
    session: {
      id: meta.id,
      summary: meta.summary,
      projectPath: meta.projectPath,
      model: meta.model,
      gitBranch: meta.gitBranch,
      source: meta.source,
      startedAt: meta.startedAt,
      updatedAt: meta.updatedAt,
      messageCount: meta.messageCount,
      turnCount: meta.turnCount,
      subagentTurnCount: meta.subagentTurnCount,
      toolCallCount: meta.toolCallCount,
      subagentCount: meta.subagentCount,
      totalTokens: totalTokens(meta.usage),
      peakContextTokens: meta.peakContextTokens,
      usage: meta.usage,
    },
    sdk: sdkMeta,
    peakTurn: peakTurn
      ? {
          turn: peakTurn.turn,
          label: peakTurn.label,
          contextTokens: peakTurn.contextTokens,
          cacheRead: peakTurn.cacheReadTokens,
          cacheCreation: peakTurn.cacheCreationTokens,
          toolName: peakTurn.toolName,
        }
      : null,
    timelineSample: timeline
      .filter((_, i) => i === 0 || i === timeline.length - 1 || i % 3 === 0)
      .slice(0, 12)
      .map((p) => ({
        turn: p.turn,
        context: p.contextTokens,
        cacheRead: p.cacheReadTokens,
        tool: p.toolName,
      })),
    topTools,
    agents,
    recentMessages,
  };

  return [
    "Analyze this Claude Code / Agent SDK session profile.",
    "Return structured findings and recommendations focused on reducing peak context and token waste.",
    "",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
    "",
    `Peak context: ${formatTokens(meta.peakContextTokens)}; total tokens: ${formatTokens(totalTokens(meta.usage))}; tools: ${meta.toolCallCount}; root turns: ${meta.turnCount}; subagent turns: ${meta.subagentTurnCount}; subagents: ${meta.subagentCount}.`,
  ].join("\n");
}

export function parseAnalysisOutput(raw: unknown): AnalysisOutput {
  return analysisOutputSchema.parse(raw);
}

export type AgentQueryRunner = (params: {
  prompt: string;
  options?: Options;
}) => AsyncIterable<SDKMessage>;

const defaultRunner: AgentQueryRunner = (params) => query(params);

export type AnalyzeProgressListener = (
  event: AnalyzeProgressEvent,
) => void | Promise<void>;

export interface AnalyzeSessionOptions {
  model?: string;
  /** Hard wall-clock timeout for the full analyze run. */
  timeoutMs?: number;
  /** Abort when no progress / SDK activity for this long. */
  idleTimeoutMs?: number;
  /** Cap for SDK getSessionInfo/getSessionMessages enrichment. */
  extrasTimeoutMs?: number;
  /** Optional external abort; analyze also aborts itself on timeout. */
  abortController?: AbortController;
  /** Live progress stages for UI / CLI streaming. */
  onProgress?: AnalyzeProgressListener;
  /** Injected for tests; defaults to Agent SDK `query`. */
  runner?: AgentQueryRunner;
  /** Injected for tests; defaults to `loadSdkSessionExtras`. */
  loadExtras?: (
    sessionId: string,
    projectPath: string | null,
  ) => Promise<SdkSessionExtras>;
  /** Injected for tests; defaults to `resolveClaudeExecutable`. */
  resolveExecutable?: () => string | undefined;
  /** Injected for tests; defaults to `buildAnalyzeEnv`. */
  buildEnv?: () => Record<string, string | undefined>;
}

export class AnalyzeSessionError extends Error {
  constructor(
    message: string,
    readonly code:
      | "auth"
      | "sdk"
      | "parse"
      | "empty"
      | "budget"
      | "timeout"
      | "invalid"
      | "unknown" = "unknown",
  ) {
    super(message);
    this.name = "AnalyzeSessionError";
  }
}

function classifyRunnerError(err: unknown): AnalyzeSessionError {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  if (
    lower.includes("api key") ||
    lower.includes("authentication") ||
    lower.includes("unauthorized") ||
    lower.includes("not logged in") ||
    lower.includes("please run /login")
  ) {
    return new AnalyzeSessionError(
      "Claude Agent SDK is not authenticated. Analysis inherits system auth (user Claude settings, `claude auth login`, or ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN in the server environment).",
      "auth",
    );
  }
  if (lower.includes("aborted") || lower.includes("timed out")) {
    return new AnalyzeSessionError(message, "timeout");
  }
  return new AnalyzeSessionError(message, "sdk");
}

/**
 * Profile a session with the Claude Agent SDK: enrich via session APIs,
 * then run a single-turn structured `query()` for optimization advice.
 *
 * Bounds the run with a hard wall-clock timeout plus an idle timeout that
 * resets on progress / SDK activity — the Agent SDK can hang forever when the
 * CLI subprocess fails to start or never yields.
 */
export async function analyzeSession(
  detail: SessionDetail,
  options: AnalyzeSessionOptions = {},
): Promise<SessionAnalysis> {
  const model = resolveAnalyzeModel(options.model);
  const runner = options.runner ?? defaultRunner;
  const loadExtras = options.loadExtras ?? loadSdkSessionExtras;
  const resolveExecutable =
    options.resolveExecutable ?? resolveClaudeExecutable;
  const buildEnv = options.buildEnv ?? buildAnalyzeEnv;
  const timeoutMs = positiveMs(
    options.timeoutMs ?? DEFAULT_ANALYZE_TIMEOUT_MS,
    300_000,
  );
  const idleTimeoutMs = Math.min(
    positiveMs(
      options.idleTimeoutMs ?? DEFAULT_ANALYZE_IDLE_TIMEOUT_MS,
      90_000,
    ),
    timeoutMs,
  );
  const extrasTimeoutMs = Math.min(
    options.extrasTimeoutMs ?? SDK_EXTRAS_TIMEOUT_MS,
    timeoutMs,
  );
  const abortController = options.abortController ?? new AbortController();
  const startedAt = Date.now();
  let timedOut = false;
  let idleTimedOut = false;
  let sawSdkActivity = false;
  let lastStage: AnalyzeProgressStage | null = null;
  const stderrChunks: string[] = [];

  const emitProgress = async (
    stage: AnalyzeProgressStage,
    message: string,
  ) => {
    lastStage = stage;
    const event: AnalyzeProgressEvent = {
      type: "progress",
      stage,
      message,
      elapsedMs: Date.now() - startedAt,
    };
    try {
      await options.onProgress?.(event);
    } catch {
      // Progress listeners must not break analysis.
    }
    bumpIdleTimer();
  };

  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const bumpIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    if (abortController.signal.aborted) return;
    idleTimer = setTimeout(() => {
      timedOut = true;
      idleTimedOut = true;
      abortController.abort();
    }, idleTimeoutMs);
  };

  const hardTimer = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, timeoutMs);
  bumpIdleTimer();

  const timeoutError = () => {
    const elapsed = Date.now() - startedAt;
    const stderrHint = stderrChunks.join("").trim().slice(0, 280);
    const stageHint = lastStage ? ` Last stage: ${lastStage}.` : "";
    const activityHint = sawSdkActivity
      ? " The Claude CLI started but stopped producing output."
      : " The Claude CLI subprocess never became ready.";
    const authHint =
      !sawSdkActivity || /login|auth|api key|unauthorized/i.test(stderrHint)
        ? " Analysis inherits ~/.claude user settings and the process env; if the interactive CLI works but this fails, ensure the server runs as the same user (HOME) or set ANTHROPIC_API_KEY / CLAUDE_SESSIONS_CLAUDE_PATH."
        : "";
    const stderrPart = stderrHint ? ` CLI stderr: ${stderrHint}` : "";
    const kind = idleTimedOut
      ? `idle for ${idleTimeoutMs}ms`
      : `${timeoutMs}ms wall-clock`;
    return new AnalyzeSessionError(
      `Analysis timed out after ${elapsed}ms (${kind}).${activityHint}${stageHint}${authHint}${stderrPart}`,
      "timeout",
    );
  };

  try {
    await emitProgress("starting", "Preparing session profile…");

    let extras: SdkSessionExtras = { info: null, messages: [] };
    await emitProgress("enriching", "Reading SDK session metadata…");
    try {
      extras = await withTimeout(
        loadExtras(detail.meta.id, detail.meta.projectPath),
        extrasTimeoutMs,
        "SDK session APIs",
        abortController.signal,
      );
    } catch {
      // Proceed with profiler-only brief if session APIs stall or fail.
      extras = { info: null, messages: [] };
    }

    if (timedOut || abortController.signal.aborted) {
      throw timeoutError();
    }

    const usedSdkSessionApi = Boolean(
      extras.info || (extras.messages && extras.messages.length > 0),
    );
    const prompt = buildAnalysisBrief(detail, extras);
    const cwd = resolveAnalyzeCwd(detail.meta.projectPath);
    const executable = resolveExecutable();
    await emitProgress(
      "brief_ready",
      usedSdkSessionApi
        ? "Built analysis brief (SDK session APIs included)."
        : "Built analysis brief (profile metrics only).",
    );

    const usedModel: string | null = model;

    const consumeRunner = async (): Promise<{
      resultText: string | null;
      structured: unknown;
      durationMs: number;
      costUsd: number | null;
    }> => {
      let resultText: string | null = null;
      let structured: unknown;
      let durationMs = 0;
      let costUsd: number | null = null;

      await emitProgress(
        "query_start",
        executable
          ? `Starting Agent SDK via ${executable}…`
          : "Starting Agent SDK (bundled Claude CLI)…",
      );

      const queryOptions: Options = {
        model,
        maxTurns: 1,
        tools: [],
        allowedTools: [],
        // Load user settings so apiKeyHelper / settings env auth matches the
        // interactive CLI. Skip project/local to avoid CLAUDE.md and project MCP.
        settingSources: ["user"],
        // Headless HTTP/CLI: never block waiting for an interactive prompt.
        permissionMode: "dontAsk",
        systemPrompt: ANALYZER_SYSTEM_PROMPT,
        outputFormat: {
          type: "json_schema",
          schema: analysisJsonSchema(),
        },
        cwd,
        // Inherit host env (PATH, HOME, ANTHROPIC_*, CLAUDE_*, cloud creds).
        env: buildEnv(),
        abortController,
        stderr: (data: string) => {
          if (data) {
            stderrChunks.push(data);
            if (stderrChunks.length > 40) stderrChunks.shift();
            const lower = data.toLowerCase();
            if (
              lower.includes("not logged in") ||
              lower.includes("please run /login") ||
              lower.includes("authentication") ||
              lower.includes("missing api key")
            ) {
              // Surface auth failures promptly instead of waiting for idle timeout.
              abortController.abort();
            }
          }
        },
      };
      if (executable) {
        queryOptions.pathToClaudeCodeExecutable = executable;
      }

      for await (const message of runner({
        prompt,
        options: queryOptions,
      })) {
        if (abortController.signal.aborted) {
          const stderrText = stderrChunks.join("");
          if (/not logged in|please run \/login|api key|unauthorized/i.test(stderrText)) {
            throw classifyRunnerError(new Error(stderrText.trim() || "Not logged in"));
          }
          throw timeoutError();
        }

        sawSdkActivity = true;
        bumpIdleTimer();

        if (message.type === "auth_status") {
          if (message.isAuthenticating) {
            await emitProgress(
              "authenticating",
              message.output?.join(" ").trim() ||
                "Authenticating with Anthropic…",
            );
          } else if (message.error) {
            throw classifyRunnerError(new Error(message.error));
          }
          continue;
        }

        if (message.type === "system" && message.subtype === "init") {
          const source =
            "apiKeySource" in message && message.apiKeySource
              ? ` (auth: ${String(message.apiKeySource)})`
              : "";
          await emitProgress(
            "sdk_ready",
            `Claude CLI ready${source}; waiting for model…`,
          );
          continue;
        }

        if (message.type === "system" && message.subtype === "api_retry") {
          await emitProgress(
            "model_running",
            `API retry ${message.attempt}/${message.max_retries}…`,
          );
          continue;
        }

        if (message.type === "assistant") {
          await emitProgress("model_running", "Model is generating analysis…");
          continue;
        }

        if (message.type === "result") {
          await emitProgress("parsing", "Parsing structured analysis…");
          durationMs = message.duration_ms;
          costUsd =
            typeof message.total_cost_usd === "number"
              ? message.total_cost_usd
              : null;
          if (message.subtype === "success") {
            resultText =
              typeof message.result === "string" ? message.result : null;
            structured = message.structured_output;
            // SDK may yield subtype "success" with is_error for auth failures.
            if (
              "is_error" in message &&
              message.is_error &&
              (structured === undefined || structured === null)
            ) {
              throw classifyRunnerError(
                new Error(
                  resultText?.trim()
                    ? resultText
                    : "Agent SDK returned an error result",
                ),
              );
            }
          } else {
            const errors =
              "errors" in message && Array.isArray(message.errors)
                ? message.errors.join("; ")
                : message.subtype;
            if (message.subtype === "error_max_budget_usd") {
              throw new AnalyzeSessionError(
                `Analysis stopped: budget exceeded (${errors})`,
                "budget",
              );
            }
            throw new AnalyzeSessionError(
              `Agent SDK analysis failed: ${errors}`,
              "sdk",
            );
          }
        }
      }

      return { resultText, structured, durationMs, costUsd };
    };

    let runnerResult: {
      resultText: string | null;
      structured: unknown;
      durationMs: number;
      costUsd: number | null;
    };
    try {
      // Race against abort: Agent SDK can hang in for-await when the CLI
      // subprocess never starts (never yields / never rejects).
      runnerResult = await Promise.race([
        consumeRunner(),
        new Promise<never>((_resolve, reject) => {
          const onAbort = () => {
            const stderrText = stderrChunks.join("");
            if (
              /not logged in|please run \/login|api key|unauthorized/i.test(
                stderrText,
              )
            ) {
              reject(
                classifyRunnerError(
                  new Error(stderrText.trim() || "Not logged in"),
                ),
              );
              return;
            }
            reject(timeoutError());
          };
          if (abortController.signal.aborted) {
            onAbort();
            return;
          }
          abortController.signal.addEventListener("abort", onAbort, {
            once: true,
          });
        }),
      ]);
    } catch (err) {
      if (err instanceof AnalyzeSessionError) throw err;
      if (timedOut || abortController.signal.aborted) {
        throw timeoutError();
      }
      throw classifyRunnerError(err);
    }

    if (timedOut || abortController.signal.aborted) {
      throw timeoutError();
    }

    const { resultText, structured, durationMs, costUsd } = runnerResult;

    let parsed: AnalysisOutput;
    try {
      if (structured !== undefined && structured !== null) {
        parsed = parseAnalysisOutput(structured);
      } else if (resultText) {
        const trimmed = resultText.trim();
        const jsonSlice = trimmed.startsWith("{")
          ? trimmed
          : trimmed.match(/\{[\s\S]*\}/)?.[0];
        if (!jsonSlice) {
          // Plain-text auth / login messages often land here.
          throw classifyRunnerError(new Error(trimmed));
        }
        parsed = parseAnalysisOutput(JSON.parse(jsonSlice));
      } else {
        throw new AnalyzeSessionError(
          "Agent returned no analysis result.",
          "empty",
        );
      }
    } catch (err) {
      if (err instanceof AnalyzeSessionError) throw err;
      throw new AnalyzeSessionError(
        `Could not parse analysis output: ${err instanceof Error ? err.message : String(err)}`,
        "parse",
      );
    }

    const analysis: SessionAnalysis = {
      sessionId: detail.meta.id,
      summary: parsed.summary,
      findings: parsed.findings.map((f) => ({
        severity: f.severity,
        title: f.title,
        detail: f.detail,
        relatedTool: f.relatedTool ?? null,
      })),
      recommendations: parsed.recommendations,
      model: usedModel,
      durationMs,
      costUsd,
      usedSdkSessionApi,
    };
    await emitProgress("complete", "Analysis complete.");
    return analysis;
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(hardTimer);
  }
}
