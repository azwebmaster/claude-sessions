import { serve } from "@hono/node-server";
import { createServer } from "node:net";
import { createApp } from "./app.js";
import { defaultSessionRoots } from "./sessions.js";

/** Default port when none is requested (also settable via `$PORT`). */
export const DEFAULT_PORT = 8787;

/**
 * How many consecutive ports to try, starting at the requested one, before
 * giving up. Override with `$CLAUDE_SESSIONS_PORT_SCAN_SPAN`.
 */
export const DEFAULT_PORT_SCAN_SPAN = 50;

export type ServeOptions = {
  port?: number;
  host?: string;
  /** Serve built client assets. Defaults to NODE_ENV === "production". */
  serveClient?: boolean;
  /**
   * Number of ports to probe (starting at `port`) when the requested one is
   * busy. Defaults to `$CLAUDE_SESSIONS_PORT_SCAN_SPAN` or `DEFAULT_PORT_SCAN_SPAN`.
   */
  portScanSpan?: number;
};

export type RunningServer = {
  port: number;
  host: string;
  close: () => Promise<void>;
};

/** Resolve the configured port-scan span, ignoring invalid overrides. */
export function portScanSpan(requested?: number): number {
  if (requested !== undefined && Number.isFinite(requested) && requested >= 1) {
    return Math.floor(requested);
  }
  const fromEnv = Number(process.env.CLAUDE_SESSIONS_PORT_SCAN_SPAN);
  if (Number.isFinite(fromEnv) && fromEnv >= 1) return Math.floor(fromEnv);
  return DEFAULT_PORT_SCAN_SPAN;
}

/** Resolve true if `port` can be bound on `host`, false if it is in use. */
export function isPortAvailable(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = createServer();
    const done = (available: boolean) => {
      tester.removeAllListeners();
      tester.close(() => resolve(available));
    };
    tester.once("error", (err: NodeJS.ErrnoException) => {
      // EADDRINUSE / EACCES mean unusable; anything else is treated the same.
      tester.removeAllListeners();
      resolve(false);
      void err;
    });
    tester.once("listening", () => done(true));
    tester.listen(port, host);
  });
}

/**
 * Find the first bindable port in `[startPort, startPort + span)` on `host`.
 * Throws when every candidate in the range is taken.
 */
export async function findAvailablePort(
  startPort: number,
  host: string,
  span: number = DEFAULT_PORT_SCAN_SPAN,
): Promise<number> {
  const attempts = Math.max(1, Math.floor(span));
  for (let i = 0; i < attempts; i += 1) {
    const candidate = startPort + i;
    if (candidate > 65535) break;
    if (await isPortAvailable(candidate, host)) return candidate;
  }
  const endPort = Math.min(startPort + attempts - 1, 65535);
  throw new Error(
    `No available port found in range ${startPort}-${endPort} on ${host}. ` +
      `Free a port or pass a different --port.`,
  );
}

export async function startServer(
  options: ServeOptions = {},
): Promise<RunningServer> {
  const requestedPort = options.port ?? Number(process.env.PORT ?? DEFAULT_PORT);
  const host = options.host ?? "127.0.0.1";
  const span = portScanSpan(options.portScanSpan);

  const port = await findAvailablePort(requestedPort, host, span);
  if (port !== requestedPort) {
    console.log(
      `Port ${requestedPort} is in use; using the next free port ${port} ` +
        `(scanned up to ${span} ports).`,
    );
  }

  const app = createApp({
    port,
    serveClient: options.serveClient,
  });

  console.log(`Claude Sessions API listening on http://${host}:${port}`);
  console.log(`Session roots: ${defaultSessionRoots().join(", ")}`);

  const server = serve({ fetch: app.fetch, port, hostname: host });

  return {
    port,
    host,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
