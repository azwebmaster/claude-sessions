import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ContextDelta,
  ContextTimelinePoint,
  TokenUsage,
  TreeNode,
} from "@shared/types";
import type { UsagePartColors } from "../theme";
import {
  buildUsageParts,
  formatDurationMs,
  formatElapsed,
  formatTurnSpan,
  metricsTitle,
  usageParts,
} from "./contextUsageParts";

const colors: UsagePartColors = {
  input: "#111",
  cacheWrite: "#222",
  cacheRead: "#333",
  output: "#444",
};

function point(partial: Partial<ContextTimelinePoint>): ContextTimelinePoint {
  return {
    turn: 1,
    nodeId: "turn-1",
    label: "Turn 1",
    contextTokens: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 0,
    toolName: null,
    log: { filePath: "a.jsonl", line: 1, raw: "" },
    causedBy: [],
    subagentLaunches: [],
    memberNodeIds: [],
    promptPreview: null,
    promptLog: null,
    startedAt: null,
    endedAt: null,
    ...partial,
  };
}

describe("buildUsageParts", () => {
  it("maps each usage field to a labeled, colored part", () => {
    const parts = buildUsageParts(
      point({
        inputTokens: 10,
        cacheCreationTokens: 20,
        cacheReadTokens: 30,
        outputTokens: 40,
      }),
      colors,
    );

    assert.deepEqual(
      parts.map((p) => [p.key, p.value, p.color, p.inContext]),
      [
        ["input", 10, colors.input, true],
        ["cache+", 20, colors.cacheWrite, true],
        ["cache", 30, colors.cacheRead, true],
        ["out", 40, colors.output, false],
      ],
    );
  });
});

describe("formatDurationMs", () => {
  it("formats sub-second durations in ms", () => {
    assert.equal(formatDurationMs(480), "480ms");
  });

  it("formats second-plus durations with one decimal", () => {
    assert.equal(formatDurationMs(1234), "1.2s");
  });
});

describe("formatElapsed", () => {
  it("formats seconds only", () => {
    assert.equal(formatElapsed(3_000), "3s");
  });

  it("formats minutes and seconds", () => {
    assert.equal(formatElapsed(65_000), "1m 5s");
  });

  it("formats hours, minutes, and seconds", () => {
    assert.equal(formatElapsed(3_725_000), "1h 2m 5s");
  });
});

describe("formatTurnSpan", () => {
  it("keeps sub-minute precision", () => {
    assert.equal(formatTurnSpan(480), "480ms");
    assert.equal(formatTurnSpan(1234), "1.2s");
    assert.equal(formatTurnSpan(59_999), "60.0s");
  });

  it("reads a multi-minute turn as minutes and seconds, not 750.0s", () => {
    assert.equal(formatTurnSpan(750_000), "12m 30s");
  });

  it("reads an hour-plus turn as hours, minutes, and seconds", () => {
    assert.equal(formatTurnSpan(3_725_000), "1h 2m 5s");
  });
});

function usage(partial: Partial<TokenUsage>): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    ...partial,
  };
}

function node(partial: Partial<TreeNode>): TreeNode {
  return {
    id: "n1",
    kind: "assistant_message",
    label: "Assistant",
    timestamp: null,
    model: null,
    usage: null,
    context: null,
    preview: null,
    log: null,
    children: [],
    ...partial,
  };
}

function context(partial: Partial<ContextDelta>): ContextDelta {
  return { addedTokens: 0, contextAfter: null, contextDelta: null, ...partial };
}

describe("usageParts", () => {
  it("joins every non-zero field in input, cache write, cache read, output order", () => {
    assert.equal(
      usageParts(
        usage({
          inputTokens: 512,
          cacheCreationInputTokens: 2_400,
          cacheReadInputTokens: 30_000,
          outputTokens: 1_200,
        }),
      ),
      "in 512 · cache+ 2.4k · cache 30.0k · out 1.2k",
    );
  });

  it("omits zero-valued fields", () => {
    assert.equal(
      usageParts(usage({ cacheReadInputTokens: 30_000, outputTokens: 1_200 })),
      "cache 30.0k · out 1.2k",
    );
  });

  it("returns null when every field is zero", () => {
    assert.equal(usageParts(usage({})), null);
  });
});

describe("metricsTitle", () => {
  it("explains API usage and appends the breakdown when the node billed tokens", () => {
    assert.equal(
      metricsTitle(node({ usage: usage({ inputTokens: 512, outputTokens: 1_200 }) })),
      "API usage for this turn (not a sum of child +N chips)." +
        " ctx = window occupancy from input + cache tokens." +
        " Child +N values are estimated tool I/O sizes only." +
        " Breakdown: in 512 · out 1.2k",
    );
  });

  it("explains the estimate for a node with only estimated added tokens", () => {
    assert.equal(
      metricsTitle(node({ kind: "tool_result", context: context({ addedTokens: 900 }) })),
      "Estimated tokens for this tool input/result (~4 chars per token)." +
        " Not the same as assistant ctx occupancy.",
    );
  });

  it("prefers the usage wording when the node has both usage and an added-token estimate", () => {
    const title = metricsTitle(
      node({
        usage: usage({ inputTokens: 512 }),
        context: context({ addedTokens: 900 }),
      }),
    );
    assert.equal(
      title,
      "API usage for this turn (not a sum of child +N chips)." +
        " ctx = window occupancy from input + cache tokens." +
        " Child +N values are estimated tool I/O sizes only." +
        " Breakdown: in 512",
    );
  });

  it("names the model call instead of the turn when asked to", () => {
    // A turn absorbs several model calls, so a per-call row must not claim to
    // be "API usage for this turn".
    assert.equal(
      metricsTitle(node({ usage: usage({ inputTokens: 512 }) }), "model call"),
      "API usage for this model call (not a sum of child +N chips)." +
        " ctx = window occupancy from input + cache tokens." +
        " Child +N values are estimated tool I/O sizes only." +
        " Breakdown: in 512",
    );
  });

  it("returns undefined when the node has no usage and no estimate", () => {
    assert.equal(metricsTitle(node({})), undefined);
    assert.equal(metricsTitle(node({ usage: usage({}) })), undefined);
    assert.equal(
      metricsTitle(node({ context: context({ addedTokens: 900, contextAfter: 12_000 }) })),
      undefined,
    );
  });
});
