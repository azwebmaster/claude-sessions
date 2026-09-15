# claude-sessions

## Commands

- Package manager: **pnpm** (see `pnpm-lock.yaml`) — use `pnpm`, never `npm`/`npx`/`yarn`.
- Tests: `pnpm test` runs Node's built-in test runner via `tsx --test` against the files listed in `package.json`'s `test` script. There is no vitest/jest in this repo — don't reach for `npx vitest run`.
- Typecheck: `pnpm run typecheck`
- Build: `pnpm run build`
- Dev (server + client): `pnpm run dev:app`

## Verification

Run `pnpm test` / `pnpm run typecheck` via a subagent or a CLI-execution skill, not inline in the root conversation — these are non-read-only external commands under the global CLI Execution rule.

## Code navigation

This repo is indexed by CodeGraph (`.codegraph/`) — prefer `codegraph_explore` over `Read`/`Grep` for symbol lookups before falling back to file reads.
