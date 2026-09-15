# 007 — Pair subagent transcripts to `Task` calls by chronological order, not filesystem/array order

## Status

- **Priority:** P2
- **Effort:** S
- **Risk:** Low
- **Depends on:** none (plan 008 in this same `plans/` directory also touches
  `buildSessionDetail`'s region of `server/parser.ts`, though a different
  part of it — see that plan's dependency note; no ordering constraint is
  required between 007 and 008, but doing 007 first is slightly preferred to
  keep each diff small and independently reviewable)
- **Category:** Correctness / bug
- **Planned at commit:** `3aac79e`
- **Issue:** (none filed)

## Why this matters

When a session has more than one subagent (`Task`/`Agent`/`TaskCreate` tool
call that spawned a sub-transcript), `buildSessionDetail` in
`server/parser.ts` pairs each loaded subagent transcript to the `Task` tool
call that launched it **purely by matching array index** — the *n*th
subagent file discovered on disk gets attached to the *n*th `Task` tool call
found while walking the tree. Those two lists are built from fundamentally
different, uncorrelated orderings:

- `taskToolNodes` (the list of `Task` tool-call nodes) is built by
  `buildSessionDetail`'s own tree-walk over `rootBuild.tree`, which reflects
  the **chronological / document order** the entries appear in the
  session's JSONL file (see "Current state" below).
- `parsed.subagentFiles` (the list of loaded subagent transcripts) comes
  from `loadSubagents()`, which lists each subagent directory with Node's
  `readdir()` and never sorts the result. `readdir()` order is
  filesystem-dependent (commonly directory-entry / inode order, not
  filename or mtime order) and has no guaranteed relationship to which
  `Task` call actually launched which subagent, or to when each subagent
  ran.

When a session has 2+ subagents and the filesystem's `readdir()` order
happens to differ from launch order (which is common — it depends on
directory-entry insertion order, not name or time), this silently
**mismatches subagent transcripts to the wrong `Task` call** in the UI: the
hierarchy tree, the per-turn "subagent launches" summary
(`ContextTimelinePoint.subagentLaunches`), and the "caused by" attribution
all end up pointing at the wrong subagent's stats (wrong `peakContextTokens`,
wrong `turnCount`, wrong `toolCallCount`, wrong `agentId`/model shown for
that launch). This is silent — there's no error, no test failure today, just
wrong data shown to the user, which is exactly the kind of bug this app
(a tool for inspecting session correctness) most needs to avoid in itself.

## Current state

`server/parser.ts:1920-1931` — how `taskToolNodes` is built, in tree-walk
(chronological/document) order:

```ts
  // Attach subagent transcripts under matching Task tool calls when possible
  const taskToolNodes: TreeNode[] = [];
  const walk = (n: TreeNode) => {
    if (
      n.kind === "tool_call" &&
      (n.toolName === "Task" || n.toolName === "Agent" || n.toolName === "TaskCreate")
    ) {
      taskToolNodes.push(n);
    }
    for (const c of n.children) walk(c);
  };
  walk(rootBuild.tree);
```

`server/parser.ts:1933-1969` — the buggy pairing loop, which zips
`parsed.subagentFiles` against `taskToolNodes` by raw array index:

```ts
  const subagentByToolUseId = new Map<string, AgentBreakdownRow>();

  for (const [index, sub] of parsed.subagentFiles.entries()) {
    const subModel =
      [...sub.entries]
        .reverse()
        .find((s) => s.entry.type === "assistant" && s.entry.message?.model)
        ?.entry.message?.model ?? null;
    const built = buildAgentTreeFromEntries(sub.entries, {
      id: sub.agentId,
      label: `Subagent · ${sub.agentId}`,
      kind: "subagent",
      model: subModel,
    });

    const row: AgentBreakdownRow = {
      agentId: sub.agentId,
      label: `Subagent · ${sub.agentId}`,
      kind: "subagent",
      model: subModel,
      usage: built.usage,
      peakContextTokens: built.peak,
      toolCallCount: built.toolCalls,
      messageCount: built.messages,
      turnCount: built.turns,
      tools: agentToolSummaries(built.tools),
    };
    agentBreakdown.push(row);

    const target = taskToolNodes[index];
    if (target) {
      target.children.push(built.tree);
      if (target.toolUseId) subagentByToolUseId.set(target.toolUseId, row);
    } else {
      rootBuild.tree.children.push(built.tree);
    }
  }
```

`target = taskToolNodes[index]` is the bug: `index` comes from
`parsed.subagentFiles.entries()`, i.e. array position in `loadSubagents()`'s
unsorted result, not from anything about which `Task` call actually launched
`sub`.

`server/parser.ts:367-402` — `loadSubagents`, confirming no sort is applied
to `readdir()`'s result (full function):

```ts
async function loadSubagents(
  sessionFilePath: string,
): Promise<{ agentId: string; filePath: string; entries: SourcedEntry[] }[]> {
  const results: { agentId: string; filePath: string; entries: SourcedEntry[] }[] =
    [];
  const seen = new Set<string>();

  for (const dir of subagentDirsForSession(sessionFilePath)) {
    let st;
    try {
      st = await stat(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;

    let files: string[] = [];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const filePath = path.join(dir, file);
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      const agentId = file.replace(/\.jsonl$/, "").replace(/^agent-/, "");
      const entries = await readEntries(filePath);
      results.push({ agentId, filePath, entries });
    }
  }

  return results;
}
```

`files = await readdir(dir)` — Node's `readdir()` makes no ordering
guarantee; it returns whatever order the underlying filesystem call
provides. Nothing between this point and the pairing loop in
`buildSessionDetail` ever sorts `results`/`parsed.subagentFiles`.

`server/parser.ts:1874-1877` — `buildSessionDetail`'s exact signature (for
reference, unchanged by this plan):

```ts
export function buildSessionDetail(
  file: DiscoveredSessionFile,
  parsed: RawSessionParse,
): SessionDetail {
```

`server/parser.ts:88-104` — `RawSessionParse`, the exported interface this
plan's new test constructs synthetically (full interface, unchanged by this
plan):

```ts
export interface RawSessionParse {
  summary: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  messageCount: number;
  turnCount: number;
  subagentTurnCount: number;
  toolCallCount: number;
  subagentCount: number;
  model: string | null;
  gitBranch: string | null;
  cwd: string | null;
  usage: TokenUsage;
  peakContextTokens: number;
  entries: SourcedEntry[];
  subagentFiles: { agentId: string; filePath: string; entries: SourcedEntry[] }[];
}
```

`server/parser.ts:50-86` — `RawEntry` and `SourcedEntry` (the (non-exported)
shapes the new test's fixture entries must satisfy structurally — you do not
need to import `SourcedEntry` by name, since TypeScript checks object
literals against `RawSessionParse`'s fields structurally):

```ts
interface RawEntry {
  type?: string;
  subtype?: string;
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  summary?: string;
  isSidechain?: boolean;
  agentId?: string;
  slug?: string;
  message?: {
    role?: string;
    model?: string;
    content?: string | ContentBlock[];
    usage?: RawUsage;
  };
  attachment?: { type?: string; subtype?: string; [key: string]: unknown };
  toolUseResult?: unknown;
  [key: string]: unknown;
}

interface SourcedEntry {
  entry: RawEntry;
  filePath: string;
  line: number;
  raw: string;
}
```

`shared/types.ts:63-80` — `TreeNode` (for reference; `agentId` is the field
the new test reads to confirm which subagent's tree attached where):

```ts
export interface TreeNode {
  id: string;
  kind: TreeNodeKind;
  label: string;
  timestamp: string | null;
  model: string | null;
  usage: TokenUsage | null;
  context: ContextDelta | null;
  preview: string | null;
  log: LogLineRef | null;
  toolName?: string;
  toolUseId?: string;
  agentId?: string;
  children: TreeNode[];
}
```

`server/parser.ts:1863-1872` — `agentToolSummaries`, the helper function
immediately preceding `buildSessionDetail`. This plan's new
`firstEntryTimeMs` helper is inserted directly after it (see Step 1), to
match this file's existing convention of small, undocumented helper
functions placed immediately above their first call site:

```ts
function agentToolSummaries(
  toolCounts: Map<string, number>,
): AgentToolSummary[] {
  return [...toolCounts.entries()]
    .map(([toolName, callCount]) => ({ toolName, callCount }))
    .sort(
      (a, b) =>
        b.callCount - a.callCount || a.toolName.localeCompare(b.toolName),
    );
}
```

Note: lines 1971-1976, immediately after the pairing loop, contain a
pre-existing dead/no-op loop:

```ts
  // Inline Task launches without separate files still show as tool nodes;
  // synthesize lightweight subagent placeholders from tool input
  for (const node of taskToolNodes) {
    if (node.children.some((c) => c.kind === "subagent")) continue;
    // look at preview / leave as tool with results only
  }
```

This loop does nothing (its body is a `continue` and a comment) — it looks
like unfinished work from a previous change. It is **out of scope** for this
plan; do not remove or "finish" it (see Scope below) — it's mentioned here
only so you don't mistake it for something this plan's fix needs to touch.

## Commands you will need

| Purpose | Command |
|---|---|
| Typecheck | `pnpm typecheck` |
| Run full test suite | `pnpm test` |

## Scope

**In scope:**
- `server/parser.ts` — add one small helper function (`firstEntryTimeMs`)
  and change the subagent-pairing loop in `buildSessionDetail` to iterate a
  chronologically-sorted copy of `parsed.subagentFiles` instead of the raw,
  unsorted array.
- `server/parser.test.ts` — add one new test (in a new `describe` block)
  that constructs a synthetic `RawSessionParse` with subagent files
  deliberately out of chronological order, and asserts they end up paired
  to the correct `Task` node.
- `package.json`'s `"test"` script — **only if** you add the new test to a
  *new* file (this plan adds it to the existing `server/parser.test.ts`,
  which is already listed in the `test` script, so no script change should
  be needed — confirm this in Step 3 rather than assuming it).

**Out of scope — do not touch:**
- Do not touch `loadSubagents()` itself (`server/parser.ts:367-402`) — do
  not add a sort inside it. The fix belongs in `buildSessionDetail`, where
  the mismatch actually happens, not in the loader (sorting only at the
  point of use is a smaller, more localized change, and keeps
  `loadSubagents`'s contract — "load whatever subagent files exist" —
  unchanged).
- Do not remove or "finish" the dead loop at (currently) lines 1971-1976 —
  see "Current state" above. It is unrelated pre-existing dead code; flag
  it in your final report instead of touching it, per this repo's own
  "don't remove pre-existing dead code unless asked" convention.
- Do not change `taskToolNodes`'s construction (the tree-walk, lines
  1920-1931) — it already produces the correct chronological reference
  order; only `subagentFiles`'s order needs fixing to match it.
- Do not attempt a more sophisticated timestamp-*proximity* matching
  algorithm (e.g. nearest Task-launch-time to each subagent's start time,
  or matching by `agentId`/description string similarity) — a simple
  ascending sort-by-first-timestamp on both sides (subagent files already
  implicitly sorted correctly by tree-walk order for `taskToolNodes`) is
  sufficient to fix the observed bug and is far lower-risk. If, while
  executing this plan, you find a real session where subagents' launch
  order and their own first-entry timestamps diverge (e.g. a subagent
  launched by the 2nd `Task` call but whose own first log entry has an
  earlier timestamp than the 1st `Task` call's subagent), STOP and report
  it rather than designing a more complex matching heuristic — that would
  be a different, larger fix than this plan authorizes.
- Do not modify `AgentBreakdownRow`, `SubagentLaunchSummary`, or any other
  shared type in `shared/types.ts`.

## Git workflow

1. Create a branch off `main`: `git checkout -b fix/subagent-task-ordering`.
2. Make the fix (Step 1) and the new test (Step 2) as a single commit —
   they are one finding with its accompanying regression test.
3. Do not push or open a PR as part of this plan unless the person running
   it tells you to — stop after the commit and report status.

## Steps

### Step 1 — Sort subagent files by first-entry timestamp before pairing

In `server/parser.ts`, add a new helper function immediately after
`agentToolSummaries` and immediately before `export function
buildSessionDetail` (i.e. insert it between the two, matching this file's
existing convention of placing small helpers right above their first call
site):

```ts
function firstEntryTimeMs(entries: SourcedEntry[]): number {
  for (const sourced of entries) {
    const ts = sourced.entry.timestamp;
    if (ts) {
      const ms = Date.parse(ts);
      if (!Number.isNaN(ms)) return ms;
    }
  }
  return Number.POSITIVE_INFINITY;
}
```

(Entries with no valid timestamp anywhere sort last, via `Infinity`, and
keep their relative order among themselves — `Array.prototype.sort` in
modern V8/Node is stable — rather than being dropped or erroring.)

Then, inside `buildSessionDetail`, change:

```ts
  const subagentByToolUseId = new Map<string, AgentBreakdownRow>();

  for (const [index, sub] of parsed.subagentFiles.entries()) {
```

to:

```ts
  const subagentByToolUseId = new Map<string, AgentBreakdownRow>();

  const sortedSubagentFiles = [...parsed.subagentFiles].sort(
    (a, b) => firstEntryTimeMs(a.entries) - firstEntryTimeMs(b.entries),
  );

  for (const [index, sub] of sortedSubagentFiles.entries()) {
```

Nothing else in the loop body changes — the rest of the loop (building
`subModel`, `built`, `row`, pushing to `agentBreakdown`, the
`target = taskToolNodes[index]` pairing, and the `else` branch) is
unchanged; only the array being iterated changes from
`parsed.subagentFiles` to the new sorted copy.

**Verify:** `pnpm typecheck` — must exit 0 with no new type errors.

### Step 2 — Add a regression test

Add a new test to `server/parser.test.ts`. First, update its imports at the
top of the file from:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { parseSessionFile, buildSessionDetail } from "./parser.js";
import { decodeProjectPath, fixtureRoot } from "./sessions.js";
import { contextSize, totalTokens } from "../shared/types.js";
```

to:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import {
  parseSessionFile,
  buildSessionDetail,
  emptyUsage,
  type RawSessionParse,
} from "./parser.js";
import { decodeProjectPath, fixtureRoot, type DiscoveredSessionFile } from "./sessions.js";
import { contextSize, totalTokens } from "../shared/types.js";
```

(only the `parser.js` and `sessions.js` import lines change — adding
`emptyUsage`, `type RawSessionParse`, and `type DiscoveredSessionFile` to
their respective existing import statements; `contextSize`/`totalTokens`'s
import line is untouched).

Then add this new `describe` block at the end of the file (after the
closing of the existing `describe("fixture session parse", ...)` block —
i.e. as a new top-level block, not nested inside it):

```ts
describe("buildSessionDetail subagent ordering", () => {
  it("pairs subagent files to Task calls by chronological order, not array index", () => {
    const sourced = (entry: Record<string, unknown>, line: number) => ({
      entry,
      filePath: "/tmp/synthetic-session.jsonl",
      line,
      raw: JSON.stringify(entry),
    });

    const taskAEntry = {
      type: "assistant",
      uuid: "a1",
      timestamp: "2024-01-01T00:00:01.000Z",
      message: {
        role: "assistant",
        model: "root-model",
        content: [
          {
            type: "tool_use",
            id: "toolu_task_a",
            name: "Task",
            input: { description: "Task A" },
          },
        ],
      },
    };
    const taskBEntry = {
      type: "assistant",
      uuid: "a2",
      timestamp: "2024-01-01T00:00:02.000Z",
      message: {
        role: "assistant",
        model: "root-model",
        content: [
          {
            type: "tool_use",
            id: "toolu_task_b",
            name: "Task",
            input: { description: "Task B" },
          },
        ],
      },
    };

    const subAEntry = {
      type: "assistant",
      uuid: "sub-a1",
      timestamp: "2024-01-01T00:00:01.500Z",
      message: {
        role: "assistant",
        model: "model-a",
        content: [{ type: "text", text: "hi from A" }],
      },
    };
    const subBEntry = {
      type: "assistant",
      uuid: "sub-b1",
      timestamp: "2024-01-01T00:00:02.500Z",
      message: {
        role: "assistant",
        model: "model-b",
        content: [{ type: "text", text: "hi from B" }],
      },
    };

    const parsed: RawSessionParse = {
      summary: null,
      startedAt: null,
      updatedAt: null,
      messageCount: 0,
      turnCount: 2,
      subagentTurnCount: 0,
      toolCallCount: 2,
      subagentCount: 2,
      model: "root-model",
      gitBranch: null,
      cwd: "/tmp",
      usage: emptyUsage(),
      peakContextTokens: 0,
      entries: [sourced(taskAEntry, 1), sourced(taskBEntry, 2)],
      // Deliberately out of chronological order: index 0 is agent-B's file
      // (its own entries start at 2.5s) and index 1 is agent-A's file (its
      // own entries start earlier, at 1.5s). This mirrors loadSubagents()
      // returning raw, unsorted readdir() order that doesn't match launch
      // order.
      subagentFiles: [
        {
          agentId: "agent-B",
          filePath: "/tmp/agent-B.jsonl",
          entries: [sourced(subBEntry, 1)],
        },
        {
          agentId: "agent-A",
          filePath: "/tmp/agent-A.jsonl",
          entries: [sourced(subAEntry, 1)],
        },
      ],
    };

    const file: DiscoveredSessionFile = {
      id: "synthetic-session",
      projectEncoded: "-tmp",
      projectPath: "/tmp",
      filePath: "/tmp/synthetic-session.jsonl",
      source: "fixture",
      mtimeMs: Date.now(),
      size: 1,
    };

    const detail = buildSessionDetail(file, parsed);

    const taskNodes: (typeof detail.tree)[] = [];
    const walk = (n: typeof detail.tree) => {
      if (n.kind === "tool_call" && n.toolName === "Task") taskNodes.push(n);
      for (const c of n.children) walk(c);
    };
    walk(detail.tree);

    const taskANode = taskNodes.find((n) => n.toolUseId === "toolu_task_a");
    const taskBNode = taskNodes.find((n) => n.toolUseId === "toolu_task_b");
    assert.ok(taskANode, "expected a Task tool_call node for toolu_task_a");
    assert.ok(taskBNode, "expected a Task tool_call node for toolu_task_b");

    const subagentUnder = (node: typeof taskANode) =>
      node?.children.find((c) => c.kind === "subagent");

    // Task A launched first (1.0s) and agent-A's own entries start at 1.5s —
    // earlier than agent-B's (2.5s) — so agent-A's tree must attach under
    // Task A's node, not agent-B's, regardless of subagentFiles' array order.
    assert.equal(subagentUnder(taskANode)?.agentId, "agent-A");
    assert.equal(subagentUnder(taskANode)?.model, "model-a");
    assert.equal(subagentUnder(taskBNode)?.agentId, "agent-B");
    assert.equal(subagentUnder(taskBNode)?.model, "model-b");
  });
});
```

**Verify:** `pnpm test` — the new test must pass. To confirm the test would
have actually caught the bug (not just pass trivially), temporarily revert
Step 1's loop change only (put back
`for (const [index, sub] of parsed.subagentFiles.entries()) {`, keep the
`firstEntryTimeMs` helper unused) and re-run `pnpm test` — the new test must
**fail** in that state, confirming it exercises the bug. Then re-apply
Step 1's fix and confirm the test passes again before committing.

### Step 3 — Confirm no test-script change is needed

`server/parser.test.ts` is already listed in `package.json`'s `"test"`
script (this plan adds a test to that existing file, not a new file), so no
`package.json` edit should be required. Run:

```
grep -n "server/parser.test.ts" package.json
```

**Verify:** this prints a match (confirming the file is already covered).
If it does *not* print a match — meaning `package.json`'s `test` script
changed since this plan was written and no longer lists
`server/parser.test.ts` — STOP and report that discrepancy rather than
silently adding it back, since something else about the test setup may
have changed too.

### Step 4 — Full verification

```
pnpm typecheck
pnpm test
pnpm build
```

**Verify:** all three exit 0. `pnpm test`'s pass count should be exactly one
higher than the pre-plan baseline (this plan adds exactly one new test, no
new file, no `describe` block removed).

## Test plan

Covered by Step 2 above: one new test in `server/parser.test.ts`, in a new
`describe("buildSessionDetail subagent ordering", ...)` block, using a
fully synthetic `RawSessionParse` (not a fixture file) with two subagents
whose `subagentFiles` array order is deliberately reversed relative to
their own entries' timestamps and relative to the two `Task` calls'
document order. This is necessary because the bug's root cause
(`readdir()` order) is filesystem-dependent and cannot be deterministically
or portably forced via a real fixture directory in a unit test — see "Why
this matters" above.

The Step 2 Verify instructions include an explicit revert-and-confirm-fail
check — do not skip it; a test that "passes" without ever having been
confirmed to fail against the pre-fix code is not proven to test anything.

## Done criteria

- [ ] `server/parser.ts` contains a `firstEntryTimeMs(entries: SourcedEntry[]): number`
      function, placed between `agentToolSummaries` and `buildSessionDetail`.
- [ ] Inside `buildSessionDetail`, the subagent-pairing loop iterates a new
      `sortedSubagentFiles` array (sorted ascending by
      `firstEntryTimeMs(sub.entries)`) instead of `parsed.subagentFiles`
      directly. The loop body itself (everything between `for (...)  {` and
      the closing `}`) is otherwise byte-for-byte unchanged from before this
      plan.
- [ ] `server/parser.test.ts` contains a new
      `describe("buildSessionDetail subagent ordering", ...)` block with
      the test from Step 2, and its imports include `emptyUsage`,
      `type RawSessionParse`, and `type DiscoveredSessionFile`.
- [ ] The new test was confirmed to fail against the pre-fix pairing logic
      and pass against the post-fix logic (per Step 2's Verify) — note this
      confirmation explicitly in your final report.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` exits 0, with exactly one more passing test than the
      pre-plan baseline.
- [ ] `pnpm build` exits 0.
- [ ] `git diff --stat` shows changes in exactly 2 files: `server/parser.ts`
      and `server/parser.test.ts`.

## STOP conditions

- If, while investigating, you find that `taskToolNodes`'s tree-walk order
  (lines 1920-1931) is *not* actually chronological for some real session
  (e.g. some structural reason the walk order diverges from timestamp
  order), STOP and report it — this plan's fix assumes `taskToolNodes` is
  already in the correct reference order and only `subagentFiles` needs
  sorting to match it; if that assumption is wrong, the fix needs to sort
  (or otherwise correct) `taskToolNodes` too, which is a different, larger
  change.
- If a real subagent transcript has **no** entry with a parseable
  `timestamp` at all (so `firstEntryTimeMs` returns `Infinity` for it), and
  there are two or more such subagents in the same session, they will sort
  after all timestamped ones but retain their original (still arbitrary)
  relative order among themselves — this is a known, accepted limitation
  of the simple fix (see Scope above); do not treat this case alone as a
  reason to STOP, just note it in your final report if you observe it in a
  real session during manual testing.
- If Step 2's revert-and-confirm-fail check does *not* actually fail on the
  pre-fix code, STOP — that means the test fixture doesn't actually
  exercise the bug (e.g. a mistake in the deliberately-reversed ordering),
  and the test needs to be redesigned before this plan can be considered
  done, since an unproven regression test provides no real protection.

## Maintenance notes

- If subagent files ever gain a more reliable ordering signal than
  "timestamp of first entry" (e.g. the transcript format starts recording
  which `Task` `tool_use_id` spawned each subagent file directly, removing
  the need to infer pairing at all), prefer switching to that direct
  reference over this timestamp-sort heuristic — it would be strictly more
  correct.
- This plan's fix and plan 008 (which unifies the four duplicated
  `assistantIndex` fallback-id counters in this file) both touch
  `server/parser.ts`, but different, non-overlapping regions of it (this
  plan touches only the subagent-pairing loop and adds one new helper;
  plan 008 touches the four `assistantIndex` counter sites elsewhere in the
  file) — no specific ordering between 007 and 008 is required, but review
  each diff independently since both change `server/parser.ts`.
- The dead loop noted in "Current state" above (lines 1971-1976 as of
  commit `3aac79e`) remains untouched and unrelated — it was flagged during
  this plan's research but is out of scope here; consider it as a
  candidate for a future small cleanup plan.
