# Claude Sessions

TypeScript web app (React + pnpm + ESM) that reads local [Claude Code](https://code.claude.com) session transcripts, lists them, and profiles agent hierarchy, tool calls, token usage, and context growth.

## What it does

- Scans `~/.claude/projects` and `~/.config/claude/projects` (or `$CLAUDE_CONFIG_DIR/projects`)
- Lists sessions with summary, project path, token totals, peak context, tool/subagent counts
- Opens a session to show:
  - **Hierarchy** — root agent → assistant turns → tool calls → results → nested subagents
  - **Token usage** per agent and per assistant turn
  - **Context timeline** — how context size changes across turns
  - **Tool impact** — ranked by attributed context growth; click a tool for per-call inputs, results, and sizes

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

Production:

```bash
pnpm build
NODE_ENV=production pnpm start
```

## Scripts

| Script | Description |
| --- | --- |
| `pnpm dev` | Watch the Hono API server |
| `pnpm dev:client` | Vite React client |
| `pnpm dev:app` | API + client together |
| `pnpm test` | Parser unit tests |
| `pnpm typecheck` | TypeScript checks |
| `pnpm build` | Build client + compile server |

## Session format

Claude Code writes append-only JSONL at:

```text
~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl
~/.claude/projects/<encoded-cwd>/<session-uuid>/subagents/agent-*.jsonl
```

Assistant records carry `message.usage` (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`). Tool results live in subsequent user entries as `tool_result` blocks.
