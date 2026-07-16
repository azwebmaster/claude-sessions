import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionListItem } from "@shared/types";
import { emptyUsage } from "@shared/types";
import {
  DEFAULT_SESSION_SORT,
  nextSessionSort,
  sortSessions,
  type SessionListSort,
} from "./sessionSort";

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
    subagentTurnCount: 2,
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

describe("sortSessions", () => {
  const a = session({
    id: "a",
    summary: "Alpha",
    updatedAt: "2026-07-10T00:00:00.000Z",
    messageCount: 5,
    turnCount: 5,
    toolCallCount: 2,
    subagentCount: 0,
    peakContextTokens: 10_000,
    usage: { ...emptyUsage(), inputTokens: 1_000 },
  });
  const b = session({
    id: "b",
    summary: "Bravo",
    updatedAt: "2026-07-16T00:00:00.000Z",
    messageCount: 20,
    turnCount: 20,
    toolCallCount: 9,
    subagentCount: 3,
    peakContextTokens: 90_000,
    usage: { ...emptyUsage(), inputTokens: 80_000 },
  });
  const c = session({
    id: "c",
    summary: null,
    updatedAt: null,
    startedAt: "2026-07-12T00:00:00.000Z",
    messageCount: 12,
    turnCount: 12,
    toolCallCount: 5,
    subagentCount: 1,
    peakContextTokens: 40_000,
    usage: { ...emptyUsage(), inputTokens: 20_000 },
  });

  it("defaults to newest updatedAt first", () => {
    assert.deepEqual(DEFAULT_SESSION_SORT, {
      key: "updatedAt",
      direction: "desc",
    });
    const sorted = sortSessions([a, b, c], DEFAULT_SESSION_SORT);
    assert.deepEqual(
      sorted.map((s) => s.id),
      ["b", "c", "a"],
    );
  });

  it("sorts by summary ascending and descending", () => {
    const asc = sortSessions([b, a, c], {
      key: "summary",
      direction: "asc",
    });
    assert.deepEqual(
      asc.map((s) => s.id),
      ["a", "b", "c"],
    );
    const desc = sortSessions([a, b, c], {
      key: "summary",
      direction: "desc",
    });
    assert.deepEqual(
      desc.map((s) => s.id),
      ["c", "b", "a"],
    );
  });

  it("sorts numeric metrics", () => {
    const byTokens: SessionListSort = { key: "tokens", direction: "desc" };
    assert.deepEqual(
      sortSessions([a, b, c], byTokens).map((s) => s.id),
      ["b", "c", "a"],
    );

    const byAgents: SessionListSort = { key: "agents", direction: "asc" };
    assert.deepEqual(
      sortSessions([b, a, c], byAgents).map((s) => s.id),
      ["a", "c", "b"],
    );
  });

  it("breaks ties by session id without mutating input", () => {
    const left = session({ id: "z", summary: "Same" });
    const right = session({ id: "m", summary: "Same" });
    const input = [left, right];
    const sorted = sortSessions(input, { key: "summary", direction: "asc" });
    assert.deepEqual(
      sorted.map((s) => s.id),
      ["m", "z"],
    );
    assert.equal(input[0]?.id, "z");
  });
});

describe("nextSessionSort", () => {
  it("toggles direction on the same key", () => {
    assert.deepEqual(
      nextSessionSort({ key: "tokens", direction: "desc" }, "tokens"),
      { key: "tokens", direction: "asc" },
    );
  });

  it("starts text sorts ascending and metrics descending", () => {
    assert.deepEqual(
      nextSessionSort(DEFAULT_SESSION_SORT, "summary"),
      { key: "summary", direction: "asc" },
    );
    assert.deepEqual(
      nextSessionSort(DEFAULT_SESSION_SORT, "turns"),
      { key: "turns", direction: "desc" },
    );
  });
});
