import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import path from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { clearAnalysisCache } from "./analysisCache.js";
import { runAnalyzeWithCache } from "./runAnalyzeWithCache.js";
import type { AgentQueryRunner } from "./analyze.js";
import { buildSessionDetail, parseSessionFile } from "./parser.js";
import { fixtureRoot } from "./sessions.js";
import type { AnalyzeProgressEvent } from "../shared/types.js";

async function loadFixture() {
  const filePath = path.join(
    fixtureRoot(),
    "-workspace-demo",
    "11111111-1111-1111-1111-111111111111.jsonl",
  );
  const parsed = await parseSessionFile(filePath, {
    lightweight: false,
    sessionId: "11111111-1111-1111-1111-111111111111",
  });
  const file = {
    id: "11111111-1111-1111-1111-111111111111",
    projectEncoded: "-workspace-demo",
    projectPath: "/workspace/demo",
    filePath,
    source: "fixture" as const,
    mtimeMs: 1_700_000_000_000,
    size: 4096,
  };
  return { detail: buildSessionDetail(file, parsed), file };
}

function successMessage(summary: string): SDKMessage {
  return {
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
      summary,
      findings: [
        {
          severity: "info",
          title: "Finding",
          detail: "Detail",
        },
      ],
      recommendations: [
        {
          title: "Rec",
          detail: "Do the thing",
          impact: "Savings",
        },
      ],
    },
    uuid: "00000000-0000-0000-0000-000000000001",
    session_id: "analysis-session",
  } as unknown as SDKMessage;
}

function countingRunner(summary: string): {
  runner: AgentQueryRunner;
  calls: () => number;
} {
  let calls = 0;
  return {
    calls: () => calls,
    runner: async function* () {
      calls += 1;
      yield successMessage(summary);
    },
  };
}

describe("runAnalyzeWithCache", () => {
  beforeEach(() => {
    clearAnalysisCache();
  });

  it("caches a successful analysis and serves cache hits", async () => {
    const { detail, file } = await loadFixture();
    const { runner, calls } = countingRunner("Cache me");

    const first = await runAnalyzeWithCache(detail, file, {
      model: "haiku",
      runner,
      loadExtras: async () => ({ info: null, messages: [] }),
    });
    assert.equal(first.cached, false);
    assert.equal(first.analysis.summary, "Cache me");
    assert.equal(calls(), 1);

    const stages: AnalyzeProgressEvent["stage"][] = [];
    const second = await runAnalyzeWithCache(detail, file, {
      model: "haiku",
      runner,
      loadExtras: async () => ({ info: null, messages: [] }),
      onProgress: (event) => {
        stages.push(event.stage);
      },
    });
    assert.equal(second.cached, true);
    assert.equal(second.analysis.summary, "Cache me");
    assert.equal(calls(), 1);
    assert.deepEqual(stages, ["complete"]);
  });

  it("bypasses cache when force is set", async () => {
    const { detail, file } = await loadFixture();
    const { runner, calls } = countingRunner("Forced");

    await runAnalyzeWithCache(detail, file, {
      model: "haiku",
      runner,
      loadExtras: async () => ({ info: null, messages: [] }),
    });
    const forced = await runAnalyzeWithCache(detail, file, {
      model: "haiku",
      force: true,
      runner,
      loadExtras: async () => ({ info: null, messages: [] }),
    });
    assert.equal(forced.cached, false);
    assert.equal(calls(), 2);
  });

  it("misses cache when the session file fingerprint changes", async () => {
    const { detail, file } = await loadFixture();
    const { runner, calls } = countingRunner("Updated file");

    await runAnalyzeWithCache(detail, file, {
      model: "haiku",
      runner,
      loadExtras: async () => ({ info: null, messages: [] }),
    });
    const changed = await runAnalyzeWithCache(
      detail,
      { ...file, mtimeMs: file.mtimeMs + 1 },
      {
        model: "haiku",
        runner,
        loadExtras: async () => ({ info: null, messages: [] }),
      },
    );
    assert.equal(changed.cached, false);
    assert.equal(calls(), 2);
  });
});
