import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { stream } from "hono/streaming";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import {
  defaultSessionRoots,
  findSessionFile,
  listSessions,
  loadSessionRaw,
} from "./sessions.js";
import { buildSessionDetail } from "./parser.js";
import { AnalyzeSessionError, analyzeSession } from "./analyze.js";
import type { AnalyzeStreamEvent } from "../shared/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Package root when running from source; `dist/` when compiled. */
const packageRoot = path.resolve(__dirname, "..");

export type CreateAppOptions = {
  /** Serve built client assets (production). Defaults to NODE_ENV === "production". */
  serveClient?: boolean;
  /** Port shown in the dev landing page. */
  port?: number;
};

export function createApp(options: CreateAppOptions = {}): Hono {
  const serveClient =
    options.serveClient ?? process.env.NODE_ENV === "production";
  const port = options.port ?? Number(process.env.PORT ?? 8787);

  const app = new Hono();

  app.use("/api/*", cors());

  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      roots: defaultSessionRoots(),
    }),
  );

  app.get("/api/sessions", async (c) => {
    const sessions = await listSessions();
    return c.json({
      sessions,
      roots: defaultSessionRoots(),
      count: sessions.length,
    });
  });

  app.get("/api/sessions/:id", async (c) => {
    const id = c.req.param("id");
    const loaded = await loadSessionRaw(id);
    if (!loaded) {
      return c.json({ error: "Session not found", id }, 404);
    }
    const detail = buildSessionDetail(loaded.file, loaded.parsed);
    return c.json(detail);
  });

  app.get("/api/sessions/:id/raw", async (c) => {
    const id = c.req.param("id");
    const file = await findSessionFile(id);
    if (!file) return c.json({ error: "Session not found", id }, 404);
    return c.json({
      id: file.id,
      projectPath: file.projectPath,
      filePath: file.filePath,
      source: file.source,
      size: file.size,
    });
  });

  app.post("/api/sessions/:id/analyze", async (c) => {
    const id = c.req.param("id");
    const loaded = await loadSessionRaw(id);
    if (!loaded) {
      return c.json({ error: "Session not found", id }, 404);
    }

    let model: string | undefined;
    try {
      const body = await c.req.json();
      if (
        body &&
        typeof body === "object" &&
        typeof (body as { model?: unknown }).model === "string"
      ) {
        model = (body as { model: string }).model.trim() || undefined;
      }
    } catch {
      // empty / non-JSON body is fine
    }

    const accept = c.req.header("accept") ?? "";
    const streamRequested =
      c.req.query("stream") === "1" ||
      accept.includes("application/x-ndjson") ||
      accept.includes("text/event-stream");

    const detail = buildSessionDetail(loaded.file, loaded.parsed);

    if (streamRequested) {
      c.header("Content-Type", "application/x-ndjson; charset=utf-8");
      c.header("Cache-Control", "no-cache, no-transform");
      c.header("X-Content-Type-Options", "nosniff");
      return stream(c, async (out) => {
        const writeEvent = async (event: AnalyzeStreamEvent) => {
          await out.write(`${JSON.stringify(event)}\n`);
        };
        try {
          const analysis = await analyzeSession(detail, {
            model,
            onProgress: (event) => writeEvent(event),
          });
          await writeEvent({ type: "result", analysis });
        } catch (err) {
          if (err instanceof AnalyzeSessionError) {
            await writeEvent({
              type: "error",
              error: err.message,
              code: err.code,
            });
            return;
          }
          const message = err instanceof Error ? err.message : String(err);
          await writeEvent({
            type: "error",
            error: message,
            code: "unknown",
          });
        }
      });
    }

    try {
      const analysis = await analyzeSession(detail, { model });
      return c.json(analysis);
    } catch (err) {
      if (err instanceof AnalyzeSessionError) {
        const status =
          err.code === "auth"
            ? 503
            : err.code === "timeout"
              ? 504
              : err.code === "empty"
                ? 502
                : 500;
        return c.json({ error: err.message, code: err.code }, status);
      }
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message, code: "unknown" }, 500);
    }
  });

  if (serveClient) {
    // Compiled server lives at dist/server; Vite client at dist/client.
    const clientDir = path.join(packageRoot, "client");
    if (existsSync(clientDir)) {
      app.use("/*", serveStatic({ root: clientDir }));
      app.get("*", async (c) => {
        const { readFile } = await import("node:fs/promises");
        const html = await readFile(path.join(clientDir, "index.html"), "utf8");
        return c.html(html);
      });
    }
  } else {
    app.get("/", (c) =>
      c.html(
        `<!doctype html><html><body style="font-family:system-ui;padding:2rem">
        <h1>Claude Sessions API</h1>
        <p>Dev API is running on port ${port}. Start the Vite client with <code>pnpm dev:client</code>.</p>
        <ul>
          <li><a href="/api/health">/api/health</a></li>
          <li><a href="/api/sessions">/api/sessions</a></li>
          <li>POST /api/sessions/:id/analyze</li>
        </ul>
      </body></html>`,
      ),
    );
  }

  return app;
}
