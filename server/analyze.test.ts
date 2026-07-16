import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  analysisJsonSchema,
  analyzeSession,
  buildAnalysisBrief,
  parseAnalysisOutput,
  resolveAnalyzeCwd,
  resolveClaudeExecutable,
  AnalyzeSessionError,
} from "./analyze.js";
import type { AnalyzeProgressEvent } from "../shared/types.js";
import { buildSessionDetail, parseSessionFile } from "./parser.js";
import { fixtureRoot } from "./sessions.js";

async function loadFixtureDetail() {
  const filePath = path.join(
    fixtureRoot(),
    "-workspace-demo",
    "11111111-1111-1111-1111-111111111111.jsonl",
  );
  const parsed = await parseSessionFile(filePath, {
    lightweight: false,
    sessionId: "11111111-1111-1111-1111-111111111111",
  });
  return buildSessionDetail(
    {
      id: "11111111-1111-1111-1111-111111111111",
      projectEncoded: "-workspace-demo",
      projectPath: "/workspace/demo",
      filePath,
      source: "fixture",
      mtimeMs: Date.now(),
      size: 1,
    },
    parsed,
  );
}

describe("analysisJsonSchema", () => {
  it("exports a plain object schema without $schema", () => {
    const schema = analysisJsonSchema();
    assert.equal(schema.type, "object");
    assert.ok(!("$schema" in schema));
    assert.ok(schema.properties);
  });
});

describe("buildAnalysisBrief", () => {
  it("includes session metrics and top tools", async () => {
    const detail = await loadFixtureDetail();
    const brief = buildAnalysisBrief(detail, {
      info: null,
      messages: [
        {
          type: "user",
          uuid: "u1",
          session_id: detail.meta.id,
          message: { role: "user", content: "Scan auth" },
          parent_tool_use_id: null,
          parent_agent_id: null,
        },
      ],
    });

    assert.match(brief, /11111111-1111-1111-1111-111111111111/);
    assert.match(brief, /peakContextTokens/);
    assert.match(brief, /"tool": "Read"/);
    assert.match(brief, /Scan auth/);
    assert.match(brief, /Analyze this Claude Code/);
  });
});

describe("parseAnalysisOutput", () => {
  it("accepts a valid structured report", () => {
    const parsed = parseAnalysisOutput({
      summary: "Context grew mainly from Read results.",
      findings: [
        {
          severity: "warning",
          title: "Large Read payloads",
          detail: "Read contributed most attributed growth.",
          relatedTool: "Read",
        },
      ],
      recommendations: [
        {
          title: "Narrow file reads",
          detail: "Prefer offset/limit or Grep before full Read.",
          impact: "Lower peak context on exploratory turns.",
        },
      ],
    });
    assert.equal(parsed.findings.length, 1);
    assert.equal(parsed.recommendations[0]?.title, "Narrow file reads");
  });

  it("rejects invalid severity", () => {
    assert.throws(() =>
      parseAnalysisOutput({
        summary: "x",
        findings: [
          {
            severity: "bad",
            title: "t",
            detail: "d",
          },
        ],
        recommendations: [],
      }),
    );
  });
});

describe("analyzeSession", () => {
  it("runs with an injected Agent SDK runner", async () => {
    const detail = await loadFixtureDetail();
    const analysis = await analyzeSession(detail, {
      loadExtras: async () => ({ info: null, messages: [] }),
      runner: async function* () {
        yield {
          type: "result",
          subtype: "success",
          duration_ms: 42,
          duration_api_ms: 40,
          is_error: false,
          num_turns: 1,
          result: "",
          stop_reason: "end_turn",
          total_cost_usd: 0.001,
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
          modelUsage: {},
          permission_denials: [],
          structured_output: {
            summary: "Fixture session is Read-heavy.",
            findings: [
              {
                severity: "info",
                title: "Healthy cache reuse",
                detail: "Cache reads dominate later turns.",
              },
            ],
            recommendations: [
              {
                title: "Keep using Grep first",
                detail: "Search before opening large files.",
                impact: "Fewer full-file Read results in context.",
              },
            ],
          },
          uuid: "00000000-0000-0000-0000-000000000001",
          session_id: "analysis-session",
        } as unknown as SDKMessage;
      },
    });

    assert.equal(analysis.sessionId, detail.meta.id);
    assert.match(analysis.summary, /Read-heavy/);
    assert.equal(analysis.findings[0]?.severity, "info");
    assert.equal(analysis.durationMs, 42);
    assert.equal(analysis.costUsd, 0.001);
    assert.equal(analysis.usedSdkSessionApi, false);
  });

  it("surfaces auth failures from the runner", async () => {
    const detail = await loadFixtureDetail();
    await assert.rejects(
      () =>
        analyzeSession(detail, {
          loadExtras: async () => ({ info: null, messages: [] }),
          runner: async function* () {
            throw new Error("Missing API key for authentication");
            yield undefined as never;
          },
        }),
      (err: unknown) =>
        err instanceof AnalyzeSessionError && err.code === "auth",
    );
  });

  it("surfaces auth when the SDK yields a success result with is_error", async () => {
    const detail = await loadFixtureDetail();
    await assert.rejects(
      () =>
        analyzeSession(detail, {
          loadExtras: async () => ({ info: null, messages: [] }),
          runner: async function* () {
            yield {
              type: "result",
              subtype: "success",
              duration_ms: 10,
              duration_api_ms: 10,
              is_error: true,
              num_turns: 1,
              result: "Not logged in · Please run /login",
              stop_reason: "end_turn",
              total_cost_usd: 0,
              usage: {
                input_tokens: 0,
                output_tokens: 0,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
              },
              modelUsage: {},
              permission_denials: [],
              uuid: "00000000-0000-0000-0000-000000000002",
              session_id: "analysis-session",
            } as unknown as SDKMessage;
          },
        }),
      (err: unknown) =>
        err instanceof AnalyzeSessionError && err.code === "auth",
    );
  });

  it("times out when the Agent SDK runner never yields", async () => {
    const detail = await loadFixtureDetail();
    await assert.rejects(
      () =>
        analyzeSession(detail, {
          timeoutMs: 50,
          idleTimeoutMs: 50,
          loadExtras: async () => ({ info: null, messages: [] }),
          resolveExecutable: () => undefined,
          runner: async function* ({ options }) {
            // Simulate the known SDK hang until abortController fires.
            const signal = options?.abortController?.signal;
            await new Promise<void>((_resolve, reject) => {
              const onAbort = () => reject(new Error("aborted"));
              if (signal?.aborted) {
                onAbort();
                return;
              }
              signal?.addEventListener("abort", onAbort, { once: true });
            });
            yield undefined as never;
          },
        }),
      (err: unknown) =>
        err instanceof AnalyzeSessionError && err.code === "timeout",
    );
  });

  it("emits progress stages while analyzing", async () => {
    const detail = await loadFixtureDetail();
    const stages: AnalyzeProgressEvent["stage"][] = [];
    const analysis = await analyzeSession(detail, {
      loadExtras: async () => ({ info: null, messages: [] }),
      resolveExecutable: () => undefined,
      onProgress: (event) => {
        stages.push(event.stage);
      },
      runner: async function* () {
        yield {
          type: "system",
          subtype: "init",
          apiKeySource: "ANTHROPIC_API_KEY",
          claude_code_version: "test",
          cwd: process.cwd(),
          tools: [],
          mcp_servers: [],
          model: "claude-haiku-4-5",
          permissionMode: "dontAsk",
          slash_commands: [],
          output_style: "default",
          skills: [],
          plugins: [],
          uuid: "00000000-0000-0000-0000-000000000010",
          session_id: "analysis-session",
        } as unknown as SDKMessage;
        yield {
          type: "assistant",
          message: { role: "assistant", content: [] },
          parent_tool_use_id: null,
          uuid: "00000000-0000-0000-0000-000000000011",
          session_id: "analysis-session",
        } as unknown as SDKMessage;
        yield {
          type: "result",
          subtype: "success",
          duration_ms: 12,
          duration_api_ms: 10,
          is_error: false,
          num_turns: 1,
          result: "",
          stop_reason: "end_turn",
          total_cost_usd: 0,
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
          modelUsage: {},
          permission_denials: [],
          structured_output: {
            summary: "Progressed through stages.",
            findings: [],
            recommendations: [],
          },
          uuid: "00000000-0000-0000-0000-000000000012",
          session_id: "analysis-session",
        } as unknown as SDKMessage;
      },
    });
    assert.match(analysis.summary, /Progressed/);
    assert.ok(stages.includes("starting"));
    assert.ok(stages.includes("query_start"));
    assert.ok(stages.includes("sdk_ready"));
    assert.ok(stages.includes("model_running"));
    assert.ok(stages.includes("complete"));
  });

  it("passes a resolved Claude executable into the runner", async () => {
    const detail = await loadFixtureDetail();
    let seenPath: string | undefined;
    await analyzeSession(detail, {
      loadExtras: async () => ({ info: null, messages: [] }),
      resolveExecutable: () => "/usr/local/bin/claude",
      runner: async function* ({ options }) {
        seenPath = options?.pathToClaudeCodeExecutable;
        yield {
          type: "result",
          subtype: "success",
          duration_ms: 1,
          duration_api_ms: 1,
          is_error: false,
          num_turns: 1,
          result: "",
          stop_reason: "end_turn",
          total_cost_usd: 0,
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
          modelUsage: {},
          permission_denials: [],
          structured_output: {
            summary: "Used PATH claude.",
            findings: [],
            recommendations: [],
          },
          uuid: "00000000-0000-0000-0000-000000000013",
          session_id: "analysis-session",
        } as unknown as SDKMessage;
      },
    });
    assert.equal(seenPath, "/usr/local/bin/claude");
  });

  it("continues when loadExtras hangs past its budget", async () => {
    const detail = await loadFixtureDetail();
    const analysis = await analyzeSession(detail, {
      timeoutMs: 5_000,
      extrasTimeoutMs: 40,
      loadExtras: async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return {
          info: {
            sessionId: detail.meta.id,
            summary: "should not be used",
          } as never,
          messages: [],
        };
      },
      runner: async function* () {
        yield {
          type: "result",
          subtype: "success",
          duration_ms: 5,
          duration_api_ms: 5,
          is_error: false,
          num_turns: 1,
          result: "",
          stop_reason: "end_turn",
          total_cost_usd: 0,
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
          modelUsage: {},
          permission_denials: [],
          structured_output: {
            summary: "Profile-only brief still works.",
            findings: [],
            recommendations: [],
          },
          uuid: "00000000-0000-0000-0000-000000000003",
          session_id: "analysis-session",
        } as unknown as SDKMessage;
      },
    });
    assert.match(analysis.summary, /Profile-only/);
    assert.equal(analysis.usedSdkSessionApi, false);
  });
});

describe("resolveAnalyzeCwd", () => {
  it("falls back when the project path is missing", () => {
    assert.equal(resolveAnalyzeCwd("/definitely/does/not/exist-xyz"), process.cwd());
  });

  it("uses an existing project path", () => {
    assert.equal(resolveAnalyzeCwd(process.cwd()), process.cwd());
  });
});

describe("resolveClaudeExecutable", () => {
  it("returns undefined or an executable path string", () => {
    const resolved = resolveClaudeExecutable();
    assert.ok(resolved === undefined || typeof resolved === "string");
  });
});
