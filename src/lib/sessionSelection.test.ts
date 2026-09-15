import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ContextTimelinePoint,
  SessionAgent,
  SessionDetail,
  SessionListItem,
  TreeNode,
} from "@shared/types";
import {
  resolveSessionSelection,
  resolveWatchParam,
  sessionTabPath,
  sessionTurnPath,
} from "./sessionSelection";
import { buildSessionWorkspaceIndex } from "./turnSteps";

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
): ContextTimelinePoint {
  return { turn, nodeId, memberNodeIds } as ContextTimelinePoint;
}

function agent(
  partial: Partial<SessionAgent> & { agentId: string },
): SessionAgent {
  return {
    agentId: partial.agentId,
    kind: partial.kind ?? "root_agent",
    label: partial.label ?? partial.agentId,
    agentType: null,
    description: null,
    parentAgentId: partial.parentAgentId ?? null,
    launchToolUseId: partial.launchToolUseId ?? null,
    spawnDepth: partial.spawnDepth ?? 0,
    timeline: partial.timeline ?? [],
    toolImpact: [],
  };
}

/** Root with two turns (`call-1` in turn 1, a synthesized id in turn 2) and a
 * one-turn subagent nested under the Task call. */
const tree = node({
  id: "sess",
  kind: "root_agent",
  agentId: "sess",
  children: [
    node({
      id: "a1",
      kind: "assistant_message",
      children: [
        node({
          id: "call-1",
          kind: "tool_call",
          toolUseId: "use-1",
          toolName: "Read",
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
              children: [
                node({
                  id: "sa1",
                  kind: "assistant_message",
                  children: [
                    node({
                      id: "call-s1",
                      kind: "tool_call",
                      toolUseId: "use-s1",
                      toolName: "Grep",
                    }),
                  ],
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
      children: [node({ id: "a2-tool-1", kind: "tool_call", toolName: "Bash" })],
    }),
  ],
});

const rootTimeline = [point(1, "a1", ["a1"]), point(2, "a2", ["a2"])];

const detail: SessionDetail = {
  meta: { id: "sess" } as SessionListItem,
  tree,
  timeline: rootTimeline,
  toolImpact: [],
  agentBreakdown: [],
  agents: [
    agent({ agentId: "sess", kind: "root_agent", timeline: rootTimeline }),
    agent({
      agentId: "sub-a",
      kind: "subagent",
      spawnDepth: 1,
      launchToolUseId: "use-task",
      timeline: [point(1, "sa1", ["sa1"])],
    }),
  ],
  loadedContext: [],
  logLines: {},
};

const index = buildSessionWorkspaceIndex(detail);

function resolve(input: {
  agentId?: string;
  turn?: string;
  step?: string | null;
  tab?: string | null;
  watch?: string | null;
}) {
  return resolveSessionSelection(detail, index, input);
}

describe("resolveSessionSelection", () => {
  it("resolves a canonical root turn without redirecting", () => {
    const sel = resolve({ turn: "2" });
    assert.equal(sel.scopeId, "sess");
    assert.equal(sel.scopeStatus, "ok");
    assert.equal(sel.turnStatus, "ok");
    assert.equal(sel.turnNumber, 2);
    assert.equal(sel.turn, rootTimeline[1]);
    assert.equal(sel.turnCount, 2);
    assert.equal(sel.prevTurn, 1);
    assert.equal(sel.nextTurn, null);
    assert.equal(sel.tab, "steps");
    assert.equal(sel.redirectTo, null);
  });

  it("reports a non-numeric turn as invalid and redirects to the first turn", () => {
    const sel = resolve({ turn: "abc" });
    assert.equal(sel.turnStatus, "invalid");
    assert.equal(sel.turnNumber, 1);
    assert.equal(sel.redirectTo, "/sessions/sess/turns/1");
  });

  it("treats a missing turn segment as invalid", () => {
    const sel = resolve({});
    assert.equal(sel.turnStatus, "invalid");
    assert.equal(sel.turnNumber, 1);
    assert.equal(sel.redirectTo, "/sessions/sess/turns/1");
  });

  it("clamps an out-of-range turn to the last turn and redirects", () => {
    const sel = resolve({ turn: "9" });
    assert.equal(sel.turnStatus, "out-of-range");
    assert.equal(sel.turnNumber, 2);
    assert.equal(sel.redirectTo, "/sessions/sess/turns/2");
  });

  it("clamps turn 0 up into range", () => {
    const sel = resolve({ turn: "0" });
    assert.equal(sel.turnStatus, "out-of-range");
    assert.equal(sel.turnNumber, 1);
    assert.equal(sel.redirectTo, "/sessions/sess/turns/1");
  });

  it("preserves a valid step and tab in the redirect", () => {
    const sel = resolve({ turn: "99", step: "a2-tool-1", tab: "context" });
    assert.equal(sel.turnNumber, 2);
    assert.equal(sel.stepId, "a2-tool-1");
    assert.equal(sel.tab, "context");
    assert.equal(
      sel.redirectTo,
      "/sessions/sess/turns/2?step=a2-tool-1&tab=context",
    );
  });

  it("keeps a step id that belongs to this turn, including a synthesized one", () => {
    assert.equal(resolve({ turn: "1", step: "call-1" }).stepId, "call-1");
    // A synthesized `${assistant}-tool-N` node id round-trips as ?step=.
    const sel = resolve({ turn: "2", step: "a2-tool-1" });
    assert.equal(sel.stepId, "a2-tool-1");
    assert.equal(
      sessionTurnPath("sess", { turn: 2, step: sel.stepId }),
      "/sessions/sess/turns/2?step=a2-tool-1",
    );
  });

  it("drops a step id that belongs to another turn or another scope", () => {
    assert.equal(resolve({ turn: "2", step: "call-1" }).stepId, null);
    assert.equal(resolve({ turn: "1", step: "call-s1" }).stepId, null);
    assert.equal(resolve({ turn: "1", step: "nope" }).stepId, null);
  });

  it("carries the explicit watch choice, including into a redirect", () => {
    assert.equal(resolve({ turn: "1" }).watch, null);
    assert.equal(resolve({ turn: "1", watch: "1" }).watch, true);
    assert.equal(resolve({ turn: "1", watch: "0" }).watch, false);
    assert.equal(
      resolve({ turn: "99", watch: "0" }).redirectTo,
      "/sessions/sess/turns/2?watch=0",
    );
    assert.equal(resolve({ agentId: "nope", watch: "1" }).watch, true);
  });

  it("falls back to the steps tab for an unknown ?tab=", () => {
    assert.equal(resolve({ turn: "1", tab: "bogus" }).tab, "steps");
    assert.equal(resolve({ turn: "1", tab: null }).tab, "steps");
    assert.equal(resolve({ turn: "1", tab: "loaded" }).tab, "loaded");
  });

  it("resolves a subagent scope against its own timeline", () => {
    const sel = resolve({ agentId: "sub-a", turn: "1", step: "call-s1" });
    assert.equal(sel.scopeId, "sub-a");
    assert.equal(sel.scopeStatus, "ok");
    assert.equal(sel.turnCount, 1);
    assert.equal(sel.turnStatus, "ok");
    assert.equal(sel.prevTurn, null);
    assert.equal(sel.nextTurn, null);
    assert.equal(sel.stepId, "call-s1");
    assert.equal(sel.redirectTo, null);
  });

  it("redirects inside the subagent scope when its turn is out of range", () => {
    const sel = resolve({ agentId: "sub-a", turn: "4" });
    assert.equal(sel.turnStatus, "out-of-range");
    assert.equal(sel.redirectTo, "/sessions/sess/agents/sub-a/turns/1");
  });

  it("reports an unknown agentId without redirecting", () => {
    const sel = resolve({ agentId: "ghost", turn: "1" });
    assert.equal(sel.scopeId, "ghost");
    assert.equal(sel.scopeStatus, "unknown-agent");
    assert.equal(sel.turn, null);
    assert.equal(sel.turnNumber, null);
    assert.equal(sel.turnStatus, "empty");
    assert.equal(sel.turnCount, 0);
    assert.equal(sel.stepId, null);
    assert.equal(sel.redirectTo, null);
  });

  it("reports an empty timeline rather than bouncing to a nonexistent turn", () => {
    const empty: SessionDetail = {
      ...detail,
      timeline: [],
      agents: [agent({ agentId: "sess", kind: "root_agent", timeline: [] })],
    };
    const sel = resolveSessionSelection(
      empty,
      buildSessionWorkspaceIndex(empty),
      { turn: "3" },
    );
    assert.equal(sel.scopeStatus, "ok");
    assert.equal(sel.turnStatus, "empty");
    assert.equal(sel.turn, null);
    assert.equal(sel.turnCount, 0);
    assert.equal(sel.redirectTo, null);
  });
});

describe("sessionTurnPath", () => {
  it("writes root and subagent turn paths", () => {
    assert.equal(sessionTurnPath("s1", { turn: 3 }), "/sessions/s1/turns/3");
    assert.equal(
      sessionTurnPath("s1", { agentId: "sub-a", turn: 1 }),
      "/sessions/s1/agents/sub-a/turns/1",
    );
    assert.equal(
      sessionTurnPath("s1", { agentId: null, turn: 1 }),
      "/sessions/s1/turns/1",
    );
  });

  it("omits the default tab and encodes query values", () => {
    assert.equal(
      sessionTurnPath("s1", { turn: 1, tab: "steps" }),
      "/sessions/s1/turns/1",
    );
    assert.equal(
      sessionTurnPath("s1", { turn: 1, step: "node id/1", tab: "loaded" }),
      "/sessions/s1/turns/1?step=node+id%2F1&tab=loaded",
    );
  });

  it("writes the watch choice as 1 or 0 and omits it when unset", () => {
    assert.equal(
      sessionTurnPath("s1", { turn: 1, watch: true }),
      "/sessions/s1/turns/1?watch=1",
    );
    assert.equal(
      sessionTurnPath("s1", { turn: 1, watch: false }),
      "/sessions/s1/turns/1?watch=0",
    );
    assert.equal(
      sessionTurnPath("s1", { turn: 1, watch: null }),
      "/sessions/s1/turns/1",
    );
    assert.equal(
      sessionTurnPath("s1", { turn: 2, tab: "loaded", watch: true }),
      "/sessions/s1/turns/2?tab=loaded&watch=1",
    );
  });

  it("encodes an agentId that is not URL-safe", () => {
    assert.equal(
      sessionTurnPath("s1", { agentId: "find token call sites", turn: 2 }),
      "/sessions/s1/agents/find%20token%20call%20sites/turns/2",
    );
  });
});

describe("sessionTabPath", () => {
  it("writes the workspace tab paths", () => {
    assert.equal(sessionTabPath("s1", "tools"), "/sessions/s1/tools");
    assert.equal(sessionTabPath("s1", "analysis"), "/sessions/s1/analysis");
    assert.equal(sessionTabPath("s1", "transcript"), "/sessions/s1/transcript");
  });

  it("carries the watch choice so a tab switch does not drop it", () => {
    assert.equal(
      sessionTabPath("s1", "tools", { watch: true }),
      "/sessions/s1/tools?watch=1",
    );
    assert.equal(
      sessionTabPath("s1", "tools", { watch: false }),
      "/sessions/s1/tools?watch=0",
    );
    assert.equal(
      sessionTabPath("s1", "tools", { watch: null }),
      "/sessions/s1/tools",
    );
  });
});

describe("resolveWatchParam", () => {
  it("reads 1 and 0 as an explicit choice and everything else as unset", () => {
    assert.equal(resolveWatchParam("1"), true);
    assert.equal(resolveWatchParam("0"), false);
    assert.equal(resolveWatchParam(null), null);
    assert.equal(resolveWatchParam(undefined), null);
    assert.equal(resolveWatchParam("true"), null);
    assert.equal(resolveWatchParam(""), null);
  });
});
