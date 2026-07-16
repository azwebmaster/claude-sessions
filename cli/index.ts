#!/usr/bin/env node
import { parseArgs } from "node:util";
import { startServer } from "../server/serve.js";
import {
  AnalyzeSessionError,
  analyzeSession,
} from "../server/analyze.js";
import { buildSessionDetail } from "../server/parser.js";
import { listSessions, loadSessionRaw } from "../server/sessions.js";

const PACKAGE_NAME = "claude-sessions";

function printHelp(): void {
  console.log(`Usage: ${PACKAGE_NAME} <command> [options]

Commands:
  serve                 Start the HTTP server (API + production UI when built)
  analyze [sessionId]   Analyze a session with the Claude Agent SDK
                        (defaults to the most recently updated session)

Options for serve:
  -p, --port <number>   Port to listen on (default: 8787, or $PORT)
  -H, --host <host>     Hostname to bind (default: 127.0.0.1)

Options for analyze:
  -m, --model <model>   Model for Agent SDK analysis (or $CLAUDE_SESSIONS_ANALYZE_MODEL)

Global:
  -h, --help            Show this help message

Examples:
  ${PACKAGE_NAME} serve
  ${PACKAGE_NAME} serve --port 3000
  ${PACKAGE_NAME} analyze
  ${PACKAGE_NAME} analyze 11111111-1111-1111-1111-111111111111
  ${PACKAGE_NAME} analyze --model claude-haiku-4-5
`);
}

async function runAnalyze(options: {
  sessionId?: string;
  model?: string;
}): Promise<void> {
  let sessionId = options.sessionId;
  if (!sessionId) {
    const sessions = await listSessions();
    const current = sessions[0];
    if (!current) {
      console.error("No sessions found to analyze.");
      process.exit(1);
    }
    sessionId = current.id;
    console.error(
      `Analyzing current session ${sessionId}${current.summary ? ` (${current.summary})` : ""}…`,
    );
  } else {
    console.error(`Analyzing session ${sessionId}…`);
  }

  const loaded = await loadSessionRaw(sessionId);
  if (!loaded) {
    console.error(`Session not found: ${sessionId}`);
    process.exit(1);
  }

  const detail = buildSessionDetail(loaded.file, loaded.parsed);
  try {
    const analysis = await analyzeSession(detail, { model: options.model });
    console.log(JSON.stringify(analysis, null, 2));
  } catch (err) {
    if (err instanceof AnalyzeSessionError) {
      console.error(err.message);
      process.exit(err.code === "auth" ? 2 : 1);
    }
    throw err;
  }
}

async function main(): Promise<void> {
  // Package managers may forward a lone `--` (e.g. `pnpm serve -- -p 3000`).
  const argv = process.argv.slice(2).filter((arg) => arg !== "--");

  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: "string", short: "p" },
      host: { type: "string", short: "H" },
      model: { type: "string", short: "m" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const [command, sessionId] = positionals;

  if (values.help || !command) {
    printHelp();
    process.exit(values.help ? 0 : 1);
  }

  if (command === "serve") {
    const port = values.port !== undefined ? Number(values.port) : undefined;
    if (port !== undefined && (!Number.isFinite(port) || port <= 0)) {
      console.error(`Invalid port: ${values.port}`);
      process.exit(1);
    }

    await startServer({
      port,
      host: values.host,
    });
    return;
  }

  if (command === "analyze") {
    await runAnalyze({
      sessionId,
      model: values.model,
    });
    return;
  }

  console.error(`Unknown command: ${command}\n`);
  printHelp();
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
