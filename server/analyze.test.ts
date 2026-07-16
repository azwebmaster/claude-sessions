import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  analysisJsonSchema,
  analyzeSession,
  buildAnalysisBrief,
  parseAnalysisOutput,
  AnalyzeSessionError,
} from "./analyze.js";
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
});
