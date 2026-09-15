# 006 — Add ESLint (flat config, typescript-eslint + react-hooks), wire a `lint` script

## Status

- **Priority:** P2
- **Effort:** M
- **Risk:** Medium (the initial `--fix` + manual cleanup pass can touch many
  files; see Steps and STOP conditions)
- **Depends on:** none — but this plan's new `pnpm lint` script is a natural
  candidate to add to plan 002's CI workflow in a later round; not required
  by this plan.
- **Category:** DX & tooling
- **Planned at commit:** `3aac79e`
- **Issue:** (none filed)

## Why this matters

This repository has no linter configured at all — confirmed: no
`eslint.config.js`/`.eslintrc*`/`biome.json` anywhere in the repo root, and
no `lint` script in `package.json`. The project already runs
`tsc --noEmit` (via `pnpm typecheck`), which catches type errors, but a
type checker does not catch a large class of real bugs and inconsistencies
that a linter does: stale/unused React hook dependencies (a common source of
subtle bugs in a React 19 codebase with `useEffect`/`useMemo` throughout
`src/`), violations of the Rules of Hooks, unreachable code, accidental
`==` vs `===`, and general style drift across a codebase with no enforced
convention today.

This plan adds a minimal, standard flat-config ESLint setup — TypeScript
rules for both the client (`src/`, `shared/`) and server/CLI (`server/`,
`cli/`) code, plus React-hooks-specific rules scoped to the client only
(server/CLI code has no React) — and wires a `lint` script. It intentionally
does **not** add a type-checked ("recommendedTypeChecked") rule set, since
`pnpm typecheck` already covers type-level correctness via `tsc`; adding a
second, slower type-aware linter pass on top would be redundant complexity
for a "add a linter" ask.

## Current state

Confirmed no existing lint config:

```
$ ls -la .eslintrc* eslint.config.* biome.json 2>&1
ls: .eslintrc*: No such file or directory
ls: eslint.config.*: No such file or directory
ls: biome.json: No such file or directory
```

Confirmed no `lint` script in `package.json`'s `scripts` block (full block,
for reference):

```json
"scripts": {
  "dev": "tsx watch cli/index.ts serve",
  "dev:client": "vite",
  "dev:app": "pnpm dev & pnpm dev:client",
  "build": "tsc -p tsconfig.server.json --noEmit && vite build && tsc -p tsconfig.server.json",
  "serve": "node dist/cli/index.js serve",
  "start": "node dist/cli/index.js serve",
  "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.server.json --noEmit",
  "test": "tsx --test server/parser.test.ts server/analyze.test.ts server/analysisCache.test.ts server/runAnalyzeWithCache.test.ts shared/formatAnalysisPrompt.test.ts src/lib/tree.test.ts src/lib/sessionFilters.test.ts src/lib/sessionSort.test.ts src/components/AgentToolDiagram.test.ts src/theme/tokens.test.ts"
}
```

The repo's two separate TypeScript project configs, which this plan's lint
config should mirror in scope (client vs. server split):

`tsconfig.json` (client — `src/`, `shared/`, JSX, DOM lib):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    ...
  },
  "include": ["src", "shared"]
}
```

`tsconfig.server.json` (server/CLI — `cli/`, `server/`, `shared/`, Node,
no DOM/JSX):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    ...
  },
  "include": ["cli", "server", "shared"]
}
```

`.gitignore` (full file, confirms `dist/` is build output and should be
excluded from linting):

```
node_modules/
dist/
.DS_Store
*.log
.env
.env.*
!.env.example
.vite/
```

Confirmed available package versions at the time this plan was written
(via `pnpm view <pkg> version`): `eslint@10.10.0`,
`typescript-eslint@8.70.0`, `eslint-plugin-react-hooks@7.1.1`,
`@eslint/js@10.0.1`.

Confirmed `eslint-plugin-react-hooks@7.1.1`'s flat-config export shape (from
its own README and its built `configs.flat` object) — it exports
`reactHooks.configs.flat.recommended`, an object of the shape
`{ plugins: { "react-hooks": <plugin> }, rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "warn", ... } }`
with **no `files` restriction baked in** — this plan scopes it to
`src/**/*.{ts,tsx}` explicitly in Step 2, since applying React-specific
hook rules to `server/`/`cli/` code (which has no React) would be
pointless, if harmless, noise.

## Commands you will need

| Purpose | Command |
|---|---|
| Install the new devDependencies | `pnpm add -D eslint typescript-eslint eslint-plugin-react-hooks @eslint/js` |
| Run lint | `pnpm lint` |
| Run lint with autofix (used once, in Step 3) | `pnpm lint -- --fix` |
| Typecheck (must still pass unchanged) | `pnpm typecheck` |
| Test (must still pass unchanged) | `pnpm test` |

## Scope

**In scope:**
- Add four new devDependencies: `eslint`, `typescript-eslint`,
  `eslint-plugin-react-hooks`, `@eslint/js`.
- New file `eslint.config.js` at the repo root.
- `package.json` — add a `lint` script.
- Whatever files `--fix` (Step 3) and any manual follow-up (Step 4) end up
  touching to reach a clean `pnpm lint` run.

**Out of scope — do not touch:**
- Do not add Prettier or any formatter — this plan is a linter only, not a
  formatting tool. Do not add a `.prettierrc` or format-on-save config.
- Do not enable type-aware/"type-checked" typescript-eslint rule sets
  (`recommendedTypeChecked`, `strictTypeChecked`, etc.) — see "Why this
  matters" above; `pnpm typecheck` already covers that ground and adding a
  second type-aware pass is out of scope for this plan.
- Do not add the lint script to CI (`.github/workflows/ci.yml` from plan
  002) as part of this plan — that's a natural follow-up but is a decision
  for whoever reviews both changes together, not something to bundle in
  silently here.
- Do not change any application logic to fix a lint finding beyond what
  `--fix` does automatically or what Step 4 explicitly calls for (unused
  var/import removal, obvious hook-dependency-array fixes). If a lint
  finding looks like it reveals a *real bug* (not just a style issue),
  do not fix the bug as part of this plan — flag it in your final report
  instead, since fixing a behavioral bug is a separate change requiring its
  own scoped review.

## Git workflow

1. Create a branch off `main`: `git checkout -b chore/add-eslint`.
2. Commit 1: add the devDependencies + `eslint.config.js` + the `lint`
   script (Steps 1-2).
3. Commit 2: the `--fix` output and any manual cleanup (Steps 3-4), as a
   separate commit so the tooling addition and the resulting code changes
   are easy to review independently.
4. Do not push or open a PR as part of this plan unless the person running
   it tells you to — stop after the commits and report status.

## Steps

### Step 1 — Install dependencies

```
pnpm add -D eslint typescript-eslint eslint-plugin-react-hooks @eslint/js
```

**Verify:** `package.json`'s `devDependencies` now includes all four
packages; `pnpm-lock.yaml` is updated (per this repo's own
dependency-manifest convention — running the install command handles this
automatically, no separate step needed).

### Step 2 — Add `eslint.config.js` and the `lint` script

Create `eslint.config.js` at the repo root:

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: reactHooks.configs.flat.recommended.plugins,
    rules: reactHooks.configs.flat.recommended.rules,
  },
);
```

In `package.json`, add a `lint` script. Insert it into the existing
`scripts` block (placement: immediately after `"typecheck"`, before
`"test"`, to group the two static-check scripts together):

```json
"typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.server.json --noEmit",
"lint": "eslint .",
"test": "tsx --test server/parser.test.ts server/analyze.test.ts server/analysisCache.test.ts server/runAnalyzeWithCache.test.ts shared/formatAnalysisPrompt.test.ts src/lib/tree.test.ts src/lib/sessionFilters.test.ts src/lib/sessionSort.test.ts src/components/AgentToolDiagram.test.ts src/theme/tokens.test.ts"
```

Do not change any other existing script.

**Verify:** `pnpm lint` runs (exits with either 0 or a nonzero count of
findings — either is expected at this point; the goal of this Verify step
is just that the command runs without an ESLint *configuration* error, e.g.
"Cannot find module" or "Unexpected top-level property"). Note how many
problems it reports before proceeding to Step 3.

### Step 3 — Autofix what can be autofixed

```
pnpm lint -- --fix
```

**Verify:** re-run `pnpm lint` (without `--fix`) and note how many problems
remain — this is the fixed set that needs Step 4's judgment, not further
`--fix` runs (running `--fix` twice in a row should be a no-op; if it isn't,
something is wrong and you should stop and report rather than looping
`--fix`).

### Step 4 — Resolve remaining findings by hand

For whatever `pnpm lint` still reports after Step 3, go file by file. Two
categories of finding are expected to dominate, given this is a from-scratch
lint setup on an existing codebase:
- **Unused variables/imports** (`@typescript-eslint/no-unused-vars`,
  overlapping with `tsc`'s own `noUnusedLocals`/`noUnusedParameters`, which
  are already `true` in both tsconfigs — so these should be rare; if there
  are many, note that as a surprising finding in your report rather than
  mass-deleting without checking each one is truly dead code per this
  repo's own "surgical changes" convention — don't delete pre-existing dead
  code that isn't obviously a leftover import).
- **React hook dependency warnings** (`react-hooks/exhaustive-deps`, a
  `warn`-severity rule per the recommended config) in `src/`. For each one,
  read the surrounding component code before changing the dependency array
  — a missing dependency is sometimes intentional (e.g. a stable
  ref/setState function that doesn't need to be listed) and the rule
  supports an inline `// eslint-disable-next-line react-hooks/exhaustive-deps`
  escape with a one-line comment explaining why, rather than blindly adding
  everything the rule suggests, which can introduce a real bug (e.g. an
  infinite re-render loop) if applied mechanically.

Any finding that looks like a genuine logic bug rather than a style issue —
STOP and report it rather than fixing the underlying bug (see Scope
above).

**Verify:** `pnpm lint` exits 0 (zero remaining problems, or only
explicitly-suppressed ones with a justifying comment).

### Step 5 — Full verification

```
pnpm typecheck
pnpm test
pnpm build
```

**Verify:** all three exit 0, with the same test pass count as before this
plan (Step 3/4's fixes should not change runtime behavior — if any test
newly fails, treat it as a STOP condition, see below, since a lint autofix
changing test outcomes means it changed behavior, not just style).

## Test plan

This plan adds a static-analysis tool, not application code — there is no
new unit test to write. The verification is:
1. `pnpm lint` exits 0 after Steps 3-4.
2. `pnpm typecheck` and `pnpm test` still pass, with `pnpm test`'s pass
   count unchanged from before this plan, proving Step 3/4's changes were
   behavior-preserving.

## Done criteria

- [ ] `eslint`, `typescript-eslint`, `eslint-plugin-react-hooks`, and
      `@eslint/js` appear in `package.json`'s `devDependencies`.
- [ ] `eslint.config.js` exists at the repo root, ignoring `dist/**`,
      applying `@eslint/js` + `typescript-eslint` recommended rules
      repo-wide, and `eslint-plugin-react-hooks`'s recommended rules scoped
      to `src/**/*.{ts,tsx}` only.
- [ ] `package.json` has a `"lint": "eslint ."` script.
- [ ] `pnpm lint` exits 0.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` exits 0 with the same pass count as the pre-plan baseline.
- [ ] `pnpm build` exits 0.
- [ ] Every file touched outside of `eslint.config.js`/`package.json`/
      `pnpm-lock.yaml` was touched only by `--fix` or by a hand-fix
      documented in your final report (no unrelated changes).

## STOP conditions

- If `pnpm lint -- --fix` (Step 3) changes the result of `pnpm test` (a
  previously-passing test now fails, or vice versa), STOP — an autofix
  should never change runtime behavior; if it did, something about that
  fix's rule needs to be disabled rather than accepted, and that decision
  should go back to whoever is reviewing this plan's execution.
- If more than roughly 30 findings remain after `--fix` (Step 3) and need
  hand resolution (Step 4), STOP after triaging and categorizing them, and
  report the breakdown instead of pushing through — a surprisingly large
  finding count on a first-time lint setup often means a default rule set
  is a poor fit for this codebase's existing conventions, and that's a
  judgment call for the person who requested this plan, not something to
  force through by disabling rules wholesale.
- If any `react-hooks/exhaustive-deps` warning's "correct" fix (per the
  rule) looks like it would change render behavior (e.g. adding a
  dependency that changes on every render, causing an effect to fire every
  render), STOP on that specific finding and report it rather than applying
  the rule's suggestion mechanically.

## Maintenance notes

- Once this is in place, plan 002's CI workflow (`.github/workflows/ci.yml`)
  is a natural place to add a `pnpm lint` step in a later round — this plan
  deliberately doesn't do that itself (see Scope), so don't forget it's now
  possible.
- Any new file added to `src/` going forward is automatically covered by
  the `react-hooks` rules via the `files: ["src/**/*.{ts,tsx}"]` glob; no
  per-file registration needed.
- If this codebase later adopts React Compiler or a newer hooks convention,
  `eslint-plugin-react-hooks` also ships a `recommended-latest` flat config
  (with additional experimental compiler rules) as a drop-in replacement
  for `recommended` in `eslint.config.js` — swap it in deliberately, not by
  accident, since it includes rules beyond the stable "Rules of Hooks" set.
