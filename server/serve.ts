import { serve } from "@hono/node-server";
import { createServer } from "node:net";
import { createApp } from "./app.js";
import { defaultSessionRoots } from "./sessions.js";

export type ServeOptions = {
  port?: number;
  host?: string;
  /** Serve built client assets. Defaults to NODE_ENV === "production". */
  serveClient?: boolean;
  /**
   * When true, fail instead of falling back to another port if `port` is
   * in use. Set this when the port came from an explicit user request
   * (e.g. --port) rather than the default/$PORT fallback.
   */
  strictPort?: boolean;
};

export type RunningServer = {
  port: number;
  host: string;
  close: () => Promise<void>;
};

const MAX_PORT_ATTEMPTS = 20;

function isPortAvailable(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = createServer();
    tester.once("error", () => resolve(false));
    tester.listen(port, host, () => {
      tester.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(
  startPort: number,
  host: string,
  maxAttempts: number,
): Promise<number | undefined> {
  for (let port = startPort; port < startPort + maxAttempts; port++) {
    if (await isPortAvailable(port, host)) {
      return port;
    }
  }
  return undefined;
}

export async function startServer(
  options: ServeOptions = {},
): Promise<RunningServer> {
  const requestedPort = options.port ?? Number(process.env.PORT ?? 8788);
  const host = options.host ?? "127.0.0.1";

  let port: number;
  if (options.strictPort) {
    const found = await findAvailablePort(requestedPort, host, 1);
    if (found === undefined) {
      throw new Error(`Port ${requestedPort} is already in use.`);
    }
    port = found;
  } else {
    const found = await findAvailablePort(requestedPort, host, MAX_PORT_ATTEMPTS);
    if (found === undefined) {
      throw new Error(
        `No available port found in range ${requestedPort}-${requestedPort + MAX_PORT_ATTEMPTS - 1}`,
      );
    }
    port = found;
    if (port !== requestedPort) {
      console.log(`Port ${requestedPort} is in use, using ${port} instead.`);
    }
  }

  const app = createApp({
    port,
    serveClient: options.serveClient,
  });

  console.log(`Claude Sessions API listening on http://${host}:${port}`);
  console.log(`Session roots: ${defaultSessionRoots().join(", ")}`);

  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const s = serve({ fetch: app.fetch, port, hostname: host }, () => resolve(s));
  });

  return {
    port,
    host,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
