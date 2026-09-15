# 001 — Fix context-bar tooltip including output tokens, add test coverage for `buildUsageParts`

## Status

- **Priority:** P1
- **Effort:** S
- **Risk:** Low
- **Depends on:** none
- **Category:** Correctness / Test coverage
- **Planned at commit:** `3aac79e`
- **Issue:** (none filed)

## Why this matters

`src/components/ContextChart.tsx` renders one bar per assistant turn, sized by
`point.contextTokens` (the tokens actually occupying the model's context
window: input + cache-write + cache-read). Hovering a bar shows a tooltip
breaking that bar down into colored segments via `BarTooltipContent`.

The breakdown source, `buildUsageParts()` (in
`src/lib/contextUsageParts.ts`), returns **four** parts — input, cache write,
cache read, and **output** — each tagged with an `inContext: boolean` field.
Output tokens are billed but do **not** occupy context (they're the model's
reply, not something stored in the window), so `inContext: false` for that
part only.

`ContextChart.tsx`'s tooltip filters parts with `.filter((p) => p.value > 0)`
— it does **not** check `inContext`. That means whenever a turn has output
tokens, the tooltip's colored segment bar includes an "Output" slice sized
against `partsTotal` (which itself also wrongly includes the output value),
while the bar's own height and the header text ("Turn N: X context") are
sized only from `point.contextTokens` (input + cache-write + cache-read).
The result: the percentages in the tooltip's mini composition bar don't sum
to what the header claims, and every segment's proportion is diluted by an
unrelated "billed but not in context" number.

The correct pattern already exists two files away:
`src/components/TurnDetailPanel.tsx:46` filters with
`.filter((p) => p.inContext && p.value > 0)`, and its bar is captioned
"Context composition bar" — consistent with what it actually shows. This
plan brings `ContextChart.tsx` in line with that existing, correct
convention.

Separately, `buildUsageParts()` is a small pure function with real branching
behavior (four fixed fields, one of which is deliberately excluded from
context accounting) and currently has **zero test coverage** — not in
`package.json`'s `test` script, and no `src/lib/contextUsageParts.test.ts`
file exists. This plan adds that missing coverage in the same change, since
a test on the `inContext` flag is exactly what would have caught this bug
and is what will keep it from regressing.

## Current state

`src/lib/contextUsageParts.ts` (full file, 52 lines) — the function under test:

```ts
import type { ContextTimelinePoint } from "@shared/types";
import type { UsagePartColors } from "../theme";

export interface UsagePart {
  key: string;
  label: string;
  hint: string;
  value: number;
  color: string;
  inContext: boolean;
}

/** Composition of a context timeline point's token usage, for the turn detail panel and bar hover. */
export function buildUsageParts(
  point: ContextTimelinePoint,
  colors: UsagePartColors,
): UsagePart[] {
  return [
    {
      key: "input",
      label: "Input (uncached)",
      hint: "Fresh prompt tokens not served from cache",
      value: point.inputTokens,
      color: colors.input,
      inContext: true,
    },
    {
      key: "cache+",
      label: "Cache write",
      hint: "Tokens written into prompt cache this turn (often the big first-turn number)",
      value: point.cacheCreationTokens,
      color: colors.cacheWrite,
      inContext: true,
    },
    {
      key: "cache",
      label: "Cache read",
      hint: "Tokens reused from prompt cache",
      value: point.cacheReadTokens,
      color: colors.cacheRead,
      inContext: true,
    },
    {
      key: "out",
      label: "Output",
      hint: "Model reply tokens (billed, but not part of ctx occupancy)",
      value: point.outputTokens,
      color: colors.output,
      inContext: false,
    },
  ];
}
```

`src/components/ContextChart.tsx:15-35` — the buggy call site:

```tsx
function BarTooltipContent({
  point,
  prevTokens,
  turnIndex,
  colors,
  subagentColor,
  selectable,
}: {
  point: ContextTimelinePoint;
  prevTokens: number;
  turnIndex: number;
  colors: ReturnType<typeof usagePartColors>;
  subagentColor: string;
  selectable: boolean;
}) {
  const delta = point.contextTokens - prevTokens;
  const parts = buildUsageParts(point, colors).filter((p) => p.value > 0);
  const partsTotal = Math.max(
    parts.reduce((sum, p) => sum + p.value, 0),
    1,
  );
```

Line 31 is the bug: `.filter((p) => p.value > 0)` should be
`.filter((p) => p.inContext && p.value > 0)`.

The correct, existing reference pattern —
`src/components/TurnDetailPanel.tsx:43-51`:

```tsx
  const parts = buildUsageParts(point, colors);
  const subagentStyle = nodeKindStyle(theme, "subagent");

  const contextParts = parts.filter((p) => p.inContext && p.value > 0);
  const contextTotal = Math.max(
    point.contextTokens,
    contextParts.reduce((sum, p) => sum + p.value, 0),
    1,
  );
```

Note `TurnDetailPanel.tsx` uses two different variables: `parts` (all four,
unfiltered — used later at line 156 to render every row including "Output ·
billed only") and `contextParts` (filtered — used only for the composition
bar width). `ContextChart.tsx`'s `BarTooltipContent` has no equivalent of
`parts` unfiltered — it only ever needs the filtered set, both for the mini
bar and for `partsTotal`. So the minimal fix is to filter at the same site
where `parts` is currently assigned, not to introduce a second variable.

Relevant types, `shared/types.ts:243-261`:

```ts
export interface ContextTimelinePoint {
  turn: number;
  /** Matches the assistant TreeNode.id for hierarchy focus */
  nodeId: string;
  timestamp: string | null;
  label: string;
  contextTokens: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  toolName: string | null;
  /** Source JSONL line for this assistant turn */
  log: LogLineRef;
  /** Tool call(s) whose results this turn's context growth is attributed to */
  causedBy: ToolImpactCall[];
  /** Non-empty if this turn launched a subagent (Task/Agent/TaskCreate) */
  subagentLaunches: SubagentLaunchSummary[];
}
```

`shared/types.ts:9-15`:

```ts
export interface LogLineRef {
  filePath: string;
  /** 1-based line number in the JSONL file */
  line: number;
  /** Exact JSONL line text */
  raw: string;
}
```

`src/theme/tokens.ts:65-80` — `UsagePartColors` is a flat object, no `Theme`
needed to construct one for a test:

```ts
export interface UsagePartColors {
  input: string;
  cacheWrite: string;
  cacheRead: string;
  output: string;
}

export function usagePartColors(theme: Theme): UsagePartColors {
  const palette = schemePalette(theme);
  return {
    input: palette.primary.main,
    cacheWrite: palette.success.main,
    cacheRead: palette.secondary.main,
    output: palette.warning.main,
  };
}
```

`package.json:22` — the test script is a **fixed file list, not a glob**:

```json
"test": "tsx --test server/parser.test.ts server/analyze.test.ts server/analysisCache.test.ts server/runAnalyzeWithCache.test.ts shared/formatAnalysisPrompt.test.ts src/lib/tree.test.ts src/lib/sessionFilters.test.ts src/lib/sessionSort.test.ts src/components/AgentToolDiagram.test.ts src/theme/tokens.test.ts"
```

Any new test file must be appended to this exact string, or `pnpm test`
will silently never run it.

Existing test-file convention to follow, `src/lib/tree.test.ts:1-36` (full
header + fixture helper):

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TreeNode } from "@shared/types";
import {
  collectExpandableIds,
  collectExpandableIdsBelowDepth,
  findAncestorIds,
  findFirstToolCallByName,
  findNode,
  findNodePath,
  findOwningAgentId,
  findToolCallNodeId,
} from "./tree";

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
    timestamp: null,
    model: null,
    usage: null,
    context: null,
    preview: null,
    log: null,
    agentId: partial.agentId,
    toolUseId: partial.toolUseId,
    toolName: partial.toolName,
    children: partial.children ?? [],
  };
}
```

This repo uses Node's built-in test runner (`node:assert/strict` +
`node:test`'s `describe`/`it`), a small local fixture-builder function with
sensible defaults (not a test-fixture library), and one `.test.ts` file per
source file, colocated in the same directory.

## Commands you will need

| Purpose | Command |
|---|---|
| Install deps (only if `node_modules` missing) | `pnpm install` |
| Typecheck | `pnpm typecheck` |
| Run full test suite | `pnpm test` |
| Run only the new test file directly (fast iteration) | `npx tsx --test src/lib/contextUsageParts.test.ts` |

## Scope

**In scope:**
- `src/components/ContextChart.tsx` — one-line filter fix.
- `src/lib/contextUsageParts.test.ts` — new file, tests for `buildUsageParts`.
- `package.json` — append the new test file to the `test` script.

**Out of scope — do not touch:**
- `src/lib/contextUsageParts.ts` itself. The function is already correct;
  only its unfiltered consumer (`ContextChart.tsx`) has the bug. Do not
  refactor `buildUsageParts` or extract a shared `contextParts`/`partsTotal`
  helper between `ContextChart.tsx` and `TurnDetailPanel.tsx` — that is a
  larger, separate refactor not requested here. Make the minimal one-line
  fix only.
- `src/components/TurnDetailPanel.tsx` — already correct (line 46), included
  in this plan only as a reference pattern to match, not to edit.
- Any other filter/tooltip logic in `ContextChart.tsx` (bar height, color
  selection, subagent dot, etc.) — unrelated to this bug.

## Git workflow

1. Create a branch off `main`: `git checkout -b fix/context-bar-incontext-filter`.
2. Make the changes described in Steps below as a single commit.
3. Do not push or open a PR as part of this plan unless the person running
   it tells you to — stop after the commit and report status.

## Steps

### Step 1 — Fix the filter in `ContextChart.tsx`

In `src/components/ContextChart.tsx`, change line 31 from:

```tsx
  const parts = buildUsageParts(point, colors).filter((p) => p.value > 0);
```

to:

```tsx
  const parts = buildUsageParts(point, colors).filter((p) => p.inContext && p.value > 0);
```

This is the only line to change in this file. Do not touch anything else
in `BarTooltipContent` or elsewhere in the file.

**Verify:** `pnpm typecheck` — must exit 0 with no new errors.

### Step 2 — Add the new test file

Create `src/lib/contextUsageParts.test.ts` with the following content. It
follows the `src/lib/tree.test.ts` convention (Node's built-in
`node:test`/`node:assert/strict`, a local fixture-builder function with
defaults):

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ContextTimelinePoint } from "@shared/types";
import type { UsagePartColors } from "../theme";
import { buildUsageParts } from "./contextUsageParts";

const colors: UsagePartColors = {
  input: "#111111",
  cacheWrite: "#222222",
  cacheRead: "#333333",
  output: "#444444",
};

function point(partial: Partial<ContextTimelinePoint> = {}): ContextTimelinePoint {
  return {
    turn: 0,
    nodeId: "assistant-0",
    timestamp: null,
    label: "turn",
    contextTokens: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 0,
    toolName: null,
    log: { filePath: "fixture.jsonl", line: 1, raw: "{}" },
    causedBy: [],
    subagentLaunches: [],
    ...partial,
  };
}

describe("buildUsageParts", () => {
  it("returns one part per token category, in a fixed order", () => {
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
      parts.map((p) => p.key),
      ["input", "cache+", "cache", "out"],
    );
    assert.deepEqual(parts.map((p) => p.value), [10, 20, 30, 40]);
  });

  it("marks input, cache write, and cache read as in-context", () => {
    const parts = buildUsageParts(point(), colors);
    const inContextKeys = parts.filter((p) => p.inContext).map((p) => p.key);
    assert.deepEqual(inContextKeys, ["input", "cache+", "cache"]);
  });

  it("marks output as not in-context, since it is billed but not context occupancy", () => {
    const parts = buildUsageParts(point(), colors);
    const out = parts.find((p) => p.key === "out");
    assert.ok(out);
    assert.equal(out.inContext, false);
  });

  it("wires each part's color from the supplied UsagePartColors", () => {
    const parts = buildUsageParts(point(), colors);
    assert.deepEqual(
      parts.map((p) => p.color),
      [colors.input, colors.cacheWrite, colors.cacheRead, colors.output],
    );
  });

  it("filtering by inContext excludes output tokens from a context total", () => {
    const parts = buildUsageParts(
      point({
        inputTokens: 10,
        cacheCreationTokens: 20,
        cacheReadTokens: 30,
        outputTokens: 1000,
      }),
      colors,
    );
    const contextParts = parts.filter((p) => p.inContext && p.value > 0);
    const contextTotal = contextParts.reduce((sum, p) => sum + p.value, 0);
    assert.equal(contextTotal, 60);
  });
});
```

**Verify:** `npx tsx --test src/lib/contextUsageParts.test.ts` — all 5 tests
pass, 0 failures.

### Step 3 — Wire the new test file into `pnpm test`

In `package.json`, find the `"test"` script (currently a single-line string
listing every test file explicitly — it is **not** a glob, so a new file is
invisible to `pnpm test` unless added here). Append
`src/lib/contextUsageParts.test.ts` to the end of that space-separated list,
so the value becomes:

```json
"test": "tsx --test server/parser.test.ts server/analyze.test.ts server/analysisCache.test.ts server/runAnalyzeWithCache.test.ts shared/formatAnalysisPrompt.test.ts src/lib/tree.test.ts src/lib/sessionFilters.test.ts src/lib/sessionSort.test.ts src/components/AgentToolDiagram.test.ts src/theme/tokens.test.ts src/lib/contextUsageParts.test.ts"
```

Only append to the end of the existing list — do not reorder or remove any
existing entry.

**Verify:** `pnpm test` — must report all previously-passing tests still
passing (64 existing + 5 new = 69 total), 0 failures.

## Test plan

- New file `src/lib/contextUsageParts.test.ts` (Step 2) is the entire test
  plan for this change — `buildUsageParts` is a pure function with no
  side effects, so a direct unit test is sufficient; no component-level or
  integration test is needed for the one-line `ContextChart.tsx` fix, since
  the fix is exercised transitively through `buildUsageParts`'s own
  `inContext` field, which is now under direct test.
- No existing test currently imports or renders `ContextChart.tsx` (confirm
  with `grep -rn "ContextChart" --include="*.test.ts*" .` returning no
  matches before starting, to make sure this plan isn't missing a test that
  needs updating). If that grep *does* find a match, STOP and re-read this
  plan's assumptions — report back rather than improvising a fix to an
  existing test.

## Done criteria

- [ ] `src/components/ContextChart.tsx` line with `buildUsageParts(point, colors).filter(...)` reads `.filter((p) => p.inContext && p.value > 0)`.
- [ ] `src/lib/contextUsageParts.test.ts` exists and exports no runtime code (test-only file).
- [ ] `package.json`'s `"test"` script string ends with `... src/theme/tokens.test.ts src/lib/contextUsageParts.test.ts"`.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` exits 0 and reports 69 passing tests (64 pre-existing + 5 new), 0 failing.
- [ ] `git diff --stat` shows changes in exactly 3 files: `src/components/ContextChart.tsx`, `package.json`, and the new `src/lib/contextUsageParts.test.ts`.

## STOP conditions

- If `grep -rn "ContextChart" --include="*.test.ts*" .` finds an existing
  test file for `ContextChart.tsx`, stop before Step 1 and report back —
  this plan assumed no such test exists; one existing would need its own
  update and wasn't accounted for.
- If `pnpm test`'s baseline (before any change in this plan) is not exactly
  64 passing tests, stop and report the actual baseline number instead of
  assuming this plan's "69 total" done-criterion is still correct — the
  repo may have changed since this plan was written (planned at commit
  `3aac79e`).
- If `buildUsageParts`'s signature or field names in
  `src/lib/contextUsageParts.ts` differ from the excerpt in this plan's
  "Current state" section, stop — the plan was written against a specific
  version of that file and a drifted signature invalidates the test code
  above.

## Maintenance notes

- Any future new token category added to `buildUsageParts` (e.g. a
  hypothetical "cache eviction" part) must also decide its `inContext`
  value deliberately — this is the exact field this plan's tests pin down,
  so a new part with a wrong default will show up as a test needing an
  update, not a silent bug.
- `ContextChart.tsx`'s `BarTooltipContent` and `TurnDetailPanel.tsx` both
  independently call `buildUsageParts` and independently filter by
  `inContext`. If a future change touches one of these two call sites,
  check the other one too — they are not sharing a helper (deliberately, per
  this plan's scope), so a fix in one will not propagate to the other.
