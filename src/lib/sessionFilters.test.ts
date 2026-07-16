import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionListItem } from "@shared/types";
import { emptyUsage } from "@shared/types";
import {
  AGE_PRESETS,
  boundsFromInputs,
  hasActiveMetricFilters,
  inNumericBounds,
  matchesSessionFilters,
  parseQuantity,
  sessionAgeMs,
  type SessionListFilters,
} from "./sessionFilters";

function session(partial: Partial<SessionListItem> = {}): SessionListItem {
  return {
    id: "sess-1",
    projectPath: "/tmp/demo",
    projectEncoded: "-tmp-demo",
    filePath: "/tmp/demo.jsonl",
    summary: "Demo session",
    startedAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-15T12:00:00.000Z",
    messageCount: 10,
    turnCount: 10,
    toolCallCount: 4,
    subagentCount: 1,
    model: "claude-opus-4-6",
    gitBranch: "main",
    usage: {
      ...emptyUsage(),
      inputTokens: 50_000,
      outputTokens: 10_000,
    },
    peakContextTokens: 80_000,
    source: "fixture",
    ...partial,
  };
}

describe("parseQuantity", () => {
  it("parses plain numbers and k/M suffixes", () => {
    assert.equal(parseQuantity("120"), 120);
    assert.equal(parseQuantity("100k"), 100_000);
    assert.equal(parseQuantity("1.5M"), 1_500_000);
    assert.equal(parseQuantity(" 2,000 "), 2000);
    assert.equal(parseQuantity(""), null);
    assert.equal(parseQuantity("abc"), null);
  });
});

describe("inNumericBounds", () => {
  it("applies optional min and max", () => {
    assert.equal(inNumericBounds(50, { min: 10, max: 100 }), true);
    assert.equal(inNumericBounds(5, { min: 10, max: null }), false);
    assert.equal(inNumericBounds(150, { min: null, max: 100 }), false);
    assert.equal(inNumericBounds(0, { min: null, max: null }), true);
  });
});

describe("boundsFromInputs", () => {
  it("builds bounds from raw text fields", () => {
    assert.deepEqual(boundsFromInputs("10k", "1M"), {
      min: 10_000,
      max: 1_000_000,
    });
  });
});

describe("sessionAgeMs", () => {
  it("computes age from updatedAt", () => {
    const now = Date.parse("2026-07-16T12:00:00.000Z");
    assert.equal(
      sessionAgeMs(session({ updatedAt: "2026-07-15T12:00:00.000Z" }), now),
      24 * 60 * 60 * 1000,
    );
  });

  it("falls back to startedAt when updatedAt is missing", () => {
    const now = Date.parse("2026-07-16T00:00:00.000Z");
    assert.equal(
      sessionAgeMs(
        session({ updatedAt: null, startedAt: "2026-07-15T00:00:00.000Z" }),
        now,
      ),
      24 * 60 * 60 * 1000,
    );
  });
});

describe("matchesSessionFilters", () => {
  const base: SessionListFilters = {
    query: "",
    tokens: { min: null, max: null },
    peakCtx: { min: null, max: null },
    turns: { min: null, max: null },
    maxAgeMs: null,
  };
  const now = Date.parse("2026-07-16T12:00:00.000Z");

  it("filters by text query", () => {
    assert.equal(
      matchesSessionFilters(session(), { ...base, query: "demo" }, now),
      true,
    );
    assert.equal(
      matchesSessionFilters(session(), { ...base, query: "other" }, now),
      false,
    );
  });

  it("filters by tokens, peak ctx, and turns", () => {
    const s = session();
    assert.equal(
      matchesSessionFilters(
        s,
        { ...base, tokens: { min: 50_000, max: null } },
        now,
      ),
      true,
    );
    assert.equal(
      matchesSessionFilters(
        s,
        { ...base, tokens: { min: 100_000, max: null } },
        now,
      ),
      false,
    );
    assert.equal(
      matchesSessionFilters(
        s,
        { ...base, peakCtx: { min: null, max: 70_000 } },
        now,
      ),
      false,
    );
    assert.equal(
      matchesSessionFilters(s, { ...base, turns: { min: 5, max: 20 } }, now),
      true,
    );
    assert.equal(
      matchesSessionFilters(s, { ...base, turns: { min: 20, max: null } }, now),
      false,
    );
  });

  it("filters by max age", () => {
    const day = 24 * 60 * 60 * 1000;
    assert.equal(
      matchesSessionFilters(session(), { ...base, maxAgeMs: 2 * day }, now),
      true,
    );
    assert.equal(
      matchesSessionFilters(session(), { ...base, maxAgeMs: day / 2 }, now),
      false,
    );
  });
});

describe("hasActiveMetricFilters / AGE_PRESETS", () => {
  it("detects active metric filters", () => {
    assert.equal(
      hasActiveMetricFilters({
        query: "x",
        tokens: { min: null, max: null },
        peakCtx: { min: null, max: null },
        turns: { min: null, max: null },
        maxAgeMs: null,
      }),
      false,
    );
    assert.equal(
      hasActiveMetricFilters({
        query: "",
        tokens: { min: 1, max: null },
        peakCtx: { min: null, max: null },
        turns: { min: null, max: null },
        maxAgeMs: null,
      }),
      true,
    );
  });

  it("includes an unbound Any age preset", () => {
    assert.equal(AGE_PRESETS[0]?.maxAgeMs, null);
  });
});
