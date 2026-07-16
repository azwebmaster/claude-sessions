# Claude Sessions

TypeScript web app (React + pnpm + ESM) that reads local [Claude Code](https://code.claude.com) session transcripts, lists them, and profiles agent hierarchy, tool calls, token usage, and context growth.

## What it does

- Scans `~/.claude/projects` and `~/.config/claude/projects` (or `$CLAUDE_CONFIG_DIR/projects`)
- Lists sessions with summary, project path, token totals, peak context, tool/subagent counts
- Opens a session to show:
  - **Hierarchy** — root agent → assistant turns → tool calls → results → nested subagents
  - **Agent ↔ tool diagram** — interactive radial view (root centered; agent circle size = peak context or total tokens; tool size = attributed growth; link weight = call volume; expand to show all tools; zoom, pan, drag to rearrange)
  - **Token usage** per agent and per assistant turn
  - **Context timeline** — how context size changes across turns
  - **Loaded context** — what makes up Claude's window at a turn (system prompt, CLAUDE.md / instructions, memory, MCPs, skills, deferred tools, files, conversation)
  - **Tool impact** — ranked by attributed context growth; each tool lists its heaviest calls (input + result) with expand for the full list

Demo fixtures under `fixtures/projects` are always included so the UI works without local Claude Code history.

## Quick start

```bash
pnpm install
pnpm dev          # API on http://127.0.0.1:8787
pnpm dev:client   # UI on http://127.0.0.1:5173 (proxies /api)
```

Or run both:

```bash
pnpm dev:app
```

## CLI

This package exposes a `claude-sessions` binary. Start the HTTP server with `serve`:

```bash
pnpm build
NODE_ENV=production node dist/cli/index.js serve
# equivalent:
NODE_ENV=production pnpm serve
NODE_ENV=production pnpm start
```

When installed as a dependency (or linked globally), the same command is available as:

```bash
claude-sessions serve
```

Options:

```bash
claude-sessions serve --port 3000
claude-sessions serve -H 0.0.0.0 -p 8787
claude-sessions --help
```

Port can also be set with `$PORT`. During development you can run the CLI via tsx without building:

```bash
pnpm exec tsx cli/index.ts serve
pnpm exec tsx cli/index.ts serve --port 3000
```

## Scripts

| Script | Description |
| --- | --- |
| `pnpm dev` | Watch the CLI `serve` command (Hono API) |
| `pnpm dev:client` | Vite React client |
| `pnpm dev:app` | API + client together |
| `pnpm serve` / `pnpm start` | Run `claude-sessions serve` from the build |
| `pnpm test` | Parser unit tests |
| `pnpm typecheck` | TypeScript checks |
| `pnpm build` | Build client + compile CLI/server |

## Session format

Claude Code writes append-only JSONL at:

```text
~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl
~/.claude/projects/<encoded-cwd>/<session-uuid>/subagents/agent-*.jsonl
```

Assistant records carry `message.usage` (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`). Tool results live in subsequent user entries as `tool_result` blocks.
