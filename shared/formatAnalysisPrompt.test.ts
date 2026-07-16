import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatAnalysisAgentPrompt } from "./formatAnalysisPrompt.js";
import type { SessionAnalysis } from "./types.js";

const sample: SessionAnalysis = {
  sessionId: "11111111-1111-1111-1111-111111111111",
  summary: "Tool results dominate context growth.",
  findings: [
    {
      severity: "critical",
      title: "Huge Read payloads",
      detail: "Several Read calls returned multi-thousand-line files.",
      relatedTool: "Read",
    },
  ],
  recommendations: [
    {
      title: "Summarize before pasting",
      detail: "Prefer targeted Grep/offset reads over full-file dumps.",
      impact: "Cuts peak context by tens of thousands of tokens",
    },
  ],
  model: "haiku",
  durationMs: 900,
  costUsd: 0.002,
  usedSdkSessionApi: true,
};

describe("formatAnalysisAgentPrompt", () => {
  it("builds a paste-ready agent prompt from recommendations", () => {
    const prompt = formatAnalysisAgentPrompt(sample);
    assert.match(prompt, /Apply these Claude Code session optimization/);
    assert.match(prompt, /## Summary/);
    assert.match(prompt, /Tool results dominate context growth/);
    assert.match(prompt, /## Recommendations/);
    assert.match(prompt, /1\. Summarize before pasting/);
    assert.match(prompt, /Impact: Cuts peak context/);
    assert.match(prompt, /## Findings \(context\)/);
    assert.match(prompt, /\(critical\) \[Read\] Huge Read payloads/);
    assert.match(prompt, /Implement the recommendations/);
  });
});
