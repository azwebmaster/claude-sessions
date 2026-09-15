# 008 — Deduplicate the 4 independent `assistant-${assistantIndex}` fallback-id formulas

## Status

- **Priority:** P2
- **Effort:** S
- **Risk:** Low
- **Depends on:** none required, but see Maintenance notes — plans 005 and
  007 in this same `plans/` directory also touch lines inside two of the
  four functions this plan changes (`buildLoadedContext` for plan 005,
  `buildSessionDetail`'s subagent-pairing loop for plan 007, which is
  adjacent to but not inside `buildAgentTreeFromEntries`). To minimize merge
  conflicts, execute this plan **after** plan 005 if both are being done —
  plan 005 edits the very top of `buildLoadedContext` (adding a `Map`), and
  this plan edits a few lines further down in the same function (the
  fallback-id formula); doing 005 first avoids this plan's diff needing to
  be rebased across that insertion.
- **Category:** Tech debt / maintainability
- **Planned at commit:** `3aac79e`
- **Issue:** (none filed)

## Why this matters

`server/parser.ts` computes a fallback node id for assistant transcript
entries — used when an entry has no `uuid` field — with the exact same
formula, independently re-typed, in **four separate functions**:

```ts
entry.uuid ?? `assistant-${assistantIndex}`
```

each paired with its own independently-declared and independently-
incremented `let assistantIndex = 0;` counter. The four sites (confirmed via
`grep -n "assistant-\${assistantIndex}\|let assistantIndex" server/parser.ts`
against commit `3aac79e`):

| Function | Counter declared | Formula used |
|---|---|---|
| `buildToolImpact` | line 577 | line 581 |
| `buildLoadedContext` | line 940 | line 1430 |
| `buildTimeline` | line 1545 | line 1549 |
| `buildAgentTreeFromEntries` | line 1628 | line 1716 (inline, as a `TreeNode.id`) |

This is copy-pasted logic, not four independent designs — all four exist to
answer the same question ("what id represents this assistant entry when it
has no transcript `uuid`?") and all four must stay in agreement, because
`nodeId`/`id` values produced by one function are looked up by `nodeId` in
another (e.g. `buildLoadedContext`'s `nodeId` values are looked up against
`buildTimeline`'s `timeline` array by `nodeId` — see plan 005 in this same
directory, which documents and relies on this cross-function agreement for
its own fix). Today they happen to agree because they were copy-pasted
identically, but nothing enforces that they stay in agreement if one is ever
edited without noticing the other three — e.g. someone changes the fallback
format in `buildTimeline` to fix an edge case and doesn't realize the exact
same string format is depended on by `buildLoadedContext`'s lookups
elsewhere in the file. Extracting one shared helper removes that class of
future bug entirely, for a small, low-risk, behavior-preserving refactor.

## Current state

All four sites, confirmed by direct reads against commit `3aac79e`:

**1. `buildToolImpact`**, `server/parser.ts:577-582`:

```ts
  let assistantIndex = 0;

  for (const { entry } of sourcedEntries) {
    if (entry.type === "assistant") {
      const nodeId = entry.uuid ?? `assistant-${assistantIndex}`;
      assistantIndex += 1;
```

**2. `buildLoadedContext`**, `server/parser.ts:940` (counter) and
`server/parser.ts:1429-1431` (formula — note this is ~490 lines below the
counter declaration, inside the same function's main loop):

```ts
  const inventory = new Map<string, LoadedContextItem>();
  const snapshots = new Map<string, TurnLoadedContext>();
  let assistantIndex = 0;
```

```ts
    if (entry.type === "assistant") {
      const nodeId = entry.uuid ?? `assistant-${assistantIndex}`;
      assistantIndex += 1;
      const u = toUsage(entry.message?.usage);
```

**3. `buildTimeline`**, `server/parser.ts:1544-1550`:

```ts
  let turn = 0;
  let assistantIndex = 0;
  for (const sourced of sourcedEntries) {
    const entry = sourced.entry;
    if (entry.type !== "assistant") continue;
    const nodeId = entry.uuid ?? `assistant-${assistantIndex}`;
    assistantIndex += 1;
```

**4. `buildAgentTreeFromEntries`**, `server/parser.ts:1628` (counter) and
`server/parser.ts:1715-1720,1734` (formula — used directly as a `TreeNode`'s
`id` field, not first assigned to a local `nodeId` variable like the other
three):

```ts
  let assistantIndex = 0;
  let lastContext: number | null = null;
```

```ts
      const assistantNode: TreeNode = {
        id: entry.uuid ?? `assistant-${assistantIndex}`,
        kind: "assistant_message",
        label: tools.length ? `Assistant · ${tools.map((t) => t.name).join(", ")}` : "Assistant",
        timestamp: entry.timestamp ?? null,
        ...
      };
      assistantIndex += 1;
```

`server/parser.ts:106-119` — the file's small-helpers section, immediately
above `toUsage`, where this plan's new helper is inserted (exact text, for
placement reference):

```ts
/** Assistant entries that appear as turns on the context timeline. */
function isTimelineAssistantTurn(entry: RawEntry): boolean {
  if (entry.type !== "assistant") return false;
  const u = toUsage(entry.message?.usage);
  return totalTokens(u) > 0 || contextSize(u) > 0;
}

function toLogRef(source: SourcedEntry): LogLineRef {
  return {
    filePath: source.filePath,
    line: source.line,
    raw: source.raw,
  };
}

function toUsage(raw?: RawUsage | null): TokenUsage {
```

`server/parser.ts:50-78` — `RawEntry` interface, confirming `uuid` is
`string | undefined` (relevant to the new helper's parameter type):

```ts
interface RawEntry {
  type?: string;
  subtype?: string;
  uuid?: string;
  ...
}
```

## Commands you will need

| Purpose | Command |
|---|---|
| Typecheck | `pnpm typecheck` |
| Run full test suite | `pnpm test` |

## Scope

**In scope:**
- `server/parser.ts` only:
  - Add one new helper function, `assistantNodeId`.
  - Replace the inline `entry.uuid ?? \`assistant-${assistantIndex}\`` (or
    equivalent) expression at each of the four sites above with a call to
    the new helper. **The `let assistantIndex = 0;` counter declarations and
    their `assistantIndex += 1;` increments stay exactly where they are, in
    each of the four functions, unchanged** — this plan deduplicates the
    *formula*, not the counter itself (each function's counter is scoped to
    that function's own loop and does not need to be shared or centralized;
    see "Out of scope" below for why not).

**Out of scope — do not touch:**
- Do not attempt to centralize the four `assistantIndex` counters
  themselves into one shared precomputed structure (e.g. a single
  `Map<SourcedEntry, string>` built once per call and passed around, or a
  shared iterator). That would be a larger, higher-risk restructuring of
  each function's loop for no behavioral benefit — the counters are already
  correctly scoped (each function iterates its own `sourcedEntries`
  parameter independently, incrementing only on `"assistant"`-typed
  entries, so there's no actual duplication bug in the *counters*, only in
  the *formula string* built from them). Keep this plan mechanical and
  low-risk: one helper function, four one-line call-site substitutions.
- Do not change `buildToolImpact`, `buildLoadedContext`, `buildTimeline`, or
  `buildAgentTreeFromEntries`'s function signatures, return values, or any
  other logic in their bodies.
- Do not touch plan 005's `timelineByNodeId` Map (if plan 005 has already
  been executed) or plan 007's `firstEntryTimeMs`/`sortedSubagentFiles`
  logic (if plan 007 has already been executed) — this plan's changes are
  independent of both; if either plan's diff is already present when you
  execute this plan, work around it (i.e. your diff for `buildLoadedContext`
  should apply cleanly whether or not plan 005's Map insertion is already
  there, since they're in different parts of the function) rather than
  reverting or altering it.

## Git workflow

1. Create a branch off `main`: `git checkout -b refactor/dedupe-assistant-node-id`.
2. Make the change described in Steps below as a single commit.
3. Do not push or open a PR as part of this plan unless the person running
   it tells you to — stop after the commit and report status.

## Steps

### Step 1 — Add the shared helper

In `server/parser.ts`, insert a new function immediately after `toLogRef`
and immediately before `toUsage` (matching the existing grouping of small,
single-purpose helpers in this part of the file):

```ts
function toLogRef(source: SourcedEntry): LogLineRef {
  return {
    filePath: source.filePath,
    line: source.line,
    raw: source.raw,
  };
}

function assistantNodeId(entry: RawEntry, assistantIndex: number): string {
  return entry.uuid ?? `assistant-${assistantIndex}`;
}

function toUsage(raw?: RawUsage | null): TokenUsage {
```

(i.e. insert the new `assistantNodeId` function between the existing
`toLogRef` and `toUsage` functions; neither of those two functions' bodies
changes).

**Verify:** `pnpm typecheck` — must exit 0 (the new function is unused by
the codebase until Step 2, which is fine — TypeScript does not flag unused
top-level functions as an error by default in this repo's `tsconfig.json`;
confirm this is still true by checking that `pnpm typecheck` doesn't fail on
"declared but never used" for this function specifically before proceeding,
though it likely will be used by the time you run this check since Step 2
comes right after).

### Step 2 — Replace each of the four call sites

**Site 1 — `buildToolImpact`.** Change:

```ts
    if (entry.type === "assistant") {
      const nodeId = entry.uuid ?? `assistant-${assistantIndex}`;
      assistantIndex += 1;
```

to:

```ts
    if (entry.type === "assistant") {
      const nodeId = assistantNodeId(entry, assistantIndex);
      assistantIndex += 1;
```

**Site 2 — `buildLoadedContext`.** Change:

```ts
    if (entry.type === "assistant") {
      const nodeId = entry.uuid ?? `assistant-${assistantIndex}`;
      assistantIndex += 1;
      const u = toUsage(entry.message?.usage);
```

to:

```ts
    if (entry.type === "assistant") {
      const nodeId = assistantNodeId(entry, assistantIndex);
      assistantIndex += 1;
      const u = toUsage(entry.message?.usage);
```

(If plan 005 has already been executed, this exact 3-line block is
unaffected by plan 005's change — plan 005 only inserts a line near the top
of the function and changes a `.find()` call much further down; this block
in the middle is untouched by that plan either way.)

**Site 3 — `buildTimeline`.** Change:

```ts
    if (entry.type !== "assistant") continue;
    const nodeId = entry.uuid ?? `assistant-${assistantIndex}`;
    assistantIndex += 1;
```

to:

```ts
    if (entry.type !== "assistant") continue;
    const nodeId = assistantNodeId(entry, assistantIndex);
    assistantIndex += 1;
```

**Site 4 — `buildAgentTreeFromEntries`.** Change:

```ts
      const assistantNode: TreeNode = {
        id: entry.uuid ?? `assistant-${assistantIndex}`,
        kind: "assistant_message",
```

to:

```ts
      const assistantNode: TreeNode = {
        id: assistantNodeId(entry, assistantIndex),
        kind: "assistant_message",
```

(the `assistantIndex += 1;` line that follows a few lines later, after the
`assistantNode` object literal closes, is unchanged).

None of the four `let assistantIndex = 0;` declarations change. No other
line in any of the four functions changes.

**Verify:** `pnpm typecheck` — must exit 0.

### Step 3 — Full verification

```
pnpm typecheck
pnpm test
pnpm build
```

**Verify:** all three exit 0. `pnpm test` must report the exact same pass
count as before this change — this is a pure extract-function refactor with
identical runtime behavior (the new helper computes the exact same string
the inline expression did, given the same two inputs), so zero test
behavior should differ.

## Test plan

This is a behavior-preserving refactor (same inputs produce the same
`nodeId`/`id` string as before, verified by inspection: `assistantNodeId(entry,
assistantIndex)` returns `entry.uuid ?? \`assistant-${assistantIndex}\``,
identical to every inline expression it replaces). No new test is required
— correctness is covered by the **existing** test suite continuing to pass
unchanged, since:
- `server/parser.test.ts:175-176` and surrounding assertions exercise
  `buildLoadedContext`'s and `buildTimeline`'s `nodeId` values end-to-end
  (via `detail.loadedContext`/`detail.timeline`).
- `server/parser.test.ts:62-71` exercises `buildAgentTreeFromEntries`'s
  node `id` values matching `buildTimeline`'s `nodeId` values (the
  `timelineIds`/`treeIds` cross-check).
- `server/parser.test.ts:210-222` exercises `buildToolImpact`'s
  `byTurn`-keyed-by-`nodeId` attribution end-to-end (the `causedBy`
  assertions).

If any of these fail after Step 2, that means the extracted helper's
behavior diverged from one of the four original inline expressions — STOP
and report exactly which site's diff doesn't match the "Site N" text above
character-for-character, rather than adjusting the helper to make tests
pass by accident.

## Done criteria

- [ ] `server/parser.ts` contains exactly one
      `function assistantNodeId(entry: RawEntry, assistantIndex: number): string`
      function, placed between `toLogRef` and `toUsage`.
- [ ] All four sites listed in "Current state" now call
      `assistantNodeId(entry, assistantIndex)` instead of inlining
      `entry.uuid ?? \`assistant-${assistantIndex}\``.
- [ ] No `let assistantIndex = 0;` declaration or `assistantIndex += 1;`
      increment was removed, added, or moved — all four remain exactly
      where they were, one per function.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` exits 0 with the exact same pass count as before this
      change (no test added or removed by this plan).
- [ ] `pnpm build` exits 0.
- [ ] `git diff --stat` shows exactly 1 file changed: `server/parser.ts`.
- [ ] `git diff server/parser.ts` shows exactly 5 net insertions attributable
      to the new helper (its ~3-line function body plus blank-line spacing)
      and exactly 4 one-line modifications at the call sites — no other
      lines touched.

## STOP conditions

- If any of the four "Current state" excerpts above don't match what you
  actually find in `server/parser.ts` at execution time (e.g. line numbers
  have shifted because other plans landed first, or the surrounding code
  differs from what's quoted), re-locate the site by searching for
  `` `assistant-${assistantIndex}` `` (there should be exactly 3 remaining
  inline-string occurrences plus 1 counter-only occurrence pattern once you
  start, or the full original 4 if you haven't started) rather than
  guessing — but if the *formula itself* differs from
  `entry.uuid ?? \`assistant-${assistantIndex}\`` at any site (e.g. it now
  includes a third fallback, or a different string prefix), STOP and
  report it — that would mean the four sites have already diverged from
  each other since this plan was written, and picking one arbitrary
  formula to standardize on requires a judgment call this plan doesn't
  authorize you to make silently.
- If `pnpm test` fails after Step 2 at any of the specific assertions named
  in "Test plan" above, STOP and report which one, rather than modifying
  the helper or the test to force a pass.

## Maintenance notes

- Any future function added to `server/parser.ts` that needs a fallback id
  for an assistant entry should call `assistantNodeId(entry, index)` rather
  than reintroducing a fifth inline copy of this formula.
- This plan intentionally leaves each function's own `assistantIndex`
  counter in place rather than centralizing it (see "Out of scope" above).
  If a future change finds an actual bug in how one function's counter is
  incremented (as opposed to the formula), fix that function's counter
  locally — it does not indicate the other three need the same fix, since
  each counter is independent by design (each function receives its own
  `sourcedEntries` array and walks it independently).
