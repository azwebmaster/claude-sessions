#!/usr/bin/env node
import { parseArgs } from "node:util";
import { startServer } from "../server/serve.js";

const PACKAGE_NAME = "claude-sessions";

function printHelp(): void {
  console.log(`Usage: ${PACKAGE_NAME} <command> [options]

Commands:
  serve     Start the HTTP server (API + production UI when built)

Options for serve:
  -p, --port <number>   Port to listen on (default: 8787, or $PORT)
  -H, --host <host>     Hostname to bind (default: 127.0.0.1)
  -h, --help            Show this help message

Examples:
  ${PACKAGE_NAME} serve
  ${PACKAGE_NAME} serve --port 3000
  ${PACKAGE_NAME} serve -H 0.0.0.0 -p 8787
`);
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
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const [command] = positionals;

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

  console.error(`Unknown command: ${command}\n`);
  printHelp();
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
