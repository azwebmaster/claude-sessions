import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Keep the dev proxy pointed at the API. When the API is started on a custom
// port (e.g. `pnpm dev` picked a free port), set `API_PORT`/`PORT` so the Vite
// client proxies to the same place. Defaults to the API's default 8787.
const apiPort = Number(process.env.API_PORT ?? process.env.PORT ?? 8787) || 8787;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
        // Analyze can stream for several minutes; don't cut the proxy early.
        timeout: 320_000,
        proxyTimeout: 320_000,
      },
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
});
