import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { parseSessionFile, buildSessionDetail } from "./parser.js";
import { decodeProjectPath, fixtureRoot } from "./sessions.js";
import { contextSize, logLineKey, totalTokens } from "../shared/types.js";
import type { TreeNode } from "../shared/types.js";

interface SyntheticSubagent {
  /** transcript basename without extension, e.g. `agent-alpha`. */
  file: string;
  entries: unknown[];
  /**
   * `.meta.json` sidecar body. An object is JSON-stringified; a string is
   * written verbatim (to exercise unparseable sidecars); omit it to write no
   * sidecar at all.
   */
  meta?: unknown;
}

/** Write synthetic JSONL entries to a temp session file and parse them via the real path. */
async function parseSyntheticSession(
  sessionId: string,
  entries: unknown[],
  subagents: SyntheticSubagent[] = [],
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "parser-test-"));
  const filePath = path.join(dir, `${sessionId}.jsonl`);
  const jsonl = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await writeFile(filePath, jsonl, "utf8");
  if (subagents.length > 0) {
    const subDir = path.join(dir, sessionId, "subagents");
    await mkdir(subDir, { recursive: true });
    for (const sub of subagents) {
      await writeFile(
        path.join(subDir, `${sub.file}.jsonl`),
        sub.entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
        "utf8",
      );
      if (sub.meta !== undefined) {
        await writeFile(
          path.join(subDir, `${sub.file}.meta.json`),
          typeof sub.meta === "string" ? sub.meta : JSON.stringify(sub.meta),
          "utf8",
        );
      }
    }
  }
  try {
    const parsed = await parseSessionFile(filePath, {
      lightweight: false,
      sessionId,
    });
    const detail = buildSessionDetail(
      {
        id: sessionId,
        projectEncoded: "-workspace-dur-test",
        projectPath: "/workspace/dur-test",
        filePath,
        source: "fixture",
        mtimeMs: Date.now(),
        size: 1,
      },
      parsed,
    );
    return { parsed, detail };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("decodeProjectPath", () => {
  it("restores a leading slash path", () => {
    assert.equal(
      decodeProjectPath("-Users-dan-code-app"),
      "/Users/dan/code/app",
    );
  });
});

describe("fixture session parse", () => {
  it("parses hierarchy, usage, and tool impact", async () => {
    const filePath = path.join(
      fixtureRoot(),
      "-workspace-demo",
      "11111111-1111-1111-1111-111111111111.jsonl",
    );
    const parsed = await parseSessionFile(filePath, {
      lightweight: false,
      sessionId: "11111111-1111-1111-1111-111111111111",
    });

    assert.ok(parsed.messageCount >= 1);
    assert.ok(parsed.turnCount >= 1);
    assert.ok(parsed.toolCallCount >= 2);
    assert.ok(totalTokens(parsed.usage) > 0);
    assert.ok(parsed.peakContextTokens > 0);
    assert.ok(parsed.subagentFiles.length >= 1);

    const detail = buildSessionDetail(
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

    assert.equal(detail.tree.kind, "root_agent");
    assert.ok(detail.timeline.length >= 1);
    assert.equal(
      parsed.turnCount,
      detail.timeline.length,
      "list turnCount must match detail timeline turns",
    );
    assert.equal(detail.meta.turnCount, detail.timeline.length);
    // Fixture has one user prompt and a multi-step tool loop of assistant
    // turns — the whole loop is one real turn, not one per assistant message.
    assert.equal(parsed.turnCount, parsed.messageCount);
    assert.equal(parsed.turnCount, 1);
    assert.ok(detail.timeline.every((p) => typeof p.nodeId === "string" && p.nodeId.length > 0));
    const timelineIds = new Set(detail.timeline.map((p) => p.nodeId));
    const walk = (node: typeof detail.tree): string[] => [
      node.id,
      ...node.children.flatMap(walk),
    ];
    const treeIds = new Set(walk(detail.tree));
    for (const id of timelineIds) {
      assert.ok(treeIds.has(id), `timeline nodeId ${id} missing from hierarchy`);
    }
    const readImpact = detail.toolImpact.find((t) => t.toolName === "Read");
    assert.ok(readImpact);
    assert.ok(readImpact.callCount >= 1);
    assert.ok(readImpact.calls.length >= 1);
    assert.ok(
      readImpact.calls.every(
        (c) => typeof c.toolUseId === "string" && c.toolUseId.length > 0,
      ),
    );
    assert.ok(
      readImpact.calls.every(
        (c) =>
          (c.inputPreview && c.inputPreview.length > 0) ||
          (c.resultPreview && c.resultPreview.length > 0),
      ),
      "each Read call should expose input or result detail",
    );
    assert.ok(
      readImpact.calls.some((c) => c.inputPreview?.includes("token.ts")),
    );
    assert.ok(
      readImpact.calls.some((c) => (c.resultPreview?.length ?? 0) > 0),
    );

    const bashOrGlob = detail.toolImpact.find(
      (t) => t.toolName === "Glob" || t.toolName === "Bash",
    );
    assert.ok(bashOrGlob);
    assert.ok(bashOrGlob.calls[0]?.inputPreview);

    // Hierarchy tool nodes should carry the detail in the label, not just a bare name.
    const toolLabels: string[] = [];
    const collectToolLabels = (n: typeof detail.tree) => {
      if (n.kind === "tool_call") toolLabels.push(n.label);
      for (const c of n.children) collectToolLabels(c);
    };
    collectToolLabels(detail.tree);
    assert.ok(toolLabels.some((l) => l.includes(" · ")));
    assert.ok(
      detail.toolImpact[0].contextGrowthAttributed >=
        detail.toolImpact[detail.toolImpact.length - 1]
          .contextGrowthAttributed ||
        detail.toolImpact.every((t) => t.contextGrowthAttributed === 0),
    );
    assert.ok(detail.agentBreakdown.some((a) => a.kind === "subagent"));
    const rootAgent = detail.agentBreakdown.find((a) => a.kind === "root_agent");
    assert.ok(rootAgent);
    assert.equal(rootAgent.turnCount, detail.timeline.length);
    // Two subagent transcripts in the fixture: the root-launched explore and
    // the depth-2 explore it launches, one real turn each.
    assert.equal(parsed.subagentTurnCount, 2);
    assert.equal(detail.meta.subagentTurnCount, 2);
    const subAgent = detail.agentBreakdown.find((a) => a.kind === "subagent");
    assert.ok(subAgent);
    assert.equal(subAgent.turnCount, 1);
    assert.equal(
      detail.agentBreakdown
        .filter((a) => a.kind === "subagent")
        .reduce((sum, a) => sum + a.turnCount, 0),
      detail.meta.subagentTurnCount,
    );
    assert.ok(Array.isArray(rootAgent.tools));
    assert.equal(
      rootAgent.tools.reduce((sum, t) => sum + t.callCount, 0),
      rootAgent.toolCallCount,
    );
    if (rootAgent.toolCallCount > 0) {
      assert.ok(rootAgent.tools.length > 0);
      assert.ok(rootAgent.tools.every((t) => t.callCount > 0 && t.toolName));
    }
    assert.ok(contextSize(detail.meta.usage) > 0);
    assert.ok(
      detail.meta.filePath.includes("11111111-1111-1111-1111-111111111111.jsonl"),
      "session detail should expose the full transcript log path",
    );
    assert.ok(detail.timeline.every((p) => p.log?.raw && p.log.line > 0));
    assert.ok(
      detail.timeline[0].log.raw.includes('"type":"assistant"') ||
        detail.timeline[0].log.raw.includes('"type": "assistant"'),
    );
    assert.equal(detail.timeline[0].log.filePath, detail.meta.filePath);
    // timeline[0] now represents the whole turn's end-state (the LAST
    // qualifying assistant entry), not the first assistant message.
    const assistantNodes = detail.tree.children.filter(
      (n) => n.kind === "assistant_message",
    );
    const lastAssistant = assistantNodes[assistantNodes.length - 1];
    assert.ok(lastAssistant?.log?.raw);
    assert.equal(lastAssistant?.log?.line, detail.timeline[0].log.line);

    const assistants = detail.tree.children.filter(
      (n) => n.kind === "assistant_message" && n.usage,
    );
    assert.ok(assistants.length >= 2);
    // First billed turn is baseline occupancy (prompt/cache), not a vs-prior delta.
    assert.equal(assistants[0].context?.contextDelta, null);
    assert.ok((assistants[0].context?.contextAfter ?? 0) > 0);
    assert.ok(
      (assistants[0].usage?.cacheCreationInputTokens ?? 0) +
        (assistants[0].usage?.inputTokens ?? 0) >
        (assistants[0].usage?.outputTokens ?? 0),
      "first-turn ctx is dominated by input/cache, not output or tool +N chips",
    );
    // Later turns report growth vs prior context.
    assert.ok(
      assistants.slice(1).some((a) => (a.context?.contextDelta ?? 0) !== 0),
    );

    assert.ok(detail.loadedContext.length >= 1);
    assert.equal(detail.loadedContext.length, detail.timeline.length);
    const firstLoaded = detail.loadedContext[0];
    assert.equal(firstLoaded.nodeId, detail.timeline[0].nodeId);
    const kinds = new Set(firstLoaded.items.map((i) => i.kind));
    assert.ok(kinds.has("system_prompt"), "baseline system prompt layer");
    assert.ok(kinds.has("instruction"), "CLAUDE.md / instructions");
    assert.ok(kinds.has("mcp"), "MCP servers from attachments");
    assert.ok(kinds.has("skill"), "skill listing attachment");
    assert.ok(kinds.has("deferred_tools"), "deferred tool names");
    assert.ok(kinds.has("memory"), "memory attachment");
    assert.ok(
      firstLoaded.categories.some((c) => c.kind === "mcp" && c.itemCount >= 1),
    );

    const later = detail.loadedContext[detail.loadedContext.length - 1];
    assert.ok(
      later.items.some((i) => i.kind === "file"),
      "later turns should include files read into context",
    );
    assert.ok(
      later.items.some(
        (i) => i.kind === "skill" && i.skillName === "security-audit",
      ),
      "invoked skill should appear in loaded context",
    );
    assert.ok(
      later.items.some((i) => i.kind === "tool_schema"),
      "ToolSearch-loaded schemas should appear",
    );

    // A turn is the whole span between a user prompt and the agent yielding
    // back, not one bar per assistant LLM message: the fixture's single
    // prompt and 6-step tool loop collapse into one turn.
    assert.equal(detail.timeline.length, 1);
    assert.equal(assistants.length, 6);

    // The single turn absorbs every qualifying assistant entry, including the
    // one that issued the Task call, and surfaces the subagent it launched.
    const turnPoint = detail.timeline[0];
    assert.ok(turnPoint.memberNodeIds.includes("a3c"));
    assert.equal(turnPoint.subagentLaunches.length, 1);
    const launch = turnPoint.subagentLaunches[0];
    assert.equal(launch?.toolUseId, "toolu_task_1");
    assert.equal(launch?.agentId, subAgent?.agentId);
    assert.equal(launch?.peakContextTokens, subAgent?.peakContextTokens);
    assert.equal(launch?.turnCount, subAgent?.turnCount);
    assert.equal(launch?.toolCallCount, subAgent?.toolCallCount);

    // causedBy is now aggregated across every entry in the turn: it should
    // include both the Task-result attribution and the parallel Read-call
    // attributions.
    assert.ok(
      turnPoint.causedBy.some((c) => c.toolUseId === "toolu_task_1"),
      "expected the Task-result attribution",
    );
    assert.ok(
      turnPoint.causedBy.some((c) => c.toolUseId.startsWith("toolu_read_")),
      "expected the parallel Read-call attributions",
    );
  });
});

describe("buildSessionDetail loadedContext evidence dedup", () => {
  it("does not re-embed each item's full raw JSONL text in every turn's snapshot", async () => {
    const filePath = path.join(
      fixtureRoot(),
      "-workspace-demo",
      "11111111-1111-1111-1111-111111111111.jsonl",
    );
    const parsed = await parseSessionFile(filePath, {
      lightweight: false,
      sessionId: "11111111-1111-1111-1111-111111111111",
    });
    const detail = buildSessionDetail(
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

    assert.ok(detail.loadedContext.length >= 1);

    // Items carried forward across turns (upsertItem never prunes the running
    // inventory) must not keep duplicating their evidence's full raw text in
    // every snapshot — that duplication is what makes loadedContext balloon
    // to hundreds of MB on real, long sessions.
    let evidenceItemCount = 0;
    for (const snapshot of detail.loadedContext) {
      for (const item of snapshot.items) {
        if (!item.evidence) continue;
        evidenceItemCount += 1;
        assert.equal(
          item.evidence.raw,
          "",
          `evidence.raw for item "${item.id}" at turn ${snapshot.turn} should be stripped; look it up via detail.logLines instead`,
        );
      }
    }
    assert.ok(evidenceItemCount > 0, "fixture should produce items with evidence");

    // The stripped raw text must still be recoverable via the shared dictionary.
    const snapshotWithEvidence = detail.loadedContext.find((s) =>
      s.items.some((i) => i.evidence),
    );
    const item = snapshotWithEvidence?.items.find((i) => i.evidence);
    assert.ok(item?.evidence);
    const key = logLineKey(item!.evidence!);
    assert.ok(
      detail.logLines[key] && detail.logLines[key].length > 0,
      `detail.logLines["${key}"] should contain the original raw JSONL line text`,
    );
  });
});

describe("tool call duration tracking", () => {
  it("sets completedAt and a non-negative durationMs once a tool_result arrives", async () => {
    const sessionId = "dur-test-completed";
    const { detail } = await parseSyntheticSession(sessionId, [
      {
        type: "user",
        uuid: "u1",
        parentUuid: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        sessionId,
        message: { role: "user", content: "Read a file." },
      },
      {
        type: "assistant",
        uuid: "a1",
        parentUuid: "u1",
        timestamp: "2026-01-01T00:00:01.000Z",
        sessionId,
        message: {
          role: "assistant",
          model: "claude-sonnet-4-20250514",
          content: [
            {
              type: "tool_use",
              id: "toolu_done",
              name: "Read",
              input: { file_path: "a.ts" },
            },
          ],
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      },
      {
        type: "user",
        uuid: "u2",
        parentUuid: "a1",
        timestamp: "2026-01-01T00:00:02.500Z",
        sessionId,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_done",
              content: "file contents",
            },
          ],
        },
      },
    ]);

    const readRow = detail.toolImpact.find((t) => t.toolName === "Read");
    const call = readRow?.calls.find((c) => c.toolUseId === "toolu_done");
    assert.ok(call, "expected the completed Read call");
    assert.equal(call!.resultApplied, true);
    assert.equal(call!.completedAt, "2026-01-01T00:00:02.500Z");
    assert.equal(call!.durationMs, 1500);
  });

  it("leaves completedAt and durationMs null while a call is still in flight", async () => {
    const sessionId = "dur-test-inflight";
    const { detail } = await parseSyntheticSession(sessionId, [
      {
        type: "user",
        uuid: "u1",
        parentUuid: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        sessionId,
        message: { role: "user", content: "Run a command." },
      },
      {
        type: "assistant",
        uuid: "a1",
        parentUuid: "u1",
        timestamp: "2026-01-01T00:00:01.000Z",
        sessionId,
        message: {
          role: "assistant",
          model: "claude-sonnet-4-20250514",
          content: [
            {
              type: "tool_use",
              id: "toolu_pending",
              name: "Bash",
              input: { command: "sleep 1" },
            },
          ],
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      },
    ]);

    const bashRow = detail.toolImpact.find((t) => t.toolName === "Bash");
    const call = bashRow?.calls.find((c) => c.toolUseId === "toolu_pending");
    assert.ok(call, "expected the in-flight Bash call");
    assert.equal(call!.resultApplied, false);
    assert.equal(call!.completedAt, null);
    assert.equal(call!.durationMs, null);
  });

  it("leaves durationMs null (not 0) when the tool_use itself has no timestamp", async () => {
    const sessionId = "dur-test-no-start-timestamp";
    const { detail } = await parseSyntheticSession(sessionId, [
      {
        type: "user",
        uuid: "u1",
        parentUuid: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        sessionId,
        message: { role: "user", content: "Read a file." },
      },
      {
        type: "assistant",
        uuid: "a1",
        parentUuid: "u1",
        // No timestamp on the tool_use entry — the call's start time is unknown.
        timestamp: null,
        sessionId,
        message: {
          role: "assistant",
          model: "claude-sonnet-4-20250514",
          content: [
            {
              type: "tool_use",
              id: "toolu_no_start",
              name: "Read",
              input: { file_path: "a.ts" },
            },
          ],
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      },
      {
        type: "user",
        uuid: "u2",
        parentUuid: "a1",
        timestamp: "2026-01-01T00:00:02.500Z",
        sessionId,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_no_start",
              content: "file contents",
            },
          ],
        },
      },
    ]);

    const readRow = detail.toolImpact.find((t) => t.toolName === "Read");
    const call = readRow?.calls.find((c) => c.toolUseId === "toolu_no_start");
    assert.ok(call, "expected the Read call");
    assert.equal(call!.timestamp, null);
    assert.equal(call!.resultApplied, true);
    assert.equal(call!.completedAt, "2026-01-01T00:00:02.500Z");
    assert.equal(call!.durationMs, null);
  });

  it("records resultApplied when the tool_result entry carries no timestamp", async () => {
    const sessionId = "dur-test-no-result-timestamp";
    const { detail } = await parseSyntheticSession(sessionId, [
      {
        type: "user",
        uuid: "u1",
        parentUuid: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        sessionId,
        message: { role: "user", content: "Read a file." },
      },
      {
        type: "assistant",
        uuid: "a1",
        parentUuid: "u1",
        timestamp: "2026-01-01T00:00:01.000Z",
        sessionId,
        message: {
          role: "assistant",
          model: "claude-sonnet-4-20250514",
          content: [
            {
              type: "tool_use",
              id: "toolu_no_result_clock",
              name: "Read",
              input: { file_path: "a.ts" },
            },
          ],
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      },
      {
        type: "user",
        uuid: "u2",
        parentUuid: "a1",
        // The result arrived, but this entry carries no timestamp — so there is
        // no clock for a duration, and `completedAt` alone cannot say whether a
        // result was recorded.
        timestamp: null,
        sessionId,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_no_result_clock",
              content: "file contents",
            },
          ],
        },
      },
    ]);

    const readRow = detail.toolImpact.find((t) => t.toolName === "Read");
    const call = readRow?.calls.find(
      (c) => c.toolUseId === "toolu_no_result_clock",
    );
    assert.ok(call, "expected the Read call");
    assert.equal(call!.resultApplied, true);
    assert.equal(call!.completedAt, null);
    assert.equal(call!.durationMs, null);
    assert.equal(call!.resultPreview, "file contents");
    // ceil("file contents".length / 4)
    assert.equal(call!.resultTokens, 4);
  });
});

describe("summary fallback from first user message", () => {
  it("derives a summary from the first real user message when no summary entry exists", async () => {
    const sessionId = "summary-fallback";
    const { parsed } = await parseSyntheticSession(sessionId, [
      {
        type: "user",
        uuid: "u1",
        parentUuid: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        sessionId,
        message: { role: "user", content: "Fix the auth token refresh bug." },
      },
      {
        type: "assistant",
        uuid: "a1",
        parentUuid: "u1",
        timestamp: "2026-01-01T00:00:01.000Z",
        sessionId,
        message: {
          role: "assistant",
          model: "claude-sonnet-4-20250514",
          content: [{ type: "text", text: "Sure, looking into it." }],
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      },
    ]);

    assert.equal(parsed.summary, "Fix the auth token refresh bug.");
  });

  it("truncates a long first user message the same way previewText does elsewhere", async () => {
    const sessionId = "summary-fallback-long";
    const longText = "Please investigate and fix this issue: ".repeat(6);
    const { parsed } = await parseSyntheticSession(sessionId, [
      {
        type: "user",
        uuid: "u1",
        parentUuid: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        sessionId,
        message: { role: "user", content: longText },
      },
    ]);

    const cleaned = longText.replace(/\s+/g, " ").trim();
    const expected = `${cleaned.slice(0, 160)}…`;
    assert.equal(parsed.summary, expected);
  });

  it("skips a leading tool_result-only user entry and ignores an explicit summary entry", async () => {
    const sessionId = "summary-fallback-skip-tool-result";
    const { parsed } = await parseSyntheticSession(sessionId, [
      {
        type: "user",
        uuid: "u0",
        parentUuid: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        sessionId,
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_x", content: "irrelevant" },
          ],
        },
      },
      {
        type: "user",
        uuid: "u1",
        parentUuid: "u0",
        timestamp: "2026-01-01T00:00:01.000Z",
        sessionId,
        message: { role: "user", content: "Investigate the flaky test." },
      },
    ]);

    assert.equal(parsed.summary, "Investigate the flaky test.");
  });

  it("strips an injected system-reminder block before deriving the title", async () => {
    const sessionId = "summary-fallback-system-reminder";
    const { parsed } = await parseSyntheticSession(sessionId, [
      {
        type: "user",
        uuid: "u1",
        parentUuid: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        sessionId,
        message: {
          role: "user",
          content:
            "<system-reminder>\nFollow CLAUDE.md rules strictly.\n</system-reminder>\nFind where auth tokens are stored and check for leaks.",
        },
      },
    ]);

    assert.equal(
      parsed.summary,
      "Find where auth tokens are stored and check for leaks.",
    );
  });

  it("keeps a long tag's closing bracket intact instead of cutting it off mid-truncation", async () => {
    const sessionId = "summary-fallback-long-tag";
    const longNotification =
      `<task-notification> task-id: a71859ed95ecf636d · ` +
      `tool-use-id: toolu_bdrk_014AGnQfrnHvtCUgLR86tvZz · ` +
      `output-file: ${"/private/tmp/claude-502/very-long-path-segment".repeat(3)}` +
      `</task-notification>`;
    const { parsed } = await parseSyntheticSession(sessionId, [
      {
        type: "user",
        uuid: "u1",
        parentUuid: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        sessionId,
        message: { role: "user", content: longNotification },
      },
    ]);

    // A naive 160-char slice would land inside the tag's value, well before
    // "</task-notification>" appears — leaving a dangling open tag that
    // client-side rendering can't detect as markup. The tag-aware truncation
    // shortens the value but always keeps both brackets.
    assert.match(parsed.summary ?? "", /^<task-notification>/);
    assert.match(parsed.summary ?? "", /<\/task-notification>…$/);
  });

  it("prefers an explicit summary entry over the derived first-user-message title", async () => {
    const sessionId = "summary-fallback-explicit-wins";
    const { parsed } = await parseSyntheticSession(sessionId, [
      { type: "summary", summary: "Explicit title", uuid: "sum-1", sessionId },
      {
        type: "user",
        uuid: "u1",
        parentUuid: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        sessionId,
        message: { role: "user", content: "Different first message text." },
      },
    ]);

    assert.equal(parsed.summary, "Explicit title");
  });
});

describe("turn grouping", () => {
  it("does not count a leading assistant entry (before any real user prompt) as its own turn", async () => {
    const sessionId = "turn-grouping-leading-assistant";
    const usage = {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };
    const { parsed, detail } = await parseSyntheticSession(sessionId, [
      // A leading assistant entry with no preceding real user prompt, as in
      // a resumed/continued session file that starts mid-conversation.
      {
        type: "assistant",
        uuid: "a0",
        parentUuid: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        sessionId,
        message: {
          role: "assistant",
          model: "claude-sonnet-4-20250514",
          content: [{ type: "text", text: "orphaned continuation" }],
          usage,
        },
      },
      {
        type: "user",
        uuid: "u1",
        parentUuid: "a0",
        timestamp: "2026-01-01T00:00:01.000Z",
        sessionId,
        message: { role: "user", content: "Real prompt." },
      },
      {
        type: "assistant",
        uuid: "a1",
        parentUuid: "u1",
        timestamp: "2026-01-01T00:00:02.000Z",
        sessionId,
        message: {
          role: "assistant",
          model: "claude-sonnet-4-20250514",
          content: [{ type: "text", text: "reply" }],
          usage,
        },
      },
    ]);

    // Only one real user prompt exists, so there must be exactly one turn —
    // the orphaned leading assistant entry must not be counted or rendered.
    assert.equal(parsed.turnCount, 1);
    assert.equal(detail.timeline.length, 1);
    assert.equal(detail.timeline[0].nodeId, "a1");
  });
});

const SUB_USAGE = {
  input_tokens: 10,
  output_tokens: 5,
  cache_creation_input_tokens: 100,
  cache_read_input_tokens: 0,
};

/** One user prompt + one assistant reply, i.e. a subagent with one real turn. */
function subagentEntries(
  sessionId: string,
  agentId: string,
  timestamp: string,
): unknown[] {
  return [
    {
      type: "user",
      uuid: `${agentId}-u1`,
      parentUuid: null,
      timestamp,
      sessionId,
      agentId,
      message: { role: "user", content: `Work for ${agentId}.` },
    },
    {
      type: "assistant",
      uuid: `${agentId}-a1`,
      parentUuid: `${agentId}-u1`,
      timestamp,
      sessionId,
      agentId,
      message: {
        role: "assistant",
        model: "claude-haiku-4-20250414",
        content: [{ type: "text", text: `${agentId} done.` }],
        usage: SUB_USAGE,
      },
    },
  ];
}

function findToolNode(node: TreeNode, toolUseId: string): TreeNode | null {
  if (node.toolUseId === toolUseId) return node;
  for (const child of node.children) {
    const hit = findToolNode(child, toolUseId);
    if (hit) return hit;
  }
  return null;
}

function subagentChildIds(node: TreeNode): string[] {
  return node.children.filter((c) => c.kind === "subagent").map((c) => c.id);
}

function taskToolUseIdsInTranscriptOrder(node: TreeNode): string[] {
  const ids: string[] = [];
  const walk = (n: TreeNode) => {
    if (n.kind === "tool_call" && n.toolName === "Task" && n.toolUseId) {
      ids.push(n.toolUseId);
    }
    for (const c of n.children) walk(c);
  };
  walk(node);
  return ids;
}

/**
 * Two Task calls whose `tool_use` ids run beta-then-alpha in the transcript
 * while the subagent files sort alpha-then-beta by timestamp — so positional
 * pairing and sidecar pairing give opposite answers.
 */
async function parseReverseOrderSubagentSession() {
  const sessionId = "33333333-3333-3333-3333-333333333333";
  return parseSyntheticSession(
    sessionId,
    [
      {
        type: "user",
        uuid: "u1",
        parentUuid: null,
        timestamp: "2026-02-01T00:00:00.000Z",
        sessionId,
        message: { role: "user", content: "Launch two explores." },
      },
      {
        type: "assistant",
        uuid: "a1",
        parentUuid: "u1",
        timestamp: "2026-02-01T00:00:01.000Z",
        sessionId,
        message: {
          role: "assistant",
          model: "claude-sonnet-4-20250514",
          content: [
            { type: "text", text: "Spawning both." },
            {
              type: "tool_use",
              id: "toolu_task_beta",
              name: "Task",
              input: { description: "Scan beta", subagent_type: "Explore" },
            },
            {
              type: "tool_use",
              id: "toolu_task_alpha",
              name: "Task",
              input: { description: "Scan alpha", subagent_type: "Explore" },
            },
          ],
          usage: {
            input_tokens: 50,
            output_tokens: 20,
            cache_creation_input_tokens: 800,
            cache_read_input_tokens: 0,
          },
        },
      },
      {
        type: "user",
        uuid: "u2",
        parentUuid: "a1",
        timestamp: "2026-02-01T00:00:05.000Z",
        sessionId,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_task_beta",
              content: "beta done.",
            },
          ],
        },
      },
      {
        type: "user",
        uuid: "u3",
        parentUuid: "a1",
        timestamp: "2026-02-01T00:00:06.000Z",
        sessionId,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_task_alpha",
              content: "alpha done.",
            },
          ],
        },
      },
    ],
    [
      {
        file: "agent-alpha",
        entries: subagentEntries(sessionId, "alpha", "2026-02-01T00:00:02.000Z"),
        meta: {
          agentType: "Explore",
          description: "Scan alpha",
          toolUseId: "toolu_task_alpha",
          spawnDepth: 1,
        },
      },
      {
        file: "agent-beta",
        entries: subagentEntries(sessionId, "beta", "2026-02-01T00:00:03.000Z"),
        meta: {
          agentType: "Explore",
          description: "Scan beta",
          toolUseId: "toolu_task_beta",
          spawnDepth: 1,
        },
      },
    ],
  );
}

describe("subagent sidecar attachment", () => {
  it("attaches by sidecar toolUseId, not by file position", async () => {
    const { detail } = await parseReverseOrderSubagentSession();

    // Guard the premise: positional pairing would map file order
    // [alpha, beta] onto transcript order [beta, alpha] and cross the two.
    assert.deepEqual(taskToolUseIdsInTranscriptOrder(detail.tree), [
      "toolu_task_beta",
      "toolu_task_alpha",
    ]);

    const alphaTask = findToolNode(detail.tree, "toolu_task_alpha");
    const betaTask = findToolNode(detail.tree, "toolu_task_beta");
    assert.ok(alphaTask);
    assert.ok(betaTask);
    assert.deepEqual(subagentChildIds(alphaTask), ["alpha"]);
    assert.deepEqual(subagentChildIds(betaTask), ["beta"]);
    assert.deepEqual(
      detail.tree.children.filter((c) => c.kind === "subagent").map((c) => c.id),
      [],
      "no subagent should fall through to the root",
    );
  });

  it("labels subagents from the sidecar agentType and description", async () => {
    const { detail } = await parseReverseOrderSubagentSession();
    const rows = new Map(detail.agentBreakdown.map((a) => [a.agentId, a]));
    assert.equal(rows.get("alpha")?.label, "Explore · Scan alpha");
    assert.equal(rows.get("beta")?.label, "Explore · Scan beta");
    const alphaTask = findToolNode(detail.tree, "toolu_task_alpha");
    const alphaNode = alphaTask?.children.find((c) => c.kind === "subagent");
    assert.equal(alphaNode?.label, "Explore · Scan alpha");
  });

  it("resolves subagentLaunches via the sidecar when file order differs from tool order", async () => {
    const { detail } = await parseReverseOrderSubagentSession();
    assert.equal(detail.timeline.length, 1);
    const launches = new Map(
      detail.timeline[0].subagentLaunches.map((l) => [l.toolUseId, l]),
    );
    assert.equal(launches.size, 2);
    assert.equal(launches.get("toolu_task_alpha")?.agentId, "alpha");
    assert.equal(launches.get("toolu_task_alpha")?.label, "Explore · Scan alpha");
    assert.equal(launches.get("toolu_task_beta")?.agentId, "beta");
    assert.equal(launches.get("toolu_task_beta")?.label, "Explore · Scan beta");
  });

  it("nests a spawnDepth 2 subagent under its parent subagent's Task node", async () => {
    const sessionId = "44444444-4444-4444-4444-444444444444";
    const { detail } = await parseSyntheticSession(
      sessionId,
      [
        {
          type: "user",
          uuid: "u1",
          parentUuid: null,
          timestamp: "2026-02-01T00:00:00.000Z",
          sessionId,
          message: { role: "user", content: "Explore this." },
        },
        {
          type: "assistant",
          uuid: "a1",
          parentUuid: "u1",
          timestamp: "2026-02-01T00:00:01.000Z",
          sessionId,
          message: {
            role: "assistant",
            model: "claude-sonnet-4-20250514",
            content: [
              {
                type: "tool_use",
                id: "toolu_task_root",
                name: "Task",
                input: { description: "Parent", subagent_type: "Explore" },
              },
            ],
            usage: {
              input_tokens: 40,
              output_tokens: 10,
              cache_creation_input_tokens: 500,
              cache_read_input_tokens: 0,
            },
          },
        },
        {
          type: "user",
          uuid: "u2",
          parentUuid: "a1",
          timestamp: "2026-02-01T00:00:10.000Z",
          sessionId,
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_task_root",
                content: "parent done.",
              },
            ],
          },
        },
      ],
      [
        // Listed (and timestamped) child-first on purpose: parent-first
        // ordering has to come from `spawnDepth`, not from the timestamps.
        {
          file: "agent-child",
          entries: subagentEntries(
            sessionId,
            "child",
            "2026-02-01T00:00:04.000Z",
          ),
          meta: {
            agentType: "Explore",
            description: "Nested",
            toolUseId: "toolu_task_nested",
            parentAgentId: "parent",
            spawnDepth: 2,
          },
        },
        {
          file: "agent-parent",
          entries: [
            {
              type: "user",
              uuid: "pu1",
              parentUuid: null,
              timestamp: "2026-02-01T00:00:02.000Z",
              sessionId,
              agentId: "parent",
              message: { role: "user", content: "Parent prompt." },
            },
            {
              type: "assistant",
              uuid: "pa1",
              parentUuid: "pu1",
              timestamp: "2026-02-01T00:00:03.000Z",
              sessionId,
              agentId: "parent",
              message: {
                role: "assistant",
                model: "claude-haiku-4-20250414",
                content: [
                  {
                    type: "tool_use",
                    id: "toolu_task_nested",
                    name: "Task",
                    input: { description: "Nested", subagent_type: "Explore" },
                  },
                ],
                usage: SUB_USAGE,
              },
            },
            {
              type: "user",
              uuid: "pu2",
              parentUuid: "pa1",
              timestamp: "2026-02-01T00:00:08.000Z",
              sessionId,
              agentId: "parent",
              message: {
                role: "user",
                content: [
                  {
                    type: "tool_result",
                    tool_use_id: "toolu_task_nested",
                    content: "child done.",
                  },
                ],
              },
            },
          ],
          meta: {
            agentType: "Explore",
            description: "Parent",
            toolUseId: "toolu_task_root",
            spawnDepth: 1,
          },
        },
      ],
    );

    const rootTask = findToolNode(detail.tree, "toolu_task_root");
    assert.ok(rootTask);
    assert.deepEqual(subagentChildIds(rootTask), ["parent"]);

    const parentNode = rootTask.children.find((c) => c.id === "parent");
    assert.ok(parentNode);
    const nestedTask = findToolNode(parentNode, "toolu_task_nested");
    assert.ok(nestedTask, "the nested Task node lives in the parent's subtree");
    assert.deepEqual(subagentChildIds(nestedTask), ["child"]);

    // The child must not also (or instead) hang off the root.
    assert.deepEqual(
      detail.tree.children.filter((c) => c.kind === "subagent").map((c) => c.id),
      [],
    );
    assert.deepEqual(
      detail.agentBreakdown.map((a) => a.agentId),
      [sessionId, "parent", "child"],
      "agentBreakdown keeps parent-before-child order",
    );
    assert.deepEqual(
      detail.agents.map((a) => a.agentId),
      [sessionId, "parent", "child"],
      "agents is root-first and parent-before-child, joining agentBreakdown",
    );
    assert.deepEqual(
      detail.agents.map((a) => a.spawnDepth),
      [0, 1, 2],
    );
    assert.deepEqual(
      detail.agents.map((a) => a.parentAgentId),
      [null, null, "parent"],
    );
  });

  it("falls back to positional pairing when sidecars are missing or unusable", async () => {
    const sessionId = "55555555-5555-5555-5555-555555555555";
    const task = (id: string, description: string) => ({
      type: "tool_use",
      id,
      name: "Task",
      input: { description, subagent_type: "Explore" },
    });
    const { detail } = await parseSyntheticSession(
      sessionId,
      [
        {
          type: "user",
          uuid: "u1",
          parentUuid: null,
          timestamp: "2026-02-01T00:00:00.000Z",
          sessionId,
          message: { role: "user", content: "Launch three." },
        },
        {
          type: "assistant",
          uuid: "a1",
          parentUuid: "u1",
          timestamp: "2026-02-01T00:00:01.000Z",
          sessionId,
          message: {
            role: "assistant",
            model: "claude-sonnet-4-20250514",
            content: [
              task("toolu_p1", "One"),
              task("toolu_p2", "Two"),
              task("toolu_p3", "Three"),
            ],
            usage: {
              input_tokens: 60,
              output_tokens: 30,
              cache_creation_input_tokens: 900,
              cache_read_input_tokens: 0,
            },
          },
        },
      ],
      [
        // no sidecar at all
        {
          file: "agent-one",
          entries: subagentEntries(sessionId, "one", "2026-02-01T00:00:02.000Z"),
        },
        // present but not JSON
        {
          file: "agent-two",
          entries: subagentEntries(sessionId, "two", "2026-02-01T00:00:03.000Z"),
          meta: "{not json",
        },
        // valid JSON, but not an object
        {
          file: "agent-three",
          entries: subagentEntries(
            sessionId,
            "three",
            "2026-02-01T00:00:04.000Z",
          ),
          meta: [1, 2, 3],
        },
      ],
    );

    assert.deepEqual(taskToolUseIdsInTranscriptOrder(detail.tree), [
      "toolu_p1",
      "toolu_p2",
      "toolu_p3",
    ]);
    assert.deepEqual(
      subagentChildIds(findToolNode(detail.tree, "toolu_p1")!),
      ["one"],
    );
    assert.deepEqual(
      subagentChildIds(findToolNode(detail.tree, "toolu_p2")!),
      ["two"],
    );
    assert.deepEqual(
      subagentChildIds(findToolNode(detail.tree, "toolu_p3")!),
      ["three"],
    );
    const rows = new Map(detail.agentBreakdown.map((a) => [a.agentId, a]));
    assert.equal(rows.get("one")?.label, "Subagent · one");
    assert.equal(rows.get("two")?.label, "Subagent · two");
    assert.equal(rows.get("three")?.label, "Subagent · three");
  });

  /**
   * Two Task calls, one subagent with a sidecar naming the *first* of them and
   * one with no sidecar at all. The positional fallback must not hand the
   * sidecar-claimed node to the sidecar-less subagent. `visitOrder` picks which
   * of the two is parsed first (earliest transcript timestamp wins), so both
   * orders are exercised.
   */
  async function parseMixedSidecarSession(visitOrder: "sidecar" | "fallback") {
    const sessionId = "66666666-6666-6666-6666-666666666666";
    const sidecarAt =
      visitOrder === "sidecar" ? "2026-02-01T00:00:02.000Z" : "2026-02-01T00:00:03.000Z";
    const fallbackAt =
      visitOrder === "sidecar" ? "2026-02-01T00:00:03.000Z" : "2026-02-01T00:00:02.000Z";
    return parseSyntheticSession(
      sessionId,
      [
        {
          type: "user",
          uuid: "u1",
          parentUuid: null,
          timestamp: "2026-02-01T00:00:00.000Z",
          sessionId,
          message: { role: "user", content: "Launch two." },
        },
        {
          type: "assistant",
          uuid: "a1",
          parentUuid: "u1",
          timestamp: "2026-02-01T00:00:01.000Z",
          sessionId,
          message: {
            role: "assistant",
            model: "claude-sonnet-4-20250514",
            content: [
              {
                type: "tool_use",
                id: "toolu_first",
                name: "Task",
                input: { description: "First", subagent_type: "Explore" },
              },
              {
                type: "tool_use",
                id: "toolu_second",
                name: "Task",
                input: { description: "Second", subagent_type: "Explore" },
              },
            ],
            usage: {
              input_tokens: 50,
              output_tokens: 20,
              cache_creation_input_tokens: 800,
              cache_read_input_tokens: 0,
            },
          },
        },
      ],
      [
        {
          file: "agent-claimed",
          entries: subagentEntries(sessionId, "claimed", sidecarAt),
          meta: {
            agentType: "Explore",
            description: "First",
            // Names the FIRST Task node — the one positional pairing would
            // otherwise hand to the sidecar-less subagent.
            toolUseId: "toolu_first",
            spawnDepth: 1,
          },
        },
        {
          file: "agent-loose",
          entries: subagentEntries(sessionId, "loose", fallbackAt),
        },
      ],
    );
  }

  for (const visitOrder of ["sidecar", "fallback"] as const) {
    it(`never lets the positional fallback re-consume a sidecar-claimed Task node (${visitOrder} first)`, async () => {
      const { detail } = await parseMixedSidecarSession(visitOrder);

      assert.deepEqual(taskToolUseIdsInTranscriptOrder(detail.tree), [
        "toolu_first",
        "toolu_second",
      ]);
      assert.deepEqual(
        subagentChildIds(findToolNode(detail.tree, "toolu_first")!),
        ["claimed"],
      );
      assert.deepEqual(
        subagentChildIds(findToolNode(detail.tree, "toolu_second")!),
        ["loose"],
      );
      assert.deepEqual(
        detail.tree.children.filter((c) => c.kind === "subagent").map((c) => c.id),
        [],
        "no subagent should fall through to the root",
      );

      // Both launches resolve, each to its own agent: one row overwriting the
      // other in `subagentByToolUseId` is exactly what the bug looked like.
      const launches = new Map(
        detail.timeline[0].subagentLaunches.map((l) => [l.toolUseId, l.agentId]),
      );
      assert.deepEqual(
        [...launches],
        [
          ["toolu_first", "claimed"],
          ["toolu_second", "loose"],
        ],
      );
    });
  }
});

describe("per-agent timeline and tool impact", () => {
  it("emits root-first agents whose ids join agentBreakdown", async () => {
    const { detail } = await parseReverseOrderSubagentSession();

    assert.deepEqual(
      detail.agents.map((a) => a.agentId),
      detail.agentBreakdown.map((a) => a.agentId),
      "one agents entry per agentBreakdown row, same order",
    );
    const root = detail.agents[0];
    assert.equal(root.kind, "root_agent");
    assert.equal(root.agentId, "33333333-3333-3333-3333-333333333333");
    assert.equal(root.label, "Root agent");
    assert.equal(root.spawnDepth, 0);
    assert.equal(root.parentAgentId, null);
    assert.equal(root.launchToolUseId, null);
    assert.equal(root.agentType, null);
    assert.equal(root.description, null);
    assert.equal(root.timeline, detail.timeline, "root reuses the session timeline");
    assert.equal(root.toolImpact, detail.toolImpact);

    const alpha = detail.agents.find((a) => a.agentId === "alpha");
    assert.ok(alpha);
    assert.equal(alpha.kind, "subagent");
    assert.equal(alpha.label, "Explore · Scan alpha");
    assert.equal(alpha.agentType, "Explore");
    assert.equal(alpha.description, "Scan alpha");
    assert.equal(alpha.launchToolUseId, "toolu_task_alpha");
    assert.equal(alpha.parentAgentId, null);
    assert.equal(alpha.spawnDepth, 1);
    // `subagentEntries` is one prompt + one reply, i.e. exactly one real turn.
    assert.equal(alpha.timeline.length, 1);
    assert.equal(alpha.timeline[0].turn, 1);
    assert.equal(alpha.timeline[0].nodeId, "alpha-a1");
    assert.equal(alpha.timeline[0].promptPreview, "Work for alpha.");
    assert.deepEqual(alpha.toolImpact, [], "that subagent calls no tools");
  });

  it("scopes each agent's timeline and toolImpact on the demo fixture", async () => {
    const sessionId = "11111111-1111-1111-1111-111111111111";
    const filePath = path.join(fixtureRoot(), "-workspace-demo", `${sessionId}.jsonl`);
    const parsed = await parseSessionFile(filePath, {
      lightweight: false,
      sessionId,
    });
    const detail = buildSessionDetail(
      {
        id: sessionId,
        projectEncoded: "-workspace-demo",
        projectPath: "/workspace/demo",
        filePath,
        source: "fixture",
        mtimeMs: Date.now(),
        size: 1,
      },
      parsed,
    );

    // Root plus the fixture's two subagent transcripts (authscan, and the
    // depth-2 loginflow it launches).
    assert.equal(detail.agents.length, 3);
    assert.deepEqual(
      detail.agents.map((a) => a.agentId),
      [sessionId, "explore-authscan", "explore-loginflow"],
    );
    assert.deepEqual(
      detail.agents.map((a) => a.spawnDepth),
      [0, 1, 2],
    );
    assert.equal(detail.agents[2].parentAgentId, "explore-authscan");
    assert.equal(detail.agents[2].launchToolUseId, "toolu_sub_task_1");

    const authscan = detail.agents[1];
    assert.equal(authscan.label, "Explore · Scan token call sites");
    assert.equal(authscan.launchToolUseId, "toolu_task_1");
    assert.ok(authscan.timeline.length >= 1);
    assert.equal(authscan.timeline.length, 1);
    assert.equal(
      authscan.timeline[0].promptPreview,
      "Find all storeToken and console.log usages related to auth tokens.",
    );
    // Per-agent causedBy comes from that agent's own byTurn map: the Grep
    // result is what grows the subagent's context.
    assert.deepEqual(
      authscan.timeline[0].causedBy.map((c) => c.toolUseId),
      ["toolu_sub_grep"],
    );

    // Scoping: the subagent's own call is in its toolImpact and in no other
    // agent's — the root's rows are built from the root transcript alone.
    const callIds = (agent: (typeof detail.agents)[number]): string[] =>
      agent.toolImpact.flatMap((row) => row.calls.map((c) => c.toolUseId));
    assert.ok(callIds(authscan).includes("toolu_sub_grep"));
    assert.ok(
      !callIds(detail.agents[0]).includes("toolu_sub_grep"),
      "a subagent's call must not appear in the root toolImpact",
    );
    assert.deepEqual(
      detail.toolImpact.flatMap((row) => row.calls.map((c) => c.toolUseId)),
      callIds(detail.agents[0]),
      "detail.toolImpact stays the root-scoped rows",
    );
    assert.ok(callIds(detail.agents[2]).includes("toolu_nested_read"));
    assert.ok(
      !callIds(authscan).includes("toolu_nested_read"),
      "the nested subagent's call belongs to the nested scope only",
    );
    assert.deepEqual(
      authscan.toolImpact.map((row) => row.toolName).sort(),
      ["Grep", "Task"],
    );

    // A subagent scope surfaces the subagent *it* launched, the same way the
    // root timeline does — nesting is not a blind spot.
    const loginflow = detail.agents[2];
    assert.equal(authscan.timeline[0].subagentLaunches.length, 1);
    const nestedLaunch = authscan.timeline[0].subagentLaunches[0];
    assert.equal(nestedLaunch.toolUseId, "toolu_sub_task_1");
    assert.equal(nestedLaunch.agentId, "explore-loginflow");
    assert.equal(nestedLaunch.label, "Explore · Trace login flow");
    const loginflowRow = detail.agentBreakdown.find(
      (a) => a.agentId === "explore-loginflow",
    );
    assert.ok(loginflowRow);
    assert.equal(nestedLaunch.peakContextTokens, loginflowRow.peakContextTokens);
    assert.equal(nestedLaunch.turnCount, loginflowRow.turnCount);
    assert.equal(nestedLaunch.toolCallCount, loginflowRow.toolCallCount);
    // The leaf launches nothing.
    assert.deepEqual(
      loginflow.timeline.flatMap((p) => p.subagentLaunches),
      [],
    );

    // Subagent points ship their JSONL text via `logLines`, not inline.
    for (const agent of detail.agents.slice(1)) {
      for (const point of agent.timeline) {
        assert.equal(point.log.raw, "");
        const key = logLineKey(point.log);
        assert.ok(key in detail.logLines, `logLines missing ${key}`);
        assert.ok(detail.logLines[key].includes('"type":"assistant"'));
        assert.ok(point.log.filePath.includes("subagents/"));
        assert.ok(point.promptLog);
        assert.equal(point.promptLog.raw, "");
        assert.ok(logLineKey(point.promptLog) in detail.logLines);
        assert.ok(
          detail.logLines[logLineKey(point.promptLog)].includes('"type":"user"'),
        );
      }
    }
    // The root timeline keeps its raw text inline.
    assert.ok(detail.timeline.every((p) => p.log.raw.length > 0));
    assert.equal(detail.agents[0].timeline[0].log.raw, detail.timeline[0].log.raw);
  });

  it("keeps an in-flight subagent call distinguishable in its own toolImpact", async () => {
    const sessionId = "66666666-6666-6666-6666-666666666666";
    const { detail } = await parseSyntheticSession(
      sessionId,
      [
        {
          type: "user",
          uuid: "u1",
          parentUuid: null,
          timestamp: "2026-03-01T00:00:00.000Z",
          sessionId,
          message: { role: "user", content: "Launch one." },
        },
        {
          type: "assistant",
          uuid: "a1",
          parentUuid: "u1",
          timestamp: "2026-03-01T00:00:01.000Z",
          sessionId,
          message: {
            role: "assistant",
            model: "claude-sonnet-4-20250514",
            content: [
              {
                type: "tool_use",
                id: "toolu_task_only",
                name: "Task",
                input: { description: "Scan", subagent_type: "Explore" },
              },
            ],
            usage: {
              input_tokens: 30,
              output_tokens: 10,
              cache_creation_input_tokens: 400,
              cache_read_input_tokens: 0,
            },
          },
        },
      ],
      [
        {
          file: "agent-pending",
          entries: [
            {
              type: "user",
              uuid: "pu1",
              parentUuid: null,
              timestamp: "2026-03-01T00:00:02.000Z",
              sessionId,
              agentId: "pending",
              message: { role: "user", content: "Grep for tokens." },
            },
            {
              type: "assistant",
              uuid: "pa1",
              parentUuid: "pu1",
              timestamp: "2026-03-01T00:00:03.000Z",
              sessionId,
              agentId: "pending",
              message: {
                role: "assistant",
                model: "claude-haiku-4-20250414",
                content: [
                  {
                    type: "tool_use",
                    id: "toolu_sub_pending",
                    name: "Grep",
                    input: { pattern: "storeToken" },
                  },
                ],
                usage: SUB_USAGE,
              },
            },
          ],
          meta: {
            agentType: "Explore",
            description: "Scan",
            toolUseId: "toolu_task_only",
            spawnDepth: 1,
          },
        },
      ],
    );

    const pending = detail.agents.find((a) => a.agentId === "pending");
    assert.ok(pending);
    const call = pending.toolImpact
      .find((row) => row.toolName === "Grep")
      ?.calls.find((c) => c.toolUseId === "toolu_sub_pending");
    assert.ok(call, "expected the subagent's in-flight Grep call");
    // In flight, not "unparseable clock" and not a fabricated 0.
    assert.equal(call.completedAt, null);
    assert.equal(call.durationMs, null);
    assert.equal(call.resultTokens, 0);
  });
});

describe("turn promptPreview", () => {
  it("emits the opening prompt's preview with system-reminders stripped", async () => {
    const sessionId = "prompt-preview-test";
    const usage = {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 50,
      cache_read_input_tokens: 0,
    };
    const { detail } = await parseSyntheticSession(sessionId, [
      {
        type: "user",
        uuid: "u1",
        parentUuid: null,
        timestamp: "2026-04-01T00:00:00.000Z",
        sessionId,
        message: {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "<system-reminder>Remember the rules.</system-reminder>\n" +
                "Summarize   the report.",
            },
          ],
        },
      },
      {
        type: "assistant",
        uuid: "a1",
        parentUuid: "u1",
        timestamp: "2026-04-01T00:00:01.000Z",
        sessionId,
        message: {
          role: "assistant",
          model: "claude-sonnet-4-20250514",
          content: [{ type: "text", text: "Done." }],
          usage,
        },
      },
      {
        type: "user",
        uuid: "u2",
        parentUuid: "a1",
        timestamp: "2026-04-01T00:00:02.000Z",
        sessionId,
        message: {
          role: "user",
          content: [
            { type: "text", text: "<system-reminder>Only a reminder.</system-reminder>" },
          ],
        },
      },
      {
        type: "assistant",
        uuid: "a2",
        parentUuid: "u2",
        timestamp: "2026-04-01T00:00:03.000Z",
        sessionId,
        message: {
          role: "assistant",
          model: "claude-sonnet-4-20250514",
          content: [{ type: "text", text: "Nothing to do." }],
          usage,
        },
      },
    ]);

    assert.equal(detail.timeline.length, 2);
    // Reminder stripped, whitespace collapsed the same way previewText does.
    assert.equal(detail.timeline[0].promptPreview, "Summarize the report.");
    assert.equal(detail.timeline[0].promptLog?.line, 1);
    assert.equal(detail.timeline[0].promptLog?.filePath, detail.meta.filePath);
    assert.ok(detail.timeline[0].promptLog?.raw.includes('"uuid":"u1"'));
    // A prompt that is nothing but a reminder has no user-visible text, but
    // its line is still linkable.
    assert.equal(detail.timeline[1].promptPreview, null);
    assert.equal(detail.timeline[1].promptLog?.line, 3);
  });
});
