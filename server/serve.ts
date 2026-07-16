import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { defaultSessionRoots } from "./sessions.js";

export type ServeOptions = {
  port?: number;
  host?: string;
  /** Serve built client assets. Defaults to NODE_ENV === "production". */
  serveClient?: boolean;
};

export type RunningServer = {
  port: number;
  host: string;
  close: () => Promise<void>;
};

export async function startServer(
  options: ServeOptions = {},
): Promise<RunningServer> {
  const port = options.port ?? Number(process.env.PORT ?? 8787);
  const host = options.host ?? "127.0.0.1";
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
