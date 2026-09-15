# 005 — Replace O(n²) `timeline.find()` in `buildLoadedContext` with a precomputed Map lookup

## Status

- **Priority:** P2
- **Effort:** S
- **Risk:** Low
- **Depends on:** none
- **Category:** Performance
- **Planned at commit:** `3aac79e`
- **Issue:** (none filed)

## Why this matters

`buildLoadedContext` in `server/parser.ts` iterates every entry of a
session's transcript (`sourcedEntries` — every JSONL line in the session,
which for a long-running session can be thousands of entries), and for
every assistant entry it does:

```ts
const point = timeline.find((p) => p.nodeId === nodeId);
```

`timeline` is itself an array with one entry per **timeline-eligible**
assistant turn (built by `buildTimeline`, a separate function — see
"Current state" below) — so this is an O(entries × timeline-points) scan:
for a session with N assistant turns, this single line alone costs O(N²)
in the worst case, on top of the O(N) work the rest of the loop already
does per entry. `buildLoadedContext` is called once per `buildSessionDetail`
call (i.e. once per session-detail HTTP request / CLI `analyze` invocation)
with the **entire session's entries** and the **entire session's timeline**
— so this scales directly with session length, and long sessions are a
normal, not edge-case, use of this app (it exists specifically to visualize
long Claude Code sessions).

The fix is mechanical and low-risk: precompute a `Map<string,
ContextTimelinePoint>` keyed by `nodeId` once, before the loop, and replace
the `.find()` call with a `.get()`. This is safe because `nodeId` is
guaranteed unique within `timeline` — confirmed below.

## Current state

`server/parser.ts:932-950` — `buildLoadedContext`'s signature and the start
of its main loop:

```ts
function buildLoadedContext(
  sourcedEntries: SourcedEntry[],
  timeline: ContextTimelinePoint[],
): TurnLoadedContext[] {
  if (timeline.length === 0) return [];

  const inventory = new Map<string, LoadedContextItem>();
  const snapshots = new Map<string, TurnLoadedContext>();
  let assistantIndex = 0;
  let sawBaseline = false;
  let userMessageCount = 0;
  let assistantMessageCount = 0;

  const pendingToolCalls = new Map<
    string,
    { name: string; input: Record<string, unknown> | null; log: LogLineRef }
  >();

  for (const sourced of sourcedEntries) {
    const entry = sourced.entry;
    const log = toLogRef(sourced);
```

`server/parser.ts:1429-1431` — where `nodeId` is computed inside that same
loop, for every assistant entry (this is the 3rd of 4 duplicated
`assistantIndex`-based fallback-id formulas in this file — see plan 008 in
this same `plans/` directory, which addresses that duplication separately
and should land after this plan, per this plan's Maintenance notes):

```ts
    if (entry.type === "assistant") {
      const nodeId = entry.uuid ?? `assistant-${assistantIndex}`;
      assistantIndex += 1;
```

`server/parser.ts:1525-1529` — the O(n²) hotspot, at the end of the
`entry.type === "assistant"` branch:

```ts
        const point = timeline.find((p) => p.nodeId === nodeId);
        if (point) {
          snapshots.set(nodeId, snapshotInventory(inventory, point));
        }
      }
    }
  }

  return timeline.map(
    (point) =>
```

(the `return timeline.map(...)` on the line after the loop closes is the
start of the function's return statement — shown here only to make clear
where the loop ends; it is unrelated to this plan's change and must not be
touched).

**Uniqueness proof** — `nodeId` is guaranteed unique within `timeline`.
`buildTimeline` (the function that produces the `timeline` array passed
into `buildLoadedContext`), `server/parser.ts:1539-1588`:

```ts
function buildTimeline(
  sourcedEntries: SourcedEntry[],
): { points: ContextTimelinePoint[]; subagentToolUseIds: Map<string, string[]> } {
  const points: ContextTimelinePoint[] = [];
  const subagentToolUseIds = new Map<string, string[]>();
  let turn = 0;
  let assistantIndex = 0;
  for (const sourced of sourcedEntries) {
    const entry = sourced.entry;
    if (entry.type !== "assistant") continue;
    const nodeId = entry.uuid ?? `assistant-${assistantIndex}`;
    assistantIndex += 1;
    if (!isTimelineAssistantTurn(entry)) continue;
    ...
    points.push({
      turn,
      nodeId,
      ...
    });
  }
  return { points, subagentToolUseIds };
}
```

`assistantIndex` increments unconditionally for **every** assistant entry,
before the `isTimelineAssistantTurn` filter that decides whether a `point`
is actually pushed. That means: whenever `entry.uuid` is present, `nodeId`
is whatever the transcript's own UUID is (session JSONL entries have unique
`uuid`s by construction); whenever it's absent and the fallback
`assistant-${assistantIndex}` form is used, each fallback id is stamped with
a strictly increasing counter value that is never reused for a different
entry. Either way, no two entries — and therefore no two `points` in
`timeline` — can share a `nodeId`. A `Map<nodeId, point>` is therefore a
correct, lossless replacement for the linear `.find()`.

`shared/types.ts:243-261` — `ContextTimelinePoint`, for reference (`nodeId`
is the field in question):

```ts
export interface ContextTimelinePoint {
  turn: number;
  /** Matches the assistant TreeNode.id for hierarchy focus */
  nodeId: string;
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
- `server/parser.ts` — inside `buildLoadedContext` only: add one
  precomputed `Map`, replace the one `.find()` call site with a `.get()`.

**Out of scope — do not touch:**
- Do not touch `buildTimeline`, `buildToolImpact`, or
  `buildAgentTreeFromEntries` — they have their own separate, independent
  `assistantIndex` counters and no equivalent `.find()`-in-a-loop pattern.
  Do not attempt to unify them with `buildLoadedContext`'s counter or
  extract a shared helper here — that is a separate finding, addressed by
  plan 008 in this same `plans/` directory. This plan is scoped to the one
  performance hotspot only.
- Do not change `buildLoadedContext`'s function signature, its return
  value's shape, or any other logic inside its loop (the inventory-building
  logic, `upsertItem` calls, `pendingToolCalls`, etc. are all unrelated to
  this fix and must be left exactly as they are).
- Do not add memoization, caching, or any change outside the body of
  `buildLoadedContext`.

## Git workflow

1. Create a branch off `main`: `git checkout -b perf/buildloadedcontext-map-lookup`.
2. Make the change described in Steps below as a single commit.
3. Do not push or open a PR as part of this plan unless the person running
   it tells you to — stop after the commit and report status.

## Steps

### Step 1 — Add the precomputed Map and replace the `.find()` call

In `server/parser.ts`, inside `buildLoadedContext`, change:

```ts
function buildLoadedContext(
  sourcedEntries: SourcedEntry[],
  timeline: ContextTimelinePoint[],
): TurnLoadedContext[] {
  if (timeline.length === 0) return [];

  const inventory = new Map<string, LoadedContextItem>();
```

to:

```ts
function buildLoadedContext(
  sourcedEntries: SourcedEntry[],
  timeline: ContextTimelinePoint[],
): TurnLoadedContext[] {
  if (timeline.length === 0) return [];

  const timelineByNodeId = new Map(timeline.map((p) => [p.nodeId, p]));
  const inventory = new Map<string, LoadedContextItem>();
```

(i.e. insert exactly one new `const timelineByNodeId = ...` line; nothing
else on those lines changes).

Then change the hotspot at (originally) line 1525 from:

```ts
        const point = timeline.find((p) => p.nodeId === nodeId);
```

to:

```ts
        const point = timelineByNodeId.get(nodeId);
```

No other line in the function changes. `point`'s inferred type is
unaffected (`ContextTimelinePoint | undefined` either way), so the
`if (point) { ... }` guard immediately below needs no change.

**Verify:** `pnpm typecheck` — must exit 0 with no new type errors.

## Test plan

This is a pure performance refactor with no intended behavior change — the
`timelineByNodeId` Map is built from the exact same `timeline` array
`.find()` was already scanning, keyed by the exact field `.find()` was
already comparing. Correctness is verified by the **existing** test
`server/parser.test.ts:175-176`:

```ts
assert.ok(detail.loadedContext.length >= 1);
assert.equal(detail.loadedContext.length, detail.timeline.length);
```

and the assertions following it (lines 177-190) that inspect
`detail.loadedContext[0]` and the last entry's specific fields — these
exercise `buildLoadedContext`'s output shape and content end-to-end via
`buildSessionDetail`, and must pass unchanged after this fix, since the fix
changes only *how* `point` is looked up, not *what* is found.

Do not add a new test file for this plan — the existing coverage in
`server/parser.test.ts` already exercises the exact code path changed, and
a synthetic "large session" performance benchmark test is not requested
here and would add CI runtime for a refactor whose correctness is already
covered.

**Verify:** `pnpm test` — the full suite must report the same pass count as
before this change (no test added, none removed), 0 failures.

## Done criteria

- [ ] `server/parser.ts`'s `buildLoadedContext` contains a
      `const timelineByNodeId = new Map(timeline.map((p) => [p.nodeId, p]));`
      line, placed immediately after the `if (timeline.length === 0) return [];`
      guard.
- [ ] The line that was `const point = timeline.find((p) => p.nodeId === nodeId);`
      now reads `const point = timelineByNodeId.get(nodeId);`.
- [ ] No other line in `server/parser.ts` changed (`git diff --stat` shows
      exactly 1 file changed; `git diff server/parser.ts` shows exactly 2
      added lines and 1 removed line, net +1 line).
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` exits 0 with the same pass count as before this change.

## STOP conditions

- If `timeline` (the second parameter) is ever mutated between its
  construction and the call to `buildLoadedContext` in a way this plan
  didn't account for (i.e. if `git diff` reveals `buildSessionDetail`
  mutates `timeline` in place after calling `buildTimeline` and before
  calling `buildLoadedContext` — check `server/parser.ts`'s
  `buildSessionDetail` region), STOP — a precomputed Map assumes `timeline`
  is stable for the duration of `buildLoadedContext`'s loop, matching what
  `.find()` already assumed, but confirm this before proceeding since a
  stale Map would silently return wrong results where `.find()` wouldn't.
  (This was checked and confirmed not to be the case as of commit
  `3aac79e` — `timeline` is passed straight through unmodified — but
  re-check if the surrounding code has changed.)
- If two entries in `timeline` are ever found to share the same `nodeId`
  (contradicting the uniqueness proof above), STOP — that would mean
  `Map.set` silently drops the earlier entry with that key, changing
  behavior from `.find()` (which always returns the *first* match). Add a
  one-line sanity check if in doubt: temporarily log
  `timeline.length !== timelineByNodeId.size` during manual testing against
  a real session before committing.

## Maintenance notes

- This function is one of four in `server/parser.ts` with its own
  independent `assistantIndex`-based fallback-id counter (the other three:
  `buildToolImpact`, `buildTimeline`, `buildAgentTreeFromEntries`). Plan 008
  in this same `plans/` directory unifies all four into a shared helper —
  execute that plan after this one if both are being done, since plan 008
  touches the same `assistantIndex`/`nodeId` lines in this function and
  doing this plan first avoids a merge conflict in the same region.
- If a future change ever needs `buildLoadedContext` to look up a point by
  something other than `nodeId` (e.g. by `turn` number), extend
  `timelineByNodeId` or add a second Map — don't reintroduce a `.find()`
  scan as a shortcut.
