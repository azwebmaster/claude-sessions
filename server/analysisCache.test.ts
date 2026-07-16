import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  analysisCacheSize,
  analysisFingerprint,
  clearAnalysisCache,
  getCachedAnalysis,
  setCachedAnalysis,
} from "./analysisCache.js";
import type { SessionAnalysis } from "../shared/types.js";

function sampleAnalysis(
  overrides: Partial<SessionAnalysis> = {},
): SessionAnalysis {
  return {
    sessionId: "11111111-1111-1111-1111-111111111111",
    summary: "Trim tool results",
    findings: [
      {
        severity: "warning",
        title: "Large tool results",
        detail: "Read returned huge payloads",
      },
    ],
    recommendations: [
      {
        title: "Cap Read output",
        detail: "Ask the agent to summarize files instead of dumping them",
        impact: "Lower peak context",
      },
    ],
    model: "haiku",
    durationMs: 1200,
    costUsd: 0.01,
    usedSdkSessionApi: false,
    ...overrides,
  };
}

describe("analysisCache", () => {
  beforeEach(() => {
    clearAnalysisCache();
  });

  it("fingerprints session file mtime and size", () => {
    assert.equal(
      analysisFingerprint({ mtimeMs: 100, size: 42 }),
      "100:42",
    );
  });

  it("stores and returns a deep-cloned analysis", () => {
    const analysis = sampleAnalysis();
    setCachedAnalysis(
      analysis.sessionId,
      "haiku",
      "100:42",
      analysis,
    );
    const hit = getCachedAnalysis(analysis.sessionId, "haiku", "100:42");
    assert.ok(hit);
    assert.deepEqual(hit, analysis);
    hit.summary = "mutated";
    const again = getCachedAnalysis(analysis.sessionId, "haiku", "100:42");
    assert.equal(again?.summary, "Trim tool results");
  });

  it("misses when fingerprint or model differs", () => {
    const analysis = sampleAnalysis();
    setCachedAnalysis(analysis.sessionId, "haiku", "100:42", analysis);
    assert.equal(
      getCachedAnalysis(analysis.sessionId, "haiku", "101:42"),
      null,
    );
    assert.equal(
      getCachedAnalysis(analysis.sessionId, "sonnet", "100:42"),
      null,
    );
  });

  it("replaces stale fingerprints for the same session+model", () => {
    const analysis = sampleAnalysis();
    setCachedAnalysis(analysis.sessionId, "haiku", "100:42", analysis);
    setCachedAnalysis(
      analysis.sessionId,
      "haiku",
      "200:99",
      sampleAnalysis({ summary: "Updated" }),
    );
    assert.equal(
      getCachedAnalysis(analysis.sessionId, "haiku", "100:42"),
      null,
    );
    assert.equal(
      getCachedAnalysis(analysis.sessionId, "haiku", "200:99")?.summary,
      "Updated",
    );
    assert.equal(analysisCacheSize(), 1);
  });
});
