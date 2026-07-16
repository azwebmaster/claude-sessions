# Claude Sessions

TypeScript web app (React + pnpm + ESM) that reads local [Claude Code](https://code.claude.com) session transcripts, lists them, and profiles agent hierarchy, tool calls, token usage, and context growth.

## What it does

- Scans `~/.claude/projects` and `~/.config/claude/projects` (or `$CLAUDE_CONFIG_DIR/projects`)
- Lists sessions with summary, project path, token totals, peak context, tool/subagent counts
- Opens a session to show:
  - **Hierarchy** — root agent → assistant turns → tool calls → results → nested subagents
  - **Agent ↔ tool diagram** — interactive radial view (root centered; each tool node scoped to its calling agent; agent circle size = peak context or total tokens; tool size = attributed growth; link weight = call volume; expand to show all tools; zoom, pan, drag to rearrange; Arrange to auto-layout)
  - **Token usage** per agent and per assistant turn
  - **Context timeline** — how context size changes across turns
  - **Loaded context** — what makes up Claude's window at a turn (system prompt, CLAUDE.md / instructions, memory, MCPs, skills, deferred tools, files, conversation)
  - **Tool impact** — ranked by attributed context growth; each tool lists its heaviest calls (input + result) with expand for the full list
  - **Agent SDK analysis** — one-click optimization report via [`@anthropic-ai/claude-agent-sdk`](https://code.claude.com/docs/en/agent-sdk) (`getSessionInfo` / `getSessionMessages` + structured `query`)

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
claude-sessions analyze                 # most recently updated session
claude-sessions analyze <session-uuid>
claude-sessions analyze --model claude-haiku-4-5
claude-sessions --help
```

Port can also be set with `$PORT`. During development you can run the CLI via tsx without building:

```bash
pnpm exec tsx cli/index.ts serve
pnpm exec tsx cli/index.ts serve --port 3000
pnpm exec tsx cli/index.ts analyze
```

### Agent SDK analysis

Session detail pages expose **Analyze session**, which:

1. Builds a compact profile brief from the existing JSONL profiler
2. Enriches it with Agent SDK session APIs when the transcript is under `~/.claude/projects`
3. Runs a single-turn structured `query()` (default model: `claude-haiku-4-5`, override with `$CLAUDE_SESSIONS_ANALYZE_MODEL` or `--model`)

Requires Anthropic auth (`ANTHROPIC_API_KEY` or `claude auth login`). The HTTP endpoint is `POST /api/sessions/:id/analyze` (add `?stream=1` or `Accept: application/x-ndjson` for a progress stream).

Analysis runs headlessly (`permissionMode: dontAsk`) with:
- an **idle** timeout (default 90s without progress, `$CLAUDE_SESSIONS_ANALYZE_IDLE_TIMEOUT_MS`)
- a **hard** wall-clock cap (default 300s, `$CLAUDE_SESSIONS_ANALYZE_TIMEOUT_MS`)

The UI streams stage progress (brief → CLI start → auth → model → parse). When a `claude` binary is on `PATH` (or `$CLAUDE_SESSIONS_CLAUDE_PATH`), analysis prefers that executable so interactive CLI login credentials are reused; otherwise it uses the SDK-bundled CLI. If the interactive CLI works but the server still stalls, set `ANTHROPIC_API_KEY` on the server process.

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
