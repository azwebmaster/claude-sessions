import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const isProd = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? 8787);

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

if (isProd) {
  // Compiled server lives at dist/server; Vite client at dist/client.
  const clientDir = path.join(rootDir, "client");
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
        </ul>
      </body></html>`,
    ),
  );
}

console.log(`Claude Sessions API listening on http://127.0.0.1:${port}`);
console.log(`Session roots: ${defaultSessionRoots().join(", ")}`);

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
