import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ContextTimelinePoint,
  SessionAgent,
  SessionDetail,
  SessionListItem,
  ToolImpactCall,
  ToolImpactRow,
  TreeNode,
} from "@shared/types";
import { collectSteps } from "./tree";
import {
  buildModelCalls,
  buildSessionWorkspaceIndex,
  buildStepBars,
  buildTurnNodeIndex,
  callsForTurn,
  enrichSteps,
  groupStepsByTurn,
  indexToolImpact,
  resolveLogLine,
  resolveSubagentInlineView,
  stepCountsByTurn,
  turnDurationMs,
  type EnrichedStep,
  type ModelCall,
} from "./turnSteps";

function node(
  partial: Pick<TreeNode, "id" | "kind"> &
    Partial<Omit<TreeNode, "id" | "kind" | "children">> & {
      children?: TreeNode[];
    },
): TreeNode {
  return {
    id: partial.id,
    kind: partial.kind,
    label: partial.label ?? partial.id,
    timestamp: partial.timestamp ?? null,
    model: partial.model ?? null,
    usage: partial.usage ?? null,
    context: partial.context ?? null,
    preview: partial.preview ?? null,
    log: partial.log ?? null,
    agentId: partial.agentId,
    toolUseId: partial.toolUseId,
    toolName: partial.toolName,
    children: partial.children ?? [],
  };
}

function point(
  turn: number,
  nodeId: string,
  memberNodeIds: string[],
  contextTokens = 0,
): ContextTimelinePoint {
  return {
    turn,
    nodeId,
    memberNodeIds,
    contextTokens,
  } as ContextTimelinePoint;
}

function call(
  partial: Partial<ToolImpactCall> & { toolUseId: string },
): ToolImpactCall {
  return {
    toolUseId: partial.toolUseId,
    timestamp: partial.timestamp ?? null,
    // The parser sets both together whenever the result entry had a timestamp,
    // so `completedAt` is the natural default for "a result arrived".
    resultApplied: partial.resultApplied ?? partial.completedAt != null,
    completedAt: partial.completedAt ?? null,
    durationMs: partial.durationMs ?? null,
    inputPreview: partial.inputPreview ?? null,
    resultPreview: partial.resultPreview ?? null,
    resultTokens: partial.resultTokens ?? 0,
    contextGrowthAttributed: partial.contextGrowthAttributed ?? 0,
    isError: partial.isError ?? false,
  };
}

function row(toolName: string, calls: ToolImpactCall[]): ToolImpactRow {
  return {
    toolName,
    callCount: calls.length,
    totalResultTokens: 0,
    avgResultTokens: 0,
    maxResultTokens: 0,
    contextGrowthAttributed: 0,
    calls,
  };
}

function agent(partial: Partial<SessionAgent> & { agentId: string }): SessionAgent {
  return {
    agentId: partial.agentId,
    kind: partial.kind ?? "root_agent",
    label: partial.label ?? partial.agentId,
    agentType: partial.agentType ?? null,
    description: partial.description ?? null,
    parentAgentId: partial.parentAgentId ?? null,
    launchToolUseId: partial.launchToolUseId ?? null,
    spawnDepth: partial.spawnDepth ?? 0,
    timeline: partial.timeline ?? [],
    toolImpact: partial.toolImpact ?? [],
  };
}

/**
 * Root transcript with: a tool call before the first timeline member (`call-0`),
 * a fully matched call (`call-1`), a Task launch nesting a subagent, a
 * zero-usage assistant turn (`a2`, absent from every `memberNodeIds`), an
 * unmatched call (`call-3`), a matched call whose clock never resolved
 * (`call-4`), and a synthesized-id call (`a3-tool-2`, no `tool_use` id). It
 * ends with a tool-less assistant message (`a4`) that billed tokens but emitted
 * no `tool_use` block, and the subagent brackets its one call with two more
 * (`sa0` before the first timeline member, `sa2` after it).
 */
function buildTree(): TreeNode {
  return node({
    id: "sess",
    kind: "root_agent",
    agentId: "sess",
    label: "Root agent",
    children: [
      node({
        id: "a0",
        kind: "assistant_message",
        children: [
          node({
            id: "call-0",
            kind: "tool_call",
            toolUseId: "use-0",
            toolName: "Glob",
          }),
        ],
      }),
      node({
        id: "a1",
        kind: "assistant_message",
        children: [
          node({
            id: "call-1",
            kind: "tool_call",
            toolUseId: "use-1",
            toolName: "Read",
            preview: "src/a.ts",
            timestamp: "2026-01-01T00:00:00.000Z",
            log: { filePath: "root.jsonl", line: 10, raw: "{call}" },
            context: { addedTokens: 12, contextAfter: null, contextDelta: null },
            children: [
              node({
                id: "call-1-result",
                kind: "tool_result",
                toolUseId: "use-1",
                preview: "the whole file",
                log: { filePath: "root.jsonl", line: 11, raw: "{result}" },
              }),
            ],
          }),
          node({
            id: "task-1",
            kind: "tool_call",
            toolUseId: "use-task",
            toolName: "Task",
            children: [
              node({
                id: "sub-a",
                kind: "subagent",
                agentId: "sub-a",
                label: "Explore · scan",
                children: [
                  // Before the subagent's first timeline member: no turn.
                  node({
                    id: "sa0",
                    kind: "assistant_message",
                    label: "Assistant",
                  }),
                  node({
                    id: "sa1",
                    kind: "assistant_message",
                    children: [
                      node({
                        id: "call-s1",
                        kind: "tool_call",
                        // Deliberately the same tool_use id as the root's
                        // `call-1`, to prove the join is per-scope.
                        toolUseId: "use-1",
                        toolName: "Grep",
                      }),
                    ],
                  }),
                  // The shape every fixture subagent ends in: a final answer
                  // that emitted no tool call, so no step exists for it.
                  node({
                    id: "sa2",
                    kind: "assistant_message",
                    label: "Assistant",
                    preview: "Found 3 call sites.",
                    usage: {
                      inputTokens: 20,
                      outputTokens: 60,
                      cacheCreationInputTokens: 0,
                      cacheReadInputTokens: 5_300,
                    },
                    context: {
                      addedTokens: 60,
                      contextAfter: 5_320,
                      contextDelta: 300,
                    },
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
      node({
        id: "a2",
        kind: "assistant_message",
        children: [
          node({
            id: "call-2",
            kind: "tool_call",
            toolUseId: "use-2",
            toolName: "Bash",
          }),
        ],
      }),
      node({
        id: "a3",
        kind: "assistant_message",
        children: [
          node({
            id: "call-3",
            kind: "tool_call",
            toolUseId: "use-3",
            toolName: "WebFetch",
            preview: "https://example.com",
          }),
          node({
            id: "call-4",
            kind: "tool_call",
            toolUseId: "use-4",
            toolName: "Edit",
          }),
          node({ id: "a3-tool-2", kind: "tool_call", toolName: "Bash" }),
        ],
      }),
      // Emitted no tool_use block, so `collectSteps` yields nothing for it —
      // yet it billed input, cache and output tokens.
      node({
        id: "a4",
        kind: "assistant_message",
        label: "Assistant",
        preview: "Done — the login flow reads the token from the header.",
        usage: {
          inputTokens: 40,
          outputTokens: 90,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 12_000,
        },
        context: { addedTokens: 90, contextAfter: 12_040, contextDelta: 400 },
        log: { filePath: "root.jsonl", line: 30, raw: "{a4}" },
      }),
    ],
  });
}

const rootPoints = [point(1, "a1", ["a1"]), point(2, "a3", ["a3"])];

const rootToolImpact = [
  row("Read", [
    call({
      toolUseId: "use-1",
      timestamp: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.500Z",
      durationMs: 1500,
      inputPreview: "src/a.ts",
      resultPreview: "the whole file (truncated)",
      resultTokens: 120,
      contextGrowthAttributed: 300,
    }),
  ]),
  // A result that arrived on an entry with no timestamp of its own: measured,
  // but with no clock to derive a duration from.
  row("Glob", [
    call({ toolUseId: "use-0", resultApplied: true, resultTokens: 5 }),
  ]),
  // In flight: no result ever arrived.
  row("Bash", [call({ toolUseId: "use-2" })]),
  // Result arrived, but the timestamps yielded no usable delta.
  row("Edit", [
    call({
      toolUseId: "use-4",
      completedAt: "2026-01-01T00:00:09.000Z",
      resultTokens: 30,
      isError: true,
    }),
  ]),
];

const subToolImpact = [
  row("Grep", [
    call({ toolUseId: "use-1", resultTokens: 7, resultPreview: "sub match" }),
  ]),
];

function buildDetail(): SessionDetail {
  const tree = buildTree();
  return {
    meta: { id: "sess" } as SessionListItem,
    tree,
    timeline: rootPoints,
    toolImpact: rootToolImpact,
    agentBreakdown: [],
    agents: [
      agent({
        agentId: "sess",
        kind: "root_agent",
        label: "Root agent",
        timeline: rootPoints,
        toolImpact: rootToolImpact,
      }),
      agent({
        agentId: "sub-a",
        kind: "subagent",
        label: "Explore · scan",
        launchToolUseId: "use-task",
        spawnDepth: 1,
        timeline: [point(1, "sa1", ["sa1"])],
        toolImpact: subToolImpact,
      }),
    ],
    loadedContext: [],
    logLines: {},
  };
}

function rootScopeSteps() {
  const tree = buildTree();
  const steps = collectSteps(tree).filter((s) => s.agentId === "sess");
  return enrichSteps({
    steps,
    toolIndex: indexToolImpact(rootToolImpact),
    turnByAssistantNodeId: buildTurnNodeIndex(tree, rootPoints),
  });
}

describe("indexToolImpact", () => {
  it("keys every call by toolUseId and keeps the first on a duplicate", () => {
    const index = indexToolImpact([
      row("Read", [call({ toolUseId: "dup", resultTokens: 11 })]),
      row("unknown", [call({ toolUseId: "dup", resultTokens: 99 })]),
    ]);
    assert.equal(index.size, 1);
    assert.equal(index.get("dup")?.toolName, "Read");
    assert.equal(index.get("dup")?.call.resultTokens, 11);
  });
});

describe("buildTurnNodeIndex", () => {
  it("maps members directly and lets zero-usage turns inherit the preceding turn", () => {
    const index = buildTurnNodeIndex(buildTree(), rootPoints);
    assert.equal(index.get("a1"), 1);
    // `a2` is absent from every memberNodeIds, so it inherits turn 1's span.
    assert.equal(index.get("a2"), 1);
    assert.equal(index.get("a3"), 2);
    // `a0` precedes the first member — it has no turn at all.
    assert.equal(index.has("a0"), false);
    // Subagent turns belong to the subagent's own scope.
    assert.equal(index.has("sa1"), false);
  });

  it("indexes a subagent's own turns when called with its subtree", () => {
    const subtree = node({
      id: "sub-a",
      kind: "subagent",
      agentId: "sub-a",
      children: [node({ id: "sa1", kind: "assistant_message" })],
    });
    const index = buildTurnNodeIndex(subtree, [point(1, "sa1", ["sa1"])]);
    assert.deepEqual([...index], [["sa1", 1]]);
  });
});

describe("turnDurationMs", () => {
  function span(
    startedAt: string | null,
    endedAt: string | null,
  ): ContextTimelinePoint {
    return { startedAt, endedAt } as ContextTimelinePoint;
  }

  it("returns the wall-clock delta between the ends of the turn", () => {
    assert.equal(
      turnDurationMs(
        span("2026-01-01T00:00:01.000Z", "2026-01-01T00:00:04.250Z"),
      ),
      3250,
    );
  });

  it("returns null when either end is missing", () => {
    assert.equal(turnDurationMs(span(null, "2026-01-01T00:00:04.250Z")), null);
    assert.equal(turnDurationMs(span("2026-01-01T00:00:01.000Z", null)), null);
  });

  it("returns null for an unparseable or negative span", () => {
    assert.equal(turnDurationMs(span("not a date", "also not")), null);
    assert.equal(
      turnDurationMs(
        span("2026-01-01T00:00:04.250Z", "2026-01-01T00:00:01.000Z"),
      ),
      null,
    );
  });
});

describe("enrichSteps", () => {
  it("populates every joined field on an exact toolUseId match", () => {
    const step = rootScopeSteps().find((s) => s.nodeId === "call-1")!;
    assert.deepEqual(step, {
      nodeId: "call-1",
      toolUseId: "use-1",
      toolName: "Read",
      agentId: "sess",
      agentLabel: "Root agent",
      assistantNodeId: "a1",
      turn: 1,
      timestamp: "2026-01-01T00:00:00.000Z",
      inputPreview: "src/a.ts",
      addedTokens: 12,
      log: { filePath: "root.jsonl", line: 10, raw: "{call}" },
      resultLog: { filePath: "root.jsonl", line: 11, raw: "{result}" },
      matched: true,
      resultApplied: true,
      resultTokens: 120,
      resultPreview: "the whole file (truncated)",
      durationMs: 1500,
      completedAt: "2026-01-01T00:00:01.500Z",
      isError: false,
      contextGrowthAttributed: 300,
      subagentId: null,
    });
  });

  it("reports an unmatched call without fabricating measurements", () => {
    const step = rootScopeSteps().find((s) => s.nodeId === "call-3")!;
    assert.equal(step.matched, false);
    assert.equal(step.resultApplied, false);
    assert.equal(step.resultPreview, null);
    assert.equal(step.resultLog, null);
    assert.equal(step.durationMs, null);
    assert.equal(step.completedAt, null);
    assert.equal(step.resultTokens, 0);
    assert.equal(step.contextGrowthAttributed, 0);
    assert.equal(step.isError, false);
    // The tree-side input preview is real data and survives.
    assert.equal(step.inputPreview, "https://example.com");
  });

  it("distinguishes the causes of a null durationMs by resultApplied", () => {
    const steps = rootScopeSteps();
    const inFlight = steps.find((s) => s.nodeId === "call-2")!;
    assert.equal(inFlight.matched, true);
    assert.equal(inFlight.resultApplied, false);
    assert.equal(inFlight.durationMs, null);
    assert.equal(inFlight.completedAt, null);
    assert.equal(inFlight.resultTokens, 0);

    const unparseableClock = steps.find((s) => s.nodeId === "call-4")!;
    assert.equal(unparseableClock.matched, true);
    assert.equal(unparseableClock.resultApplied, true);
    assert.equal(unparseableClock.durationMs, null);
    assert.equal(unparseableClock.completedAt, "2026-01-01T00:00:09.000Z");
    assert.equal(unparseableClock.isError, true);

    // A result whose own entry carried no timestamp: still a measurement, so
    // `completedAt == null` alone must not read as in flight.
    const noResultClock = steps.find((s) => s.nodeId === "call-0")!;
    assert.equal(noResultClock.matched, true);
    assert.equal(noResultClock.resultApplied, true);
    assert.equal(noResultClock.completedAt, null);
    assert.equal(noResultClock.durationMs, null);
    assert.equal(noResultClock.resultTokens, 5);
  });

  it("leaves toolUseId null for a synthesized node id and never matches it", () => {
    const step = rootScopeSteps().find((s) => s.nodeId === "a3-tool-2")!;
    assert.equal(step.toolUseId, null);
    assert.equal(step.matched, false);
    assert.equal(step.turn, 2);
  });

  it("exposes the launched subagent on a Task step", () => {
    const step = rootScopeSteps().find((s) => s.nodeId === "task-1")!;
    assert.equal(step.subagentId, "sub-a");
  });
});

describe("groupStepsByTurn", () => {
  it("buckets by turn and collects turnless steps as unassigned", () => {
    const { byTurn, unassigned } = groupStepsByTurn(rootScopeSteps());
    assert.deepEqual(
      byTurn.get(1)?.map((s) => s.nodeId),
      ["call-1", "task-1", "call-2"],
    );
    assert.deepEqual(
      byTurn.get(2)?.map((s) => s.nodeId),
      ["call-3", "call-4", "a3-tool-2"],
    );
    // `call-0` sits before the first timeline member.
    assert.deepEqual(
      unassigned.map((s) => s.nodeId),
      ["call-0"],
    );
    assert.equal(unassigned[0]!.turn, null);
  });
});

describe("buildSessionWorkspaceIndex", () => {
  it("builds one scope per agent with disjoint steps", () => {
    const index = buildSessionWorkspaceIndex(buildDetail());
    assert.equal(index.rootAgentId, "sess");
    assert.deepEqual([...index.scopes.keys()], ["sess", "sub-a"]);

    const root = index.scopes.get("sess")!;
    const sub = index.scopes.get("sub-a")!;
    assert.deepEqual(
      root.allSteps.map((s) => s.nodeId),
      ["call-0", "call-1", "task-1", "call-2", "call-3", "call-4", "a3-tool-2"],
    );
    assert.deepEqual(
      sub.allSteps.map((s) => s.nodeId),
      ["call-s1"],
    );
    assert.equal(sub.tree.id, "sub-a");
    assert.equal(sub.kind, "subagent");
    assert.equal(sub.launchToolUseId, "use-task");
    assert.deepEqual(
      sub.stepsByTurn.get(1)?.map((s) => s.nodeId),
      ["call-s1"],
    );

    // Every node id resolves to exactly one owning agent.
    assert.equal(index.stepByNodeId.size, 8);
    assert.equal(index.stepByNodeId.get("call-1")?.agentId, "sess");
    assert.equal(index.stepByNodeId.get("call-s1")?.agentId, "sub-a");
    assert.equal(index.stepByNodeId.get("call-s1")?.turn, 1);
    assert.equal(index.stepByNodeId.get("call-0")?.turn, null);
    assert.equal(index.subagentByLaunchToolUseId.get("use-task"), "sub-a");
  });

  it("puts every model call on the scope, turnless and tool-less included", () => {
    const index = buildSessionWorkspaceIndex(buildDetail());
    const root = index.scopes.get("sess")!;
    assert.deepEqual(
      root.modelCalls.map((c) => [c.assistantNodeId, c.turn, c.steps.length]),
      [
        ["a0", null, 1],
        ["a1", 1, 2],
        ["a2", 1, 1],
        ["a3", 2, 3],
        ["a4", 2, 0],
      ],
    );
    // The builder discards `groupStepsByTurn`'s `unassigned`, so `call-0` is
    // reachable only through `allSteps` and `modelCalls`.
    assert.equal(
      [...root.stepsByTurn.values()].flat().length,
      root.allSteps.length - 1,
    );
    assert.deepEqual(
      root.modelCalls.flatMap((c) => c.steps.map((s) => s.nodeId)),
      root.allSteps.map((s) => s.nodeId),
    );
    assert.deepEqual(
      index.scopes.get("sub-a")!.modelCalls.map((c) => c.assistantNodeId),
      ["sa0", "sa1", "sa2"],
    );
  });

  it("resolves the same toolUseId per scope", () => {
    const index = buildSessionWorkspaceIndex(buildDetail());
    const rootCall = index.stepByNodeId.get("call-1")!.step;
    const subCall = index.stepByNodeId.get("call-s1")!.step;
    assert.equal(rootCall.toolUseId, "use-1");
    assert.equal(subCall.toolUseId, "use-1");
    assert.equal(rootCall.resultTokens, 120);
    assert.equal(subCall.resultTokens, 7);
    assert.equal(subCall.resultPreview, "sub match");
  });
});

describe("buildModelCalls", () => {
  function rootCalls() {
    const tree = buildTree();
    return buildModelCalls(
      tree,
      rootScopeSteps(),
      buildTurnNodeIndex(tree, rootPoints),
    );
  }

  function shape(calls: ReturnType<typeof rootCalls>) {
    return calls.map((c) => ({
      assistantNodeId: c.assistantNodeId,
      turn: c.turn,
      nodeIds: c.steps.map((s) => s.nodeId),
    }));
  }

  it("emits one call per assistant message in document order, tool-less included", () => {
    assert.deepEqual(shape(rootCalls()), [
      // `a0` precedes the first timeline member, so it has no turn — and its
      // step is invisible to any `stepsByTurn`-driven render.
      { assistantNodeId: "a0", turn: null, nodeIds: ["call-0"] },
      { assistantNodeId: "a1", turn: 1, nodeIds: ["call-1", "task-1"] },
      { assistantNodeId: "a2", turn: 1, nodeIds: ["call-2"] },
      {
        assistantNodeId: "a3",
        turn: 2,
        nodeIds: ["call-3", "call-4", "a3-tool-2"],
      },
      // The invariant: a row with no steps, not a missing row.
      { assistantNodeId: "a4", turn: 2, nodeIds: [] },
    ]);
  });

  it("carries the assistant node's own metrics onto the tool-less call", () => {
    const toolLess = rootCalls().find((c) => c.assistantNodeId === "a4")!;
    assert.equal(toolLess.label, "Assistant");
    assert.equal(
      toolLess.preview,
      "Done — the login flow reads the token from the header.",
    );
    assert.deepEqual(toolLess.usage, {
      inputTokens: 40,
      outputTokens: 90,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 12_000,
    });
    assert.deepEqual(toolLess.context, {
      addedTokens: 90,
      contextAfter: 12_040,
      contextDelta: 400,
    });
    assert.deepEqual(toolLess.log, {
      filePath: "root.jsonl",
      line: 30,
      raw: "{a4}",
    });
  });

  it("gives every step the turn of the call that issued it", () => {
    // What lets `StepList` decide selectability per call: a `?step=` resolves
    // only against `stepsByTurn.get(turn)`, so a call with `turn == null` must
    // never hold a step that any bucket contains, and a call with a turn must
    // hold only steps of that same turn.
    for (const call of rootCalls()) {
      if (call.assistantNodeId == null) continue;
      assert.deepEqual(
        call.steps.map((step) => step.turn),
        call.steps.map(() => call.turn),
        `call ${call.assistantNodeId} mixes turns`,
      );
    }
    const turnless = rootCalls().find((c) => c.turn == null)!;
    assert.deepEqual(
      turnless.steps.map((s) => s.nodeId),
      ["call-0"],
    );
    const { byTurn } = groupStepsByTurn(rootScopeSteps());
    for (const bucket of byTurn.values()) {
      assert.equal(
        bucket.some((step) => step.nodeId === "call-0"),
        false,
      );
    }
  });

  it("does not descend into subagent children", () => {
    const ids = rootCalls().map((c) => c.assistantNodeId);
    assert.deepEqual(ids, ["a0", "a1", "a2", "a3", "a4"]);
    for (const subId of ["sa0", "sa1", "sa2"]) {
      assert.equal(ids.includes(subId), false);
    }
  });

  it("emits every model call even when the scope produced no steps", () => {
    const tree = buildTree();
    const calls = buildModelCalls(
      tree,
      [],
      buildTurnNodeIndex(tree, rootPoints),
    );
    assert.deepEqual(shape(calls), [
      { assistantNodeId: "a0", turn: null, nodeIds: [] },
      { assistantNodeId: "a1", turn: 1, nodeIds: [] },
      { assistantNodeId: "a2", turn: 1, nodeIds: [] },
      { assistantNodeId: "a3", turn: 2, nodeIds: [] },
      { assistantNodeId: "a4", turn: 2, nodeIds: [] },
    ]);
  });

  it("drops no step: a null or unknown assistantNodeId lands in a trailing row", () => {
    const tree = buildTree();
    const steps = rootScopeSteps();
    const withStrays = [
      ...steps,
      // Names an assistant node this tree does not contain.
      { ...steps[1]!, nodeId: "ghost-call", assistantNodeId: "not-in-tree" },
      // A tool call with no enclosing assistant message at all.
      {
        ...steps[1]!,
        nodeId: "orphan-call",
        assistantNodeId: null,
        turn: null,
      },
    ];
    const calls = buildModelCalls(
      tree,
      withStrays,
      buildTurnNodeIndex(tree, rootPoints),
    );

    const trailing = calls[calls.length - 1]!;
    assert.equal(trailing.assistantNodeId, null);
    assert.equal(trailing.turn, null);
    assert.equal(trailing.usage, null);
    assert.deepEqual(
      trailing.steps.map((s) => s.nodeId),
      ["orphan-call", "ghost-call"],
    );
    // Every step accounted for exactly once.
    assert.equal(
      calls.reduce((n, c) => n + c.steps.length, 0),
      withStrays.length,
    );
  });
});

describe("buildStepBars", () => {
  function enrichedStep(
    partial: Partial<EnrichedStep> & { nodeId: string },
  ): EnrichedStep {
    return {
      nodeId: partial.nodeId,
      toolUseId: partial.toolUseId ?? null,
      toolName: partial.toolName ?? "Read",
      agentId: partial.agentId ?? "root",
      agentLabel: partial.agentLabel ?? "root",
      assistantNodeId: partial.assistantNodeId ?? null,
      turn: partial.turn ?? null,
      timestamp: partial.timestamp ?? null,
      inputPreview: partial.inputPreview ?? null,
      addedTokens: partial.addedTokens ?? 0,
      log: partial.log ?? null,
      resultLog: partial.resultLog ?? null,
      matched: partial.matched ?? false,
      resultApplied: partial.resultApplied ?? false,
      resultTokens: partial.resultTokens ?? 0,
      resultPreview: partial.resultPreview ?? null,
      durationMs: partial.durationMs ?? null,
      completedAt: partial.completedAt ?? null,
      isError: partial.isError ?? false,
      contextGrowthAttributed: partial.contextGrowthAttributed ?? 0,
      subagentId: partial.subagentId ?? null,
    };
  }

  function modelCall(
    partial: Partial<Omit<ModelCall, "steps">> & { steps: EnrichedStep[] },
  ): ModelCall {
    return {
      assistantNodeId: partial.assistantNodeId ?? null,
      label: partial.label ?? "Assistant",
      preview: partial.preview ?? null,
      usage: partial.usage ?? null,
      context: partial.context ?? null,
      log: partial.log ?? null,
      turn: partial.turn ?? null,
      steps: partial.steps,
    };
  }

  it("gives a single-step call one bar at that call's contextAfter", () => {
    const calls = [
      modelCall({
        assistantNodeId: "a1",
        context: { addedTokens: 10, contextAfter: 1000, contextDelta: 100 },
        steps: [enrichedStep({ nodeId: "s1", assistantNodeId: "a1" })],
      }),
    ];
    assert.deepEqual(buildStepBars(calls), [
      {
        step: calls[0]!.steps[0],
        contextAfter: 1000,
        groupKey: "a1",
        groupSize: 1,
        groupIndex: 0,
      },
    ]);
  });

  it("groups a parallel call's steps under one key at equal contextAfter", () => {
    const calls = [
      modelCall({
        assistantNodeId: "a1",
        context: { addedTokens: 10, contextAfter: 2000, contextDelta: 500 },
        steps: [
          enrichedStep({ nodeId: "s1", assistantNodeId: "a1" }),
          enrichedStep({ nodeId: "s2", assistantNodeId: "a1" }),
          enrichedStep({ nodeId: "s3", assistantNodeId: "a1" }),
        ],
      }),
    ];
    const bars = buildStepBars(calls);
    assert.equal(bars.length, 3);
    for (const bar of bars) {
      assert.equal(bar.groupKey, "a1");
      assert.equal(bar.groupSize, 3);
      assert.equal(bar.contextAfter, 2000);
    }
    assert.deepEqual(bars.map((b) => b.groupIndex), [0, 1, 2]);
  });

  it("holds the last known context for a call with no context of its own", () => {
    const calls = [
      modelCall({
        assistantNodeId: "a1",
        context: { addedTokens: 10, contextAfter: 1500, contextDelta: 200 },
        steps: [enrichedStep({ nodeId: "s1", assistantNodeId: "a1" })],
      }),
      modelCall({
        assistantNodeId: null,
        context: null,
        steps: [enrichedStep({ nodeId: "s2", assistantNodeId: null })],
      }),
    ];
    const bars = buildStepBars(calls);
    assert.deepEqual(
      bars.map((b) => b.contextAfter),
      [1500, 1500],
    );
    assert.equal(bars[1]!.groupKey, "unattributed-1");
  });

  it("skips calls with no steps", () => {
    const calls = [
      modelCall({ assistantNodeId: "a1", steps: [] }),
      modelCall({
        assistantNodeId: "a2",
        steps: [enrichedStep({ nodeId: "s1", assistantNodeId: "a2" })],
      }),
    ];
    assert.deepEqual(
      buildStepBars(calls).map((b) => b.step.nodeId),
      ["s1"],
    );
  });
});

describe("callsForTurn / stepCountsByTurn", () => {
  function rootCalls() {
    const tree = buildTree();
    return buildModelCalls(
      tree,
      rootScopeSteps(),
      buildTurnNodeIndex(tree, rootPoints),
    );
  }

  it("gives turn 1 the turnless calls, since no later turn can reach them", () => {
    assert.deepEqual(
      callsForTurn(rootCalls(), 1).map((c) => c.assistantNodeId),
      ["a0", "a1", "a2"],
    );
    assert.deepEqual(
      callsForTurn(rootCalls(), 2).map((c) => c.assistantNodeId),
      ["a3", "a4"],
    );
    assert.deepEqual(callsForTurn(rootCalls(), 3), []);
  });

  it("counts the steps of exactly the calls each turn renders", () => {
    const counts = stepCountsByTurn(rootCalls());
    // Turn 1: `a0`'s turnless `call-0`, plus `a1`'s two and `a2`'s one.
    assert.equal(counts.get(1), 4);
    assert.equal(counts.get(2), 3);
    assert.equal(counts.get(3), undefined);
    // The count `stepsByTurn` would give turn 1 — one short, which is the
    // disagreement between the rail label and the pane's rows this prevents.
    assert.equal(groupStepsByTurn(rootScopeSteps()).byTurn.get(1)?.length, 3);
  });

  it("agrees with callsForTurn on every turn", () => {
    const calls = rootCalls();
    const counts = stepCountsByTurn(calls);
    for (const turn of [1, 2]) {
      assert.equal(
        counts.get(turn),
        callsForTurn(calls, turn).reduce((n, c) => n + c.steps.length, 0),
        `turn ${turn} count disagrees with its calls`,
      );
    }
  });
});

describe("resolveSubagentInlineView", () => {
  /** `buildDetail`, with the subagent's timeline swapped for `subTimeline`. */
  function inlineIndex(subTimeline: ContextTimelinePoint[]) {
    const base = buildDetail();
    return buildSessionWorkspaceIndex({
      ...base,
      agents: base.agents.map((a) =>
        a.agentId === "sub-a" ? { ...a, timeline: subTimeline } : a,
      ),
    });
  }

  it("reports a missing scope rather than an empty view", () => {
    assert.deepEqual(
      resolveSubagentInlineView(
        buildSessionWorkspaceIndex(buildDetail()),
        "no-such-agent",
      ),
      { kind: "missing" },
    );
  });

  it("flattens a single-turn subagent to its own calls", () => {
    const view = resolveSubagentInlineView(
      inlineIndex([point(1, "sa1", ["sa1"], 400)]),
      "sub-a",
    );
    assert.equal(view.kind, "flat");
    if (view.kind !== "flat") return;
    assert.equal(view.scope.agentId, "sub-a");
    assert.equal(view.calls, view.scope.modelCalls);
    assert.deepEqual(
      view.calls.map((c) => ({
        assistantNodeId: c.assistantNodeId,
        turn: c.turn,
        nodeIds: c.steps.map((s) => s.nodeId),
      })),
      [
        { assistantNodeId: "sa0", turn: null, nodeIds: [] },
        { assistantNodeId: "sa1", turn: 1, nodeIds: ["call-s1"] },
        { assistantNodeId: "sa2", turn: 1, nodeIds: [] },
      ],
    );
    // The tool-less final answer still carries its metrics.
    assert.equal(view.calls[2]!.usage?.outputTokens, 60);
    assert.equal(view.calls[2]!.context?.contextAfter, 5_320);
  });

  it("treats an empty timeline as flat so no call is stranded", () => {
    const view = resolveSubagentInlineView(inlineIndex([]), "sub-a");
    assert.equal(view.kind, "flat");
    if (view.kind !== "flat") return;
    assert.deepEqual(
      view.calls.map((c) => c.assistantNodeId),
      ["sa0", "sa1", "sa2"],
    );
    assert.deepEqual(
      view.calls.map((c) => c.turn),
      [null, null, null],
    );
  });

  it("keeps turnless calls reachable and scales bars to the subagent's own peak", () => {
    const view = resolveSubagentInlineView(
      inlineIndex([point(1, "sa1", ["sa1"], 400), point(2, "sa2", ["sa2"], 900)]),
      "sub-a",
    );
    assert.equal(view.kind, "turns");
    if (view.kind !== "turns") return;
    assert.deepEqual(
      view.points.map((p) => p.turn),
      [1, 2],
    );
    assert.deepEqual(
      view.orphanCalls.map((c) => c.assistantNodeId),
      ["sa0"],
    );
    // Only `sa0` is orphaned; the other two land on turn rows 1 and 2.
    assert.deepEqual(
      view.scope.modelCalls.map((c) => c.turn),
      [null, 1, 2],
    );
    assert.equal(view.maxContextTokens, 900);
  });

  it("floors maxContextTokens at 1 when no point reports a context size", () => {
    const view = resolveSubagentInlineView(
      inlineIndex([point(1, "sa1", ["sa1"]), point(2, "sa2", ["sa2"])]),
      "sub-a",
    );
    assert.equal(view.kind, "turns");
    if (view.kind !== "turns") return;
    assert.equal(view.maxContextTokens, 1);
  });
});

describe("resolveLogLine", () => {
  const logDetail: SessionDetail = {
    meta: { id: "sess" } as SessionListItem,
    tree: node({
      id: "sess",
      kind: "root_agent",
      agentId: "sess",
      log: { filePath: "/p/root.jsonl", line: 1, raw: '{"type":"summary"}' },
      children: [
        node({
          id: "call-1",
          kind: "tool_call",
          log: {
            filePath: "/p/root.jsonl",
            line: 4,
            raw: '{"type":"assistant"}',
          },
        }),
      ],
    }),
    timeline: [],
    toolImpact: [],
    agentBreakdown: [],
    agents: [
      agent({
        agentId: "sub-a",
        kind: "subagent",
        timeline: [
          {
            ...point(1, "sa1", ["sa1"]),
            log: { filePath: "/p/sub.jsonl", line: 2, raw: "" },
            promptLog: { filePath: "/p/sub.jsonl", line: 1, raw: "" },
          } as ContextTimelinePoint,
        ],
      }),
    ],
    loadedContext: [],
    logLines: {
      "/p/sub.jsonl:2": '{"type":"assistant","uuid":"sa1"}',
      "/p/evidence.jsonl:9": '{"type":"user"}',
    },
  };

  it("finds a nested tree node's own raw line", () => {
    assert.deepEqual(resolveLogLine(logDetail, "/p/root.jsonl:4"), {
      filePath: "/p/root.jsonl",
      line: 4,
      raw: '{"type":"assistant"}',
    });
  });

  it("recovers a stripped subagent timeline line from detail.logLines", () => {
    assert.deepEqual(resolveLogLine(logDetail, "/p/sub.jsonl:2"), {
      filePath: "/p/sub.jsonl",
      line: 2,
      raw: '{"type":"assistant","uuid":"sa1"}',
    });
  });

  it("resolves a stashed line no ref points at, splitting its key", () => {
    // loadedContext evidence is reachable only through `detail.logLines`.
    assert.deepEqual(resolveLogLine(logDetail, "/p/evidence.jsonl:9"), {
      filePath: "/p/evidence.jsonl",
      line: 9,
      raw: '{"type":"user"}',
    });
  });

  it("returns the ref with an empty raw when no text was stashed for it", () => {
    assert.deepEqual(resolveLogLine(logDetail, "/p/sub.jsonl:1"), {
      filePath: "/p/sub.jsonl",
      line: 1,
      raw: "",
    });
  });

  it("returns null for a key this session does not hold", () => {
    assert.equal(resolveLogLine(logDetail, "/p/nope.jsonl:3"), null);
    assert.equal(resolveLogLine(logDetail, "/p/root.jsonl:99"), null);
    assert.equal(resolveLogLine(logDetail, "/p/root.jsonl"), null);
    assert.equal(resolveLogLine(logDetail, "/p/root.jsonl:x"), null);
  });
});
