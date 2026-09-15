# 002 — Add a GitHub Actions CI workflow (typecheck + test + build)

## Status

- **Priority:** P1
- **Effort:** S
- **Risk:** Low
- **Depends on:** none
- **Category:** DX & tooling
- **Planned at commit:** `3aac79e`
- **Issue:** (none filed)

## Why this matters

This repository has no CI at all — confirmed: `.github/` does not exist
anywhere in the repo (`ls -la .github` → "No such file or directory"), and
there is no other CI config file (no `.circleci/`, `.gitlab-ci.yml`,
`azure-pipelines.yml`, etc.).

The project already has real, working verification commands
(`pnpm typecheck`, `pnpm test`, `pnpm build`) — they just never run
automatically. That means a broken PR (failing typecheck, a regressed test,
a build that no longer compiles) can currently be merged into `main` without
anyone or anything catching it before merge. This is the single highest-
leverage DX gap in the repo: it's cheap to fix (one new file) and it
protects every other change made to this codebase from here on, including
the other plans in this `plans/` directory.

## Current state

Confirmed absence of any workflow directory:

```
$ ls -la .github
ls: .github: No such file or directory
```

Confirmed package manager and lockfile:

```
$ ls pnpm-lock.yaml
pnpm-lock.yaml
$ pnpm --version
10.34.5
```

`package.json` has no `packageManager` field pinning a pnpm version, and no
`engines.pnpm` — only `"engines": { "node": ">=20" }`. This plan pins the
CI's pnpm version explicitly (via `pnpm/action-setup`'s `version` input)
rather than relying on corepack or an unpinned "latest", since neither
`package.json` nor any other file in the repo currently records which pnpm
major version this lockfile was generated with beyond what's installed
locally (`10.34.5`).

Full `scripts` block from `package.json`, for reference:

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

All three (`typecheck`, `test`, `build`) were independently confirmed to run
successfully and side-effect-free (aside from writing to `dist/`, which is
gitignored) against the current `main` at commit `3aac79e` during this
audit.

## Commands you will need

| Purpose | Command |
|---|---|
| Confirm scripts still work locally before wiring CI | `pnpm typecheck && pnpm test && pnpm build` |
| Validate the workflow YAML is well-formed (no `act`/GH required) | `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"` (or any YAML validator available; if none is available, careful manual review is acceptable — see Step 2) |

## Scope

**In scope:**
- New file `.github/workflows/ci.yml`.

**Out of scope — do not touch:**
- Do not add a release/publish workflow, a dependabot config, branch
  protection rules, or any other GitHub-side setting. This plan is CI checks
  only.
- Do not add caching-only optimizations beyond the standard
  `actions/setup-node` cache mechanism used below — no separate cache action
  needed for a repo this size.
- Do not modify `package.json` scripts. If `pnpm build`, `pnpm typecheck`, or
  `pnpm test` fail when you run them locally in Step 1 below, STOP — see
  STOP conditions. Do not "fix" the scripts as part of this plan; that's a
  different, separate change.

## Git workflow

1. Create a branch off `main`: `git checkout -b ci/add-github-actions-workflow`.
2. Add the single new file as one commit.
3. Do not push or open a PR as part of this plan unless the person running
   it tells you to — stop after the commit and report status.

## Steps

### Step 1 — Confirm the baseline locally

Before adding CI, confirm all three commands the workflow will run still
pass on a clean checkout:

```
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

**Verify:** all four commands exit 0. `pnpm test` reports all tests passing
(64 at the time this plan was written — see plan 001, which may have raised
this to 69 if executed first; either count passing with 0 failures is
acceptable here, this plan does not require an exact number).

If any of the four commands fails, STOP — see STOP conditions below. Do not
attempt to fix the failing command as part of this plan.

### Step 2 — Create the workflow file

Create `.github/workflows/ci.yml` (and the `.github/workflows/` directories,
which do not yet exist) with the following content:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Typecheck
        run: pnpm typecheck

      - name: Test
        run: pnpm test

      - name: Build
        run: pnpm build
```

Notes on the choices baked into this file (do not change these without a
reason, since each maps to a fact confirmed above):
- `pnpm/action-setup@v4` with `version: 10` matches the locally-confirmed
  pnpm major version (`10.34.5`) and the lockfile format it produced.
- `node-version: 20` matches `package.json`'s `"engines": { "node": ">=20" }`
  floor — using the floor, not a newer version, maximizes the chance CI
  reflects what the stated minimum supported Node actually does.
- `pnpm install --frozen-lockfile` (not plain `pnpm install`) so CI fails
  loudly if `pnpm-lock.yaml` is out of sync with `package.json`, rather than
  silently regenerating the lockfile in the CI runner.
- `pull_request` with no `branches` filter runs on PRs targeting any base
  branch; `push` is restricted to `main` only, to avoid double-running on
  every push to a PR's own branch (which already triggers `pull_request`).

**Verify:** the file parses as valid YAML. If a YAML validator is available
(e.g. `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"`),
run it and confirm no exception. If none is available, re-read the file
character-by-character for indentation consistency (this workflow uses
2-space indentation throughout, list items introduced by `- `) before
proceeding.

## Test plan

There is no unit-testable code in this change — it is a CI configuration
file. The test plan is:
1. The YAML-validity check in Step 2's Verify.
2. After this change is pushed (not part of this plan's execution — see Git
   workflow above, which stops after the local commit), the actual proof
   this works is the workflow running green on GitHub Actions for the first
   push/PR that includes it. Note this expectation in your final report so
   whoever pushes the branch knows to check the Actions tab.

## Done criteria

- [ ] `.github/workflows/ci.yml` exists.
- [ ] The file contains exactly one job (`build`) with five steps in this
      order: checkout, pnpm setup, node setup, install, typecheck, test,
      build (7 steps total including checkout).
- [ ] `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm build`
      all succeed locally (this is the same sequence the workflow runs).
- [ ] `git diff --stat` shows exactly one new file: `.github/workflows/ci.yml`.
      No other file is modified.

## STOP conditions

- If `pnpm install`, `pnpm typecheck`, `pnpm test`, or `pnpm build` fails
  locally in Step 1 on an unmodified `main` checkout, STOP before creating
  the workflow file and report the exact failure — wiring a CI workflow
  around a command that doesn't currently pass would just produce a
  permanently-red CI, which is worse than no CI. Report back instead of
  attempting to fix the underlying script.
- If `.github/workflows/` already contains other workflow files by the time
  this plan is executed (i.e. the repo changed since this plan was written
  at commit `3aac79e`), STOP and report — check whether an existing workflow
  already covers this ground before adding a duplicate.

## Maintenance notes

- If a future change adds a new top-level script that should gate merges
  (e.g. a `lint` script — see plan 006 in this same `plans/` directory,
  which adds one), add a corresponding step to this workflow's `build` job,
  in the same style as the existing steps.
- If `package.json`'s `engines.node` floor ever changes, update
  `node-version` in this workflow to match.
- If the repo's pnpm major version is ever bumped, update `version: 10` in
  the `pnpm/action-setup` step to match, or the workflow's install step may
  silently use a mismatched pnpm and produce a different lockfile resolution
  than local development.
